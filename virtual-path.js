import { posix } from "node:path";

export const DEFAULT_CWD = "/workspace";

export function normalizeVirtualPath(path, cwd = DEFAULT_CWD) {
  if (typeof path !== "string" || path.length === 0) {
    throw new Error("Path must be a non-empty string");
  }
  const resolved = path.startsWith("/") ? posix.normalize(path) : posix.resolve(cwd, path);
  return resolved.startsWith("/") ? resolved : `/${resolved}`;
}

export function isWithin(path, root) {
  const normalizedPath = normalizeVirtualPath(path, "/");
  const normalizedRoot = normalizeVirtualPath(root, "/");
  return normalizedPath === normalizedRoot || normalizedPath.startsWith(`${normalizedRoot}/`);
}
