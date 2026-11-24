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

    // ---- language pack -------------------------------------------------------------------------
    // One table per language; a missing key falls back to English. To add a language, copy `en`,
    // translate it, register it in LANG_NAMES and (optionally) in detectLang().
    const LANG_KEY = 'dsh-llm-monitor.lang';
    const LANG_NAMES = { 'zh-TW': '繁體中文', 'zh-CN': '简体中文', en: 'English' };
    const DICT = {
      en: {
        tabTitle: 'Monitor', guideTitle: 'Local model monitor', guideDesc: 'Speed, GPU, memory',
        loading: 'Loading…', connectErr: (u) => 'Cannot reach the monitor server (' + u + ')',
        connectHint: 'Start server/monitor_server.py (see the README); the balance below works without it.',
        stLoading: 'Loading model', stOffline: 'Offline', stBusy: 'Busy', stIdle: 'Idle',
        secLocal: 'Local model', secMem: 'Memory', secOutsource: 'Outsourcing (compaction / long reads)', secBalance: 'DeepSeek account',
        genNow: 'Generation speed (live)', genLast: 'Generation speed (last reply)', promptNow: 'Prompt processing (live)', promptLast: 'Prompt processing (last)',
        prefillDone: 'Done (generating)', busyWait: (s) => 'Working ' + s + ' s (speed shown when done)', prefillLive: (tps, n, p) => tps + ' tok/s · ' + n + ' tok · ' + p + '%',
        genSpeed: 'Generation speed (now / last reply)', genAvg: 'Generation speed (overall avg)', promptSpeed: 'Prompt processing (now / last)', promptAvg: 'Prompt processing (overall avg)', queue: 'Processing / queued', kv: 'KV cache usage',
        noMetrics: 'The server was started without --metrics; restart the model to get speed data.', notStarted: 'Model not started.',
        visionLabel: 'Vision (image input)', visionOn: 'On', visionOff: 'Off (text only)', visionUnknown: 'Unknown',
        visionTurnOn: 'Turn on', visionTurnOff: 'Turn off', visionConfirm: 'Restart the model?', visionYes: 'Restart', visionNo: 'Cancel',
        visionWarn: 'The model restarts (about 30–60 s), the KV cache is cleared and a running chat is interrupted. Best done at the start of a conversation. Vision uses ~3.7 GB more RAM and may slow generation on 32 GB.',
        visionRestarting: 'Restarting the model…', visionBusy: 'The model is working; try again when the reply ends.', visionDenied: 'Only allowed from this computer.',
        visionFail: 'Switch failed', visionPending: (on) => 'Setting is ' + (on ? 'on' : 'off') + ' but the running model differs; it applies at the next restart.', visionOfflineNote: 'The model is off: you will be asked at the next start.',
        util: 'Utilization', temp: 'Temperature', power: 'Power', ram: 'RAM', commit: 'Committed (incl. page file)',
        updated: 'Updated ',
        balLoading: 'Loading…', balSignedOut: 'Not signed in to a DeepSeek account.', balFail: (m) => 'Balance unavailable. (' + m + ')',
        balBonus: 'Bonus ', balMain: 'Balance ', balSince: (d) => ' (' + d + ' since opened)', balZero: 'Balance ¥0.00',
        offLabel: 'Off', noteOff: 'No outsourcing: the current local model does it itself.',
        noteAgy: 'Free, with a daily quota.', noteDeepseek: 'Spends your DeepSeek account balance.',
        noteClaude: 'Counts against your Claude plan.', noteCodex: 'Counts against your ChatGPT / Codex quota.',
        unavailable: 'This tool was not found on this computer.',
        model: 'Model', modelDefaultAgy: 'Default (gemini-3.8-flash-high)', modelDefaultDeepseek: 'Default (Flash, latest)',
        modelDefaultClaude: 'Default (Haiku, latest, cheapest)', modelDefaultCodex: "Default (Codex's own default)",
        modelCustom: 'Custom…', modelCustomPh: 'Type any model id', modelCustomNote: 'Any id the tool accepts. A wrong id makes the call fail and the local model takes over.',
        effort: 'Effort', effortDefault: ' (default, cheapest)', effortInName: 'Part of the model name (e.g. …-high)',
        eOff: 'Thinking off', eLow: 'Low', eMedium: 'Medium', eHigh: 'High', eXhigh: 'Extra high', eMax: 'Max',
        warn: '⚠ When outsourcing is on, the conversation text is sent to that outside AI. Keep it "Off" for sensitive content (especially output of an uncensored model): the outside AI may refuse (then the local model does it) or quietly drop parts (not detectable); sending such content to a third-party service may also break its terms and get the account flagged. Use your own judgment.',
        lastPrefix: 'Last compaction: ', lastLocal: 'local model', lastOk: ', succeeded', lastFail: ', failed, the local model took over', secs: (s) => ', ' + s + ' s',
        usageRow: (n) => n + ' today / total', times: (n, t) => n + ' calls ≈' + t + ' tok', noRecords: 'No outsourcing yet.', language: 'Language',
        // model notes (the ids themselves are product names and stay as they are)
        'n.gemini-3.8-flash-low': 'Fastest, lightest', 'n.gemini-3.8-flash-medium': 'Balanced', 'n.gemini-3.8-flash-high': 'Best of the Flash tier (default)',
        'n.claude-sonnet-4-6': 'Claude Sonnet 4.6 via agy (thinking)', 'n.claude-opus-4-6-thinking': 'Claude Opus 4.6 via agy (thinking)', 'n.gpt-oss-120b-medium': 'Open-weight GPT-OSS 120B',
        'n.deepseek-flash': 'Latest Flash model (default, cheap, strong)', 'n.deepseek-v4-pro': 'DeepSeek V4 Pro (older generation, pricier)',
        'n.haiku': 'Newest Haiku: cheapest', 'n.sonnet': 'Newest Sonnet: balanced', 'n.opus': 'Newest Opus: strongest, uses the most quota',
        'n.claude-fable-5-1': 'Fable 5.1 (pinned version)',
        'n.gpt-6-luna': 'GPT-6 Luna (most efficient; OpenAI suggests it for summarizing)', 'n.gpt-6.1-terra': 'GPT-6.1 Terra', 'n.gpt-6.1-sol': 'GPT-6.1 Sol', 'n.gpt-6-astra': 'GPT-6 Astra',
      },
      'zh-TW': {
        tabTitle: '監控', guideTitle: '本地模型監控', guideDesc: '速度、GPU、記憶體',
        loading: '載入中…', connectErr: (u) => '無法連到監控服務（' + u + '）',
        connectHint: '請先啟動 server/monitor_server.py（見 README）；下方的餘額不需要它。',
        stLoading: '載入中', stOffline: '離線', stBusy: '處理中', stIdle: '閒置',
        secLocal: '本地模型', secMem: '記憶體', secOutsource: '外包（壓縮／讀長內容）', secBalance: 'DeepSeek 帳號',
        genNow: '生成速度（即時）', genLast: '生成速度（上次回覆）', promptNow: '提示處理（即時）', promptLast: '提示處理（上次）',
        prefillDone: '已完成（生成中）', busyWait: (s) => '處理中 ' + s + ' 秒（完成後顯示速度）', prefillLive: (tps, n, p) => tps + ' tok/s · ' + n + ' tok · ' + p + '%',
        genSpeed: '生成速度（目前／上次回覆）', genAvg: '生成速度（整體平均）', promptSpeed: '提示處理（目前／上次）', promptAvg: '提示處理（整體平均）', queue: '處理中 / 排隊', kv: 'KV 快取用量',
        noMetrics: '此次啟動沒有 --metrics，速度資料需重啟模型後才有。', notStarted: '模型未啟動。',
        visionLabel: '視覺（讀圖）', visionOn: '開', visionOff: '關（純文字）', visionUnknown: '未知',
        visionTurnOn: '開啟', visionTurnOff: '關閉', visionConfirm: '要重啟模型嗎？', visionYes: '重啟', visionNo: '取消',
        visionWarn: '模型會重啟（約 30～60 秒），KV 快取清空，進行中的對話會中斷，建議在新對話開始時切換。視覺多吃約 3.7 GB 記憶體，32GB 機器上速度可能變慢。',
        visionRestarting: '模型重啟中…', visionBusy: '模型正在處理請求，等回覆結束再切換。', visionDenied: '只能從本機切換。',
        visionFail: '切換失敗', visionPending: (on) => '設定是' + (on ? '開' : '關') + '，但執行中的模型不同，下次重啟才會生效。', visionOfflineNote: '模型未啟動：下次啟動時會問你要不要開。',
        util: '使用率', temp: '溫度', power: '功耗', ram: 'RAM', commit: '已認可（含分頁檔）',
        updated: '更新 ',
        balLoading: '讀取中…', balSignedOut: '尚未登入 DeepSeek 帳號。', balFail: (m) => '暫時讀不到餘額。（' + m + '）',
        balBonus: '贈金 ', balMain: '餘額 ', balSince: (d) => '（開啟後 ' + d + '）', balZero: '餘額 ¥0.00',
        offLabel: '關閉', noteOff: '不外包，由目前的本地模型自己處理。',
        noteAgy: '免費，但有每日額度上限。', noteDeepseek: '扣 DeepSeek 帳號儲值餘額。',
        noteClaude: '計入 Claude 訂閱用量。', noteCodex: '計入 ChatGPT / Codex 額度。',
        unavailable: '這台電腦找不到這個工具，無法使用',
        model: '模型', modelDefaultAgy: '預設（gemini-3.8-flash-high）', modelDefaultDeepseek: '預設（Flash，最新）',
        modelDefaultClaude: '預設（Haiku，最新，最省）', modelDefaultCodex: '預設（Codex 自己的預設）',
        modelCustom: '自訂…', modelCustomPh: '輸入任何模型代號', modelCustomNote: '填該工具接受的任何代號。填錯會讓呼叫失敗，並自動改由本地模型處理。',
        effort: '思考強度', effortDefault: '（預設，最省）', effortInName: '包含在模型名稱裡（例如 …-high）',
        eOff: '關閉思考', eLow: '低', eMedium: '中', eHigh: '高', eXhigh: '特高', eMax: '最高',
        warn: '⚠ 選了外包後，對話內容會送到該外部 AI。含敏感內容（尤其是審核版模型的輸出）請保持「關閉」：外部 AI 可能拒絕（會自動改由本地模型處理）或默默刪掉部分內容（偵測不到）；把敏感內容送到外部服務也可能違反其使用條款、導致帳號被標記，請自行判斷。',
        lastPrefix: '最近一次壓縮：', lastLocal: '本地模型', lastOk: '，成功', lastFail: '，失敗，已改由本地模型處理', secs: (s) => '，' + s + ' 秒',
        usageRow: (n) => n + ' 今日 / 累計', times: (n, t) => n + ' 次 ≈' + t + ' tok', noRecords: '還沒有外包紀錄。', language: '語言',
        'n.gemini-3.8-flash-low': '最快、最輕量', 'n.gemini-3.8-flash-medium': '均衡', 'n.gemini-3.8-flash-high': 'Flash 系列中最強（預設）',
        'n.claude-sonnet-4-6': '經由 agy 使用 Claude Sonnet 4.6（含思考）', 'n.claude-opus-4-6-thinking': '經由 agy 使用 Claude Opus 4.6（含思考）', 'n.gpt-oss-120b-medium': '開放權重 GPT-OSS 120B',
        'n.deepseek-flash': '最新的 Flash 模型（預設，便宜又強）', 'n.deepseek-v4-pro': 'DeepSeek V4 Pro（上一代，較貴）',
        'n.haiku': '最新的 Haiku：最省', 'n.sonnet': '最新的 Sonnet：均衡', 'n.opus': '最新的 Opus：最強、最耗用量',
        'n.claude-fable-5-1': 'Fable 5.1（固定版本）',
        'n.gpt-6-luna': 'GPT-6 Luna（最省；OpenAI 建議用於摘要）', 'n.gpt-6.1-terra': 'GPT-6.1 Terra', 'n.gpt-6.1-sol': 'GPT-6.1 Sol', 'n.gpt-6-astra': 'GPT-6 Astra',
      },
      'zh-CN': {
        tabTitle: '监控', guideTitle: '本地模型监控', guideDesc: '速度、GPU、内存',
        loading: '加载中…', connectErr: (u) => '无法连接监控服务（' + u + '）',
        connectHint: '请先启动 server/monitor_server.py（见 README）；下方的余额不需要它。',
        stLoading: '加载中', stOffline: '离线', stBusy: '处理中', stIdle: '空闲',
        secLocal: '本地模型', secMem: '内存', secOutsource: '外包（压缩／读长内容）', secBalance: 'DeepSeek 账号',
        genNow: '生成速度（实时）', genLast: '生成速度（上次回复）', promptNow: '提示处理（实时）', promptLast: '提示处理（上次）',
        prefillDone: '已完成（生成中）', busyWait: (s) => '处理中 ' + s + ' 秒（完成后显示速度）', prefillLive: (tps, n, p) => tps + ' tok/s · ' + n + ' tok · ' + p + '%',
        genSpeed: '生成速度（目前／上次回复）', genAvg: '生成速度（整体平均）', promptSpeed: '提示处理（目前／上次）', promptAvg: '提示处理（整体平均）', queue: '处理中 / 排队', kv: 'KV 缓存用量',
        noMetrics: '本次启动没有 --metrics，速度数据需重启模型后才有。', notStarted: '模型未启动。',
        visionLabel: '视觉（读图）', visionOn: '开', visionOff: '关（纯文本）', visionUnknown: '未知',
        visionTurnOn: '开启', visionTurnOff: '关闭', visionConfirm: '要重启模型吗？', visionYes: '重启', visionNo: '取消',
        visionWarn: '模型会重启（约 30～60 秒），KV 缓存清空，进行中的对话会中断，建议在新对话开始时切换。视觉多占约 3.7 GB 内存，32GB 机器上速度可能变慢。',
        visionRestarting: '模型重启中…', visionBusy: '模型正在处理请求，等回复结束再切换。', visionDenied: '只能从本机切换。',
        visionFail: '切换失败', visionPending: (on) => '设置是' + (on ? '开' : '关') + '，但运行中的模型不同，下次重启才会生效。', visionOfflineNote: '模型未启动：下次启动时会问你要不要开。',
        util: '使用率', temp: '温度', power: '功耗', ram: 'RAM', commit: '已提交（含页面文件）',
        updated: '更新 ',
        balLoading: '读取中…', balSignedOut: '尚未登录 DeepSeek 账号。', balFail: (m) => '暂时读不到余额。（' + m + '）',
        balBonus: '赠金 ', balMain: '余额 ', balSince: (d) => '（打开后 ' + d + '）', balZero: '余额 ¥0.00',
        offLabel: '关闭', noteOff: '不外包，由当前的本地模型自己处理。',
        noteAgy: '免费，但有每日额度上限。', noteDeepseek: '扣 DeepSeek 账号充值余额。',
        noteClaude: '计入 Claude 订阅用量。', noteCodex: '计入 ChatGPT / Codex 额度。',
        unavailable: '这台电脑找不到这个工具，无法使用',
        model: '模型', modelDefaultAgy: '默认（gemini-3.8-flash-high）', modelDefaultDeepseek: '默认（Flash，最新）',
        modelDefaultClaude: '默认（Haiku，最新，最省）', modelDefaultCodex: '默认（Codex 自己的默认）',
        modelCustom: '自定义…', modelCustomPh: '输入任意模型代号', modelCustomNote: '填该工具接受的任意代号。填错会让调用失败，并自动改由本地模型处理。',
        effort: '思考强度', effortDefault: '（默认，最省）', effortInName: '包含在模型名称里（例如 …-high）',
        eOff: '关闭思考', eLow: '低', eMedium: '中', eHigh: '高', eXhigh: '特高', eMax: '最高',
        warn: '⚠ 选了外包后，对话内容会发送到该外部 AI。含敏感内容（尤其是未审核模型的输出）请保持「关闭」：外部 AI 可能拒绝（会自动改由本地模型处理）或悄悄删掉部分内容（检测不到）；把敏感内容发送到外部服务也可能违反其使用条款、导致账号被标记，请自行判断。',
        lastPrefix: '最近一次压缩：', lastLocal: '本地模型', lastOk: '，成功', lastFail: '，失败，已改由本地模型处理', secs: (s) => '，' + s + ' 秒',
        usageRow: (n) => n + ' 今日 / 累计', times: (n, t) => n + ' 次 ≈' + t + ' tok', noRecords: '还没有外包记录。', language: '语言',
        'n.gemini-3.8-flash-low': '最快、最轻量', 'n.gemini-3.8-flash-medium': '均衡', 'n.gemini-3.8-flash-high': 'Flash 系列中最强（默认）',
        'n.claude-sonnet-4-6': '经由 agy 使用 Claude Sonnet 4.6（含思考）', 'n.claude-opus-4-6-thinking': '经由 agy 使用 Claude Opus 4.6（含思考）', 'n.gpt-oss-120b-medium': '开放权重 GPT-OSS 120B',
        'n.deepseek-flash': '最新的 Flash 模型（默认，便宜又强）', 'n.deepseek-v4-pro': 'DeepSeek V4 Pro（上一代，较贵）',
        'n.haiku': '最新的 Haiku：最省', 'n.sonnet': '最新的 Sonnet：均衡', 'n.opus': '最新的 Opus：最强、最耗用量',
        'n.claude-fable-5-1': 'Fable 5.1（固定版本）',
        'n.gpt-6-luna': 'GPT-6 Luna（最省；OpenAI 建议用于摘要）', 'n.gpt-6.1-terra': 'GPT-6.1 Terra', 'n.gpt-6.1-sol': 'GPT-6.1 Sol', 'n.gpt-6-astra': 'GPT-6 Astra',
      },
    };

    function detectLang() {
      try {
        const saved = window.localStorage.getItem(LANG_KEY);
        if (saved && DICT[saved]) return saved;
      } catch (e) { /* storage blocked: detect from the browser */ }
      const n = String(window.navigator.language || 'en').toLowerCase();
      if (/^zh-(tw|hk|mo|hant)/.test(n)) return 'zh-TW';
      return n.startsWith('zh') ? 'zh-CN' : 'en';
    }
    // The language of the render in progress; Body sets it, so every child reads the same one.
    let LANG = detectLang();
    function t(key, ...args) {
      const v = (DICT[LANG] && DICT[LANG][key] !== undefined) ? DICT[LANG][key] : DICT.en[key];
      if (v === undefined) return key;
      return typeof v === 'function' ? v(...args) : v;
    }

    function statsUrl() {
      try {
        const o = window.localStorage.getItem('dsh-llm-monitor.url');
        if (o) return o;
      } catch (e) { /* storage blocked: use the default */ }
      const host = window.location.hostname || '127.0.0.1';
      return 'http://' + host + ':8001/stats';
    }

    const pick = (...xs) => { for (const x of xs) if (typeof x === 'number' && isFinite(x) && x > 0) return x; return null; };
    const fmt = (n, d) => (typeof n === 'number' && isFinite(n) ? n.toFixed(d === undefined ? 1 : d) : '—');
    const tone = (p) => (p >= 92 ? '#d64545' : p >= 80 ? '#e5a50a' : '#3d8bfd');
    const BORDER = '.5px solid var(--dsw-alias-border-l3, rgba(128,128,128,.4))';
    // 判斷目前介面是深色還是淺色：看頁面文字顏色亮不亮（亮字＝深色背景）；讀不到就看系統偏好。
    // 2026-11-24：下拉選單的選項原本寫死黑字，在深色主題的彈出清單上變成黑底黑字看不到。
    const isDarkUi = () => {
      try {
        const c = (window.getComputedStyle(document.body).color.match(/[\d.]+/g) || []).map(Number);
        if (c.length >= 3) return (0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]) > 140;
      } catch (e) { /* 讀不到就用系統偏好 */ }
      try { return window.matchMedia('(prefers-color-scheme: dark)').matches; } catch (e) { return false; }
    };
    // 用 getter：每次 render 才取值，主題切換後立刻跟著變。
    const FIELD = {
      flex: 1, minWidth: 0, padding: '4px 6px', fontSize: 12, borderRadius: 6, color: 'inherit', background: 'transparent', border: BORDER,
      get colorScheme() { return isDarkUi() ? 'dark' : 'light'; },
    };
    // 下拉清單的選項：明確指定與目前主題相符的底色與字色。
    const OPT = {
      get color() { return isDarkUi() ? '#eaeaea' : '#111111'; },
      get background() { return isDarkUi() ? '#2b2d31' : '#ffffff'; },
    };

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

    function visionUrl() {
      return statsUrl().replace(/\/stats$/, '/vision');
    }

    // 視覺（讀圖）開關：顯示執行中模型實際有沒有載入視覺模組，按鈕要先二次確認，確認後 POST /vision，
    // 伺服器改設定並重啟模型；重啟期間顯示「重啟中」，等模型回來且模式吻合才解除。
    function VisionRow({ l, cfg, restarting }) {
      const [confirming, setConfirming] = React.useState(false);
      const [target, setTarget] = React.useState(null); // 剛送出的目標值（true／false），null＝沒有進行中的切換
      const [msg, setMsg] = React.useState(null);
      const actual = l.vision; // true／false／undefined（模型離線或舊版 llama-server）
      // 模型回來且模式與目標吻合 → 切換完成；伺服器端的「重啟中」旗號結束也解除（避免卡住）
      React.useEffect(() => {
        if (target !== null && l.up && actual === target) setTarget(null);
        if (target !== null && !restarting && !l.up && l.status === 'offline') {
          const to = setTimeout(() => setTarget(null), 120000);
          return () => clearTimeout(to);
        }
        return undefined;
      }, [target, actual, l.up, l.status, restarting]);
      const switching = target !== null || restarting;
      const send = async () => {
        const want = !(actual === true);
        setConfirming(false);
        setMsg(null);
        try {
          const r = await fetch(visionUrl(), { method: 'POST', body: JSON.stringify({ on: want }) });
          if (r.ok) { setTarget(want); return; }
          const j = await r.json().catch(() => ({}));
          setMsg(r.status === 403 ? t('visionDenied') : j.error === 'busy' ? t('visionBusy') : j.error === 'switching' ? t('visionRestarting') : t('visionFail') + ' (' + r.status + ')');
        } catch (e) { setMsg(t('visionFail')); }
      };
      const btn = (label, onClick, extra) => h('button', {
        onClick, style: Object.assign({ fontSize: 11, padding: '2px 8px', borderRadius: 6, border: BORDER, background: 'transparent', color: 'inherit', cursor: 'pointer' }, extra || {}),
      }, label);
      const valueText = actual === true ? t('visionOn') : actual === false ? t('visionOff') : t('visionUnknown');
      return h('div', { style: { margin: '6px 0 2px' } },
        h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12, gap: 6 } },
          h('span', { style: { opacity: 0.75 } }, t('visionLabel')),
          h('span', { style: { display: 'flex', alignItems: 'center', gap: 6 } },
            h('span', null, switching ? t('visionRestarting') : valueText),
            // 離線或舊版（讀不到目前模式）時不給按鈕，避免誤判方向
            (l.up && typeof actual === 'boolean' && !switching && !confirming)
              ? btn(actual ? t('visionTurnOff') : t('visionTurnOn'), () => { setMsg(null); setConfirming(true); }) : null)),
        confirming ? h('div', { style: { fontSize: 11, marginTop: 4, lineHeight: 1.4 } },
          h('div', { style: { opacity: 0.8, marginBottom: 4 } }, t('visionWarn')),
          h('div', { style: { display: 'flex', alignItems: 'center', gap: 6 } },
            h('span', null, t('visionConfirm')),
            btn(t('visionYes'), send, { color: '#e5a50a' }), btn(t('visionNo'), () => setConfirming(false)))) : null,
        msg ? h('div', { style: { color: '#e5a50a', fontSize: 11, marginTop: 3 } }, msg) : null,
        (!l.up && !switching) ? h('div', { style: { opacity: 0.6, fontSize: 11, marginTop: 3 } }, t('visionOfflineNote'))
          : (l.up && typeof actual === 'boolean' && actual !== cfg && !switching)
            ? h('div', { style: { opacity: 0.7, fontSize: 11, marginTop: 3 } }, t('visionPending', cfg)) : null);
    }

    const BACKENDS = ['off', 'agy', 'deepseek', 'claude', 'codex'];
    const BACKEND_LABEL = { agy: 'agy', deepseek: 'DeepSeek', claude: 'Claude', codex: 'Codex' };
    const backendLabel = (b) => (b === 'off' ? t('offLabel') : BACKEND_LABEL[b] || b);
    const BACKEND_NOTE = { off: 'noteOff', agy: 'noteAgy', deepseek: 'noteDeepseek', claude: 'noteClaude', codex: 'noteCodex' };
    // Model ids per tool (the empty id = the tool's own default). agy's list is what `agy models` prints.
    // The Claude ids are aliases: the CLI resolves them to the newest model of that family.
    const MODEL_PRESETS = {
      agy: ['gemini-3.8-flash-low', 'gemini-3.8-flash-medium', 'gemini-3.8-flash-high', 'claude-sonnet-4-6', 'claude-opus-4-6-thinking', 'gpt-oss-120b-medium'],
      deepseek: ['deepseek-flash', 'deepseek-v4-pro'],
      claude: ['haiku', 'sonnet', 'opus', 'claude-fable-5-1'],
      codex: ['gpt-6-luna', 'gpt-6.1-terra', 'gpt-6.1-sol', 'gpt-6-astra'],
    };
    const MODEL_DEFAULT = { agy: 'modelDefaultAgy', deepseek: 'modelDefaultDeepseek', claude: 'modelDefaultClaude', codex: 'modelDefaultCodex' };
    // Moving aliases show a plain name (the note says "newest"), so a model update never leaves a stale version
// number on screen; every other id is shown as the tool lists it.
const DISPLAY = { haiku: 'Haiku', sonnet: 'Sonnet', opus: 'Opus', 'deepseek-flash': 'DeepSeek Flash' };
    const modelText = (m) => (DISPLAY[m] || m) + ' — ' + t('n.' + m);
    const CUSTOM = '__custom__';

    // First entry = cheapest = default. agy has none: its strength is part of the model name.
    const EFFORT_PRESETS = {
      deepseek: ['off', 'low', 'high', 'max'],
      claude: ['low', 'medium', 'high', 'xhigh', 'max'],
      codex: ['low', 'medium', 'high', 'xhigh'],
    };
    const EFFORT_KEY = { off: 'eOff', low: 'eLow', medium: 'eMedium', high: 'eHigh', xhigh: 'eXhigh', max: 'eMax' };
    const effortLabel = (x) => (EFFORT_KEY[x] ? t(EFFORT_KEY[x]) : x);

    // Switch for outsourcing compaction / long reads to another AI, the model per AI, what it has used and
    // who wrote the last checkpoint. Hidden when the server has no /helper endpoint.
    function HelperSection() {
      const [st, setSt] = React.useState(null);
      const [busy, setBusy] = React.useState(false);
      const [draft, setDraft] = React.useState(null);
      const [customOn, setCustomOn] = React.useState(false);
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
      const presets = MODEL_PRESETS[cur] || [];
      const isCustom = customOn || (curModel !== '' && presets.indexOf(curModel) < 0);
      const btn = (b) => {
        const usable = b === 'off' || (st.available && st.available[b]);
        const on = cur === b;
        return h('button', {
          key: b, disabled: busy || !usable, onClick: () => { setDraft(null); setCustomOn(false); post({ backend: b }); },
          title: usable ? t(BACKEND_NOTE[b]) : t('unavailable'),
          style: {
            flex: 1, padding: '5px 0', fontSize: 12, borderRadius: 6, cursor: usable ? 'pointer' : 'not-allowed',
            border: BORDER, background: on ? '#3d8bfd' : 'transparent', color: on ? '#fff' : 'inherit', opacity: usable ? 1 : 0.4,
          },
        }, backendLabel(b));
      };
      const commitModel = (value) => {
        const v = value.trim();
        setDraft(null);
        if (v !== curModel) post({ models: { [cur]: v } });
      };
      const pickModel = (v) => {
        if (v === CUSTOM) { setCustomOn(true); return; }
        setCustomOn(false);
        setDraft(null);
        if (v !== curModel) post({ models: { [cur]: v } });
      };
      // A plain <select> always lists every choice, unlike a filtering text box; "Custom…" reveals a free input.
      const modelRow = cur === 'off' ? null : h('div', { style: { margin: '2px 0 6px', fontSize: 12 } },
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 6 } },
          h('span', { style: { opacity: 0.75, whiteSpace: 'nowrap' } }, t('model')),
          h('select', { value: isCustom ? CUSTOM : curModel, disabled: busy, onChange: (e) => pickModel(e.target.value), style: FIELD },
            h('option', { key: '', value: '', style: OPT }, t(MODEL_DEFAULT[cur])),
            presets.map((m) => h('option', { key: m, value: m, style: OPT }, modelText(m))),
            h('option', { key: CUSTOM, value: CUSTOM, style: OPT }, t('modelCustom')))),
        isCustom
          ? h('input', {
            value: draft === null ? curModel : draft, placeholder: t('modelCustomPh'), disabled: busy, autoFocus: true,
            onChange: (e) => setDraft(e.target.value),
            onBlur: (e) => { if (draft !== null) commitModel(e.target.value); },
            onKeyDown: (e) => { if (e.key === 'Enter') commitModel(e.target.value); },
            style: { ...FIELD, display: 'block', width: '100%', boxSizing: 'border-box', marginTop: 4 },
          })
          : null,
        // The full description of the chosen model, which the narrow select may cut off.
        h('div', { style: { opacity: 0.65, fontSize: 11, marginTop: 3, lineHeight: 1.4 } },
          isCustom ? t('modelCustomNote') : curModel ? modelText(curModel) : t(MODEL_DEFAULT[cur])));
      const efforts = EFFORT_PRESETS[cur];
      const curEffort = (st.config.efforts && st.config.efforts[cur]) || (efforts ? efforts[0] : '');
      const effortRow = cur === 'off' ? null : h('div', { style: { display: 'flex', alignItems: 'center', gap: 6, margin: '2px 0 6px', fontSize: 12 } },
        h('span', { style: { opacity: 0.75, whiteSpace: 'nowrap' } }, t('effort')),
        efforts
          ? h('select', {
            value: curEffort, disabled: busy, onChange: (e) => post({ efforts: { [cur]: e.target.value } }), style: FIELD,
          }, efforts.map((x, i) => h('option', { key: x, value: x, style: OPT }, effortLabel(x) + (i === 0 ? t('effortDefault') : ''))))
          : h('span', { style: { opacity: 0.6 } }, t('effortInName')));
      const warn = h('div', {
        style: {
          fontSize: 11, lineHeight: 1.5, margin: '6px 0', padding: '6px 8px', borderRadius: 6,
          background: cur === 'off' ? 'transparent' : 'rgba(229,165,10,.12)',
          border: '.5px solid ' + (cur === 'off' ? 'var(--dsw-alias-border-l3, rgba(128,128,128,.3))' : 'rgba(229,165,10,.6)'),
          opacity: cur === 'off' ? 0.65 : 1,
        },
      }, t('warn'));
      const last = st.last;
      const lastLine = last && h('div', { style: { fontSize: 12, margin: '4px 0', color: last.ok ? 'inherit' : '#e5a50a' } },
        t('lastPrefix') + (last.backend === 'local' ? t('lastLocal') : backendLabel(last.backend) + (last.model ? ' (' + last.model + (last.effort ? ' · ' + effortLabel(last.effort) : '') + ')' : ''))
        + (last.ok ? t('lastOk') : t('lastFail')) + (last.secs ? t('secs', last.secs) : '')
        + (last.error ? ' (' + String(last.error).slice(0, 60) + ')' : ''));
      const usage = st.usage || {};
      const rows = Object.keys(usage).map((b) => h(Row, {
        key: b, label: t('usageRow', backendLabel(b)),
        value: t('times', usage[b].today.calls, usage[b].today.tokens) + ' / ' + t('times', usage[b].total.calls, usage[b].total.tokens),
      }));
      return h(Section, { title: t('secOutsource') },
        h('div', { style: { display: 'flex', gap: 6, marginBottom: 6 } }, BACKENDS.map(btn)),
        modelRow,
        effortRow,
        h('div', { style: { fontSize: 12, opacity: 0.7, marginBottom: 4 } }, t(BACKEND_NOTE[cur])),
        warn,
        lastLine,
        rows.length ? rows : h('div', { style: { fontSize: 12, opacity: 0.55 } }, t('noRecords')));
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
      if (bal === undefined) body.push(h('div', { key: 'l', style: { opacity: 0.65, fontSize: 12 } }, t('balLoading')));
      else if (bal === null) body.push(h('div', { key: 'n', style: { opacity: 0.65, fontSize: 12 } }, t('balSignedOut')));
      else if (bal.status !== 'ready') body.push(h('div', { key: 'f', style: { opacity: 0.65, fontSize: 12 } }, t('balFail', bal.msg || JSON.stringify(bal).slice(0, 140))));
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
            label: (w.bonus ? t('balBonus') : t('balMain')) + w.currency,
            value: (SYMBOL[w.currency] || '') + now.toFixed(2) + (Math.abs(delta) >= 0.005 ? t('balSince', (delta > 0 ? '+' : '') + delta.toFixed(2)) : ''),
          }));
        });
        if (rows.length === 0) body.push(h('div', { key: 'e', style: { opacity: 0.65, fontSize: 12 } }, t('balZero')));
      }
      return h(Section, { title: t('secBalance') }, body);
    }

    function LanguagePicker({ lang, onChange }) {
      return h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 6, fontSize: 11, opacity: 0.7, marginTop: 4 } },
        h('span', null, t('language')),
        h('select', {
          value: lang, onChange: (e) => onChange(e.target.value),
          style: { ...FIELD, flex: '0 0 auto', padding: '2px 4px', fontSize: 11 },
        }, Object.keys(LANG_NAMES).map((k) => h('option', { key: k, value: k, style: OPT }, LANG_NAMES[k]))));
    }

    function Body() {
      const [data, setData] = React.useState(null);
      const [err, setErr] = React.useState(null);
      const [lang, setLang] = React.useState(LANG);
      LANG = lang;
      const changeLang = (l) => {
        try { window.localStorage.setItem(LANG_KEY, l); } catch (e) { /* storage blocked: applies to this view only */ }
        LANG = l;
        setLang(l);
      };
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
              if (!stopped) setErr(true);
            } finally { clearTimeout(to); }
          }
          if (!stopped) timer = setTimeout(tick, POLL_MS);
        };
        tick();
        return () => { stopped = true; clearTimeout(timer); };
      }, []);

      const wrap = { padding: 12, overflowY: 'auto', height: '100%', boxSizing: 'border-box', fontSize: 13 };
      const picker = h(LanguagePicker, { lang, onChange: changeLang });
      if (err && !data) return h('div', { style: wrap }, h(BalanceSection),
        h('div', { style: { opacity: 0.8 } }, t('connectErr', statsUrl())),
        h('div', { style: { opacity: 0.6, fontSize: 12, marginTop: 6 } }, t('connectHint')),
        picker);
      if (!data) return h('div', { style: wrap }, t('loading'));

      const l = data.llama || {};
      const m = l.metrics || null;
      const g = data.gpu;
      const mem = data.mem || {};
      const busy = (l.slots || []).some((s) => s.busy);
      const state = !l.up ? (l.status === 'loading model' ? t('stLoading') : t('stOffline')) : busy ? t('stBusy') : t('stIdle');
      const dot = !l.up ? '#8a8a8a' : busy ? '#e5a50a' : '#2fb344';
      const kv = m && typeof m.kv_cache_usage_ratio === 'number' ? m.kv_cache_usage_ratio * 100 : null;

      return h('div', { style: wrap },
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 } },
          h('span', { style: { width: 9, height: 9, borderRadius: '50%', background: dot, display: 'inline-block' } }),
          h('span', { style: { fontWeight: 600 } }, state),
          h('span', { style: { opacity: 0.7, fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } },
            l.model ? l.model + (l.n_ctx ? ' · ctx ' + l.n_ctx : '') : '')),
        err ? h('div', { style: { color: '#d64545', fontSize: 12, marginBottom: 8 } }, t('connectErr', statsUrl())) : null,

        h(Section, { title: t('secLocal') },
          // 伺服器有提供 vision_cfg 才顯示開關（舊版監視器伺服器沒有 /vision，不顯示）
          typeof data.vision_cfg === 'boolean'
            ? h(VisionRow, { key: 'vis', l, cfg: data.vision_cfg, restarting: !!data.vision_restarting }) : null,
          m
            ? [
              // 即時：閒置固定顯示 0.0 tok/s；處理中若還沒有速度資料（此版 llama-server 在請求結束才更新計數），
              // 改顯示「處理中 N 秒」與預填進度，證明確實在動。「上次」保留最近一次完成的速度。
              h(Row, { key: 'g', label: t('genNow'),
                value: !busy ? '0.0 tok/s' : (m.gen_live > 0 ? fmt(m.gen_live) + ' tok/s' : t('busyWait', fmt(l.busy_secs || 0, 0))) }),
              h(Row, { key: 'gl', label: t('genLast'), value: fmt(pick(m.gen_last, m.predicted_tokens_seconds)) + ' tok/s' }),
              h(Row, { key: 'ga', label: t('genAvg'), value: fmt(m.gen_avg) + ' tok/s' }),
              h(Row, { key: 'p', label: t('promptNow'),
                value: !busy ? '0.0 tok/s' : (m.gen_live > 0 ? t('prefillDone') : l.prefill ? t('prefillLive', fmt(l.prefill.tps), l.prefill.tokens, fmt(l.prefill.progress * 100, 0))
                  : (m.prompt_live > 0 ? fmt(m.prompt_live) + ' tok/s' : t('busyWait', fmt(l.busy_secs || 0, 0)))) }),
              h(Row, { key: 'pl', label: t('promptLast'), value: fmt(pick(m.prompt_last, m.prompt_tokens_seconds)) + ' tok/s' }),
              h(Row, { key: 'pa', label: t('promptAvg'), value: fmt(m.prompt_avg) + ' tok/s' }),
              h(Row, { key: 'r', label: t('queue'), value: fmt(m.requests_processing, 0) + ' / ' + fmt(m.requests_deferred, 0) }),
              kv !== null ? h(Bar, { key: 'k', label: t('kv'), value: kv, text: fmt(kv) + '%' }) : null,
            ]
            : h('div', { style: { opacity: 0.65, fontSize: 12 } },
              l.up ? t('noMetrics') : t('notStarted'))),

        g ? h(Section, { title: 'GPU · ' + g.name.replace('NVIDIA GeForce ', '') },
          h(Bar, { label: t('util'), value: g.util, text: fmt(g.util, 0) + '%' }),
          h(Bar, { label: 'VRAM', value: (g.vram_used_mb / g.vram_total_mb) * 100,
            text: fmt(g.vram_used_mb / 1024) + ' / ' + fmt(g.vram_total_mb / 1024) + ' GB' }),
          h(Row, { label: t('temp'), value: fmt(g.temp_c, 0) + ' °C' }),
          h(Row, { label: t('power'), value: fmt(g.power_w, 0) + ' / ' + fmt(g.power_limit_w, 0) + ' W' })) : null,

        h(Section, { title: t('secMem') },
          h(Bar, { label: t('ram'), value: (mem.ram_used_gb / mem.ram_total_gb) * 100,
            text: fmt(mem.ram_used_gb) + ' / ' + fmt(mem.ram_total_gb) + ' GB' }),
          h(Bar, { label: t('commit'), value: (mem.commit_used_gb / mem.commit_limit_gb) * 100,
            text: fmt(mem.commit_used_gb) + ' / ' + fmt(mem.commit_limit_gb) + ' GB' })),

        h(HelperSection),

        h(BalanceSection),

        h('div', { style: { opacity: 0.5, fontSize: 11, textAlign: 'right' } },
          t('updated') + new Date((data.t || 0) * 1000).toLocaleTimeString()),
        picker);
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
        title: () => t('tabTitle'),
        guide: [{
          id: 'open',
          order: 50,
          title: () => t('guideTitle'),
          description: () => t('guideDesc'),
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
