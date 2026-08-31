"use strict";

/**
 * CHRONO — Booking helpers (real booking lifecycle over bookings table + holds).
 */

const db = require("../../db").get;
const crypto = require("../../lib/crypto");
const { badRequest } = require("../../lib/errors");
const { generateAvailability } = require("./slots");

function isValidIsoDatetime(v) {
    if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(v)) return false;
    return !Number.isNaN(new Date(v).getTime());
}
function normalizeIso(v) { return new Date(v).toISOString(); }

function listBookedIso(businessId, dayIso) {
    return db().prepare(
        "SELECT scheduled_at FROM bookings WHERE business_id=? AND status='confirmed' AND substr(scheduled_at,1,10)=?"
    ).all(businessId, dayIso).map((r) => r.scheduled_at);
}

function isSlotAvailable(businessId, scheduledAtIso) {
    const dayIso = scheduledAtIso.slice(0, 10);
    const hhmm = scheduledAtIso.slice(11, 16);
    // seating-aware capacity check
    let capacity = 1;
    try { capacity = require("./schedule").getSchedule(businessId).maxSeatsPerSlot || 1; } catch {}
    const bookedCount = db().prepare(
        "SELECT COUNT(*) as n FROM bookings WHERE business_id=? AND status='confirmed' AND scheduled_at=?"
    ).get(businessId, scheduledAtIso).n;
    if (bookedCount >= capacity) return false;
    const heldCount = db().prepare(
        "SELECT COUNT(*) as n FROM chrono_slot_holds WHERE business_id=? AND scheduled_at=? AND expires_at > ?"
    ).get(businessId, scheduledAtIso, Date.now()).n;
    if (bookedCount + heldCount >= capacity) return false;
    // check that slot is within generated availability (respects schedule/overrides/minNotice)
    const avail = generateAvailability(businessId, { startDate: dayIso, days: 1 });
    const day = avail.days.find((d) => d.date === dayIso);
    if (!day) return false;
    return day.openSlots.includes(hhmm);
}

function pickHostRoundRobin(businessId) {
    try {
        const sched = require("./schedule").getSchedule(businessId);
        const hosts = sched.hosts || [];
        if (!hosts.length) return "";
        // count bookings per host in last 30 days to balance load
        const counts = new Map(hosts.map((h) => [h.name, 0]));
        const rows = db().prepare(
            "SELECT assigned_host as host, COUNT(*) as c FROM bookings WHERE business_id=? AND assigned_host != '' AND created_at > ? GROUP BY assigned_host"
        ).all(businessId, Date.now() - 30 * 24 * 60 * 60 * 1000);
        for (const r of rows) if (counts.has(r.host)) counts.set(r.host, r.c);
        let best = hosts[0].name; let min = counts.get(best) ?? 0;
        for (const h of hosts) {
            const c = counts.get(h.name) ?? 0;
            if (c < min) { min = c; best = h.name; }
        }
        return best;
    } catch { return ""; }
}

/** Create a hold (reservation) for the slot during confirmation window. Default 5min like Cal. */
function holdSlot({ businessId, customerId, scheduledAt, service }) {
    const iso = normalizeIso(scheduledAt);
    if (!isSlotAvailable(businessId, iso)) throw badRequest("That time just became unavailable — pick another slot.", "slot_conflict");
    const holdId = `hld_${crypto.randomHex(10)}`;
    const now = Date.now();
    const expiresAt = now + 5 * 60 * 1000;
    // clear expired holds opportunistically
    db().prepare("DELETE FROM chrono_slot_holds WHERE expires_at <= ?").run(now);
    db().prepare("INSERT INTO chrono_slot_holds (hold_id, business_id, customer_id, scheduled_at, service, expires_at, created_at) VALUES (?,?,?,?,?,?,?)")
        .run(holdId, businessId, customerId, iso, String(service || "").slice(0,200), expiresAt, now);
    return { holdId, scheduledAt: iso, expiresAt };
}

function createBooking(ctx, params) {
    const service = String(params.service || "").trim().slice(0, 200);
    const contact = String(params.contact || "").trim().slice(0, 200);
    const notes = String(params.notes || "").trim().slice(0, 1000);
    if (!service) throw badRequest("booking.create requires service.", "invalid_params");
    if (!isValidIsoDatetime(params.datetime)) throw badRequest("datetime must be ISO8601 e.g. 2026-09-01T10:00:00Z", "invalid_params");
    const scheduledAt = normalizeIso(params.datetime);

    // Final availability check (covers schedule, buffer, holds, notice)
    if (!isSlotAvailable(ctx.businessId, scheduledAt)) {
        throw badRequest("That slot is no longer available. Offer adjacent ranked slots.", "slot_conflict");
    }
    const uid = `bkg_${crypto.randomHex(12)}`;
    const now = Date.now();
    const assignedHost = pickHostRoundRobin(ctx.businessId);
    db().prepare(
        "INSERT INTO bookings (booking_uid, business_id, customer_id, conversation_id, service, scheduled_at, contact, notes, status, assigned_host, seats, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?, 'confirmed', ?, 1, ?, ?)"
    ).run(uid, ctx.businessId, ctx.customerId, ctx.conversationId || null, service, scheduledAt, contact, notes, assignedHost, now, now);
    // release any hold for this slot (one seat)
    db().prepare("DELETE FROM chrono_slot_holds WHERE business_id=? AND scheduled_at=? AND customer_id=?").run(ctx.businessId, scheduledAt, ctx.customerId);
    // if no customer-specific hold, clear one oldest hold for hygiene
    if (db().prepare("SELECT changes() as c").get().c === 0) {
        db().prepare("DELETE FROM chrono_slot_holds WHERE business_id=? AND scheduled_at=? AND rowid = (SELECT rowid FROM chrono_slot_holds WHERE business_id=? AND scheduled_at=? ORDER BY created_at LIMIT 1)").run(ctx.businessId, scheduledAt, ctx.businessId, scheduledAt);
    }
    const hostMsg = assignedHost ? ` Host: ${assignedHost}.` : "";
    return { bookingRef: uid, service, scheduledAt, status: "confirmed", assignedHost, message: `Booking confirmed. Reference ${uid}.${hostMsg}` };
}

function cancelBooking({ businessId, customerId }, bookingUid) {
    const row = db().prepare("SELECT * FROM bookings WHERE booking_uid=? AND business_id=?").get(bookingUid, businessId);
    if (!row) throw badRequest("Booking not found.", "not_found");
    // allow customer or any caller with business scope — portal route will enforce ownership
    db().prepare("UPDATE bookings SET status='cancelled', updated_at=? WHERE booking_uid=?").run(Date.now(), bookingUid);
    return { bookingRef: bookingUid, status: "cancelled" };
}

function rescheduleBooking(ctx, params) {
    const { bookingUid, datetime } = params;
    if (!bookingUid) throw badRequest("bookingUid required.", "invalid_params");
    if (!isValidIsoDatetime(datetime)) throw badRequest("datetime must be ISO8601.", "invalid_params");
    const row = db().prepare("SELECT * FROM bookings WHERE booking_uid=? AND business_id=?").get(bookingUid, ctx.businessId);
    if (!row) throw badRequest("Booking not found.", "not_found");
    if (row.status === "cancelled") throw badRequest("Cannot reschedule a cancelled booking.", "invalid_state");
    const newIso = normalizeIso(datetime);
    if (!isSlotAvailable(ctx.businessId, newIso)) throw badRequest("Target slot unavailable.", "slot_conflict");
    db().prepare("UPDATE bookings SET scheduled_at=?, updated_at=? WHERE booking_uid=?").run(newIso, Date.now(), bookingUid);
    return { bookingRef: bookingUid, scheduledAt: newIso, status: "confirmed" };
}

function listCustomerBookings({ businessId, customerId }) {
    const rows = db().prepare(
        "SELECT booking_uid, service, scheduled_at, status, contact, notes, assigned_host, created_at FROM bookings WHERE business_id=? AND customer_id=? ORDER BY scheduled_at ASC LIMIT 50"
    ).all(businessId, customerId);
    return { bookings: rows };
}

function listBusinessBookings(businessId, opts = {}) {
    let sql = "SELECT booking_uid, customer_id, service, scheduled_at, status FROM bookings WHERE business_id=?";
    const params = [businessId];
    if (opts.status) { sql += " AND status=?"; params.push(opts.status); }
    if (opts.from) { sql += " AND scheduled_at >= ?"; params.push(new Date(opts.from).toISOString()); }
    if (opts.to) { sql += " AND scheduled_at <= ?"; params.push(new Date(opts.to).toISOString()); }
    sql += " ORDER BY scheduled_at ASC LIMIT 100";
    return db().prepare(sql).all(...params);
}

module.exports = { isValidIsoDatetime, holdSlot, createBooking, cancelBooking, rescheduleBooking, listCustomerBookings, listBusinessBookings, isSlotAvailable };
