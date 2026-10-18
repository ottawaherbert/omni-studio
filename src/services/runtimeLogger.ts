export type RuntimeLogLevel = "debug" | "info" | "warn" | "error";

export interface RuntimeLogEvent {
  source: "frontend" | "production" | "agent" | "qa" | "api";
  event: string;
  level?: RuntimeLogLevel;
  runId?: string;
  projectId?: string;
  stageId?: string;
  stageType?: string;
  agentRunId?: string;
  agentId?: string;
  qaAgentId?: string;
  status?: string;
  message?: string;
  details?: Record<string, unknown>;
}

const truncateString = (value: string, maxLength = 500) =>
  value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;

const sanitizeValue = (value: unknown): unknown => {
  if (typeof value === "string") return truncateString(value);
  if (Array.isArray(value)) return value.slice(0, 20).map(sanitizeValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !/apiKey|authorization|promptUsed|rawOutput|content/i.test(key))
      .slice(0, 30)
      .map(([key, item]) => [key, sanitizeValue(item)]),
  );
};

export function logRuntimeEvent(event: RuntimeLogEvent) {
  if (typeof window === "undefined") return;
  const payload = {
    ...event,
    level: event.level || "info",
    timestamp: Date.now(),
    details: sanitizeValue(event.details || {}),
  };
  fetch("/api/runtime-logs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    keepalive: true,
  }).catch(() => {
    // Runtime logging must never break production actions.
  });
}
