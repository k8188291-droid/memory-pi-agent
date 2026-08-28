import { BrowserAgentRuntime } from "./runtime.js";

const elements = {
  form: document.querySelector("#prompt-form"),
  prompt: document.querySelector("#prompt-input"),
  mode: document.querySelector("#mode-select"),
  format: document.querySelector("#format-select"),
  formatField: document.querySelector("#format-field"),
  endpoint: document.querySelector("#endpoint-input"),
  endpointField: document.querySelector("#endpoint-field"),
  model: document.querySelector("#model-input"),
  modelField: document.querySelector("#model-field"),
  key: document.querySelector("#api-key"),
  keyField: document.querySelector("#key-field"),
  modeNote: document.querySelector("#mode-note"),
  run: document.querySelector("#run-button"),
  stop: document.querySelector("#stop-button"),
  reset: document.querySelector("#reset-button"),
  transcript: document.querySelector("#transcript"),
  memoryMap: document.querySelector("#memory-map"),
  statusDot: document.querySelector("#status-dot"),
  statusText: document.querySelector("#status-text"),
};

let runtime = new BrowserAgentRuntime();
let streamBody;

function setStatus(text, state = "ready") {
  elements.statusText.textContent = text;
  elements.statusDot.classList.toggle("is-busy", state === "busy");
  elements.statusDot.classList.toggle("is-error", state === "error");
}

function appendMessage(label, body, variant = label) {
  const article = document.createElement("article");
  article.className = `message message--${variant}`;
  const labelNode = document.createElement("div");
  labelNode.className = "message__label";
  labelNode.textContent = label;
  const bodyNode = document.createElement("div");
  bodyNode.className = "message__body";
  bodyNode.textContent = body;
  article.append(labelNode, bodyNode);
  elements.transcript.append(article);
  elements.transcript.scrollTop = elements.transcript.scrollHeight;
  return bodyNode;
}

function resultText(result) {
  return result?.content?.map((part) => part.type === "text" ? part.text : `[${part.type}]`).join("\n") || "(no output)";
}

async function renderFiles() {
  const files = await runtime.listFiles();
  elements.memoryMap.replaceChildren();
  if (!files.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.innerHTML = "<span>workspace/</span><small>Run the agent to create files.</small>";
    elements.memoryMap.append(empty);
    return;
  }
  for (const file of files) {
    const row = document.createElement("div");
    row.className = `file-entry file-entry--${file.type === "directory" ? "dir" : "file"}`;
    const branch = document.createElement("span");
    branch.className = "file-entry__branch";
    branch.textContent = `${"  ".repeat(file.depth)}${file.type === "directory" ? "├─" : "└─"}`;
    const name = document.createElement("span");
    name.className = "file-entry__name";
    name.textContent = `${file.name}${file.type === "directory" ? "/" : ""}`;
    name.title = file.path;
    const meta = document.createElement("span");
    meta.className = "file-entry__meta";
    meta.textContent = file.type === "file" ? `${file.size ?? 0}b` : "mem";
    row.append(branch, name, meta);
    elements.memoryMap.append(row);
  }
}

function handleAgentEvent(event) {
  if (event.type === "agent_start") {
    setStatus("agent running · memfs active", "busy");
  } else if (event.type === "message_start" && event.message.role === "assistant") {
    streamBody = appendMessage("agent", "", "assistant");
  } else if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
    if (!streamBody) streamBody = appendMessage("agent", "", "assistant");
    streamBody.textContent += event.assistantMessageEvent.delta;
    elements.transcript.scrollTop = elements.transcript.scrollHeight;
  } else if (event.type === "message_end" && event.message.role === "assistant") {
    if (streamBody && !streamBody.textContent) streamBody.closest(".message")?.remove();
    streamBody = undefined;
  } else if (event.type === "tool_execution_start") {
    appendMessage(event.toolName, `$ ${JSON.stringify(event.args)}`, "tool");
    setStatus(`tool · ${event.toolName}`, "busy");
  } else if (event.type === "tool_execution_end") {
    appendMessage(event.isError ? "error" : "output", resultText(event.result), event.isError ? "error" : "tool");
    void renderFiles();
  } else if (event.type === "agent_end") {
    setStatus("complete · memfs retained");
  }
}

function updateMode() {
  const live = elements.mode.value === "compatible";
  elements.formatField.hidden = !live;
  elements.endpointField.hidden = !live;
  elements.modelField.hidden = !live;
  elements.keyField.hidden = !live;
  elements.modeNote.innerHTML = live
    ? '<span class="accent">direct compatible mode</span> sends requests from this browser to your endpoint. Endpoint, model ID and key are never persisted; the endpoint must allow browser CORS and tool calling.'
    : '<span class="accent">local demo</span> uses Pi\'s scripted model so the complete agent/tool loop runs without a key or network.';
}

elements.mode.addEventListener("change", updateMode);

document.querySelectorAll("[data-prompt]").forEach((button) => {
  button.addEventListener("click", () => {
    elements.prompt.value = button.dataset.prompt;
    elements.prompt.focus();
  });
});

elements.form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const prompt = elements.prompt.value.trim();
  if (!prompt) return;
  appendMessage("you", prompt, "user");
  elements.run.disabled = true;
  elements.stop.hidden = false;
  streamBody = undefined;
  try {
    await runtime.run({
      mode: elements.mode.value,
      prompt,
      apiKey: elements.key.value,
      endpoint: elements.endpoint.value,
      modelId: elements.model.value,
      apiFormat: elements.format.value,
      onEvent: handleAgentEvent,
    });
    await renderFiles();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    appendMessage("error", message, "error");
    setStatus("runtime error", "error");
  } finally {
    elements.run.disabled = false;
    elements.stop.hidden = true;
    streamBody = undefined;
  }
});

elements.stop.addEventListener("click", () => runtime.abort());

elements.reset.addEventListener("click", async () => {
  runtime.abort();
  runtime = new BrowserAgentRuntime();
  elements.key.value = "";
  elements.transcript.innerHTML = '<article class="message message--system"><div class="message__label">system</div><div class="message__body">/workspace remounted in memory · tools: read, write, edit, ls, bash</div></article>';
  await renderFiles();
  setStatus("ready · fresh memfs mounted");
});

elements.prompt.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) elements.form.requestSubmit();
});

updateMode();
void renderFiles();
