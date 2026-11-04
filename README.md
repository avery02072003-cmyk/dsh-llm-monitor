# dsh-llm-monitor

A right-sidebar **Monitor** tab for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH), for people who run a local model with `llama.cpp`.
It works in both the DSH web client and the desktop app, because they share the same client.

English | [繁體中文](#繁體中文)

> Unofficial community plugin. Not affiliated with or endorsed by DeepSeek.
> Tested with DSH `0.2.1-rc.5` on Windows 11 + `llama-server` (llama.cpp) + an NVIDIA GPU.

## What it shows

| Section | Data | Source |
|---|---|---|
| Local model | up / idle / busy, model name, context size, generation tok/s, prompt tok/s, requests processing / queued, KV-cache usage | `llama-server` `/health`, `/props`, `/slots`, `/metrics` |
| GPU | utilization, VRAM, temperature, power | `nvidia-smi` |
| Memory | RAM, committed memory (RAM + page file) | OS |
| DeepSeek account | balance, and the change since you opened the tab | DSH's own account service (`getBalance`) |

Generation / prompt speed and KV-cache usage need `llama-server` to be started with `--metrics`.
GPU and memory numbers describe your machine, so they only make sense for a **local** model; the DeepSeek (cloud) model has no GPU/RAM to show.

## How it works

```
 DSH client (browser / desktop app)
   └─ plugin/  (sidebar tab, polls every 2 s) ──HTTP──►  server/monitor_server.py ──► llama-server, nvidia-smi, OS
   └─ DeepSeek balance  ◄── ctx.remote.account.getBalance  (DSH's own account remote, no extra login)
```

* `plugin/` is a **client-only** DSH plugin: it registers a tab type in the right sidebar and a pane body. Nothing runs on the DSH host.
* `server/monitor_server.py` is a tiny read-only HTTP server (Python standard library only) exposing `GET /stats`.
  The llama-server API key (if you use one) stays inside this process and is never returned.
* The tab fetches `http://<page host>:8001/stats`, so it also works from a phone that opens your DSH web client over the LAN.
  Override the URL with `localStorage.setItem('dsh-llm-monitor.url', 'http://host:port/stats')` in the browser console.

## Install

Requirements: DSH, Python 3.8+, a running `llama-server`; optional: `nvidia-smi`.

**1. Start the server**

```bash
python server/monitor_server.py                    # 127.0.0.1:8001 -> llama-server at 127.0.0.1:8000
python server/monitor_server.py --host 0.0.0.0     # also reachable from other devices on your LAN
python server/monitor_server.py --llama http://127.0.0.1:8080 --port 8001
```

If `llama-server` uses `--api-key`, set `LLAMA_API_KEY` (or `LLAMA_API_KEY_FILE`) in the environment before starting the server.
Start `llama-server` with `--metrics` to get speed and KV-cache numbers.

**2. Install the plugin into a DSH profile**

A DSH profile lives in `~/.dsh/profiles/<name>/` (for example `web`, `desktop`, or one you created).

1. **Back up** the profile's `package.json` and `cordis.patch.yml`.
2. Copy this repository's `plugin/` folder to `~/.dsh/profiles/<name>/node_modules/dsh-llm-monitor/`.
3. Add it to the profile's `package.json` dependencies (so a later install does not prune it):
   ```json
   "dependencies": { "dsh-llm-monitor": "file:/absolute/path/to/dsh-llm-monitor/plugin" }
   ```
4. Append this to the profile's `cordis.patch.yml`:
   ```yaml
   - insert:
       - id: llm-monitor
         name: dsh-llm-monitor
   ```
5. Restart that DSH (web server or desktop app). The server caches client bundles at start-up, so a restart is required after every plugin update.

**3. Open it**

Open any conversation → click the sidebar button at the top right → pick the **Local model monitor** card (or press **+** on the sidebar tab strip and pick it).

> The `desktop` profile is managed by the desktop app. Edit it only with the app closed, keep your backups, and expect an app update to possibly rewrite it.

## Uninstall

Remove the `- insert:` block you added, delete `node_modules/dsh-llm-monitor` and the dependency line, then restart DSH.

## Security notes

* The server is read-only and has no authentication. It binds to `127.0.0.1` by default; use `--host 0.0.0.0` only on a network you trust.
* Output contains no API keys. It does contain your GPU model, memory sizes and the llama-server model name.
* The DeepSeek balance is read through DSH's own signed-in account service inside your DSH client; this project never sees or stores your credentials.

## Known limitations

* The plugin passes `0.2.1-rc.5` as the client version to the account service; other DSH versions may need that string updated in `plugin/lib/client.js`.
* The balance request occasionally returns a transient failure; the tab retries every 60 s.
* GPU stats need an NVIDIA GPU with `nvidia-smi` in `PATH`.
* Plugin internals (`sidebarRightTabs`, `slots`, `remote.account`) are DSH client APIs that may change between releases.

## License

MIT, see [LICENSE](LICENSE).

---

## 繁體中文

給用 `llama.cpp` 跑本地模型的 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH）使用者：在**右側欄**加一個「監控」分頁。網頁版和桌面版共用同一套前端，所以兩邊都能用。

> 非官方社群外掛，與 DeepSeek 無關。測試環境：DSH `0.2.1-rc.5`、Windows 11、`llama-server`、NVIDIA 顯卡。

### 會顯示什麼

| 區塊 | 內容 | 來源 |
|---|---|---|
| 本地模型 | 離線 / 閒置 / 處理中、模型名稱、ctx、生成速度、提示處理速度、處理中與排隊數、KV 快取用量 | `llama-server` 的 `/health`、`/props`、`/slots`、`/metrics` |
| GPU | 使用率、VRAM、溫度、功耗 | `nvidia-smi` |
| 記憶體 | RAM、已認可記憶體（RAM + 分頁檔） | 作業系統 |
| DeepSeek 帳號 | 餘額，以及開啟分頁後的變化 | DSH 自己的帳號服務（`getBalance`） |

生成速度、提示處理速度、KV 用量需要 `llama-server` 加 `--metrics` 啟動。
GPU 和記憶體是你這台電腦的數字，只對**本地**模型有意義；DeepSeek 雲端模型沒有對應的 GPU / RAM 可顯示，所以只顯示帳號餘額。

### 運作方式

* `plugin/` 是**純前端**的 DSH 外掛：在右側欄註冊一種分頁和內容，不在 DSH 主機端執行任何東西。
* `server/monitor_server.py` 是只讀的小型 HTTP 服務（只用 Python 標準函式庫），提供 `GET /stats`。API 金鑰只留在這個程序內，不會回傳。
* 分頁會向 `http://<網頁主機>:8001/stats` 取資料，所以用手機透過區網開 DSH 網頁版也能看。

### 安裝

1. 啟動服務：`python server/monitor_server.py`（要讓手機連，加 `--host 0.0.0.0`；`llama-server` 有設 `--api-key` 的話，先設定環境變數 `LLAMA_API_KEY` 或 `LLAMA_API_KEY_FILE`）。
2. **先備份**要安裝的 DSH 設定檔（`~/.dsh/profiles/<名稱>/` 裡的 `package.json`、`cordis.patch.yml`）。
3. 把本專案的 `plugin/` 複製到 `~/.dsh/profiles/<名稱>/node_modules/dsh-llm-monitor/`，在 `package.json` 的 `dependencies` 加上 `"dsh-llm-monitor": "file:/你的路徑/dsh-llm-monitor/plugin"`。
4. 在 `cordis.patch.yml` 最後加上：
   ```yaml
   - insert:
       - id: llm-monitor
         name: dsh-llm-monitor
   ```
5. 重新啟動該 DSH（每次更新外掛都要重啟，因為伺服器啟動時就會快取前端程式）。
6. 打開任一對話 → 右上角點側欄按鈕 → 選「本地模型監控」卡片；分頁被關掉時，按分頁列的 **＋** 即可再打開。

> 桌面版的 `desktop` 設定檔由桌面 app 管理：請在 app 關閉時修改、保留備份，app 更新後可能被改寫。

### 注意事項

* 服務沒有身分驗證，預設只綁 `127.0.0.1`；只有在你信任的區網才用 `--host 0.0.0.0`。
* 輸出不含 API 金鑰，但包含顯卡型號、記憶體大小與模型名稱。
* DeepSeek 餘額是由你自己 DSH 內已登入的帳號服務讀取，本專案不會取得或保存你的憑證。

### 授權

MIT。
