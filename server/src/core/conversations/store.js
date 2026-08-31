"use strict";

/**
 * Conversation persistence. Server-side history so context survives
 * across sessions and analytics become possible.
 */

const db = require("../../db").get;
const { randomId } = require("../../lib/crypto");
const { normalizeBusinessId } = require("../config/service");
const { estimateTokens } = require("../../lib/tokens");

function findOrCreateConversation({ businessId, customerId, conversationId = null, channel = "api" }) {
    const business = normalizeBusinessId(businessId);
    const timestamp = Date.now();

    if (conversationId) {
        const existing = db()
            .prepare(
                `SELECT conversation_id FROM conversations
                 WHERE business_id = ? AND customer_id = ? AND conversation_id = ?
                 LIMIT 1`
            )
            .get(business, customerId, String(conversationId));
        if (existing) return existing.conversation_id;
    }

    // Continue most recent active conversation unless a specific one was requested.
    if (!conversationId) {
        const recent = db()
            .prepare(
                `SELECT conversation_id FROM conversations
                 WHERE business_id = ? AND customer_id = ? AND status = 'active'
                 ORDER BY updated_at DESC
                 LIMIT 1`
            )
            .get(business, customerId);
        if (recent) return recent.conversation_id;
    }

    const id = randomId("conv", 12);
    db()
        .prepare(
            `INSERT INTO conversations (conversation_id, business_id, customer_id, channel, status, message_count, created_at, updated_at)
             VALUES (?, ?, ?, ?, 'active', 0, ?, ?)`
        )
        .run(id, business, customerId, String(channel || "api").slice(0, 40), timestamp, timestamp);
    return id;
}

function appendMessage({ businessId, customerId, conversationId, role, content, model = null }) {
    if (!["user", "assistant", "system"].includes(role)) return false;
    const text = String(content || "").trim().slice(0, 10_000);
    if (!text) return false;

    const timestamp = Date.now();
    db()
        .prepare(
            `INSERT INTO conversation_messages (conversation_id, business_id, customer_id, role, content, tokens, model, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(conversationId, normalizeBusinessId(businessId), customerId, role, text, estimateTokens(text), model, timestamp);

    db()
        .prepare(`UPDATE conversations SET message_count = message_count + 1, updated_at = ? WHERE conversation_id = ?`)
        .run(timestamp, conversationId);
    return true;
}

function getConversationMessages(businessId, conversationId, limit = 200) {
    return db()
        .prepare(
            `SELECT role, content, model, created_at
             FROM conversation_messages
             WHERE business_id = ? AND conversation_id = ?
             ORDER BY created_at ASC
             LIMIT ?`
        )
        .all(normalizeBusinessId(businessId), String(conversationId), Math.max(1, Math.min(Number(limit) || 200, 500)));
}

function listConversations(businessId, { customerId = null, limit = 50, offset = 0 } = {}) {
    const business = normalizeBusinessId(businessId);
    const safeLimit = Math.max(1, Math.min(Number(limit) || 50, 200));
    const safeOffset = Math.max(0, Number(offset) || 0);

    const where = customerId ? `business_id = ? AND customer_id = ?` : `business_id = ?`;
    const params = customerId ? [business, String(customerId)] : [business];

    const rows = db()
        .prepare(
            `SELECT conversation_id, customer_id, channel, status, message_count, created_at, updated_at
             FROM conversations
             WHERE ${where}
             ORDER BY updated_at DESC
             LIMIT ? OFFSET ?`
        )
        .all(...params, safeLimit, safeOffset);

    const total = db().prepare(`SELECT COUNT(*) AS n FROM conversations WHERE ${where}`).get(...params).n;

    return { conversations: rows, total, limit: safeLimit, offset: safeOffset };
}

module.exports = {
    findOrCreateConversation,
    appendMessage,
    getConversationMessages,
    listConversations,
};
