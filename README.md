# Memory Pi Agent

> [Interactive project page](https://k8188291-droid.github.io/memory-pi-agent/)

瀏覽器 demo 會直接在頁面中執行 Pi agent loop、just-bash 與同一個 `InMemoryFs`。預設 deterministic demo 不需要網路；Live OpenAI 模式使用的 API key 只保留在目前分頁的記憶體中。

這是一個以 Pi SDK 建立的單次執行 Agent。Agent 能看到的檔案系統完全位於記憶體中：

- Settings、model catalog cache 都不寫入 Pi 的檔案；session 與 OAuth credential 只在指定 `--fs` 時寫入該 snapshot。
- `AGENTS.md`、skills、prompt templates 全部從虛擬檔案系統載入。
- Extensions 永遠停用，不載入任何 extension JavaScript。
- `read`、`write`、`edit`、`ls`、`find`、`grep`、`bash` 都使用同一個 just-bash `InMemoryFs`。
- bash 不啟動宿主 subprocess；network、Python、JavaScript execution 預設停用。

界線：Node 仍需從宿主讀取本 script 與 `node_modules`。指定 `--fs` 時，launcher 只會額外讀寫該 snapshot（包括 session 與 OAuth credential）；snapshot 的宿主路徑、session 與 credential 都不會出現在 Agent 的虛擬檔案系統。

## 模組結構

- `memory-pi-agent.js`：薄 CLI entry point 與相容 re-exports。
- `cli-interface.js`：參數解析、help 與 OAuth 終端互動。
- `agent-runtime.js`：單次 agent turn 的 orchestration 與狀態回存。
- `memory-environment.js`：VFS、just-bash、resource loader 與 tools 的組裝。
- `model-runtime.js`：OAuth credential 注入、登入與 model runtime。
- `memory-resource-loader.js`：從 VFS 載入 AGENTS、skills 與 prompts。
- `tools/`：file、search、bash tools 與共用輸出處理。
- `snapshot-store.js`：snapshot 容器與 VFS serialization。
- `session-snapshot.js`／`oauth-credential.js`：session 與 OAuth codecs。
- `virtual-path.js`／`agent-config.js`：共用 path 規則與固定設定。

## 需求與安裝

- Node.js 22.19 或更新版本
- ChatGPT Plus 或 Pro subscription

```bash
npm install
```

## 執行

首次執行預設顯示 OpenAI device-code 登入網址與代碼。未指定 `--fs` 時，OAuth access／refresh token 僅存在目前 Node 行程，程式結束即消失。

```bash
node memory-pi-agent.js -p "這是運行在memory的pi agent 環境，檔案系統全部都是In memory，請測試你所有功能都可以正常運作"
```

載入並在結束時保存 snapshot：

```bash
node memory-pi-agent.js --fs files.json -p "讀取 AGENTS.md，使用適合的 skill，然後測試所有工具"
```

`--fs` 指定的檔案可以不存在；此時從空白 workspace 與新 session 開始，結束後建立該檔。完整 session tree（messages、tool results、model／thinking 變更、compaction 與 branches）和 OAuth credential 都會一起保存，後續執行會延續相同上下文；refresh 後的新 token 也會在結束時更新。此檔案含有對話內容與可登入帳號的秘密，請勿提交到版本控制或分享。

其他選項：

```text
--model MODEL       預設 gpt-5.4
--cwd PATH          預設 /workspace；未指定時沿用 snapshot.cwd
--oauth device      預設，適合 headless CLI
--oauth browser     localhost callback／手動貼回 code
```

列出目前套件內可用的 model：

```bash
node --input-type=module -e '
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { InMemoryCredentialStore } from "@earendil-works/pi-ai";
const runtime = await ModelRuntime.create({
  credentials: new InMemoryCredentialStore(),
  modelsPath: null,
  refreshOnCreate: false,
  allowModelNetwork: false,
});
console.log(runtime.getModels("openai-codex").map(model => model.id).join("\n"));
'
```

## 不經檔案注入 OAuth

若外部系統已安全管理 OpenAI Codex OAuth credential，可透過環境變數注入：

```bash
PI_OPENAI_OAUTH_JSON='{"access":"...","refresh":"...","expires":1893456000000,"accountId":"..."}' \
  node memory-pi-agent.js -p "測試環境"
```

若同時指定 `--fs`，環境變數提供的 credential 優先於 snapshot，並會在結束時回存。若 access token 在行程內過期，Pi 會以 refresh token 更新 credential。

## Snapshot 格式

`files` 支援簡單字串，也支援帶 encoding 的 entry。程式輸出時會自動使用 UTF-8 或 Base64：

```json
{
  "version": 1,
  "cwd": "/workspace",
  "oauth": {
    "access": "...",
    "refresh": "...",
    "expires": 1893456000000,
    "accountId": "..."
  },
  "session": {
    "header": {
      "type": "session",
      "version": 3,
      "id": "...",
      "timestamp": "2026-08-27T12:00:00.000Z",
      "cwd": "/workspace"
    },
    "entries": [],
    "leafId": null
  },
  "directories": [],
  "files": {
    "/workspace/AGENTS.md": {
      "encoding": "utf8",
      "data": "Always verify your work.\n",
      "mode": 420
    },
    "/workspace/image.png": {
      "encoding": "base64",
      "data": "iVBORw0KGgo...",
      "mode": 420
    }
  },
  "symlinks": {}
}
```

just-bash 自動建立的 `/bin`、`/usr`、`/proc`、`/dev` 不會存進 snapshot，每次啟動都會重建。

Skills 預設掃描位置：

- `/agent/skills`
- `/workspace/.pi/skills`
- `/workspace/.agents/skills`

Prompt templates 預設掃描 `/agent/prompts` 和 `/workspace/.pi/prompts`。

## 保存範圍

指定 `--fs` 時會保存：虛擬檔案內容與 mode、目錄、symlink、virtual cwd、完整 Pi session，以及 OpenAI OAuth credential。

以下狀態仍不保存：

- Settings：目前每次都由程式中的固定設定重建，print mode 沒有可修改它們的入口。
- Model catalog cache：已停用 model catalog network refresh，只使用套件內建 catalog。
- 檔案時間戳與 ownership，以及排除後每次重建的 `/bin`、`/usr`、`/proc`、`/dev` runtime paths。
- 執行中的 request、retry timer、stdout/stderr 與其他行程暫態；若行程被強制終止到無法執行 `finally`，本次尚未回存的變更也會遺失。

## 測試

```bash
npm test
```

測試涵蓋工具共用同一個 VFS、宿主路徑不可見、`AGENTS.md`／skills／prompts、extension 排除、binary／OAuth／session snapshot，以及 Pi session 實際啟用的工具 registry。
