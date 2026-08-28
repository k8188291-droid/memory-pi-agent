const output = document.querySelector("#output");
const form = document.querySelector("#command-form");
const input = document.querySelector("#command-input");
const terminal = document.querySelector("#terminal");
const toast = document.querySelector("#toast");

const repoUrl = "https://github.com/k8188291-droid/memory-pi-agent";
const history = [];
let historyIndex = 0;
let toastTimer;

const commands = {
  about: `Memory Pi Agent 是以 Pi SDK 建立的單次執行 Agent。

它把 Agent 可見的檔案、AGENTS.md、skills、prompt templates、
session 與工具放進同一個記憶體環境；宿主檔案系統不會被暴露。

Node.js 22.19+ · ChatGPT Plus / Pro · OpenAI Codex OAuth`,

  quickstart: `<strong>01 · CLONE</strong>
<code>git clone ${repoUrl}.git</code>

<strong>02 · INSTALL</strong>
<code>cd memory-pi-agent && npm install</code>

<strong>03 · RUN</strong>
<code>node memory-pi-agent.js -p "測試所有工具"</code>

要保存 workspace、session 與 OAuth credential：
<code>node memory-pi-agent.js --fs files.json -p "繼續工作"</code>`,

  architecture: `<span class="tree-line"><b>prompt</b>
  └─ cli-interface.js
     └─ <b>agent-runtime.js</b>
        ├─ model-runtime.js       OAuth + model
        ├─ memory-environment.js VFS + just-bash
        ├─ memory-tools.js       shared tools
        └─ snapshot-store.js     optional persistence

<b>Agent-visible world</b>
  /workspace  files, AGENTS.md, session
  /agent      skills, prompt templates
  /bin        just-bash virtual commands

<b>Host boundary</b>
  script + node_modules only; no agent-visible host paths</span>`,

  security: `<strong>DEFAULT BOUNDARY</strong>
✓ In-memory virtual filesystem
✓ One shared VFS for read / write / grep / bash
✓ Extensions always disabled
✓ No host subprocesses
✓ Network, Python and JavaScript execution disabled by default

<strong>IMPORTANT</strong>
指定 <code>--fs</code> 的 snapshot 會包含對話、session 與 OAuth credential。
不要提交到版本控制，也不要分享。`,

  snapshot: `<strong>WITHOUT --fs</strong>
OAuth credential 與所有檔案只存在目前 Node 行程，結束即消失。

<strong>WITH --fs files.json</strong>
保存 virtual cwd、檔案、目錄、symlink、完整 session tree 與 OAuth credential。
下次執行會從同一個 context 繼續。

<span class="muted">Transient by default. Persistent only when explicit.</span>`,

  help: `Available commands:
  about          專案定位與需求
  quickstart     安裝與執行
  architecture   runtime 結構
  security       安全邊界
  snapshot       保存行為
  github         開啟原始碼
  clear          清除 terminal output
  help           顯示此列表`,
};

function escapeHtml(value) {
  return value.replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#039;",
    '"': "&quot;",
  })[character]);
}

function appendResult(command, body, { html = false } = {}) {
  const section = document.createElement("section");
  section.className = "result";

  const commandLine = document.createElement("p");
  commandLine.className = "result__command";
  commandLine.innerHTML = `<span class="prompt-mark">$</span> ${escapeHtml(command)}`;

  const resultBody = document.createElement("div");
  resultBody.className = "result__body";
  if (html) resultBody.innerHTML = body;
  else resultBody.textContent = body;

  section.append(commandLine, resultBody);
  output.append(section);
  section.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function runCommand(rawCommand) {
  const command = rawCommand.trim();
  if (!command) return;

  history.push(command);
  historyIndex = history.length;

  if (command === "clear") {
    output.innerHTML = "";
    return;
  }

  if (command === "github") {
    appendResult(command, `Opening ${repoUrl} …`);
    window.open(repoUrl, "_blank", "noopener,noreferrer");
    return;
  }

  if (Object.hasOwn(commands, command)) {
    appendResult(command, commands[command], { html: command !== "about" });
    return;
  }

  appendResult(command, `command not found: ${command}\nType "help" to see available commands.`);
}

function showToast(message) {
  window.clearTimeout(toastTimer);
  toast.textContent = message;
  toast.classList.add("is-visible");
  toastTimer = window.setTimeout(() => toast.classList.remove("is-visible"), 1600);
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  runCommand(input.value);
  input.value = "";
});

input.addEventListener("keydown", (event) => {
  if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
  event.preventDefault();
  const direction = event.key === "ArrowUp" ? -1 : 1;
  historyIndex = Math.min(history.length, Math.max(0, historyIndex + direction));
  input.value = history[historyIndex] ?? "";
  window.requestAnimationFrame(() => input.setSelectionRange(input.value.length, input.value.length));
});

document.querySelectorAll("[data-command]").forEach((button) => {
  button.addEventListener("click", () => {
    runCommand(button.dataset.command);
    input.focus();
  });
});

document.querySelectorAll("[data-copy]").forEach((button) => {
  button.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(button.dataset.copy);
      showToast("copied to clipboard");
    } catch {
      showToast("select the command to copy");
    }
  });
});

terminal.addEventListener("click", (event) => {
  if (event.target.closest("a, button, input")) return;
  input.focus({ preventScroll: true });
});

window.addEventListener("load", () => input.focus({ preventScroll: true }));
