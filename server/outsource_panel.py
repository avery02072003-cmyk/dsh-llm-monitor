"""Backend of the monitor tab's "outsourcing" section (stdlib only).

Reads and writes the live choice file shared with the dsh-compaction-outsource plugin:

    <data dir>/config.json     {"backend": "off|agy|deepseek|claude|codex", "models": {...}, "efforts": {...}}
    <data dir>/usage.jsonl     one line per outsourced call (characters only, never content)
    <data dir>/last_compaction.json   who wrote the most recent compaction checkpoint

The plugin re-reads config.json on every compaction, so a change made here applies to the next one.
"""
import glob
import importlib.util
import json
import os
import re
import time
from pathlib import Path

BACKENDS = ('agy', 'deepseek', 'claude', 'codex')
# Same lists as the plugin; the first entry is the cheapest and the default. agy has none (part of its model name).
EFFORTS = {
    'deepseek': ('off', 'low', 'high', 'max'),
    'claude': ('low', 'medium', 'high', 'xhigh', 'max'),
    'codex': ('low', 'medium', 'high', 'xhigh'),
}
MODEL_RE = re.compile(r'^[\w.:/-]{1,80}$')


class Panel:
    def __init__(self, data_dir):
        self.dir = Path(data_dir)
        self._avail = (0.0, None)

    # -- config ---------------------------------------------------------------------------------
    def load(self):
        cfg = {'backend': 'off', 'models': {}, 'efforts': {}}
        try:
            raw = json.loads((self.dir / 'config.json').read_text(encoding='utf-8'))
            if raw.get('backend') in BACKENDS:
                cfg['backend'] = raw['backend']
            for key in ('models', 'efforts'):
                if isinstance(raw.get(key), dict):
                    cfg[key] = {k: v for k, v in raw[key].items() if k in BACKENDS and isinstance(v, str)}
        except (OSError, ValueError):
            pass
        return cfg

    def update(self, body):
        """Merge a validated change; raises ValueError on anything unknown."""
        cfg = self.load()
        if 'backend' in body:
            if body['backend'] != 'off' and body['backend'] not in BACKENDS:
                raise ValueError('bad backend')
            cfg['backend'] = body['backend']
        for key, allowed in (('models', None), ('efforts', EFFORTS)):
            for backend, value in (body.get(key) or {}).items():
                if backend not in BACKENDS or not isinstance(value, str):
                    raise ValueError('bad ' + key)
                value = value.strip()
                if key == 'models' and value and not MODEL_RE.match(value):
                    raise ValueError('bad model')
                if key == 'efforts' and value not in EFFORTS.get(backend, ()):
                    raise ValueError('bad effort')
                cfg[key][backend] = value
        self.dir.mkdir(parents=True, exist_ok=True)
        (self.dir / 'config.json').write_text(json.dumps(cfg, ensure_ascii=False, indent=2), encoding='utf-8')
        return cfg

    # -- availability ---------------------------------------------------------------------------
    def available(self):
        """Which tools can run on this machine, asked of the plugin's own helper script (cached 60 s)."""
        now = time.time()
        if self._avail[1] is not None and now - self._avail[0] < 60:
            return self._avail[1]
        result = {'agy': False, 'deepseek': True, 'claude': False, 'codex': False}
        try:
            hits = [os.environ.get('OUTSOURCE_CLI', '')] + glob.glob(os.path.join(
                Path.home(), '.dsh', 'profiles', '*', 'node_modules', 'dsh-compaction-outsource', 'helper', 'outsource_cli.py'))
            path = next((h for h in hits if h and os.path.isfile(h)), None)
            if path:
                spec = importlib.util.spec_from_file_location('outsource_cli', path)
                mod = importlib.util.module_from_spec(spec)
                spec.loader.exec_module(mod)
                result.update(mod.available())
        except Exception:
            pass
        self._avail = (now, result)
        return result

    # -- usage / status ---------------------------------------------------------------------------
    def usage(self):
        """Per tool: calls and rough tokens (characters / 3), today and in total."""
        out = {}
        midnight = time.mktime(time.localtime()[:3] + (0, 0, 0, 0, 0, -1))
        try:
            lines = (self.dir / 'usage.jsonl').read_text(encoding='utf-8').splitlines()
        except OSError:
            return out
        for line in lines:
            try:
                r = json.loads(line)
            except ValueError:
                continue
            if r.get('purpose') == 'test' or not r.get('ok', True):
                continue
            b = out.setdefault(r['backend'], {'today': {'calls': 0, 'tokens': 0}, 'total': {'calls': 0, 'tokens': 0}})
            tokens = int((r.get('in_chars', 0) + r.get('out_chars', 0)) / 3)
            for scope in ('total',) + (('today',) if r['ts'] >= midnight else ()):
                b[scope]['calls'] += 1
                b[scope]['tokens'] += tokens
        return out

    def last(self):
        try:
            return json.loads((self.dir / 'last_compaction.json').read_text(encoding='utf-8'))
        except (OSError, ValueError):
            return None

    def state(self):
        return {'config': self.load(), 'available': self.available(), 'usage': self.usage(), 'last': self.last()}
