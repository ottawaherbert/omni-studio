import { parseProviderText } from "./providerProxyUtils";

const contentText = (value: unknown) => {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return "";
  return value.map((part) => {
    if (!part || typeof part !== "object") return "";
    const source = part as Record<string, unknown>;
    if (typeof source.text === "string") return source.text;
    if (source.text && typeof source.text === "object") {
      const nested = source.text as Record<string, unknown>;
      return typeof nested.value === "string" ? nested.value : "";
    }
    return "";
  }).join("");
};

const eventPayloads = (source: string) => {
  const payloads: string[] = [];
  let dataLines: string[] = [];
  const flush = () => {
    if (dataLines.length) payloads.push(dataLines.join("\n"));
    dataLines = [];
  };
  for (const line of source.split(/\r?\n/)) {
    if (!line.trim()) {
      flush();
      continue;
    }
    if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
  }
  flush();
  return payloads;
};

export const parseOpenAICompatibleEventStream = (source: string) => {
  let content = "";
  let role = "assistant";
  let finishReason = "";
  let usage: unknown;
  let creditsConsumed: unknown;
  let parsedEventCount = 0;
  let terminal = false;
  let refusal = '';

  for (const payload of eventPayloads(source)) {
    if (payload === "[DONE]") { terminal = true; continue; }
    if (!payload) continue;
    let event: Record<string, unknown>;
    try {
      event = JSON.parse(payload) as Record<string, unknown>;
    } catch {
      throw new Error("OpenAI-compatible provider stream contains an invalid event.");
    }
    parsedEventCount += 1;
    if (event.error) throw new Error("OpenAI-compatible provider stream returned an error event.");

    const choices = Array.isArray(event.choices) ? event.choices : [];
    const firstChoice = choices[0] && typeof choices[0] === "object"
      ? choices[0] as Record<string, unknown>
      : undefined;
    const delta = firstChoice?.delta && typeof firstChoice.delta === "object"
      ? firstChoice.delta as Record<string, unknown>
      : firstChoice?.message && typeof firstChoice.message === "object"
        ? firstChoice.message as Record<string, unknown>
        : undefined;
    if (typeof delta?.role === "string") role = delta.role;
    content += contentText(delta?.content);
    if (typeof delta?.refusal === 'string') refusal += delta.refusal;
    if (typeof firstChoice?.finish_reason === "string" && firstChoice.finish_reason) { finishReason = firstChoice.finish_reason; terminal = true; }

    const candidates = Array.isArray(event.candidates) ? event.candidates : [];
    const firstCandidate = candidates[0] && typeof candidates[0] === "object"
      ? candidates[0] as Record<string, unknown>
      : undefined;
    const candidateContent = firstCandidate?.content && typeof firstCandidate.content === "object"
      ? firstCandidate.content as Record<string, unknown>
      : undefined;
    const parts = Array.isArray(candidateContent?.parts) ? candidateContent.parts : [];
    content += parts.map((part) => {
      if (!part || typeof part !== "object") return "";
      const text = (part as Record<string, unknown>).text;
      return typeof text === "string" ? text : "";
    }).join("");
    if (typeof candidateContent?.role === "string") role = candidateContent.role;
    if (typeof firstCandidate?.finishReason === "string" && firstCandidate.finishReason) { finishReason = firstCandidate.finishReason; terminal = true; }

    if (event.usage) usage = event.usage;
    if (event.usageMetadata) usage = event.usageMetadata;
    if (event.credits_consumed !== undefined) creditsConsumed = event.credits_consumed;
  }

  if (!terminal) throw new Error("OpenAI-compatible provider stream ended before completion.");
  if (!parsedEventCount) {
    throw new Error("OpenAI-compatible provider stream returned no parsable events.");
  }

  return {
    choices: [{
      index: 0,
      message: { role, content, ...(refusal ? { refusal } : {}) },
      finish_reason: finishReason || (content ? "stop" : null),
    }],
    ...(usage ? { usage } : {}),
    ...(creditsConsumed !== undefined ? { credits_consumed: creditsConsumed } : {}),
  };
};

export const parseOpenAICompatibleProviderText = (source: string, contentType?: string | null) =>
  contentType?.includes("text/event-stream") || source.trimStart().startsWith("data:")
    ? parseOpenAICompatibleEventStream(source)
    : parseProviderText(source);
