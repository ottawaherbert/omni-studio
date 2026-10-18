import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  isOpenAICompatibleTextChannelType,
  isKieOpenAICompatibleTextModelId,
  resolveKieOpenAICompatibleTextBaseUrl,
} from "../src/config/aiConfigDefaults";
import { parseOpenAICompatibleEventStream } from "../src/server/routes/openAICompatibleEventStream";

assert.equal(isKieOpenAICompatibleTextModelId("gemini-3-7-flash-openai"), true);
assert.equal(isKieOpenAICompatibleTextModelId("gemini-3-7-flash"), false);
assert.equal(
  resolveKieOpenAICompatibleTextBaseUrl("https://api.kie.ai/api/v1", "gemini-3-7-flash-openai"),
  "https://api.kie.ai/gemini-3-7-flash-openai/v1",
);
assert.throws(
  () => resolveKieOpenAICompatibleTextBaseUrl("https://example.com/api/v1", "gemini-3-7-flash-openai"),
  /official|官方/,
);
assert.throws(
  () => resolveKieOpenAICompatibleTextBaseUrl("https://api.kie.ai/api/v1", "gemini-3-7-flash"),
  /-openai/,
);

const aiSource = readFileSync("src/services/ai.ts", "utf8");
const proxyRoutesSource = readFileSync("src/server/routes/providerProxyRoutes.ts", "utf8");
const openAICompatibleProxyRouteSource = readFileSync("src/server/routes/openAICompatibleProxyRoute.ts", "utf8");
const proxyUtilsSource = readFileSync("src/server/routes/providerProxyUtils.ts", "utf8");
const providerTargetPolicySource = readFileSync("src/server/routes/providerTargetPolicy.ts", "utf8");

assert.equal(isOpenAICompatibleTextChannelType("kie"), true, "Kie text models must enter the OpenAI-compatible text branch");
assert.ok(aiSource.includes("isOpenAICompatibleTextChannelType(channel.type)"));
assert.ok(aiSource.includes("resolveKieOpenAICompatibleTextBaseUrl(channel.baseUrl, model.modelId)"));
assert.ok(aiSource.includes("completionParams.stream = true"), "Kie text calls must use the provider's documented SSE response path");
assert.ok(aiSource.includes("delete completionParams.model"), "Kie model identity is carried by the endpoint path");
assert.equal(aiSource.includes("max_tokens"), false, "Text providers must decide their own output length");
assert.equal(aiSource.includes("timeoutMs"), false, "Text requests must not be cut off by a client deadline");
assert.ok(aiSource.includes("options.requireJson && channel.type !== 'kie'"), "Kie must rely on the prompt JSON contract instead of unsupported response_format");
assert.ok(aiSource.includes("value?.candidates?.[0]?.content?.parts"), "Kie Gemini native-shaped responses need a text fallback");
assert.ok(
  aiSource.includes("Structured JSON response_format returned no text; retrying without it."),
  "Kie HTTP-200 embedded errors must fall back from response_format",
);
assert.ok(
  aiSource.includes("OpenAI-compatible provider returned no usable text"),
  "Textless provider responses must surface as failures instead of empty drafts",
);
assert.ok(openAICompatibleProxyRouteSource.includes('["openai", "deepseek", "doubao", "kie", "llamacpp"]'));
assert.ok(openAICompatibleProxyRouteSource.includes("parseOpenAICompatibleProviderText(text, response.headers.get"));
assert.ok(openAICompatibleProxyRouteSource.includes("providerFailurePayload"), "Provider status and redacted response details must reach the UI");
assert.ok(proxyUtilsSource.includes('"openai" | "deepseek" | "doubao" | "kie"'));
assert.ok(providerTargetPolicySource.includes('kie: ["https://api.kie.ai"]'), "Kie text proxy must allow its official host");
assert.ok(providerTargetPolicySource.includes('provider === "kie" || provider === "gemini"'), "Kie must reject custom credential targets");

const streamed = parseOpenAICompatibleEventStream([
  'data: {"choices":[{"delta":{"content":"STREAM_37","role":"assistant"},"index":0}]}',
  "",
  'data: {"choices":[{"delta":{"content":"_OK"},"finish_reason":"stop","index":0}]}',
  "",
  'data: {"choices":[],"usage":{"completion_tokens":6},"credits_consumed":0.01}',
  "",
  "data: [DONE]",
  "",
].join("\n"));
assert.equal(streamed.choices[0].message.content, "STREAM_37_OK");
assert.equal(streamed.choices[0].finish_reason, "stop");
assert.deepEqual(streamed.usage, { completion_tokens: 6 });

const nativeStreamed = parseOpenAICompatibleEventStream([
  'data: {"candidates":[{"content":{"role":"model","parts":[{"text":"NATIVE_37_OK"}]},"finishReason":"STOP"}]}',
  "",
  "data: [DONE]",
  "",
].join("\n"));
assert.equal(nativeStreamed.choices[0].message.content, "NATIVE_37_OK");
assert.equal(nativeStreamed.choices[0].finish_reason, "STOP");

console.log("kie-gemini-text-self-check: ok");
