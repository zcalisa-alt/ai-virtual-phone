// lib/session-context-summary.ts
// Small per-session rolling summaries for prompt compression.
// The source chat messages remain intact and continue to be exportable/viewable.

import { simpleLLMCall } from "./api-helpers";
import {
    loadChatMessages,
    loadChatSessions,
    saveChatSessions,
    type ChatMessage,
} from "./chat-storage";
import { loadMemoryConfig } from "./memory-storage";
import { resolveAuxiliaryApiConfig } from "./settings-storage";
import { estimateTokens } from "./token-counter";

const runningSessions = new Set<string>();
const SUMMARY_SOURCE_TOKEN_LIMIT = 12000;

function isSummaryMessage(message: ChatMessage): boolean {
    if (message.role !== "user" && message.role !== "assistant") return false;
    if (!message.content.trim() && !message.mediaData?.label?.trim()) return false;
    return message.mediaType !== "tool_notice"
        && message.mediaType !== "tool_result"
        && message.mediaType !== "memory_write_request";
}

function formatSummaryLine(message: ChatMessage): string {
    const speaker = message.senderName?.trim()
        || (message.role === "user" ? "用户" : "角色");
    const body = message.content.trim();
    const media = message.mediaData?.label?.trim();
    return `${speaker}：${body || (media ? `[${media}]` : "[富媒体消息]")}`;
}

function takeWithinBudget(messages: ChatMessage[]): ChatMessage[] {
    const selected: ChatMessage[] = [];
    let used = 0;
    for (const message of messages) {
        const tokens = estimateTokens(formatSummaryLine(message)) + 4;
        if (selected.length > 0 && used + tokens > SUMMARY_SOURCE_TOKEN_LIMIT) break;
        selected.push(message);
        used += tokens;
    }
    return selected;
}

/**
 * Update one session summary after enough messages have moved outside the recent window.
 * The first run intentionally starts near the recent window instead of re-sending an
 * entire legacy transcript; older facts continue to come from the existing memory bank.
 */
export async function maybeUpdateSessionContextSummary(
    sessionId: string,
    conversationLabel: string,
): Promise<void> {
    const config = loadMemoryConfig();
    if (!config.contextOptimizationEnabled || !config.rollingSummaryEnabled) return;
    if (runningSessions.has(sessionId)) return;

    const sessions = loadChatSessions();
    const session = sessions.find(item => item.id === sessionId);
    if (!session) return;

    const messages = loadChatMessages(sessionId).filter(isSummaryMessage);
    const recentCount = Math.max(2, config.minimumRecentMessages);
    const interval = Math.max(4, config.rollingSummaryMessageInterval);
    const summarizeUntil = Math.max(0, messages.length - recentCount);
    if (summarizeUntil <= 0) return;

    const anchorIndex = session.contextSummaryUntilMessageId
        ? messages.findIndex(message => message.id === session.contextSummaryUntilMessageId)
        : -1;
    // Existing installs can have years of history. Bootstrap from the nearest completed
    // chunk instead of issuing one enormous and expensive first summary request.
    const startIndex = anchorIndex >= 0
        ? anchorIndex + 1
        : Math.max(0, summarizeUntil - interval);
    if (summarizeUntil - startIndex < interval) return;

    const pending = takeWithinBudget(messages.slice(startIndex, summarizeUntil));
    if (pending.length < interval) return;

    const apiConfig = resolveAuxiliaryApiConfig("memorySummaryApiConfigId");
    if (!apiConfig) return;

    runningSessions.add(sessionId);
    try {
        const previous = session.contextSummary?.trim() || "（这是首次滚动总结）";
        const transcript = pending.map(formatSummaryLine).join("\n");
        const prompt = [
            `请维护「${conversationLabel}」的滚动对话摘要。`,
            "这份摘要会替代较早的逐字聊天记录，帮助角色在后续对话中保持连续。",
            "",
            "【已有摘要】",
            previous,
            "",
            "【本次新增对话】",
            transcript,
            "",
            "请输出更新后的完整摘要，要求：",
            "- 只保留已发生的事实，不自行补写",
            "- 保留人物关系、承诺、偏好、情绪变化、未完成事项和当前场景",
            "- 保留重要专有名词、时间与数量",
            "- 合并重复信息，删除无意义寒暄",
            "- 300～600字；只输出摘要正文，不要标题、JSON或解释",
        ].join("\n");

        const result = await simpleLLMCall(
            apiConfig,
            [{ role: "user", content: prompt }],
            { temperature: 0.2, max_tokens: 8192, label: `滚动摘要·${conversationLabel}` },
        );
        const summary = result.content?.trim();
        if (!summary || result.wasTruncated) return;

        const latestSessions = loadChatSessions();
        const latestIndex = latestSessions.findIndex(item => item.id === sessionId);
        if (latestIndex < 0) return;
        latestSessions[latestIndex] = {
            ...latestSessions[latestIndex],
            contextSummary: summary,
            contextSummaryUntilMessageId: pending[pending.length - 1].id,
            contextSummaryUpdatedAt: new Date().toISOString(),
        };
        saveChatSessions(latestSessions);
    } finally {
        runningSessions.delete(sessionId);
    }
}

