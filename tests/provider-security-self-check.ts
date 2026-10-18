import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "provider-security-"));
process.env.OMNI_DB_PATH = path.join(tempDirectory, "workspace.db");

const { db, dbHelpers } = await import("../src/server/db");
const { AI_CONFIG_SCHEMA_VERSION, defaultRouting } = await import("../src/config/aiConfigDefaults");
const { normalizeOpenAICompatibleBaseUrl } = await import("../src/server/routes/providerProxyUtils");
const {
  normalizeCredentialedProviderTarget,
  normalizeLocalOpenAICompatibleTarget,
} = await import("../src/server/routes/providerTargetPolicy");
const { resolveServerBindHost } = await import("../src/server/serverBindPolicy");
const { registerProviderProxyRoutes } = await import("../src/server/routes/providerProxyRoutes");

try {
  assert.equal(
    normalizeOpenAICompatibleBaseUrl("openai", "https://api.openai.com/v1/?debug=true#token"),
    "https://api.openai.com/v1",
  );
  assert.equal(
    normalizeCredentialedProviderTarget("minimax", "https://api.minimaxi.com/anthropic/v1/messages").origin,
    "https://api.minimaxi.com",
  );
  assert.throws(
    () => normalizeCredentialedProviderTarget("doubao", "https://credential-capture.example/collect"),
    /not allowed/,
  );
  assert.throws(
    () => normalizeCredentialedProviderTarget("gemini", "https://storage.example/video.mp4"),
    /not allowed/,
  );
  assert.throws(
    () => normalizeCredentialedProviderTarget("openai", "https://user:secret@api.openai.com/v1"),
    /credentials/,
  );

  dbHelpers.saveAIConfig({
    schemaVersion: AI_CONFIG_SCHEMA_VERSION,
    channels: [{
      id: "lan-llamacpp",
      name: "LAN llama.cpp",
      type: "llamacpp",
      baseUrl: "http://192.168.5.9:8080/v1",
      apiKey: "",
    }],
    models: [],
    routing: defaultRouting,
    visualQcEnabled: true,
    comfyWorkflows: [],
  });
  assert.equal(
    normalizeLocalOpenAICompatibleTarget("http://192.168.5.9:8080/v1/?debug=true#token", "lan-llamacpp").toString(),
    "http://192.168.5.9:8080/v1/",
  );
  assert.throws(
    () => normalizeLocalOpenAICompatibleTarget("http://169.254.169.254/latest/meta-data", "lan-llamacpp"),
    /private-network|exactly match/,
  );
  assert.throws(
    () => normalizeLocalOpenAICompatibleTarget("http://192.168.5.8:8080/v1", "lan-llamacpp"),
    /exactly match/,
  );
  assert.throws(
    () => normalizeLocalOpenAICompatibleTarget("http://provider.local:8080/v1", "lan-llamacpp"),
    /private-network/,
  );

  process.env.OMNI_OPENAI_ALLOWED_ORIGINS = "http://127.0.0.1:8088";
  assert.equal(
    normalizeCredentialedProviderTarget("openai", "http://127.0.0.1:8088/v1").origin,
    "http://127.0.0.1:8088",
  );
  process.env.OMNI_KIE_ALLOWED_ORIGINS = "https://credential-capture.example";
  assert.throws(
    () => normalizeCredentialedProviderTarget("kie", "https://credential-capture.example/v1"),
    /not allowed/,
  );

  assert.equal(resolveServerBindHost({}), "127.0.0.1");
  assert.throws(() => resolveServerBindHost({ OMNI_HOST: "0.0.0.0" }), /Refusing to expose/);
  assert.equal(
    resolveServerBindHost({ OMNI_HOST: "0.0.0.0", OMNI_ALLOW_REMOTE_ACCESS: "true" }),
    "0.0.0.0",
  );

  const handlers = new Map<string, (req: any, res: any) => Promise<unknown>>();
  const app = new Proxy({}, {
    get: (_target, method) => (route: string, ...routeHandlers: Array<(req: any, res: any) => Promise<unknown>>) => {
      handlers.set(`${String(method).toUpperCase()} ${route}`, routeHandlers.at(-1)!);
    },
  });
  registerProviderProxyRoutes(app as any);
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    throw new Error("provider fetch must not run for rejected targets");
  };
  const invoke = async (path: string, body: Record<string, unknown>) => {
    let statusCode = 200;
    let payload: any;
    const res = {
      status: (value: number) => { statusCode = value; return res; },
      json: (value: unknown) => { payload = value; return res; },
      send: (value: unknown) => { payload = value; return res; },
      setHeader: () => undefined,
    };
    await handlers.get(`POST ${path}`)?.({ body, query: {}, params: {} }, res);
    return { statusCode, payload };
  };
  try {
    assert.equal((await invoke("/api/proxy/doubao", {
      url: "https://credential-capture.example/doubao",
      headers: { authorization: "Bearer server-secret" },
    })).statusCode, 400);
    assert.equal((await invoke("/api/proxy/minimax", {
      url: "http://169.254.169.254/latest/meta-data",
      headers: { "x-api-key": "server-secret" },
    })).statusCode, 400);
    assert.equal((await invoke("/api/proxy/gemini", {
      apiKey: "server-secret",
      action: "downloadVideo",
      payload: { uri: "https://credential-capture.example/video.mp4" },
    })).statusCode, 400);
    assert.equal((await invoke("/api/proxy/openai-compatible", {
      provider: "openai",
      apiKey: "server-secret",
      baseUrl: "https://credential-capture.example/v1",
    })).statusCode, 400);
    assert.equal(fetchCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }

  let forwardedHeaders: Record<string, string> | undefined;
  let forwardedUrl = "";
  globalThis.fetch = async (input, init) => {
    forwardedUrl = String(input);
    forwardedHeaders = init?.headers as Record<string, string>;
    return new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  try {
    const result = await invoke("/api/proxy/openai-compatible", {
      provider: "llamacpp",
      channelId: "lan-llamacpp",
      baseUrl: "http://192.168.5.9:8080/v1",
      body: { model: "Qwen3.8-27B-Q6_K.gguf", messages: [{ role: "user", content: "ping" }] },
    });
    assert.equal(result.statusCode, 200);
    assert.equal(forwardedUrl, "http://192.168.5.9:8080/v1/chat/completions");
    assert.equal(forwardedHeaders?.Authorization, undefined, "llama.cpp requests must not synthesize an API key header");

    const futureKeyConfig = dbHelpers.getAIConfig().config;
    dbHelpers.saveAIConfig({
      ...futureKeyConfig,
      channels: futureKeyConfig.channels.map((channel) => channel.id === "lan-llamacpp"
        ? { ...channel, apiKey: "future-local-key" }
        : channel),
    });
    await invoke("/api/proxy/openai-compatible", {
      provider: "llamacpp",
      channelId: "lan-llamacpp",
      baseUrl: "http://192.168.5.9:8080/v1",
      body: { model: "Qwen3.8-27B-Q6_K.gguf", messages: [{ role: "user", content: "ping" }] },
    });
    assert.equal(
      forwardedHeaders?.Authorization,
      "Bearer future-local-key",
      "llama.cpp must start sending the ordinary Bearer header as soon as a key is configured",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
} finally {
  db.close();
  fs.rmSync(tempDirectory, { recursive: true, force: true });
}

console.log("provider credential target and server bind security checks passed");
