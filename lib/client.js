// Client module for DSH: a right-sidebar tab showing the local model, GPU and memory.
// Same self-registering classic-script shape the host's own client plugins ship in.
window.__ModuleLoader__.load({
  id: 'dsh-llm-monitor',
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });
    const React = require('react');
    const h = React.createElement;

    const ID = 'dsh-llm-monitor';
    const POLL_MS = 2000;
    const BALANCE_MS = 60000;
    const SYMBOL = { CNY: '¥', USD: '$' };
    // Set by apply(): reads the DeepSeek account balance through the host's account remote.
    let balanceFetcher = null;

    function statsUrl() {
      try {
        const o = window.localStorage.getItem('dsh-llm-monitor.url');
        if (o) return o;
      } catch (e) { /* storage blocked: use the default */ }
      const host = window.location.hostname || '127.0.0.1';
      return 'http://' + host + ':8001/stats';
    }

    const fmt = (n, d) => (typeof n === 'number' && isFinite(n) ? n.toFixed(d === undefined ? 1 : d) : '—');
    const tone = (p) => (p >= 92 ? '#d64545' : p >= 80 ? '#e5a50a' : '#3d8bfd');

    function Bar({ label, value, text }) {
      const p = Math.max(0, Math.min(100, value || 0));
      return h('div', { style: { margin: '6px 0' } },
        h('div', { style: { display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 3 } },
          h('span', { style: { opacity: 0.75 } }, label),
          h('span', null, text)),
        h('div', { style: { height: 6, borderRadius: 3, background: 'var(--dsw-alias-border-l3, rgba(128,128,128,.25))', overflow: 'hidden' } },
          h('div', { style: { width: p + '%', height: '100%', background: tone(p), transition: 'width .4s' } })));
    }

    function Row({ label, value }) {
      return h('div', { style: { display: 'flex', justifyContent: 'space-between', fontSize: 12, margin: '3px 0' } },
        h('span', { style: { opacity: 0.75 } }, label), h('span', null, value));
    }

    function Section({ title, children }) {
      return h('div', {
        style: {
          border: '.5px solid var(--dsw-alias-border-l3, rgba(128,128,128,.3))', borderRadius: 10,
          padding: '10px 12px', margin: '0 0 10px', background: 'var(--dsw-alias-bg-layer-1, transparent)',
        },
      }, h('div', { style: { fontSize: 12, fontWeight: 600, marginBottom: 4 } }, title), children);
    }

    function helperUrl() {
      return statsUrl().replace(/\/stats$/, '/helper');
    }

    const BACKENDS = ['off', 'agy', 'deepseek', 'claude', 'codex'];
    const BACKEND_LABEL = { off: '關閉', agy: 'agy', deepseek: 'DeepSeek', claude: 'Claude', codex: 'Codex' };
    const BACKEND_NOTE = {
      off: '不外包，由目前的本地模型自己處理。',
      agy: '免費，但有每日額度上限。',
      deepseek: '扣 DeepSeek 帳號儲值餘額。',
      claude: '計入 Claude 訂閱用量。',
      codex: '計入 ChatGPT / Codex 額度。',
    };
    const MODEL_PRESETS = {
      agy: ['gemini-3.8-flash-high'],
      deepseek: ['deepseek-flash', 'deepseek-v4-pro'],
      claude: ['haiku', 'sonnet', 'opus'],
      codex: [],
    };

    // First entry = cheapest = default. agy has none: its strength is part of the model name.
    const EFFORT_PRESETS = {
      deepseek: ['off', 'low', 'high', 'max'],
      claude: ['low', 'medium', 'high', 'xhigh', 'max'],
      codex: ['minimal', 'low', 'medium', 'high'],
    };
    const EFFORT_LABEL = { off: '關閉思考', minimal: '極低', low: '低', medium: '中', high: '高', xhigh: '特高', max: '最高' };

    // Switch for outsourcing compaction / long reads to another AI, the model per AI, what it has used and
    // who wrote the last checkpoint. Hidden when the server has no /helper endpoint.
    function HelperSection() {
      const [st, setSt] = React.useState(null);
      const [busy, setBusy] = React.useState(false);
      const [draft, setDraft] = React.useState(null);
      React.useEffect(() => {
        let stopped = false;
        let timer;
        const tick = async () => {
          try {
            const r = await fetch(helperUrl(), { cache: 'no-store' });
            if (r.ok && !stopped) setSt(await r.json());
          } catch (e) { /* server offline: keep the last state */ }
          if (!stopped) timer = setTimeout(tick, 5000);
        };
        tick();
        return () => { stopped = true; clearTimeout(timer); };
      }, []);
      if (!st || !st.config) return null;
      const post = async (body) => {
        setBusy(true);
        try {
          const r = await fetch(helperUrl(), { method: 'POST', body: JSON.stringify(body) });
          if (r.ok) setSt(await r.json());
        } catch (e) { /* ignore: next poll shows the real state */ } finally { setBusy(false); }
      };
      const cur = st.config.backend;
      const curModel = (st.config.models && st.config.models[cur]) || '';
      const btn = (b) => {
        const usable = b === 'off' || (st.available && st.available[b]);
        const on = cur === b;
        return h('button', {
          key: b, disabled: busy || !usable, onClick: () => { setDraft(null); post({ backend: b }); },
          title: usable ? BACKEND_NOTE[b] : '這台電腦找不到這個工具，無法使用',
          style: {
            flex: 1, padding: '5px 0', fontSize: 12, borderRadius: 6, cursor: usable ? 'pointer' : 'not-allowed',
            border: '.5px solid var(--dsw-alias-border-l3, rgba(128,128,128,.4))',
            background: on ? '#3d8bfd' : 'transparent', color: on ? '#fff' : 'inherit', opacity: usable ? 1 : 0.4,
          },
        }, BACKEND_LABEL[b]);
      };
      const commitModel = (value) => {
        const v = value.trim();
        setDraft(null);
        if (v !== curModel) post({ models: { [cur]: v } });
      };
      const modelRow = cur === 'off' ? null : h('div', { style: { display: 'flex', alignItems: 'center', gap: 6, margin: '2px 0 6px', fontSize: 12 } },
        h('span', { style: { opacity: 0.75, whiteSpace: 'nowrap' } }, '模型'),
        h('input', {
          list: 'dsh-outsource-models', value: draft === null ? curModel : draft, placeholder: '預設（可下拉或自行輸入）',
          disabled: busy,
          onChange: (e) => setDraft(e.target.value),
          onBlur: (e) => { if (draft !== null) commitModel(e.target.value); },
          onKeyDown: (e) => { if (e.key === 'Enter') commitModel(e.target.value); },
          style: {
            flex: 1, minWidth: 0, padding: '4px 6px', fontSize: 12, borderRadius: 6, color: 'inherit', background: 'transparent',
            border: '.5px solid var(--dsw-alias-border-l3, rgba(128,128,128,.4))',
          },
        }),
        h('datalist', { id: 'dsh-outsource-models' }, (MODEL_PRESETS[cur] || []).map((m) => h('option', { key: m, value: m }))));
      const efforts = EFFORT_PRESETS[cur];
      const curEffort = (st.config.efforts && st.config.efforts[cur]) || (efforts ? efforts[0] : '');
      const effortRow = cur === 'off' ? null : h('div', { style: { display: 'flex', alignItems: 'center', gap: 6, margin: '2px 0 6px', fontSize: 12 } },
        h('span', { style: { opacity: 0.75, whiteSpace: 'nowrap' } }, '思考強度'),
        efforts
          ? h('select', {
            value: curEffort, disabled: busy, onChange: (e) => post({ efforts: { [cur]: e.target.value } }),
            style: {
              flex: 1, minWidth: 0, padding: '4px 6px', fontSize: 12, borderRadius: 6, color: 'inherit', background: 'transparent',
              border: '.5px solid var(--dsw-alias-border-l3, rgba(128,128,128,.4))',
            },
          }, efforts.map((x, i) => h('option', { key: x, value: x, style: { color: '#000' } }, (EFFORT_LABEL[x] || x) + (i === 0 ? '（預設，最省）' : ''))))
          : h('span', { style: { opacity: 0.6 } }, '包含在模型名稱裡（例如 …-high）'));
      const warn = h('div', {
        style: {
          fontSize: 11, lineHeight: 1.5, margin: '6px 0', padding: '6px 8px', borderRadius: 6,
          background: cur === 'off' ? 'transparent' : 'rgba(229,165,10,.12)',
          border: '.5px solid ' + (cur === 'off' ? 'var(--dsw-alias-border-l3, rgba(128,128,128,.3))' : 'rgba(229,165,10,.6)'),
          opacity: cur === 'off' ? 0.65 : 1,
        },
      }, '⚠ 選了外包後，對話內容會送到該外部 AI。含敏感內容（尤其是審核版模型的輸出）請保持「關閉」：外部 AI 可能拒絕'
        + '（會自動改由本地模型處理）或默默刪掉部分內容（偵測不到）；把敏感內容送到外部服務也可能違反其使用條款、導致帳號被標記，請自行判斷。');
      const last = st.last;
      const lastLine = last && h('div', { style: { fontSize: 12, margin: '4px 0', color: last.ok ? 'inherit' : '#e5a50a' } },
        '最近一次壓縮：' + (last.backend === 'local' ? '本地模型' : (BACKEND_LABEL[last.backend] || last.backend) + (last.model ? '（' + last.model + (last.effort ? ' · ' + (EFFORT_LABEL[last.effort] || last.effort) : '') + '）' : ''))
        + (last.ok ? '，成功' : '，失敗，已改由本地模型處理') + (last.secs ? '，' + last.secs + ' 秒' : '')
        + (last.error ? '（' + String(last.error).slice(0, 60) + '）' : ''));
      const usage = st.usage || {};
      const rows = Object.keys(usage).map((b) => h(Row, {
        key: b, label: (BACKEND_LABEL[b] || b) + ' 今日 / 累計',
        value: usage[b].today.calls + ' 次 ≈' + usage[b].today.tokens + ' tok / ' + usage[b].total.calls + ' 次 ≈' + usage[b].total.tokens + ' tok',
      }));
      return h(Section, { title: '外包（壓縮／讀長內容）' },
        h('div', { style: { display: 'flex', gap: 6, marginBottom: 6 } }, BACKENDS.map(btn)),
        modelRow,
        effortRow,
        h('div', { style: { fontSize: 12, opacity: 0.7, marginBottom: 4 } }, BACKEND_NOTE[cur] || ''),
        warn,
        lastLine,
        rows.length ? rows : h('div', { style: { fontSize: 12, opacity: 0.55 } }, '還沒有外包紀錄。'));
    }

    function BalanceSection() {
      const [bal, setBal] = React.useState(undefined); // undefined: loading, null: signed out, {…}
      const first = React.useRef(null);
      React.useEffect(() => {
        let stopped = false;
        let timer;
        const tick = async () => {
          try {
            const r = balanceFetcher ? await balanceFetcher() : null;
            if (!stopped) setBal(r === null ? null : r);
          } catch (e) {
            if (!stopped) setBal({ status: 'failed', msg: String((e && e.message) || e).slice(0, 160) });
          }
          if (!stopped) timer = setTimeout(tick, BALANCE_MS);
        };
        tick();
        return () => { stopped = true; clearTimeout(timer); };
      }, []);
      const body = [];
      if (bal === undefined) body.push(h('div', { key: 'l', style: { opacity: 0.65, fontSize: 12 } }, '讀取中…'));
      else if (bal === null) body.push(h('div', { key: 'n', style: { opacity: 0.65, fontSize: 12 } }, '尚未登入 DeepSeek 帳號。'));
      else if (bal.status !== 'ready') body.push(h('div', { key: 'f', style: { opacity: 0.65, fontSize: 12 } }, '暫時讀不到餘額。（' + (bal.msg || JSON.stringify(bal).slice(0, 140)) + '）'));
      else {
        if (first.current === null) first.current = {};
        const all = (bal.value || []).concat((bal.bonusWallets || []).map((w) => ({ ...w, bonus: true })));
        const rows = all.filter((w) => Math.abs(parseFloat(w.balance)) >= 0.005);
        rows.forEach((w) => {
          const key = (w.bonus ? 'b' : 'v') + w.currency;
          const now = parseFloat(w.balance);
          if (first.current[key] === undefined) first.current[key] = now;
          const delta = now - first.current[key];
          body.push(h(Row, {
            key,
            label: (w.bonus ? '贈金 ' : '餘額 ') + w.currency,
            value: (SYMBOL[w.currency] || '') + now.toFixed(2) + (Math.abs(delta) >= 0.005 ? '（開啟後 ' + (delta > 0 ? '+' : '') + delta.toFixed(2) + '）' : ''),
          }));
        });
        if (rows.length === 0) body.push(h('div', { key: 'e', style: { opacity: 0.65, fontSize: 12 } }, '餘額 ¥0.00'));
      }
      return h(Section, { title: 'DeepSeek 帳號' }, body);
    }

    function Body() {
      const [data, setData] = React.useState(null);
      const [err, setErr] = React.useState(null);
      React.useEffect(() => {
        let stopped = false;
        let timer;
        const tick = async () => {
          if (document.visibilityState === 'visible') {
            const ac = new AbortController();
            const to = setTimeout(() => ac.abort(), 3000);
            try {
              const r = await fetch(statsUrl(), { signal: ac.signal, cache: 'no-store' });
              const j = await r.json();
              if (!stopped) { setData(j); setErr(null); }
            } catch (e) {
              if (!stopped) setErr('無法連到監控服務（' + statsUrl() + '）');
            } finally { clearTimeout(to); }
          }
          if (!stopped) timer = setTimeout(tick, POLL_MS);
        };
        tick();
        return () => { stopped = true; clearTimeout(timer); };
      }, []);

      const wrap = { padding: 12, overflowY: 'auto', height: '100%', boxSizing: 'border-box', fontSize: 13 };
      if (err && !data) return h('div', { style: wrap }, h(BalanceSection),
        h('div', { style: { opacity: 0.8 } }, err),
        h('div', { style: { opacity: 0.6, fontSize: 12, marginTop: 6 } }, '用「本地模型 開關」捷徑啟動後會自動帶起監控服務。'));
      if (!data) return h('div', { style: wrap }, '載入中…');

      const l = data.llama || {};
      const m = l.metrics || null;
      const g = data.gpu;
      const mem = data.mem || {};
      const busy = (l.slots || []).some((s) => s.busy);
      const state = !l.up ? (l.status === 'loading model' ? '載入中' : '離線') : busy ? '處理中' : '閒置';
      const dot = !l.up ? '#8a8a8a' : busy ? '#e5a50a' : '#2fb344';
      const kv = m && typeof m.kv_cache_usage_ratio === 'number' ? m.kv_cache_usage_ratio * 100 : null;

      return h('div', { style: wrap },
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 } },
          h('span', { style: { width: 9, height: 9, borderRadius: '50%', background: dot, display: 'inline-block' } }),
          h('span', { style: { fontWeight: 600 } }, state),
          h('span', { style: { opacity: 0.7, fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } },
            l.model ? l.model + (l.n_ctx ? ' · ctx ' + l.n_ctx : '') : '')),
        err ? h('div', { style: { color: '#d64545', fontSize: 12, marginBottom: 8 } }, err) : null,

        h(Section, { title: '本地模型' },
          m
            ? [
              h(Row, { key: 'g', label: '生成速度（平均）', value: fmt(m.predicted_tokens_seconds) + ' tok/s' }),
              h(Row, { key: 'p', label: '提示處理（平均）', value: fmt(m.prompt_tokens_seconds) + ' tok/s' }),
              h(Row, { key: 'r', label: '處理中 / 排隊', value: fmt(m.requests_processing, 0) + ' / ' + fmt(m.requests_deferred, 0) }),
              kv !== null ? h(Bar, { key: 'k', label: 'KV 快取用量', value: kv, text: fmt(kv) + '%' }) : null,
            ]
            : h('div', { style: { opacity: 0.65, fontSize: 12 } },
              l.up ? '此次啟動沒有 --metrics，速度資料需重啟模型後才有。' : '模型未啟動。')),

        g ? h(Section, { title: 'GPU · ' + g.name.replace('NVIDIA GeForce ', '') },
          h(Bar, { label: '使用率', value: g.util, text: fmt(g.util, 0) + '%' }),
          h(Bar, { label: 'VRAM', value: (g.vram_used_mb / g.vram_total_mb) * 100,
            text: fmt(g.vram_used_mb / 1024) + ' / ' + fmt(g.vram_total_mb / 1024) + ' GB' }),
          h(Row, { label: '溫度', value: fmt(g.temp_c, 0) + ' °C' }),
          h(Row, { label: '功耗', value: fmt(g.power_w, 0) + ' / ' + fmt(g.power_limit_w, 0) + ' W' })) : null,

        h(Section, { title: '記憶體' },
          h(Bar, { label: 'RAM', value: (mem.ram_used_gb / mem.ram_total_gb) * 100,
            text: fmt(mem.ram_used_gb) + ' / ' + fmt(mem.ram_total_gb) + ' GB' }),
          h(Bar, { label: '已認可（含分頁檔）', value: (mem.commit_used_gb / mem.commit_limit_gb) * 100,
            text: fmt(mem.commit_used_gb) + ' / ' + fmt(mem.commit_limit_gb) + ' GB' })),

        h(HelperSection),

        h(BalanceSection),

        h('div', { style: { opacity: 0.5, fontSize: 11, textAlign: 'right' } },
          '更新 ' + new Date((data.t || 0) * 1000).toLocaleTimeString()));
    }

    function apply(ctx) {
      balanceFetcher = async () => {
        const res = await ctx.remote.account.getBalance({
          version: '0.2.1-rc.5',
          locale: 'zh',
          timezoneOffsetSeconds: -new Date().getTimezoneOffset() * 60,
        });
        // The remote wraps results as { ok, value }; value is null when signed out.
        if (res && typeof res === 'object' && 'ok' in res) {
          if (res.ok) return res.value;
          throw new Error('remote error');
        }
        return res;
      };
      ctx.effect(() => ctx.sidebarRightTabs.register({
        id: ID,
        kind: 'llm-monitor',
        priority: 'extension',
        title: () => '監控',
        guide: [{
          id: 'open',
          order: 50,
          title: () => '本地模型監控',
          description: () => '速度、GPU、記憶體',
        }],
      }), 'llm-monitor.type');
      ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
        name: 'sidebar.right.pane.tab',
        key: ID,
        inject: () => ({}),
      }, Body)), 'llm-monitor.body');
    }

    exports.apply = apply;
    exports.inject = ['slots', 'sidebarRightTabs', 'remote', 'remote.account'];
    return module.exports;
  },
});
