import { isIP } from "node:net";

import { dbHelpers } from "../db";

export type CredentialedProvider = "openai" | "deepseek" | "doubao" | "kie" | "minimax" | "gemini";

const OFFICIAL_PROVIDER_ORIGINS: Record<CredentialedProvider, readonly string[]> = {
  openai: ["https://api.openai.com"],
  deepseek: ["https://api.deepseek.com"],
  doubao: ["https://ark.cn-beijing.volces.com"],
  kie: ["https://api.kie.ai"],
  minimax: ["https://api.minimaxi.com", "https://api.minimax.io"],
  gemini: ["https://generativelanguage.googleapis.com"],
};

const splitEnvList = (value?: string) =>
  (value || "").split(",").map((item) => item.trim()).filter(Boolean);

const normalizedOrigin = (value: string) => {
  try {
    return new URL(value).origin;
  } catch {
    return "";
  }
};

const configuredChannelOrigin = (provider: CredentialedProvider, channelId?: string) => {
  if (!channelId || provider === "kie" || provider === "gemini") return "";
  try {
    const channel = dbHelpers.getAIConfig().config.channels.find((item) => item.id === channelId);
    return channel?.type === provider ? normalizedOrigin(channel.baseUrl || "") : "";
  } catch {
    return "";
  }
};

const providerAllowedOrigins = (provider: CredentialedProvider, channelId?: string) => {
  const providerEnvName = `OMNI_${provider.toUpperCase()}_ALLOWED_ORIGINS`;
  const configurableOrigins = provider === "kie" || provider === "gemini"
    ? []
    : [
        ...splitEnvList(process.env.OMNI_PROVIDER_ALLOWED_ORIGINS).map(normalizedOrigin),
        ...splitEnvList(process.env[providerEnvName]).map(normalizedOrigin),
        configuredChannelOrigin(provider, channelId),
      ];
  return new Set([
    ...OFFICIAL_PROVIDER_ORIGINS[provider],
    ...configurableOrigins,
  ].filter(Boolean));
};

export class ProviderTargetPolicyError extends Error {
  readonly statusCode = 400;

  constructor(message: string) {
    super(message);
    this.name = "ProviderTargetPolicyError";
  }
}

const normalizedHost = (hostname: string) => hostname.toLowerCase().replace(/^\[|\]$/g, "");

const isPrivateLocalProviderHost = (hostname: string) => {
  const host = normalizedHost(hostname);
  if (host === "localhost") return true;
  if (isIP(host) === 4) {
    const octets = host.split(".").map(Number);
    return octets[0] === 10
      || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31)
      || (octets[0] === 192 && octets[1] === 168)
      || octets[0] === 127;
  }
  if (isIP(host) === 6) {
    return host === "::1" || host.startsWith("fc") || host.startsWith("fd");
  }
  return false;
};

const normalizedProviderPath = (pathname: string) => pathname.replace(/\/+$/, "") || "/";

export const normalizeLocalOpenAICompatibleTarget = (rawUrl: string, channelId?: string) => {
  if (!channelId) {
    throw new ProviderTargetPolicyError("A saved llama.cpp channel is required for local provider requests.");
  }
  const channel = dbHelpers.getAIConfig().config.channels.find((item) => item.id === channelId);
  if (!channel || channel.type !== "llamacpp") {
    throw new ProviderTargetPolicyError("The selected llama.cpp channel was not found.");
  }

  let url: URL;
  let configuredUrl: URL;
  try {
    url = new URL(rawUrl);
    configuredUrl = new URL(channel.baseUrl);
  } catch {
    throw new ProviderTargetPolicyError("Invalid llama.cpp provider URL.");
  }
  if (url.username || url.password || configuredUrl.username || configuredUrl.password) {
    throw new ProviderTargetPolicyError("Provider URLs cannot contain credentials.");
  }
  if (!["http:", "https:"].includes(url.protocol) || !["http:", "https:"].includes(configuredUrl.protocol)) {
    throw new ProviderTargetPolicyError("llama.cpp provider URLs must use HTTP or HTTPS.");
  }
  if (!isPrivateLocalProviderHost(url.hostname) || !isPrivateLocalProviderHost(configuredUrl.hostname)) {
    throw new ProviderTargetPolicyError("llama.cpp provider URLs must use localhost or a literal private-network IP address.");
  }
  if (url.origin !== configuredUrl.origin || normalizedProviderPath(url.pathname) !== normalizedProviderPath(configuredUrl.pathname)) {
    throw new ProviderTargetPolicyError("The llama.cpp request target must exactly match the selected saved channel.");
  }
  url.search = "";
  url.hash = "";
  return url;
};

export const normalizeCredentialedProviderTarget = (
  provider: CredentialedProvider,
  rawUrl: string,
  channelId?: string,
) => {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new ProviderTargetPolicyError(`Invalid ${provider} provider URL.`);
  }
  if (url.username || url.password) {
    throw new ProviderTargetPolicyError("Provider URLs cannot contain credentials.");
  }
  const isLoopback = ["localhost", "127.0.0.1", "::1"].includes(url.hostname.toLowerCase());
  if (url.protocol !== "https:" && !(isLoopback && url.protocol === "http:")) {
    throw new ProviderTargetPolicyError("Credentialed provider requests require HTTPS, except configured loopback development endpoints.");
  }
  if (!providerAllowedOrigins(provider, channelId).has(url.origin)) {
    throw new ProviderTargetPolicyError(
      `${provider} provider origin is not allowed. Use its official endpoint, the selected channel endpoint, or an explicit server allowlist.`,
    );
  }
  url.hash = "";
  return url;
};
