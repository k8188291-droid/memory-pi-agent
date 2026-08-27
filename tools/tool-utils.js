import { normalizeVirtualPath } from "../virtual-path.js";

const MAX_TOOL_BYTES = 50 * 1024;
const MAX_TOOL_LINES = 2_000;

export function textResult(text, details) {
  return { content: [{ type: "text", text }], details };
}

export function truncateOutput(value, { tail = false } = {}) {
  const normalized = String(value).replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");
  const selected = tail ? lines.slice(-MAX_TOOL_LINES) : lines.slice(0, MAX_TOOL_LINES);
  let output = selected.join("\n");
  let bytes = Buffer.byteLength(output);
  let truncated = lines.length > selected.length;
  if (bytes > MAX_TOOL_BYTES) {
    const buffer = Buffer.from(output);
    output = (tail
      ? buffer.subarray(buffer.length - MAX_TOOL_BYTES)
      : buffer.subarray(0, MAX_TOOL_BYTES)).toString("utf8");
    truncated = true;
    bytes = Buffer.byteLength(output);
  }
  if (truncated) output += `\n\n[Output truncated in memory: ${bytes} bytes shown]`;
  return output;
}

export function detectImageMime(buffer) {
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    return "image/png";
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "image/jpeg";
  }
  if (buffer.length >= 6 && ["GIF87a", "GIF89a"].includes(buffer.subarray(0, 6).toString("ascii"))) {
    return "image/gif";
  }
  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
    buffer.subarray(8, 12).toString("ascii") === "WEBP"
  ) return "image/webp";
  return undefined;
}

export function isProbablyBinary(buffer) {
  return buffer.subarray(0, Math.min(buffer.length, 8_192)).includes(0);
}

export async function listFilesUnder(vfs, root) {
  const normalizedRoot = normalizeVirtualPath(root, "/");
  const prefix = normalizedRoot === "/" ? "/" : `${normalizedRoot}/`;
  const result = [];
  for (const path of vfs.getAllPaths()) {
    if (path !== normalizedRoot && !path.startsWith(prefix)) continue;
    try {
      if ((await vfs.stat(path)).isFile) result.push(path);
    } catch {}
  }
  return result.sort();
}
