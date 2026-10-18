import type { ChannelType } from "../../../../src/config/aiConfigDefaults";

export type ServerTextTransport = "openai_compatible" | "gemini" | "minimax";

export interface ServerTextProviderCapability {
  transport: ServerTextTransport;
  envKeyNames: readonly string[];
  apiKeyOptional: boolean;
}

const SERVER_TEXT_PROVIDER_CAPABILITIES: Readonly<Partial<Record<ChannelType, ServerTextProviderCapability>>> = {
  openai: { transport: "openai_compatible", envKeyNames: ["OPENAI_API_KEY"], apiKeyOptional: false },
  deepseek: { transport: "openai_compatible", envKeyNames: ["DEEPSEEK_API_KEY"], apiKeyOptional: false },
  doubao: { transport: "openai_compatible", envKeyNames: ["DOUBAO_API_KEY", "ARK_API_KEY", "VOLCENGINE_API_KEY"], apiKeyOptional: false },
  kie: { transport: "openai_compatible", envKeyNames: ["KIE_API_KEY"], apiKeyOptional: false },
  llamacpp: { transport: "openai_compatible", envKeyNames: [], apiKeyOptional: true },
  gemini: { transport: "gemini", envKeyNames: ["GEMINI_API_KEY"], apiKeyOptional: false },
  minimax: { transport: "minimax", envKeyNames: ["MINIMAX_API_KEY"], apiKeyOptional: false },
};

export const getServerTextProviderCapability = (type: ChannelType) =>
  SERVER_TEXT_PROVIDER_CAPABILITIES[type];

export const isServerTextProviderSupported = (type: ChannelType) =>
  Boolean(getServerTextProviderCapability(type));

export const isServerOpenAICompatibleProvider = (type: ChannelType) =>
  getServerTextProviderCapability(type)?.transport === "openai_compatible";

export const hasServerProviderEnvKey = (
  type: ChannelType,
  env: NodeJS.ProcessEnv = process.env,
) => getServerTextProviderCapability(type)?.envKeyNames.some((name) => Boolean((env[name] || "").trim())) || false;
