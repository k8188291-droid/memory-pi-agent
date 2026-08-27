import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { PROVIDER } from "./agent-config.js";
import { normalizeOAuthCredential } from "./oauth-credential.js";

export async function createModelRuntime({
  oauthMethod,
  oauthCredential,
  credentials,
  createAuthInteraction,
}) {
  let supplied = oauthCredential;
  if (process.env.PI_OPENAI_OAUTH_JSON) {
    supplied = normalizeOAuthCredential(
      JSON.parse(process.env.PI_OPENAI_OAUTH_JSON),
      "PI_OPENAI_OAUTH_JSON",
    );
  }
  if (supplied) {
    const normalized = normalizeOAuthCredential(supplied);
    await credentials.modify(PROVIDER, async () => normalized);
  }

  const runtime = await ModelRuntime.create({
    credentials,
    modelsPath: null,
    allowModelNetwork: false,
    // Avoid ambient provider scans and model-cache file I/O. The selected
    // provider is synchronized by login or the preloaded in-memory credential.
    refreshOnCreate: false,
  });
  if (!(await credentials.read(PROVIDER))) {
    if (!createAuthInteraction) throw new Error("OAuth login requires an auth interaction");
    const auth = await createAuthInteraction({ method: oauthMethod });
    try { await runtime.login(PROVIDER, "oauth", auth.interaction); }
    finally { auth.close(); }
  }
  return runtime;
}
