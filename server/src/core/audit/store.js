"use strict";

/**
 * Audit log. Records security-relevant actions. Never stores secrets.
 */

const db = require("../../db").get;
const { redact } = require("../../lib/logger");

function record({ businessId = null, actorType, actorId = null, action, detail = {}, ip = null }) {
    try {
        db()
            .prepare(
                `INSERT INTO audit_log (business_id, actor_type, actor_id, action, detail_json, ip, created_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?)`
            )
            .run(
                businessId,
                String(actorType || "system").slice(0, 40),
                actorId ? String(actorId).slice(0, 200) : null,
                String(action).slice(0, 100),
                JSON.stringify(redact(detail) || {}),
                ip ? String(ip).slice(0, 80) : null,
                Date.now()
            );
    } catch {
        // Auditing must never break request handling.
    }
}

function listAudit(businessId, { limit = 50, offset = 0 } = {}) {
    const rows = db()
        .prepare(
            `SELECT id, business_id, actor_type, actor_id, action, detail_json, ip, created_at
             FROM audit_log
             WHERE business_id IS NULL OR business_id = ?
             ORDER BY created_at DESC
             LIMIT ? OFFSET ?`
        )
        .all(businessId, Math.max(1, Math.min(Number(limit) || 50, 200)), Math.max(0, Number(offset) || 0));

    return rows.map((row) => {
        let detail = {};
        try {
            detail = JSON.parse(row.detail_json || "{}");
        } catch {
            detail = {};
        }
        return {
            id: row.id,
            businessId: row.business_id,
            actorType: row.actor_type,
            actorId: row.actor_id,
            action: row.action,
            detail,
            ip: row.ip,
            createdAt: row.created_at,
        };
    });
}

module.exports = { record, listAudit };
