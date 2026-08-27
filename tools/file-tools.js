import { posix } from "node:path";
import { Type } from "@earendil-works/pi-ai";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { normalizeVirtualPath } from "../virtual-path.js";
import { detectImageMime, isProbablyBinary, textResult, truncateOutput } from "./tool-utils.js";

export function createFileTools({ vfs, cwd }) {
  const resolve = (path) => normalizeVirtualPath(path, cwd);

  const read = defineTool({
    name: "read",
    label: "read",
    description: "Read a text or image file from the isolated in-memory filesystem.",
    promptSnippet: "Read files from the in-memory workspace",
    promptGuidelines: ["Use read to inspect files. Every visible path is virtual and in memory."],
    parameters: Type.Object({
      path: Type.String({ description: "Virtual file path, relative to /workspace or absolute" }),
      offset: Type.Optional(Type.Number({ description: "1-indexed starting line" })),
      limit: Type.Optional(Type.Number({ description: "Maximum number of lines" })),
    }),
    executionMode: "parallel",
    async execute(_id, { path, offset, limit }, signal) {
      signal?.throwIfAborted();
      const absolutePath = resolve(path);
      const stat = await vfs.stat(absolutePath);
      if (!stat.isFile) throw new Error(`Not a file: ${absolutePath}`);
      const buffer = Buffer.from(await vfs.readFileBuffer(absolutePath));
      const mimeType = detectImageMime(buffer);
      if (mimeType) {
        return {
          content: [
            { type: "text", text: `Read image file [${mimeType}] from ${absolutePath}` },
            { type: "image", data: buffer.toString("base64"), mimeType },
          ],
          details: undefined,
        };
      }
      if (isProbablyBinary(buffer)) return textResult(`Binary file: ${absolutePath} (${buffer.length} bytes)`);
      const lines = buffer.toString("utf8").split("\n");
      const start = Math.max(0, (offset ?? 1) - 1);
      if (start >= lines.length && lines.length > 0) throw new Error(`Offset ${offset} is beyond end of file`);
      const end = limit === undefined ? lines.length : Math.min(lines.length, start + Math.max(0, limit));
      let output = truncateOutput(lines.slice(start, end).join("\n"));
      if (end < lines.length) output += `\n\n[${lines.length - end} more lines; continue with offset=${end + 1}]`;
      return textResult(output);
    },
  });

  const write = defineTool({
    name: "write",
    label: "write",
    description: "Create or completely overwrite a file in the isolated in-memory filesystem.",
    promptSnippet: "Create or overwrite in-memory files",
    promptGuidelines: ["Use write for new files or complete rewrites."],
    parameters: Type.Object({
      path: Type.String({ description: "Virtual file path" }),
      content: Type.String({ description: "Complete UTF-8 file content" }),
    }),
    executionMode: "sequential",
    async execute(_id, { path, content }, signal) {
      signal?.throwIfAborted();
      const absolutePath = resolve(path);
      await vfs.mkdir(posix.dirname(absolutePath), { recursive: true });
      await vfs.writeFile(absolutePath, content, "utf8");
      return textResult(`Wrote ${Buffer.byteLength(content)} bytes to ${absolutePath}`);
    },
  });

  const replacementSchema = Type.Object({
    oldText: Type.String({ description: "Exact unique text from the original file" }),
    newText: Type.String({ description: "Replacement text" }),
  });
  const edit = defineTool({
    name: "edit",
    label: "edit",
    description: "Apply one or more exact, non-overlapping replacements to an in-memory file.",
    promptSnippet: "Edit in-memory files with exact text replacements",
    promptGuidelines: [
      "Each edits[].oldText must occur exactly once in the original file.",
      "Combine multiple disjoint replacements into one edit call.",
    ],
    parameters: Type.Object({
      path: Type.String({ description: "Virtual file path" }),
      edits: Type.Array(replacementSchema, { minItems: 1 }),
    }),
    prepareArguments(args) {
      if (!args || typeof args !== "object") return args;
      const result = { ...args };
      if (typeof result.edits === "string") {
        try { result.edits = JSON.parse(result.edits); } catch {}
      }
      if (result.edits && !Array.isArray(result.edits)) result.edits = [result.edits];
      return result;
    },
    executionMode: "sequential",
    async execute(_id, { path, edits }, signal) {
      signal?.throwIfAborted();
      const absolutePath = resolve(path);
      const original = await vfs.readFile(absolutePath, "utf8");
      const ranges = edits.map(({ oldText, newText }, index) => {
        if (!oldText) throw new Error(`edits[${index}].oldText must not be empty`);
        const start = original.indexOf(oldText);
        if (start < 0) throw new Error(`edits[${index}].oldText was not found`);
        if (original.indexOf(oldText, start + 1) >= 0) throw new Error(`edits[${index}].oldText is not unique`);
        return { start, end: start + oldText.length, newText };
      }).sort((left, right) => left.start - right.start);
      for (let index = 1; index < ranges.length; index++) {
        if (ranges[index].start < ranges[index - 1].end) {
          throw new Error("Edits overlap; merge them into one replacement");
        }
      }
      let updated = original;
      for (const range of [...ranges].sort((left, right) => right.start - left.start)) {
        updated = updated.slice(0, range.start) + range.newText + updated.slice(range.end);
      }
      await vfs.writeFile(absolutePath, updated, "utf8");
      return textResult(`Applied ${ranges.length} replacement(s) to ${absolutePath}`);
    },
  });

  const ls = defineTool({
    name: "ls",
    label: "ls",
    description: "List a directory in the isolated in-memory filesystem.",
    promptSnippet: "List in-memory directories",
    parameters: Type.Object({
      path: Type.Optional(Type.String({ description: "Virtual directory; default is /workspace" })),
      limit: Type.Optional(Type.Number({ description: "Maximum entries; default 1000" })),
    }),
    executionMode: "parallel",
    async execute(_id, { path = ".", limit = 1_000 }, signal) {
      signal?.throwIfAborted();
      const absolutePath = resolve(path);
      const entries = await vfs.readdir(absolutePath);
      const output = [];
      for (const name of entries.sort((left, right) => left.localeCompare(right))) {
        if (output.length >= limit) break;
        const stat = await vfs.lstat(posix.join(absolutePath, name));
        output.push(`${name}${stat.isDirectory ? "/" : stat.isSymbolicLink ? "@" : ""}`);
      }
      return textResult(output.join("\n") || "(empty directory)");
    },
  });

  return [read, write, edit, ls];
}
