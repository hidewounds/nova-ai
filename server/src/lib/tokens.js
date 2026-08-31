"use strict";

/**
 * Token estimation. Uses a characters/4 heuristic which is adequate for
 * context budgeting without requiring a tokenizer dependency.
 */
function estimateTokens(text) {
    if (typeof text !== "string" || !text) return 0;
    return Math.ceil(text.length / 4);
}

function estimateMessagesTokens(messages = []) {
    if (!Array.isArray(messages)) return 0;
    let total = 0;
    for (const message of messages) {
        if (!message || typeof message.content !== "string") continue;
        total += estimateTokens(message.content) + 4; // per-message overhead
    }
    return total;
}

/** Hard character cap used across user-supplied text. */
function clampText(value, maximum) {
    if (typeof value !== "string") return "";
    return value.trim().slice(0, maximum);
}

module.exports = { estimateTokens, estimateMessagesTokens, clampText };
