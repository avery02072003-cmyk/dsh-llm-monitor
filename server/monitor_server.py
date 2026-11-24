"""dsh-llm-monitor server: JSON endpoints for the DSH sidebar tab (or any browser).

GET  /stats  -> llama-server health/metrics (+ live speed) + NVIDIA GPU + system memory.
GET  /helper, POST /helper -> outsourcing section (optional, see outsource_panel.py).
POST /vision -> turn the model's vision (image input) on/off by restarting it (optional, off by default).

Stdlib only. The llama-server API key (if any) is read from the environment or a file and is
never included in the output.

Usage:
    python monitor_server.py [--host 127.0.0.1] [--port 8001] [--llama http://127.0.0.1:8000]
                             [--llama-log FILE] [--vision-flag FILE --vision-restart-cmd CMD]

Environment (all optional):
    LLAMA_API_KEY         API key passed to llama-server (--api-key)
    LLAMA_API_KEY_FILE    file containing the API key (used when LLAMA_API_KEY is unset)
    LLAMA_LOG_FILE        llama-server's stderr log; lets the tab show prompt-processing progress
    VISION_FLAG_FILE      marker file: it exists  <=>  your start script loads the vision projector (mmproj)
    VISION_RESTART_CMD    command that restarts llama-server so it re-reads the marker file
"""
import argparse
import ctypes
import json
import os
import re
import shlex
import subprocess
import sys
import threading
import time
import urllib.request
from urllib.parse import urlparse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
try:
    from outsource_panel import Panel
except ImportError:  # the outsourcing section is optional
    Panel = None

TTL = 1.0
LLAMA = 'http://127.0.0.1:8000'
PANEL = None  # set in main(): backend of the tab's outsourcing section
KEY = ''
LOG = None          # set in main(): llama-server stderr log (prompt-processing progress), optional
VISION_FLAG = None  # set in main(): marker file for the vision switch, optional
VISION_CMD = None   # set in main(): command that restarts the model, optional


def load_key():
    key = os.environ.get('LLAMA_API_KEY', '').strip()
    if not key and os.environ.get('LLAMA_API_KEY_FILE'):
        try:
            key = Path(os.environ['LLAMA_API_KEY_FILE']).read_text(encoding='utf-8').strip()
        except OSError:
            key = ''
    return key


def llama_get(path, timeout=2.0):
    headers = {'Authorization': 'Bearer ' + KEY} if KEY else {}
    req = urllib.request.Request(LLAMA + path, headers=headers)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read().decode('utf-8', 'replace')


def parse_metrics(text):
    out = {}
    for line in text.splitlines():
        m = re.match(r'^llamacpp:([a-z_]+)\s+([-+0-9.eE]+)\s*$', line)
        if m:
            out[m.group(1)] = float(m.group(2))
    return out


# llama.cpp's llamacpp:*_tokens_seconds gauges are per-scrape-window averages that reset to 0 when idle,
# so derive held speeds from the cumulative counters instead.
_SP = {}


def _speed(kind, m, busy):
    """kind: 'gen' or 'prompt'. Adds <kind>_live, <kind>_last (last finished reply, held) and <kind>_avg (since model start)."""
    tok_k, sec_k = (('tokens_predicted_total', 'tokens_predicted_seconds_total') if kind == 'gen'
                    else ('prompt_tokens_total', 'prompt_seconds_total'))
    tok, sec = m.get(tok_k), m.get(sec_k)
    if tok is None or sec is None:
        return
    st = _SP.setdefault(kind, {'tok': tok, 'sec': sec, 'at': 0.0, 'as': 0.0, 'last': None})
    if tok < st['tok'] or sec < st['sec']:  # model restarted: counters reset
        st.update(tok=tok, sec=sec, at=0.0, **{'as': 0.0}, last=None)
    dt, ds = tok - st['tok'], sec - st['sec']
    st['tok'], st['sec'] = tok, sec
    if dt > 0 and ds > 0:
        st['at'] += dt
        st['as'] += ds
        st['live'] = dt / ds
    else:
        st['live'] = None
        if st['as'] > 0 and not busy:  # a reply just finished: hold its average
            st['last'] = st['at'] / st['as']
            st['at'] = st['as'] = 0.0
    m[kind + '_live'] = st.get('live')
    m[kind + '_last'] = st['last'] if st['last'] is not None else (st['at'] / st['as'] if st['as'] > 0 else None)
    m[kind + '_avg'] = tok / sec if sec > 0 else None


# Some llama-server builds only update the /metrics counters when a request ends, so there is no live tok/s
# while it generates. Two signals prove the model is moving:
#   1) busy_secs: how long the current job has been running (we track the start of is_processing)
#   2) prefill: the newest "prompt processing" progress line at the end of llama-server's log (needs --llama-log)
# While generating, /slots may carry next_token[].n_decoded; its delta between two polls gives a real live tok/s.
_PF = re.compile(r'prompt processing, n_tokens =\s*(\d+), progress = ([0-9.]+), t =\s*([0-9.]+) s / ([0-9.]+) tokens per second')
_BUSY = {'since': None}
_DEC = {'last': None}


def prefill_state():
    """Newest prefill progress, or None. age = seconds since the log file was last written."""
    if not LOG:
        return None
    try:
        st = LOG.stat()
        with open(LOG, 'rb') as f:
            f.seek(max(0, st.st_size - 16384))
            tail = f.read().decode('utf-8', 'replace')
    except OSError:
        return None
    last = None
    for m in _PF.finditer(tail):
        last = m
    if not last:
        return None
    return {'tokens': int(last.group(1)), 'progress': float(last.group(2)),
            'tps': float(last.group(4)), 'age': max(0.0, time.time() - st.st_mtime)}


def llama_state():
    s = {'up': False}
    try:
        h = json.loads(llama_get('/health'))
        s['up'] = h.get('status') == 'ok'
        s['status'] = h.get('status')
    except Exception as e:
        s['status'] = 'offline'
        s['error'] = type(e).__name__
        return s
    props, slots = {}, []
    try:
        props = json.loads(llama_get('/props'))
    except Exception:
        pass
    try:
        slots = json.loads(llama_get('/slots'))
    except Exception:
        pass
    busy_now = any(x.get('is_processing') for x in slots)
    try:
        s['metrics'] = parse_metrics(llama_get('/metrics'))
        _speed('gen', s['metrics'], busy_now)
        _speed('prompt', s['metrics'], busy_now)
    except Exception:
        s['metrics'] = None  # llama-server was started without --metrics
    # Live generation speed from the n_decoded delta between two polls (resets when the task changes).
    now = time.time()
    n_dec, task = None, None
    for x in slots:
        nt = x.get('next_token')
        nt = nt[0] if isinstance(nt, list) and nt else nt
        if isinstance(nt, dict) and isinstance(nt.get('n_decoded'), (int, float)) and x.get('is_processing'):
            n_dec = (n_dec or 0) + nt['n_decoded']
            task = x.get('id_task', task)
    live = None
    prev = _DEC.get('last')
    if n_dec is not None and prev and prev['task'] == task and n_dec > prev['n'] and now > prev['t']:
        live = (n_dec - prev['n']) / (now - prev['t'])
    _DEC['last'] = {'n': n_dec, 't': now, 'task': task} if n_dec is not None else None
    if live is not None and isinstance(s.get('metrics'), dict):
        s['metrics']['gen_live'] = live
    if busy_now:
        if _BUSY['since'] is None:
            _BUSY['since'] = now
        s['busy_secs'] = now - _BUSY['since']
        pf = prefill_state()
        # only trust progress written during this job, never a stale line from the previous request
        s['prefill'] = pf if pf and pf['age'] <= s['busy_secs'] + 2 else None
    else:
        _BUSY['since'] = None
        s['busy_secs'] = 0.0
        s['prefill'] = None
    # Does the running llama-server have the vision projector loaded? (/props modalities.vision; None on older builds)
    mod = props.get('modalities')
    s['vision'] = bool(mod.get('vision')) if isinstance(mod, dict) else None
    s['busy_any'] = busy_now
    gs = props.get('default_generation_settings') or {}
    s['model'] = props.get('model_alias') or Path(props.get('model_path') or '').name
    s['n_ctx'] = gs.get('n_ctx')
    s['slots'] = [{'id': x.get('id'), 'busy': bool(x.get('is_processing')), 'n_ctx': x.get('n_ctx')} for x in slots]
    return s


def gpu_state():
    try:
        flags = 0x08000000 if sys.platform == 'win32' else 0
        out = subprocess.run(
            ['nvidia-smi', '--query-gpu=name,utilization.gpu,memory.used,memory.total,temperature.gpu,power.draw,power.limit',
             '--format=csv,noheader,nounits'], capture_output=True, text=True, timeout=4,
            creationflags=flags).stdout.strip().splitlines()[0]
        n, u, mu, mt, t, p, pl = [x.strip() for x in out.split(',')]
        return {'name': n, 'util': float(u), 'vram_used_mb': float(mu), 'vram_total_mb': float(mt),
                'temp_c': float(t), 'power_w': float(p), 'power_limit_w': float(pl)}
    except Exception:
        return None


def mem_state():
    gb = 1024 ** 3
    if sys.platform == 'win32':
        class MEMSTATUS(ctypes.Structure):
            _fields_ = [('dwLength', ctypes.c_ulong), ('dwMemoryLoad', ctypes.c_ulong),
                        ('ullTotalPhys', ctypes.c_ulonglong), ('ullAvailPhys', ctypes.c_ulonglong),
                        ('ullTotalPageFile', ctypes.c_ulonglong), ('ullAvailPageFile', ctypes.c_ulonglong),
                        ('ullTotalVirtual', ctypes.c_ulonglong), ('ullAvailVirtual', ctypes.c_ulonglong),
                        ('ullAvailExtendedVirtual', ctypes.c_ulonglong)]
        m = MEMSTATUS()
        m.dwLength = ctypes.sizeof(MEMSTATUS)
        ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(m))
        return {'ram_used_gb': (m.ullTotalPhys - m.ullAvailPhys) / gb, 'ram_total_gb': m.ullTotalPhys / gb,
                'commit_used_gb': (m.ullTotalPageFile - m.ullAvailPageFile) / gb, 'commit_limit_gb': m.ullTotalPageFile / gb}
    try:  # Linux
        info = {k: int(v.split()[0]) * 1024 for k, v in (l.split(':', 1) for l in open('/proc/meminfo'))}
        total, avail = info['MemTotal'], info['MemAvailable']
        commit_limit, committed = info.get('CommitLimit', total), info.get('Committed_AS', total - avail)
        return {'ram_used_gb': (total - avail) / gb, 'ram_total_gb': total / gb,
                'commit_used_gb': committed / gb, 'commit_limit_gb': commit_limit / gb}
    except Exception:
        return {'ram_used_gb': 0.0, 'ram_total_gb': 1.0, 'commit_used_gb': 0.0, 'commit_limit_gb': 1.0}


# ---- Vision switch: write/remove the marker file, then run the restart command in the background ----
RESTART_WINDOW = 240.0  # seconds a restart may take before another switch is allowed again
_RESTART = {'t': 0.0}
_LOOPBACK = ('127.0.0.1', '::1', 'localhost')


def vision_enabled():
    return VISION_FLAG is not None and bool(VISION_CMD)


def _restarting():
    """True within 8 s of a switch (the old process may still be shutting down), then until the model answers /health."""
    age = time.time() - _RESTART['t']
    if age >= RESTART_WINDOW:
        return False
    if age < 8:
        return True
    try:
        if json.loads(llama_get('/health', 1.0)).get('status') == 'ok':
            _RESTART['t'] = 0.0
            return False
    except Exception:
        pass
    return True


def switch_vision(on):
    """Returns (HTTP status, body). Refused while the model is working or already restarting, so no chat is cut off."""
    if _restarting():
        return 409, {'error': 'switching'}
    try:
        if any(x.get('is_processing') for x in json.loads(llama_get('/slots'))):
            return 409, {'error': 'busy'}
    except Exception:
        pass  # model not running / /slots unreadable: switch anyway
    VISION_FLAG.parent.mkdir(parents=True, exist_ok=True)
    if on:
        VISION_FLAG.touch()
    else:
        try:
            VISION_FLAG.unlink()
        except FileNotFoundError:
            pass
    _RESTART['t'] = time.time()
    argv = shlex.split(VISION_CMD, posix=(os.name != 'nt'))
    if os.name == 'nt':
        argv = [a[1:-1] if len(a) > 1 and a[0] == a[-1] and a[0] in '"\'' else a for a in argv]
        # CREATE_NO_WINDOW + new process group. Do NOT add DETACHED_PROCESS: combined with CREATE_NO_WINDOW,
        # PowerShell exits at once without running the script (verified).
        kw = {'creationflags': 0x08000000 | 0x00000200}
    else:
        kw = {'start_new_session': True}
    subprocess.Popen(argv, close_fds=True, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, **kw)
    with _lock:
        _cache['v'] = None  # the next /stats shows the new setting at once
    return 200, {'ok': True, 'vision_cfg': bool(on)}


_cache = {'t': 0.0, 'v': None}
_lock = threading.Lock()


def stats():
    with _lock:
        if _cache['v'] is not None and time.time() - _cache['t'] < TTL:
            return _cache['v']
        v = {'t': time.time(), 'llama': llama_state(), 'gpu': gpu_state(), 'mem': mem_state()}
        if vision_enabled():  # the tab shows the vision row only when these keys exist
            v['vision_cfg'] = VISION_FLAG.exists()
            v['vision_restarting'] = _restarting()
        _cache.update(t=time.time(), v=v)
        return v


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def _send(self, code, body):
        data = body.encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(data)))
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(data)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Headers', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.end_headers()

    def _same_site(self):
        """A browser page may change the setting only from the same host as this server (blocks other websites)."""
        origin = self.headers.get('Origin')
        if not origin:
            return True
        host = (self.headers.get('Host') or '').rsplit(':', 1)[0].strip('[]')
        return (urlparse(origin).hostname or '') == host

    def _local_only(self):
        """The vision switch restarts the model: only this computer, and only under a loopback Host name
        (blocks LAN clients and DNS rebinding)."""
        host = (self.headers.get('Host') or '').rsplit(':', 1)[0].strip('[]')
        return self.client_address[0] in _LOOPBACK and host in _LOOPBACK

    def do_POST(self):
        path = self.path.split('?')[0]
        if path == '/vision' and vision_enabled():
            if not (self._same_site() and self._local_only()):
                return self._send(403, json.dumps({'error': 'local only'}))
            try:
                n = min(int(self.headers.get('Content-Length') or 0), 256)
                body = json.loads(self.rfile.read(n) or b'{}')
                if not isinstance(body.get('on'), bool):
                    return self._send(400, json.dumps({'error': 'need boolean "on"'}))
                code, out = switch_vision(body['on'])
                return self._send(code, json.dumps(out))
            except ValueError as e:
                return self._send(400, json.dumps({'error': str(e)}))
            except Exception as e:
                return self._send(500, json.dumps({'error': type(e).__name__}))
        if path != '/helper' or PANEL is None:
            return self._send(404, '{}')
        if not self._same_site():
            return self._send(403, json.dumps({'error': 'cross-site request refused'}))
        try:
            n = min(int(self.headers.get('Content-Length') or 0), 2048)
            PANEL.update(json.loads(self.rfile.read(n) or b'{}'))
            self._send(200, json.dumps(PANEL.state()))
        except ValueError as e:
            self._send(400, json.dumps({'error': str(e)}))
        except Exception as e:
            self._send(500, json.dumps({'error': type(e).__name__}))

    def do_GET(self):
        if self.path.split('?')[0] == '/helper' and PANEL is not None:
            return self._send(200, json.dumps(PANEL.state()))
        if self.path.split('?')[0] in ('/stats', '/'):
            try:
                self._send(200, json.dumps(stats()))
            except Exception as e:
                self._send(500, json.dumps({'error': type(e).__name__}))
        else:
            self._send(404, '{}')


def main():
    global LLAMA, KEY, PANEL, LOG, VISION_FLAG, VISION_CMD
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--host', default='127.0.0.1', help='bind address (use 0.0.0.0 to reach it from a phone on your LAN)')
    ap.add_argument('--port', type=int, default=8001)
    ap.add_argument('--llama', default=LLAMA, help='llama-server base URL')
    ap.add_argument('--outsource-dir', default=os.environ.get('OUTSOURCE_DIR') or str(Path.home() / '.dsh' / 'outsource'),
                    help='data folder shared with the dsh-compaction-outsource plugin (default: ~/.dsh/outsource)')
    ap.add_argument('--llama-log', default=os.environ.get('LLAMA_LOG_FILE'),
                    help="llama-server's stderr log, to show prompt-processing progress (optional)")
    ap.add_argument('--vision-flag', default=os.environ.get('VISION_FLAG_FILE'),
                    help='marker file: exists <=> your start script loads the vision projector (enables the vision switch)')
    ap.add_argument('--vision-restart-cmd', default=os.environ.get('VISION_RESTART_CMD'),
                    help='command that restarts llama-server so it re-reads the marker file (enables the vision switch)')
    args = ap.parse_args()
    PANEL = Panel(args.outsource_dir) if Panel else None
    LLAMA = args.llama.rstrip('/')
    KEY = load_key()
    LOG = Path(args.llama_log) if args.llama_log else None
    VISION_FLAG = Path(args.vision_flag) if args.vision_flag else None
    VISION_CMD = args.vision_restart_cmd
    ThreadingHTTPServer((args.host, args.port), Handler).serve_forever()


if __name__ == '__main__':
    main()
