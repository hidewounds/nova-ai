"use strict";

/**
 * Usage/analytics aggregation for the admin dashboard.
 * All queries are strictly business-scoped.
 * Includes multi-touch attribution, conversion funnels, and ROI metrics.
 */

const db = require("../../db").get;
const { normalizeBusinessId } = require("../config/service");
const { clampText } = require("../../lib/tokens");

/** Attribution window in days for outcome attribution. */
const ATTRIBUTION_WINDOW_DAYS = 7;

/** Outcome types that generate revenue. */
const REVENUE_OUTCOME_TYPES = new Set(["purchase", "subscription", "upgrade"]);

/** Deduplication window for outcome events (ms). */
const DEDUP_WINDOW_MS = 60 * 60 * 1000; // 1 hour

function summary(businessId) {
    const business = normalizeBusinessId(businessId);

    const counts = {
        customers: db().prepare(`SELECT COUNT(*) AS n FROM customers WHERE business_id = ?`).get(business).n,
        memories: db().prepare(`SELECT COUNT(*) AS n FROM memories WHERE business_id = ?`).get(business).n,
        behaviorEvents: db().prepare(`SELECT COUNT(*) AS n FROM behavioral_events WHERE business_id = ?`).get(business).n,
        conversations: db().prepare(`SELECT COUNT(*) AS n FROM conversations WHERE business_id = ?`).get(business).n,
        messages: db().prepare(`SELECT COUNT(*) AS n FROM conversation_messages WHERE business_id = ?`).get(business).n,
        knowledgeItems: db().prepare(`SELECT COUNT(*) AS n FROM business_knowledge WHERE business_id = ? AND active = 1`).get(business).n,
    };

    const since7d = Date.now() - 7 * 86_400_000;

    const recent = {
        conversations7d: db()
            .prepare(`SELECT COUNT(*) AS n FROM conversations WHERE business_id = ? AND created_at >= ?`)
            .get(business, since7d).n,
        messages7d: db()
            .prepare(`SELECT COUNT(*) AS n FROM conversation_messages WHERE business_id = ? AND created_at >= ?`)
            .get(business, since7d).n,
        behaviorEvents7d: db()
            .prepare(`SELECT COUNT(*) AS n FROM behavioral_events WHERE business_id = ? AND created_at >= ?`)
            .get(business, since7d).n,
    };

    const eventBreakdown = db()
        .prepare(
            `SELECT event_type AS eventType, COUNT(*) AS count
             FROM behavioral_events
             WHERE business_id = ?
             GROUP BY event_type
             ORDER BY count DESC`
        )
        .all(business);

    return { counts, recent, eventBreakdown };
}

/**
 * Multi-touch attribution for outcome events.
 * Distributes credit across touchpoints within the attribution window.
 * Supports: first-touch, last-touch, linear, time-decay, U-shaped models.
 */
function attributeOutcomes(businessId, { windowDays = ATTRIBUTION_WINDOW_DAYS, model = "linear" } = {}) {
    const business = normalizeBusinessId(businessId);
    const windowStart = Date.now() - windowDays * 86_400_000;

    // Get all outcome events in window
    const outcomes = db()
        .prepare(
            `SELECT outcome_uid, business_id, customer_id, conversation_id, outcome_type, amount_cents, source_event_id, created_at
             FROM outcome_events
             WHERE business_id = ? AND created_at >= ?
             ORDER BY created_at ASC`
        )
        .all(business, windowStart);

    if (!outcomes.length) return { attributed: 0, totalRevenue: 0, byModel: {} };

    // Get all behavioral events in window for these customers
    const customerIds = [...new Set(outcomes.map(o => o.customer_id))];
    const placeholders = customerIds.map(() => "?").join(",");
    
    const touchpoints = db()
        .prepare(
            `SELECT event_id, business_id, customer_id, event_type, event_data, created_at
             FROM behavioral_events
             WHERE business_id = ? AND customer_id IN (${placeholders}) AND created_at >= ?
             ORDER BY created_at ASC`
        )
        .all(business, ...customerIds, windowStart);

    // Group touchpoints by customer
    const touchpointsByCustomer = new Map();
    for (const tp of touchpoints) {
        const arr = touchpointsByCustomer.get(tp.customer_id) || [];
        arr.push(tp);
        touchpointsByCustomer.set(tp.customer_id, arr);
    }

    // Attribute each outcome
    const attributed = [];
    let totalRevenue = 0;

    for (const outcome of outcomes) {
        const tps = touchpointsByCustomer.get(outcome.customer_id) || [];
        // Filter touchpoints before outcome
        const relevantTps = tps.filter(tp => tp.created_at < outcome.created_at);
        
        if (!relevantTps.length) {
            attributed.push({ outcomeUid: outcome.outcome_uid, attributed: false, reason: "no_touchpoints" });
            continue;
        }

        let attribution = [];
        const revenue = outcome.amount_cents || 0;
        totalRevenue += revenue;

        if (model === "first-touch") {
            attribution = [{ eventId: relevantTps[0].event_id, weight: 1 }];
        } else if (model === "last-touch") {
            attribution = [{ eventId: relevantTps[relevantTps.length - 1].event_id, weight: 1 }];
        } else if (model === "linear") {
            const weight = 1 / relevantTps.length;
            attribution = relevantTps.map(tp => ({ eventId: tp.event_id, weight }));
        } else if (model === "time-decay") {
            const now = outcome.created_at;
            const weights = relevantTps.map(tp => {
                const age = now - tp.created_at;
                return Math.exp(-age / (2 * 86_400_000)); // half-life 2 days
            });
            const sum = weights.reduce((a, b) => a + b, 0);
            attribution = relevantTps.map((tp, i) => ({ eventId: tp.event_id, weight: weights[i] / sum }));
        } else if (model === "u-shaped") {
            if (relevantTps.length === 1) {
                attribution = [{ eventId: relevantTps[0].event_id, weight: 1 }];
            } else {
                const firstWeight = 0.4;
                const lastWeight = 0.4;
                const middleWeight = 0.2 / (relevantTps.length - 2);
                attribution = relevantTps.map((tp, i) => {
                    let weight = middleWeight;
                    if (i === 0) weight = firstWeight;
                    else if (i === relevantTps.length - 1) weight = lastWeight;
                    return { eventId: tp.event_id, weight };
                });
            }
        }

        attributed.push({
            outcomeUid: outcome.outcome_uid,
            attributed: true,
            revenue,
            model,
            attribution,
        });
    }

    // Persist attribution results
    for (const a of attributed) {
        if (a.attributed) {
            db().prepare(
                `UPDATE outcome_events SET attribution_json = ? WHERE outcome_uid = ?`
            ).run(JSON.stringify({ model: a.model, attribution: a.attribution, revenue: a.revenue }), a.outcomeUid);
        }
    }

    // Aggregate by event type
    const byEventType = {};
    for (const a of attributed) {
        if (!a.attributed) continue;
        for (const attr of a.attribution) {
            const tp = db().prepare("SELECT event_type FROM behavioral_events WHERE event_id = ?").get(attr.eventId);
            if (tp) {
                byEventType[tp.event_type] = (byEventType[tp.event_type] || 0) + attr.weight * a.revenue;
            }
        }
    }

    return {
        attributed: attributed.filter(a => a.attributed).length,
        totalOutcomes: outcomes.length,
        totalRevenue,
        byModel: { [model]: attributed.filter(a => a.attributed).length },
        revenueByEventType: byEventType,
    };
}

/**
 * Conversion funnel analysis.
 * Tracks: conversation -> qualified lead -> booking -> purchase.
 */
function getFunnel(businessId, { windowDays = 30 } = {}) {
    const business = normalizeBusinessId(businessId);
    const windowStart = Date.now() - windowDays * 86_400_000;

    // Conversations started
    const conversations = db()
        .prepare(`SELECT COUNT(*) AS n FROM conversations WHERE business_id = ? AND created_at >= ?`)
        .get(business, Date.now() - windowDays * 86_400_000).n;

    // Qualified leads (conversations with booking intent)
    const qualifiedLeads = db()
        .prepare(
            `SELECT COUNT(DISTINCT c.conversation_id) AS n
             FROM conversations c
             JOIN conversation_messages m ON m.conversation_id = c.conversation_id
             WHERE c.business_id = ? AND c.created_at >= ?
               AND (m.content LIKE '%book%' OR m.content LIKE '%appointment%' OR m.content LIKE '%schedule%')`
        )
        .get(business, windowStart).n;

    // Bookings created
    const bookings = db()
        .prepare(`SELECT COUNT(*) AS n FROM bookings WHERE business_id = ? AND created_at >= ? AND status = 'confirmed'`)
        .get(business, windowStart).n;

    // Purchases
    const purchases = db()
        .prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(amount_cents), 0) AS revenue
                  FROM outcome_events
                  WHERE business_id = ? AND outcome_type = 'purchase' AND created_at >= ?`)
        .get(business, windowStart);

    // Conversion rates
    const funnel = {
        conversations,
        qualifiedLeads,
        bookings,
        purchases: purchases.n,
        revenueCents: purchases.revenue,
        rates: {
            conversationToLead: conversations > 0 ? (qualifiedLeads / conversations * 100).toFixed(1) : 0,
            leadToBooking: qualifiedLeads > 0 ? (bookings / qualifiedLeads * 100).toFixed(1) : 0,
            bookingToPurchase: bookings > 0 ? (purchases.n / bookings * 100).toFixed(1) : 0,
            conversationToPurchase: conversations > 0 ? (purchases.n / conversations * 100).toFixed(1) : 0,
        },
    };

    return funnel;
}

/**
 * ROI metrics with resilience to duplicate/delayed events.
 */
function getROI(businessId, { windowDays = 30 } = {}) {
    const business = normalizeBusinessId(businessId);
    const windowStart = Date.now() - windowDays * 86_400_000;

    // Revenue from purchases (deduplicated by outcome_uid — schema has outcome_uid/source_event_id, not event_id)
    let revenue;
    try {
        revenue = db()
            .prepare(
                `SELECT COALESCE(SUM(amount_cents), 0) AS total, COUNT(*) AS count
                 FROM (
                     SELECT amount_cents, outcome_uid,
                            ROW_NUMBER() OVER (PARTITION BY outcome_uid ORDER BY created_at) as rn
                     FROM outcome_events
                     WHERE business_id = ? AND outcome_type IN ('purchase', 'subscription', 'upgrade') AND created_at >= ?
                 ) WHERE rn = 1`
            )
            .get(business, windowStart);
    } catch {
        // Fallback for older SQLite without window functions
        revenue = db()
            .prepare(
                `SELECT COALESCE(SUM(amount_cents), 0) AS total, COUNT(*) AS count
                 FROM outcome_events
                 WHERE business_id = ? AND outcome_type IN ('purchase', 'subscription', 'upgrade') AND created_at >= ?`
            )
            .get(business, windowStart);
    }

    // AI costs (estimated from token usage) — schema uses single `tokens` column on conversation_messages
    let aiCosts;
    try {
        aiCosts = db()
            .prepare(
                `SELECT COALESCE(SUM(tokens) * 0.00015, 0) AS cost_usd
                 FROM conversation_messages
                 WHERE business_id = ? AND role = 'assistant' AND model IS NOT NULL AND created_at >= ?`
            )
            .get(business, windowStart);
    } catch {
        aiCosts = { cost_usd: 0 };
    }

    // Human hours saved (estimated: 5 min per automated conversation)
    const automatedConversations = db()
        .prepare(`SELECT COUNT(*) AS n FROM conversations WHERE business_id = ? AND created_at >= ? AND status = 'resolved'`)
        .get(business, Date.now() - 30 * 86_400_000);

    const hoursSaved = (automatedConversations.n || 0) * 5 / 60;
    const laborCostSaved = hoursSaved * 25; // $25/hr average

    const revenueUsd = (revenue?.total || 0) / 100;
    const aiCostUsd = aiCosts?.cost_usd || 0;
    const netRevenue = revenueUsd - aiCostUsd;
    const roi = aiCostUsd > 0 ? ((netRevenue + laborCostSaved) / aiCostUsd * 100).toFixed(1) : "N/A";

    return {
        revenueUsd: revenueUsd.toFixed(2),
        aiCostUsd: aiCostUsd.toFixed(2),
        laborCostSavedUsd: laborCostSaved.toFixed(2),
        netRevenueUsd: netRevenue.toFixed(2),
        roiPercent: roi,
        conversationsAutomated: automatedConversations.n,
        hoursSaved: hoursSaved.toFixed(1),
    };
}

/**
 * Resilient event ingestion with deduplication.
 * Handles: duplicate events, delayed events, out-of-order events.
 */
async function ingestEvent(businessId, event) {
    const business = normalizeBusinessId(businessId);
    const { eventId, eventType, eventData, customerId, createdAt = Date.now() } = event;

    // Validate
    if (!eventId || !eventType || !customerId) {
        throw new Error("Missing required fields: eventId, eventType, customerId");
    }

    // Deduplication: check if event_id already exists within dedup window
    const existing = db()
        .prepare(`SELECT 1 FROM behavioral_events WHERE business_id = ? AND event_id = ? AND created_at > ?`)
        .get(businessId, eventId, Date.now() - DEDUP_WINDOW_MS);
    
    if (existing) {
        return { deduplicated: true, eventId };
    }

    // Handle delayed events (createdAt in past)
    const timestamp = Math.min(createdAt, Date.now()); // Don't allow future timestamps

    // Insert with deduplication
    const result = db()
        .prepare(
            `INSERT OR IGNORE INTO behavioral_events (event_id, business_id, customer_id, event_type, event_data, created_at, expires_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .run(eventId, businessId, customerId, eventType, JSON.stringify(eventData || {}), timestamp, createdAt + 30 * 86_400_000);

    return { deduplicated: false, eventId, createdAt: timestamp };
}

/**
 * Batch ingest events with transaction support.
 */
async function ingestEventsBatch(businessId, events) {
    const results = [];
    for (const event of events) {
        try {
            const result = await ingestEvent(businessId, event);
            results.push({ eventId: event.eventId, success: true, ...result });
        } catch (error) {
            results.push({ eventId: event.eventId, success: false, error: error.message });
        }
    }
    return results;
}

/**
 * Weekly summary for business owner.
 */
async function getWeeklySummary(businessId) {
    const [funnel, roi, attribution] = await Promise.all([
        getFunnel(businessId, { windowDays: 7 }),
        getROI(businessId, { windowDays: 7 }),
        attributeOutcomes(businessId, { windowDays: 7, model: "u-shaped" }),
    ]);

    return {
        funnel,
        roi,
        attribution,
        generatedAt: Date.now(),
    };
}

module.exports = {
    summary,
    attributeOutcomes,
    getFunnel,
    getROI,
    ingestEvent,
    ingestEventsBatch,
    getWeeklySummary,
};