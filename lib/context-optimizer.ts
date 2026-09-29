// lib/context-optimizer.ts
// Request-side context budgeting for chat and group chat.
// Stored messages and memories are never mutated or deleted here.

import type { MemoryConfig } from "./memory-types";
import type { PresetConfig } from "./settings-types";

export type PromptContextMode = "chat" | "group_chat";

export type PromptContextPolicy = {
    enabled: boolean;
    maxInputTokens: number;
    recentTokens: number;
    minimumRecentMessages: number;
};

const MIN_INPUT_TOKENS = 8000;
const MIN_RECENT_TOKENS = 2000;
const DEFAULT_OUTPUT_RESERVE = 4096;

function finitePositive(value: unknown, fallback: number): number {
    return typeof value === "number" && Number.isFinite(value) && value > 0
        ? Math.round(value)
        : fallback;
}

/**
 * Resolve the effective input budget. The preset context window is now honoured:
 * enough room is reserved for the configured output before the request is sent.
 */
export function resolvePromptContextPolicy(
    config: MemoryConfig,
    preset: PresetConfig | null,
    mode: PromptContextMode,
    options?: { nativeToolsEnabled?: boolean },
): PromptContextPolicy {
    const configuredTotal = mode === "group_chat"
        ? finitePositive(config.groupContextTokenBudget, 48000)
        : finitePositive(config.chatContextTokenBudget, 32000);
    const configuredRecent = mode === "group_chat"
        ? finitePositive(config.groupRecentTokenBudget, 18000)
        : finitePositive(config.chatRecentTokenBudget, 12000);
    const contextWindow = finitePositive(preset?.openai_max_context, configuredTotal + DEFAULT_OUTPUT_RESERVE);
    const outputReserve = finitePositive(preset?.openai_max_tokens, DEFAULT_OUTPUT_RESERVE);
    // Native tool schemas are sent outside messages but still consume provider input tokens.
    const nativeToolReserve = options?.nativeToolsEnabled ? 3000 : 0;
    const maxAllowedByModel = Math.max(
        MIN_INPUT_TOKENS,
        contextWindow - outputReserve - nativeToolReserve,
    );
    const maxInputTokens = Math.max(MIN_INPUT_TOKENS, Math.min(configuredTotal, maxAllowedByModel));

    return {
        enabled: config.contextOptimizationEnabled !== false,
        maxInputTokens,
        recentTokens: Math.max(MIN_RECENT_TOKENS, Math.min(configuredRecent, Math.floor(maxInputTokens * 0.6))),
        minimumRecentMessages: Math.max(2, Math.min(40, finitePositive(config.minimumRecentMessages, 10))),
    };
}

/**
 * Memory retrieval used to have three independent 100k budgets. Clamp only the
 * prompt-time copy while preserving the user's stored values and memory database.
 */
export function createPromptMemoryConfig(
    config: MemoryConfig,
    policy: PromptContextPolicy,
    participantCount = 1,
): MemoryConfig {
    if (!policy.enabled) return config;

    const participants = Math.max(1, participantCount);
    const coreShare = Math.max(600, Math.floor(policy.maxInputTokens * 0.10 / participants));
    const longTermShare = Math.max(1000, Math.floor(policy.maxInputTokens * 0.15 / participants));

    return {
        ...config,
        shortTermTokenBudget: Math.min(config.shortTermTokenBudget, policy.recentTokens),
        coreMemoryTokenBudget: Math.min(config.coreMemoryTokenBudget, coreShare),
        longTermTokenBudget: Math.min(config.longTermTokenBudget, longTermShare),
    };
}

