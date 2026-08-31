"use strict";

/**
 * Context engine: turns a raw chat request into a ranked, token-budgeted
 * model context. Single canonical pipeline:
 *
 *   conversation -> memories -> behavior -> knowledge -> ranking -> budget
 */

const { listMemories, hybridSearchMemories } = require("../memory/store");
const { listRecentBehavior } = require("../behavior/store");
const { searchKnowledge, hybridSearchKnowledge, tokenize } = require("../knowledge/store");
const { estimateTokens, estimateMessagesTokens } = require("../../lib/tokens");
const { sanitizeContext } = require("../../lib/sanitize");

function messageText(messages = []) {
    return messages
        .filter((message) => message && typeof message.content === "string")
        .map((message) => message.content)
        .join(" ");
}

function scoreMemory(memory, queryWords) {
    const key = String(memory?.memory_key || "").toLowerCase();
    const value = String(memory?.memory_value || "").toLowerCase();
    const category = String(memory?.category || "").toLowerCase();

    let score = 0;
    for (const word of queryWords) {
        if (key === word) score += 8;
        else if (key.includes(word)) score += 4;
        if (value.includes(word)) score += 3;
        if (category.includes(word)) score += 2;
    }

    // Identity fields are broadly useful.
    if (["name", "location"].includes(key)) score += 1;

    // Explicit statements outrank inferred ones.
    if (memory?.origin === "explicit") score += 3;

    const confidence = Number(memory?.confidence);
    if (Number.isFinite(confidence)) score += Math.max(0, Math.min(confidence, 2));

    const updatedAt = Number(memory?.updated_at || 0);
    if (updatedAt > 0) {
        const age = Date.now() - updatedAt;
        if (age < 86_400_000) score += 2;
        else if (age < 7 * 86_400_000) score += 1;
    }

    return score;
}

function scoreBehavior(event, queryWords) {
    const type = String(event?.eventType || "").toLowerCase();
    let serialized = "";
    try {
        serialized = JSON.stringify(event?.eventData || {}).toLowerCase();
    } catch {
        serialized = "";
    }

    let score = 0;
    for (const word of queryWords) {
        if (type.includes(word)) score += 4;
        if (serialized.includes(word)) score += 3;
    }

    const createdAt = Number(event?.createdAt || 0);
    if (createdAt > 0) {
        const age = Date.now() - createdAt;
        if (age < 86_400_000) score += 4;
        else if (age < 3 * 86_400_000) score += 3;
        else if (age < 7 * 86_400_000) score += 1;
    }

    return score;
}

/** Trim conversation to the configured window. */
function limitConversation(messages, maxMessages, maxCharsPerMessage = 10_000) {
    if (!Array.isArray(messages)) return [];
    return messages
        .filter(
            (message) =>
                message &&
                (message.role === "user" || message.role === "assistant") &&
                typeof message.content === "string" &&
                message.content.trim()
        )
        .map((message) => ({ role: message.role, content: message.content.trim().slice(0, maxCharsPerMessage) }))
        .slice(-maxMessages);
}

/**
 * Build the full model context.
 *
 * @returns {{
 *   customer: object,
 *   conversation: Array,
 *   memories: Array,
 *   behavioralEvents: Array,
 *   knowledge: Array,
 *   budget: { estimatedTokens, maxContextTokens, withinBudget },
 * }}
 */
async function buildContext({ businessId, customerId, customer, messages = [], config }) {
    const contextConfig = config?.context || {};
    const memoryEnabled = config?.memory?.enabled !== false;
    const behaviorEnabled = config?.behavior?.enabled !== false;

    const conversation = limitConversation(messages, contextConfig.maxConversationMessages || 20);
    const query = messageText(conversation);
    const queryWords = tokenize(query);

    // --- candidates ---------------------------------------------------------
    const candidateMemories =
        memoryEnabled && (contextConfig.maxMemories ?? 5) > 0
            ? await hybridSearchMemories(businessId, customerId, query, { limit: 20 })
            : [];

    const candidateBehavior =
        behaviorEnabled && (contextConfig.maxBehavior ?? 10) > 0
            ? (await listRecentBehavior(businessId, customerId, 60)).events
            : [];

    // --- rank & select --------------------------------------------------------
    const selectedMemories = candidateMemories
        .map((memory) => ({ ...memory, relevanceScore: (memory.hybridScore || 0) * 100 + scoreMemory(memory, queryWords) }))
        .filter((memory) => memory.relevanceScore >= (contextConfig.minimumMemoryScore ?? 1))
        .sort((a, b) => b.relevanceScore - a.relevanceScore)
        .slice(0, contextConfig.maxMemories ?? 5);

    const selectedBehavior = candidateBehavior
        .map((event) => ({ ...event, relevanceScore: scoreBehavior(event, queryWords) }))
        .filter((event) => event.relevanceScore >= (contextConfig.minimumBehaviorScore ?? 1))
        .sort((a, b) => b.relevanceScore - a.relevanceScore || b.createdAt - a.createdAt)
        .slice(0, contextConfig.maxBehavior ?? 10);

    const selectedKnowledge = config?.features?.knowledge !== false
        ? await hybridSearchKnowledge(businessId, query, contextConfig.maxKnowledge ?? 4)
        : [];

    // --- budget enforcement ---------------------------------------------------
    const maxContextTokens = contextConfig.maxContextTokens ?? 6000;

    function sectionTokens(memories, behavior, knowledge) {
        let total = estimateMessagesTokens(conversation);
        for (const memory of memories) total += estimateTokens(`${memory.memory_key}: ${memory.memory_value}`) + 6;
        for (const event of behavior) total += estimateTokens(JSON.stringify(event.eventData || {})) + 8;
        for (const item of knowledge) total += estimateTokens(item.content) + 10;
        return total;
    }

    // Drop lowest-value items until inside budget (knowledge first by lowest
    // relevance ratio, then behavior, then memories).
    let memories = [...selectedMemories];
    let behavior = [...selectedBehavior];
    let knowledge = [...selectedKnowledge];

    while (sectionTokens(memories, behavior, knowledge) > maxContextTokens) {
        if (behavior.length > 1) {
            behavior.pop();
            continue;
        }
        if (knowledge.length > 0) {
            knowledge.pop();
            continue;
        }
        if (memories.length > 1) {
            memories.pop();
            continue;
        }
        break; // only the highest-priority single items remain
    }

    const estimatedTokens = sectionTokens(memories, behavior, knowledge);

    const context = {
        customer: {
            id: customer?.customerId || customerId,
            name: customer?.name || null,
            email: customer?.email || null,
            phone: customer?.phone || null,
        },
        businessId,
        conversation,
        memories,
        behavioralEvents: behavior,
        knowledge,
        budget: {
            estimatedTokens,
            maxContextTokens,
            withinBudget: estimatedTokens <= maxContextTokens,
        },
    };

    // Sanitize all retrieved content before prompt injection
    return sanitizeContext(context);
}

module.exports = { buildContext, limitConversation };