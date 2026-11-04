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
| Outsourcing | choose which AI (agy / DeepSeek / Claude / Codex), its model and reasoning effort writes your compaction checkpoint; usage and who wrote the last one | companion plugin [dsh-compaction-outsource](https://github.com/avery02072003-cmyk/dsh-compaction-outsource) |

Generation / prompt speed and KV-cache usage need `llama-server` to be started with `--metrics`.
GPU and memory numbers describe your machine, so they only make sense for a **local** model; the DeepSeek (cloud) model has no GPU/RAM to show.

## How it works

```
 DSH client (browser / desktop app)
   └─ lib/  (sidebar tab, polls every 2 s) ──HTTP──►  server/monitor_server.py ──► llama-server, nvidia-smi, OS
   └─ DeepSeek balance  ◄── ctx.remote.account.getBalance  (DSH's own account remote, no extra login)
```

* The plugin (`lib/`) is **client-only** DSH plugin: it registers a tab type in the right sidebar and a pane body. Nothing runs on the DSH host.
* `server/monitor_server.py` is a tiny read-only HTTP server (Python standard library only) exposing `GET /stats`.
  The llama-server API key (if you use one) stays inside this process and is never returned.
* The tab fetches `http://<page host>:8001/stats`, so it also works from a phone that opens your DSH web client over the LAN.
  Override the URL with `localStorage.setItem('dsh-llm-monitor.url', 'http://host:port/stats')` in the browser console.

## Install

Requirements: DSH, Python 3.8+ and a running `llama-server` (optional: `nvidia-smi`).

**1. Install the plugin from DSH's Plugins page** (web or desktop)

1. Open **Plugins** in the left sidebar → **Add plugin** (添加插件).
2. Paste this address and press **Install**:
   ```
   https://github.com/avery02072003-cmyk/dsh-llm-monitor
   ```
3. When it says *Installed*, press **Enable now**. That's it: DSH adds the plugin to the profile for you, no file editing.

**2. Start the monitor server** (the tab reads its numbers from it)

```bash
python server/monitor_server.py                    # 127.0.0.1:8001 -> llama-server at 127.0.0.1:8000
python server/monitor_server.py --host 0.0.0.0     # also reachable from other devices on your LAN
python server/monitor_server.py --llama http://127.0.0.1:8080 --port 8001
```

If `llama-server` uses `--api-key`, set `LLAMA_API_KEY` (or `LLAMA_API_KEY_FILE`) in the environment first. Start `llama-server` with `--metrics` to get speed and KV-cache numbers. The `server/` folder is in this repository (clone it or download the ZIP).

**3. Open it**

Open any conversation → click the sidebar button at the top right → pick the **Local model monitor** card (or press **+** on the sidebar tab strip and pick it).

> Without the server the tab still opens and the DeepSeek balance still works; the local-model sections show "offline".
> The DSH Plugins page installs into the profile you are running. After an update, restart DSH once: the server caches client bundles at start-up.
> Verified on the DSH web client; the desktop app uses the same Plugins page.

<details><summary>Manual install (only if the Plugins page is not available)</summary>

1. Back up the profile's `package.json` and `cordis.patch.yml` (`~/.dsh/profiles/<name>/`).
2. Add `"dsh-llm-monitor": "file:/absolute/path/to/dsh-llm-monitor"` to its `package.json` dependencies and copy this repository to `node_modules/dsh-llm-monitor/`.
3. Append to `cordis.patch.yml`:
   ```yaml
   - insert:
       - id: llm-monitor
         name: dsh-llm-monitor
   ```
4. Restart DSH.
</details>

## Outsourcing section (optional)

Install [dsh-compaction-outsource](https://github.com/avery02072003-cmyk/dsh-compaction-outsource) as well and the tab gets an **Outsourcing** section: switch the helper AI, pick its model and effort, and see which AI wrote the last compaction. It is **off by default**. The server reads and writes the same data folder as that plugin (`--outsource-dir`, default `~/.dsh/outsource`). Changing the setting from a browser is only accepted from the same host as the server.

The model box is a drop-down that always lists every choice, each with a short description (for example `gemini-3.8-flash-low — fastest, lightest`, `Haiku — Newest Haiku: cheapest`), plus **Custom…** for any other id. The agy list is what `agy models` prints. The Claude entries (Haiku / Sonnet / Opus) and DeepSeek Flash are shown by name and marked "newest" instead of a version number, because they always point to the newest model of that family, so an update never leaves a stale number on screen.

The tab follows your browser language (繁體中文 / 简体中文 / English) and has a language picker at the bottom. To add a language, copy the `en` table at the top of `lib/client.js`, translate it and register it in `LANG_NAMES`.

## Uninstall

**Plugins** → find *dsh-llm-monitor* under installed plugins → uninstall. Stop `monitor_server.py`.

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
| 外包 | 選擇由哪個 AI（agy / DeepSeek / Claude / Codex）、用什麼模型與思考強度來寫壓縮檢查點；顯示用量與最近一次由誰寫 | 搭配插件 [dsh-compaction-outsource](https://github.com/avery02072003-cmyk/dsh-compaction-outsource) |

生成速度、提示處理速度、KV 用量需要 `llama-server` 加 `--metrics` 啟動。
GPU 和記憶體是你這台電腦的數字，只對**本地**模型有意義；DeepSeek 雲端模型沒有對應的 GPU / RAM 可顯示，所以只顯示帳號餘額。

### 運作方式

* 外掛（`lib/`）是**純前端**的 DSH 外掛：在右側欄註冊一種分頁和內容，不在 DSH 主機端執行任何東西。
* `server/monitor_server.py` 是只讀的小型 HTTP 服務（只用 Python 標準函式庫），提供 `GET /stats`。API 金鑰只留在這個程序內，不會回傳。
* 分頁會向 `http://<網頁主機>:8001/stats` 取資料，所以用手機透過區網開 DSH 網頁版也能看。要改網址，可在瀏覽器主控台執行 `localStorage.setItem('dsh-llm-monitor.url', 'http://host:port/stats')`。

```
 DSH 前端（瀏覽器／桌面 app）
   └─ lib/（側欄分頁，每 2 秒輪詢）──HTTP──►  server/monitor_server.py ──► llama-server、nvidia-smi、作業系統
   └─ DeepSeek 餘額  ◄── ctx.remote.account.getBalance（DSH 自己的帳號服務，不需另外登入）
```

### 安裝

1. **從 DSH 的插件頁安裝**（網頁版、桌面版都有）：左側欄「插件」→「添加插件」→ 貼上 `https://github.com/avery02072003-cmyk/dsh-llm-monitor` →「安装」→ 完成後按「立即启用」。DSH 會自動把外掛加進設定檔，不用手動改任何檔案。
2. 啟動服務（分頁的數字從這裡來）。需求：DSH、Python 3.8+、執行中的 `llama-server`（`nvidia-smi` 可選）。`server/` 資料夾在本倉庫裡（clone 或下載 ZIP）：

   ```bash
   python server/monitor_server.py                    # 127.0.0.1:8001 -> 連到 127.0.0.1:8000 的 llama-server
   python server/monitor_server.py --host 0.0.0.0     # 區網內其他裝置也能連
   python server/monitor_server.py --llama http://127.0.0.1:8080 --port 8001
   ```

   `llama-server` 有設 `--api-key` 的話，先設定環境變數 `LLAMA_API_KEY` 或 `LLAMA_API_KEY_FILE`；要看速度與 KV 快取，`llama-server` 需加 `--metrics`。
3. 打開任一對話 → 右上角點側欄按鈕 → 選「本地模型監控」卡片；分頁被關掉時，按分頁列的 **＋** 即可再打開。

> 沒有啟動服務時分頁仍可開啟，DeepSeek 餘額照常顯示，本地模型區塊會顯示「離線」。更新外掛後請重啟一次 DSH（伺服器啟動時就會快取前端程式）。
> 已在 DSH 網頁版實測；桌面版使用同一個插件頁。

<details><summary>手動安裝（插件頁用不了才需要）</summary>

1. 先備份 `~/.dsh/profiles/<名稱>/` 裡的 `package.json`、`cordis.patch.yml`。
2. 把本倉庫複製到 `node_modules/dsh-llm-monitor/`，並在 `package.json` 的 `dependencies` 加上 `"dsh-llm-monitor": "file:/你的路徑/dsh-llm-monitor"`。
3. 在 `cordis.patch.yml` 最後加上 `- insert:` → `- id: llm-monitor` / `name: dsh-llm-monitor`。
4. 重新啟動 DSH。
</details>

### 外包區塊（選用）

再安裝 [dsh-compaction-outsource](https://github.com/avery02072003-cmyk/dsh-compaction-outsource)，分頁就會多出**外包**區塊：切換幫忙的 AI、選模型與思考強度，並看到最近一次壓縮是誰寫的。**預設關閉。** 服務與該插件讀寫同一個資料夾（`--outsource-dir`，預設 `~/.dsh/outsource`）。從瀏覽器改設定時，只接受與服務同一主機的來源。

模型欄是一個永遠列出全部選項的下拉選單，每項附簡短說明（例如 `gemini-3.8-flash-low — 最快、最輕量`、`Haiku — 最新的 Haiku：最省`），另有「**自訂…**」可填任何其他代號。agy 的清單就是 `agy models` 印出來的。Claude（Haiku／Sonnet／Opus）與 DeepSeek Flash 只顯示名稱並標註「最新」、不寫版本號，因為它們永遠指向該系列最新的模型，更新後畫面上就不會留著過時的數字。

分頁會跟隨瀏覽器語言（繁體中文／简体中文／English），底部有語言選單。要新增語言：複製 `lib/client.js` 開頭的 `en` 表、翻譯後登記到 `LANG_NAMES`。

### 解除安裝

「插件」→ 在已安裝清單找到 *dsh-llm-monitor* → 解除安裝，並停止 `monitor_server.py`。

### 注意事項

* 服務沒有身分驗證，預設只綁 `127.0.0.1`；只有在你信任的區網才用 `--host 0.0.0.0`。
* 輸出不含 API 金鑰，但包含顯卡型號、記憶體大小與模型名稱。
* DeepSeek 餘額是由你自己 DSH 內已登入的帳號服務讀取，本專案不會取得或保存你的憑證。

### 已知限制

* 外掛向帳號服務傳的用戶端版本是 `0.2.1-rc.5`；其他 DSH 版本可能需要更新 `lib/client.js` 裡的這個字串。
* 餘額請求偶爾會暫時失敗；分頁每 60 秒重試一次。
* GPU 數據需要 NVIDIA 顯卡且 `nvidia-smi` 在 `PATH` 內。
* 外掛內部用到的 `sidebarRightTabs`、`slots`、`remote.account` 都是 DSH 前端 API，可能隨版本變動。

### 授權

MIT，見 [LICENSE](LICENSE)。
