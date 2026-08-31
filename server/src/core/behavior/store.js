"use strict";

/**
 * Canonical behavioral event store. TTL-based contextual evidence,
 * business-scoped and customer-scoped.
 */

const db = require("../../db").get;
const { randomId } = require("../../lib/crypto");
const { badRequest } = require("../../lib/errors");
const { normalizeBusinessId } = require("../config/service");

const ALLOWED_EVENT_TYPES = new Set([
    "page_view",
    "product_view",
    "search",
    "category_view",
    "cart",
    "wishlist",
    "purchase",
]);

function normalizeCustomerId(customerId) {
    const value = String(customerId || "").trim().slice(0, 150);
    if (!value) throw badRequest("Customer ID is required.");
    return value;
}

function isAllowedEventType(eventType) {
    return ALLOWED_EVENT_TYPES.has(String(eventType || "").trim());
}

function cleanEventData(eventData) {
    if (!eventData || typeof eventData !== "object" || Array.isArray(eventData)) return {};
    try {
        const serialized = JSON.stringify(eventData);
        if (serialized.length > 10_000) return { truncated: true };
        return JSON.parse(serialized);
    } catch {
        return {};
    }
}

function getRetentionDays(eventType, config) {
    const behaviorConfig = config?.behavior || {};
    const event = behaviorConfig.events?.[eventType];
    if (Number.isFinite(Number(event?.retentionDays)) && Number(event.retentionDays) > 0) {
        return Number(event.retentionDays);
    }
    if (Number.isFinite(Number(behaviorConfig.defaultRetentionDays)) && Number(behaviorConfig.defaultRetentionDays) > 0) {
        return Number(behaviorConfig.defaultRetentionDays);
    }
    return 30;
}

function saveBehaviorEvent({ businessId, customerId, eventType, eventData = {}, config = null }) {
    const business = normalizeBusinessId(businessId);
    const customer = normalizeCustomerId(customerId);
    const type = String(eventType || "").trim();

    if (!type) throw badRequest("eventType is required.");
    if (!isAllowedEventType(type)) throw badRequest(`Unsupported behavior event: ${type}`, "unsupported_event");

    if (config?.behavior?.enabled === false) {
        return { saved: false, reason: "behavior_disabled" };
    }
    const eventConfig = config?.behavior?.events?.[type];
    if (eventConfig && eventConfig.enabled === false) {
        return { saved: false, reason: "event_disabled" };
    }

    const cleanData = cleanEventData(eventData);
    const createdAt = Date.now();
    const retentionDays = getRetentionDays(type, config);
    const expiresAt = createdAt + retentionDays * 24 * 60 * 60 * 1000;
    const eventId = randomId("evt", 10);

    db()
        .prepare(
            `INSERT INTO behavioral_events (event_id, business_id, customer_id, event_type, event_data, created_at, expires_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .run(eventId, business, customer, type, JSON.stringify(cleanData), createdAt, expiresAt);

    cleanupBehavior(business, customer, config);
    cleanupExpiredGlobal();

    return { saved: true, eventId, eventType: type, eventData: cleanData, createdAt, expiresAt, retentionDays };
}

/** Remove expired + over-cap events for one customer. */
function cleanupBehavior(businessId, customerId, config = null) {
    const now = Date.now();
    const expired = db()
        .prepare(
            `DELETE FROM behavioral_events
             WHERE business_id = ? AND customer_id = ? AND expires_at IS NOT NULL AND expires_at <= ?`
        )
        .run(businessId, customerId, now);

    const maxEvents = Math.max(10, Math.min(Number(config?.behavior?.maxEvents) || 100, 10_000));
    const rows = db()
        .prepare(`SELECT id FROM behavioral_events WHERE business_id = ? AND customer_id = ? ORDER BY created_at DESC`)
        .all(businessId, customerId);

    if (rows.length <= maxEvents) return expired.changes;

    const excess = rows.slice(maxEvents);
    const statement = db().prepare(`DELETE FROM behavioral_events WHERE id = ?`);
    for (const row of excess) statement.run(row.id);

    return expired.changes + excess.length;
}

function cleanupExpiredGlobal() {
    try {
        db().prepare(`DELETE FROM behavioral_events WHERE expires_at IS NOT NULL AND expires_at <= ?`).run(Date.now());
    } catch {
        // non-fatal
    }
}

function listRecentBehavior(businessId, customerId, limit = 20, offset = 0) {
    const safeLimit = Math.max(1, Math.min(Number(limit) || 20, 200));
    const safeOffset = Math.max(0, Number(offset) || 0);
    const rows = db()
        .prepare(
            `SELECT id, event_id, event_type, event_data, created_at, expires_at
             FROM behavioral_events
             WHERE business_id = ? AND customer_id = ? AND expires_at > ?
             ORDER BY created_at DESC
             LIMIT ? OFFSET ?`
        )
        .all(normalizeBusinessId(businessId), normalizeCustomerId(customerId), Date.now(), safeLimit, safeOffset);

    const total = db()
        .prepare(`SELECT COUNT(*) AS n FROM behavioral_events WHERE business_id = ? AND customer_id = ? AND expires_at > ?`)
        .get(normalizeBusinessId(businessId), normalizeCustomerId(customerId), Date.now()).n;

    return { events: rows.map((row) => {
        let eventData = {};
        try {
            eventData = JSON.parse(row.event_data || "{}");
        } catch {
            eventData = {};
        }
        return {
            eventId: row.event_id,
            eventType: row.event_type,
            eventData,
            createdAt: row.created_at,
            expiresAt: row.expires_at,
        };
    }), total, limit: safeLimit, offset: safeOffset };
}

function deleteBehaviorEvent(businessId, customerId, eventId) {
    const result = db()
        .prepare(`DELETE FROM behavioral_events WHERE business_id = ? AND customer_id = ? AND event_id = ?`)
        .run(normalizeBusinessId(businessId), normalizeCustomerId(customerId), String(eventId || "").trim());
    return result.changes > 0;
}

function deleteAllBehavior(businessId, customerId) {
    return db()
        .prepare(`DELETE FROM behavioral_events WHERE business_id = ? AND customer_id = ?`)
        .run(normalizeBusinessId(businessId), normalizeCustomerId(customerId)).changes;
}

module.exports = {
    ALLOWED_EVENT_TYPES,
    isAllowedEventType,
    saveBehaviorEvent,
    listRecentBehavior,
    deleteBehaviorEvent,
    deleteAllBehavior,
    cleanupBehavior,
};
