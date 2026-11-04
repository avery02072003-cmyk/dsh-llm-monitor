"""dsh-llm-monitor server: one read-only JSON endpoint for the DSH sidebar tab (or any browser).

GET /stats -> llama-server health/metrics + NVIDIA GPU + system memory.

Stdlib only. The llama-server API key (if any) is read from the environment or a file and is
never included in the output.

Usage:
    python monitor_server.py [--host 127.0.0.1] [--port 8001] [--llama http://127.0.0.1:8000]

Environment (all optional):
    LLAMA_API_KEY        API key passed to llama-server (--api-key)
    LLAMA_API_KEY_FILE   file containing the API key (used when LLAMA_API_KEY is unset)
"""
import argparse
import ctypes
import json
import os
import re
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
    try:
        s['metrics'] = parse_metrics(llama_get('/metrics'))
    except Exception:
        s['metrics'] = None  # llama-server was started without --metrics
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


_cache = {'t': 0.0, 'v': None}
_lock = threading.Lock()


def stats():
    with _lock:
        if _cache['v'] is not None and time.time() - _cache['t'] < TTL:
            return _cache['v']
        v = {'t': time.time(), 'llama': llama_state(), 'gpu': gpu_state(), 'mem': mem_state()}
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

    def do_POST(self):
        if self.path.split('?')[0] != '/helper' or PANEL is None:
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
    global LLAMA, KEY, PANEL
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--host', default='127.0.0.1', help='bind address (use 0.0.0.0 to reach it from a phone on your LAN)')
    ap.add_argument('--port', type=int, default=8001)
    ap.add_argument('--llama', default=LLAMA, help='llama-server base URL')
    ap.add_argument('--outsource-dir', default=os.environ.get('OUTSOURCE_DIR') or str(Path.home() / '.dsh' / 'outsource'),
                    help='data folder shared with the dsh-compaction-outsource plugin (default: ~/.dsh/outsource)')
    args = ap.parse_args()
    PANEL = Panel(args.outsource_dir) if Panel else None
    LLAMA = args.llama.rstrip('/')
    KEY = load_key()
    ThreadingHTTPServer((args.host, args.port), Handler).serve_forever()


if __name__ == '__main__':
    main()
