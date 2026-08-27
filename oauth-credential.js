export function normalizeOAuthCredential(value, source = "OAuth credential") {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${source} must be an OAuth credential JSON object`);
  }
  if (value.type !== undefined && value.type !== "oauth") {
    throw new Error(`${source}.type must be oauth`);
  }
  for (const field of ["access", "refresh", "expires"]) {
    if (value[field] === undefined) throw new Error(`${source} is missing ${field}`);
  }
  return { ...value, type: "oauth" };
}

export function serializeOAuthCredential(credential) {
  if (!credential) return undefined;
  const { type: _type, ...oauth } = normalizeOAuthCredential(credential);
  return oauth;
}
