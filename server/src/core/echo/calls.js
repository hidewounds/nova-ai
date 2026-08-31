"use strict";

/**
 * ECHO — Voice call sessions.
 * Minimal call lifecycle used by the voice_receptionist role.
 * A call = a conversation with audio turns. Handoff escalation is last-resort.
 */

const db = require("../../db").get;
const crypto = require("../../lib/crypto");

function now() { return Date.now(); }

function createCall({ businessId, customerId, phone, language }) {
    const callId = `call_${crypto.randomHex(10)}`;
    db().prepare(
        "INSERT INTO echo_voice_calls (call_id, business_id, customer_id, phone, status, language, transcript_json, handoff_requested, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)"
    ).run(callId, businessId, customerId, String(phone || "").slice(0, 40), "active", String(language || "").slice(0, 10), "[]", 0, now(), now());
    return getCall(callId);
}

function getCall(callId) {
    return db().prepare("SELECT * FROM echo_voice_calls WHERE call_id=?").get(callId) || null;
}

function appendTranscript(callId, { role, text, language }) {
    const row = getCall(callId);
    if (!row) return null;
    let arr = [];
    try { arr = JSON.parse(row.transcript_json || "[]"); } catch {}
    arr.push({ role: role === "assistant" ? "assistant" : "user", text: String(text || "").slice(0, 4000), language: language || row.language || "", at: now() });
    if (arr.length > 80) arr = arr.slice(-80);
    db().prepare("UPDATE echo_voice_calls SET transcript_json=?, updated_at=? WHERE call_id=?").run(JSON.stringify(arr), now(), callId);
    return getCall(callId);
}

function requestHandoff(callId) {
    const row = getCall(callId);
    if (!row) return null;
    db().prepare("UPDATE echo_voice_calls SET handoff_requested=1, status='handoff_requested', updated_at=? WHERE call_id=?").run(now(), callId);
    return getCall(callId);
}

function endCall(callId, status = "ended") {
    db().prepare("UPDATE echo_voice_calls SET status=?, updated_at=? WHERE call_id=?").run(String(status).slice(0, 20), now(), callId);
    return getCall(callId);
}

function listCalls(businessId, limit = 50) {
    return db().prepare("SELECT call_id, customer_id, phone, status, language, handoff_requested, created_at, updated_at FROM echo_voice_calls WHERE business_id=? ORDER BY created_at DESC LIMIT ?").all(businessId, limit);
}

module.exports = { createCall, getCall, appendTranscript, requestHandoff, endCall, listCalls };
