import { db } from "../db";
import { resolveAIConfig, buildProvider, type AIProviderConfig } from "./index";
import type { AIProvider } from "./types";

export type PublicAiConfig = {
  provider: "mock" | "openai" | "anthropic";
  baseUrl: string;
  model: string;
  hasApiKey: boolean;
  source: "user" | "env" | "default";
};

export async function loadUserAiConfig(userId: string): Promise<{
  config: AIProviderConfig;
  source: "user" | "env";
}> {
  const row = await db.aiProviderConfig.findUnique({ where: { userId } });
  if (row && (row.apiKey || row.provider === "mock")) {
    return {
      config: {
        provider: row.provider as AIProviderConfig["provider"],
        baseUrl: row.baseUrl,
        model: row.model,
        apiKey: row.apiKey,
      },
      source: "user",
    };
  }
  return { config: resolveAIConfig(userId), source: "env" };
}

export async function getProviderForUser(userId: string): Promise<{
  provider: AIProvider;
  config: PublicAiConfig;
}> {
  const { config, source } = await loadUserAiConfig(userId);
  return {
    provider: buildProvider(config),
    config: {
      provider: config.provider,
      baseUrl: config.baseUrl,
      model: config.model,
      hasApiKey: Boolean(config.apiKey),
      source,
    },
  };
}

export async function getPublicAiConfig(userId: string): Promise<PublicAiConfig> {
  const env = resolveAIConfig(userId);
  const row = await db.aiProviderConfig.findUnique({ where: { userId } });
  if (row) {
    return {
      provider: row.provider as PublicAiConfig["provider"],
      baseUrl: row.baseUrl,
      model: row.model,
      hasApiKey: Boolean(row.apiKey),
      source: "user",
    };
  }
  return {
    provider: env.provider,
    baseUrl: env.baseUrl,
    model: env.model,
    hasApiKey: Boolean(env.apiKey),
    source: "env",
  };
}

export async function saveUserAiConfig(
  userId: string,
  input: {
    provider: "mock" | "openai" | "anthropic";
    baseUrl?: string;
    model?: string;
    apiKey?: string;
  },
): Promise<PublicAiConfig> {
  const existing = await db.aiProviderConfig.findUnique({ where: { userId } });
  // Empty apiKey string means "keep existing key" when already set
  let apiKey = input.apiKey ?? "";
  if ((!input.apiKey || input.apiKey.length === 0) && existing?.apiKey) {
    apiKey = existing.apiKey;
  }

  const baseUrl =
    input.baseUrl ??
    (input.provider === "anthropic"
      ? "https://api.anthropic.com"
      : input.provider === "openai"
        ? "https://api.openai.com/v1"
        : "");

  const model =
    input.model ??
    (input.provider === "anthropic"
      ? "claude-sonnet-4-5"
      : input.provider === "openai"
        ? "gpt-4o-mini"
        : "mock");

  const data = {
    provider: input.provider,
    baseUrl,
    model,
    apiKey,
  };

  if (existing) {
    await db.aiProviderConfig.update({ where: { userId }, data });
  } else {
    await db.aiProviderConfig.create({ data: { userId, ...data } });
  }

  return {
    provider: data.provider,
    baseUrl: data.baseUrl,
    model: data.model,
    hasApiKey: Boolean(data.apiKey),
    source: "user",
  };
}

export async function clearUserAiConfig(userId: string): Promise<PublicAiConfig> {
  await db.aiProviderConfig.deleteMany({ where: { userId } });
  return getPublicAiConfig(userId);
}
