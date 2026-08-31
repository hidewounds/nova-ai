"use strict";

/**
 * CHRONO — Slot engine.
 * Generates real, ranked open slots for a business's schedule, respecting:
 * - weekly hours + overrides, min-notice, buffer, existing bookings, active holds.
 * Horizon defaults to 30 days; caller can request up to 90.
 * Slot picking also ranks slots to minimize rush (spaced suggestions).
 */

const db = require("../../db").get;
const { getSchedule } = require("./schedule");

const SLOT_HORIZON_MAX = 90;

function pad2(n) { return String(n).padStart(2, "0"); }
function toIsoDate(d) { return d.toISOString().slice(0, 10); }
function hhmmToMinutes(hhmm) { const [h, m] = hhmm.split(":").map(Number); return h * 60 + m; }
function minutesToHhmm(min) { return `${pad2(Math.floor(min / 60))}:${pad2(min % 60)}`; }

function loadBookedCounts(businessId, dayIso) {
    // confirmed bookings count per hhmm; holds also count toward capacity
    const bookings = db().prepare(
        "SELECT substr(scheduled_at,12,5) as hhmm, COUNT(*) as c FROM bookings WHERE business_id=? AND status='confirmed' AND substr(scheduled_at,1,10)=? GROUP BY hhmm"
    ).all(businessId, dayIso);
    const holds = db().prepare(
        "SELECT substr(scheduled_at,12,5) as hhmm, COUNT(*) as c FROM chrono_slot_holds WHERE business_id=? AND substr(scheduled_at,1,10)=? AND expires_at > ? GROUP BY hhmm"
    ).all(businessId, dayIso, Date.now());
    const counts = new Map();
    for (const r of bookings) counts.set(r.hhmm, (counts.get(r.hhmm) || 0) + r.c);
    for (const r of holds) counts.set(r.hhmm, (counts.get(r.hhmm) || 0) + r.c);
    return counts;
}
// legacy shim
function loadBookedSet(businessId, dayIso) {
    const counts = loadBookedCounts(businessId, dayIso);
    return new Set([...counts.entries()].filter(([, c]) => c > 0).map(([hhmm]) => hhmm));
}

/**
 * Rank slots to avoid clustering / rush.
 * Strategy: prefer mid-morning (10-11) and early afternoon (14-15), de-prioritize
 * back-to-back tight slots by spacing.
 */
function rankSlots(slots) {
    const preference = { "10:00": -3, "10:30": -2, "11:00": -2, "14:00": -2, "14:30": -1, "15:00": -1, "09:00": 0, "16:30": 2 };
    return [...slots].sort((a, b) => (preference[a] ?? 0) - (preference[b] ?? 0));
}

/**
 * Generate availability.
 * @param {string} businessId
 * @param {object} opts { startDate?: YYYY-MM-DD, days?: number, horizonDays?: number, rank?: boolean }
 */
function generateAvailability(businessId, opts = {}) {
    const schedule = getSchedule(businessId);
    const overrides = new Map(
        db().prepare("SELECT date, is_closed, open_time, close_time FROM chrono_overrides WHERE business_id=?").all(businessId)
            .map((r) => [r.date, r])
    );

    const start = opts.startDate && /^\d{4}-\d{2}-\d{2}$/.test(opts.startDate)
        ? new Date(`${opts.startDate}T00:00:00Z`)
        : new Date();
    if (Number.isNaN(start.getTime())) throw new Error("Invalid startDate");

    let daysCount = Math.min(SLOT_HORIZON_MAX, Math.max(1, Number(opts.days || opts.horizonDays || 14) || 14));
    // cap by business maxDaysAhead
    daysCount = Math.min(daysCount, schedule.maxDaysAhead);

    const minNoticeMs = schedule.minNoticeMinutes * 60 * 1000;
    const earliestAllowed = Date.now() + minNoticeMs;

    const days = [];
    const cursor = new Date(start);
    // if no explicit startDate, start today (inclusive)
    let collected = 0;
    let guard = 0;
    while (collected < daysCount && guard < 400) {
        guard++;
        const dayIso = toIsoDate(cursor);
        const dowIdx = cursor.getUTCDay();
        const dowName = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"][dowIdx];

        const override = overrides.get(dayIso);
        let blocks;
        if (override) {
            if (override.is_closed) blocks = [];
            else if (override.open_time && override.close_time) blocks = [{ start: override.open_time, end: override.close_time }];
            else blocks = schedule.weekly[dowName] || [];
        } else {
            blocks = schedule.weekly[dowName] || [];
        }

        if (blocks.length) {
            const counts = loadBookedCounts(businessId, dayIso);
            const capacity = schedule.maxSeatsPerSlot || 1;
            const rawSlots = [];
            const seatsLeft = {};
            for (const block of blocks) {
                const startMin = hhmmToMinutes(block.start);
                const endMin = hhmmToMinutes(block.end);
                for (let m = startMin; m + schedule.slotDuration <= endMin; m += schedule.slotDuration + schedule.bufferMinutes) {
                    const hhmm = minutesToHhmm(m);
                    const used = counts.get(hhmm) || 0;
                    if (used >= capacity) continue;
                    const iso = `${dayIso}T${hhmm}:00Z`;
                    if (new Date(iso).getTime() < earliestAllowed) continue;
                    rawSlots.push(hhmm);
                    seatsLeft[hhmm] = capacity - used;
                }
            }
            const ranked = opts.rank ? rankSlots(rawSlots) : rawSlots;
            days.push({ date: dayIso, openSlots: ranked, slots: ranked.map((t) => `${dayIso}T${t}:00Z`), seatsLeft });
            collected++;
        } else {
            // still emit closed days if caller wants full horizon visibility
            if (opts.includeClosed) days.push({ date: dayIso, openSlots: [], slots: [], closed: true });
        }
        cursor.setUTCDate(cursor.getUTCDate() + 1);
    }

    return {
        timezone: schedule.timezone,
        slotDuration: schedule.slotDuration,
        bufferMinutes: schedule.bufferMinutes,
        maxSeatsPerSlot: schedule.maxSeatsPerSlot,
        hosts: schedule.hosts,
        horizonDays: daysCount,
        days,
        note: "Live availability generated by chrono. Confirm exact time with customer before booking.",
    };
}

function availabilityWithRanking(businessId, opts = {}) {
    return generateAvailability(businessId, { ...opts, rank: true });
}

module.exports = { generateAvailability, availabilityWithRanking, rankSlots };
