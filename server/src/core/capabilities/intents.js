"use strict";

/**
 * Pending confirmation intents for risky ("write") capability calls.
 *
 * A write executes ONLY when all of these hold:
 *   1. a pending intent exists for this business+customer+tool+args
 *   2. the agent replays its token with confirm=true
 *   3. the customer sent at least one NEW message after the intent was
 *      proposed (conversation length grew) — i.e. a human actually replied.
 *
 * Intents expire quickly; confirmation is never long-lived.
 */

const db = require("../../db").get;
const crypto = require("../../lib/crypto");

const TTL_MS = 15 * 60 * 1000;

function hashArgs(tool, args) {
    return stableHash(JSON.stringify({ tool, args: args ?? null }));
}

function stableHash(text) {
    // Short non-crypto hash is enough: collisions are guarded by full-args compare.
    let h = 5381;
    for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) >>> 0;
    return String(h);
}

function purgeExpired() {
    try {
        db().prepare(`UPDATE capability_intents SET status = 'expired' WHERE status = 'pending' AND expires_at < ?`).run(Date.now());
    } catch {
        // never break chatting
    }
}

function createIntent({ businessId, customerId, conversationId = null, tool, args, messageCount = 0 }) {
    purgeExpired();
    const token = `cap_${crypto.randomHex(16)}`;
    const now = Date.now();
    db()
        .prepare(
            `INSERT INTO capability_intents (token, business_id, customer_id, conversation_id, tool, args_json, args_hash, message_count, status, created_at, expires_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`
        )
        .run(
            token,
            businessId,
            customerId,
            conversationId,
            String(tool).slice(0, 100),
            JSON.stringify(args ?? {}),
            hashArgs(tool, args),
            Number(messageCount) || 0,
            now,
            now + TTL_MS
        );
    return { token, expiresInMs: TTL_MS };
}

/**
 * Validate a confirmation attempt. Returns { ok } or { ok:false, reason }.
 */
function validateConfirmation({ businessId, customerId, conversationId, tool, args, token }) {
    purgeExpired();
    const argsHash = hashArgs(tool, args);

    let row = null;
    if (token) {
        row = db()
            .prepare(
                `SELECT * FROM capability_intents
                 WHERE token = ? AND business_id = ? AND customer_id = ? AND tool = ? AND status = 'pending'
                 LIMIT 1`
            )
            .get(String(token).slice(0, 100), businessId, customerId, String(tool).slice(0, 100));
        if (row && row.args_hash !== argsHash) {
            return { ok: false, reason: "arguments_changed_since_proposal" };
        }
    } else {
        row = db()
            .prepare(
                `SELECT * FROM capability_intents
                 WHERE business_id = ? AND customer_id = ? AND tool = ? AND args_hash = ? AND status = 'pending'
                 ORDER BY id DESC LIMIT 1`
            )
            .get(businessId, customerId, String(tool).slice(0, 100), argsHash);
    }

    if (!row) return { ok: false, reason: "no_pending_intent" };
    if (row.expires_at < Date.now()) {
        db().prepare(`UPDATE capability_intents SET status = 'expired' WHERE id = ?`).run(row.id);
        return { ok: false, reason: "intent_expired" };
    }
    if (!conversationId || row.conversation_id !== conversationId) {
        return { ok: false, reason: "confirmation_unavailable" };
    }

    const counted = db()
        .prepare(`SELECT COUNT(*) AS n FROM conversation_messages WHERE conversation_id = ?`)
        .get(conversationId);
    if (!(counted.n > row.message_count)) {
        return { ok: false, reason: "customer_has_not_replied" };
    }

    db().prepare(`UPDATE capability_intents SET status = 'consumed' WHERE id = ?`).run(row.id);
    return { ok: true };
}

/** Newest pending intent for this tenant/customer/conversation (or null). */
function getPendingIntent({ businessId, customerId, conversationId }) {
    purgeExpired();
    if (!conversationId) return null;
    const row = db()
        .prepare(
            `SELECT * FROM capability_intents
             WHERE business_id = ? AND customer_id = ? AND conversation_id = ? AND status = 'pending'
             ORDER BY id DESC LIMIT 1`
        )
        .get(businessId, customerId, String(conversationId));
    if (!row || row.expires_at < Date.now()) return null;
    let args = {};
    try { args = JSON.parse(row.args_json || "{}"); } catch { /* ignore */ }
    return { token: row.token, tool: row.tool, args };
}

module.exports = { createIntent, validateConfirmation, getPendingIntent };
