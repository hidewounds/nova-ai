"use strict";

/**
 * Owner weekly digest: capability gating, per-tenant isolation, weekly dedupe,
 * catch-up window, admin force-run/preview, portal self-service recipient.
 */

const test = require("node:test");
const assert = require("node:assert");
const { startServer, api, setupBusiness } = require("./helpers");

// Fixed clock points (server-local): Monday 2026-08-24 and the next Monday.
const MON_NOON = new Date(2026, 7, 24, 12, 0, 0).getTime();
const MON_EARLY = new Date(2026, 7, 24, 7, 30, 0).getTime(); // before DIGEST_HOUR
const NEXT_MON_NOON = new Date(2026, 7, 31, 12, 0, 0).getTime();
const LAST_WEEK_TS = new Date(2026, 7, 20, 15, 0, 0).getTime(); // inside reported window

const mailer = require("../server/src/core/mailer");

function stubMailer() {
    const captured = [];
    const origSend = mailer.sendAsBusiness;
    const origCan = mailer.canSend;
    mailer.canSend = () => ({ ok: true, reason: null });
    mailer.sendAsBusiness = async (businessId, msg) => {
        captured.push({ businessId, ...msg });
        return { sent: true };
    };
    return {
        captured,
        smtpDown() {
            mailer.canSend = () => ({ ok: false, reason: "SMTP not configured" });
        },
        restore() {
            mailer.sendAsBusiness = origSend;
            mailer.canSend = origCan;
        },
    };
}

function digestsEngine() {
    return require("../server/src/core/digests/engine");
}

function seedPurchase(dbh, businessId, cents, at) {
    dbh.prepare(
        `INSERT INTO outcome_events (outcome_uid, business_id, customer_id, outcome_type, amount_cents, created_at)
         VALUES (?, ?, ?, 'purchase', ?, ?)`
    ).run("ocm_t_" + Math.random().toString(36).slice(2), businessId, "cust-" + Math.random().toString(36).slice(2), cents, at);
}

async function createSecondBusiness(baseUrl, adminToken) {
    return api(baseUrl, "POST", "/api/admin/businesses", {
        token: adminToken,
        body: { businessName: "Digest Biz " + Math.random().toString(36).slice(2) },
    });
}

test("digest never sends while the capability is OFF (default)", async (t) => {
    const server = await startServer();
    t.after(() => server.close());
    const setup = await setupBusiness(server.baseUrl);

    digestsEngine().setEmail(setup.businessId, "owner@acme.io"); // recipient alone changes nothing

    const m = stubMailer();
    try {
        const r = await digestsEngine().processDueDigests({ nowTs: MON_NOON });
        assert.strictEqual(r.sent, 0);
        assert.strictEqual(m.captured.length, 0);
        assert.ok(r.results.every((x) => x.reason === "flag-off"));
    } finally {
        m.restore();
    }
});

test("Monday tick emails each owner ONLY their own tenant numbers", async (t) => {
    const server = await startServer();
    t.after(() => server.close());
    const a = await setupBusiness(server.baseUrl);
    const b = (await createSecondBusiness(server.baseUrl, a.adminToken)).data;

    seedPurchase(server.db.get(), a.businessId, 8999, LAST_WEEK_TS);
    seedPurchase(server.db.get(), b.business.businessId, 123456, LAST_WEEK_TS);

    const digests = digestsEngine();
    require("../server/src/core/flags/store").setFlags(a.businessId, { weekly_digest: true });
    require("../server/src/core/flags/store").setFlags(b.business.businessId, { weekly_digest: true });
    digests.setEmail(a.businessId, "owner-a@x.io");
    digests.setEmail(b.business.businessId, "owner-b@x.io");

    const m = stubMailer();
    try {
        const r = await digests.processDueDigests({ nowTs: MON_NOON });
        assert.strictEqual(r.sent, 2);

        const aMail = m.captured.find((c) => c.to === "owner-a@x.io");
        const bMail = m.captured.find((c) => c.to === "owner-b@x.io");
        assert.ok(aMail && bMail);
        assert.match(aMail.subject, /^Acme Store — your weekly report$/);
        assert.match(aMail.text, /\$89\.99/);
        assert.doesNotMatch(aMail.text, /1234\.56/, "tenant A must never see B's revenue");
        assert.match(bMail.text, /\$1234\.56/);
        assert.doesNotMatch(bMail.text, /\$89\.99/);

        assert.strictEqual(digests.getConfig(a.businessId).lastSentWeek, "2026-08-24");
    } finally {
        m.restore();
    }
});

test("one send per calendar week; next Monday resumes", async (t) => {
    const server = await startServer();
    t.after(() => server.close());
    const setup = await setupBusiness(server.baseUrl);

    const digests = digestsEngine();
    require("../server/src/core/flags/store").setFlags(setup.businessId, { weekly_digest: true });
    digests.setEmail(setup.businessId, "weekly@acme.io");
    seedPurchase(server.db.get(), setup.businessId, 5000, LAST_WEEK_TS);

    const m = stubMailer();
    try {
        let r = await digests.processDueDigests({ nowTs: MON_NOON });
        assert.strictEqual(r.sent, 1);
        assert.strictEqual(m.captured.length, 1);

        // Restart / re-tick the same week → nothing.
        r = await digests.processDueDigests({ nowTs: MON_NOON });
        assert.strictEqual(r.sent, 0);
        assert.ok(r.results.every((x) => x.reason === "already-sent"));
        assert.strictEqual(m.captured.length, 1);

        // Next Monday → a fresh digest goes out.
        r = await digests.processDueDigests({ nowTs: NEXT_MON_NOON });
        assert.strictEqual(r.sent, 1);
        assert.strictEqual(digests.getConfig(setup.businessId).lastSentWeek, "2026-08-31");
    } finally {
        m.restore();
    }
});

test("nothing goes out before Monday DIGEST_HOUR", async (t) => {
    const server = await startServer();
    t.after(() => server.close());
    const setup = await setupBusiness(server.baseUrl);

    const digests = digestsEngine();
    require("../server/src/core/flags/store").setFlags(setup.businessId, { weekly_digest: true });
    digests.setEmail(setup.businessId, "early@acme.io");

    const m = stubMailer();
    try {
        const r = await digests.processDueDigests({ nowTs: MON_EARLY });
        assert.strictEqual(r.reason, "not-due");
        assert.strictEqual(m.captured.length, 0);
    } finally {
        m.restore();
    }
});

test("missing recipient or broken SMTP blocks the send", async (t) => {
    const server = await startServer();
    t.after(() => server.close());
    const setup = await setupBusiness(server.baseUrl);

    const digests = digestsEngine();
    require("../server/src/core/flags/store").setFlags(setup.businessId, { weekly_digest: true });

    const m = stubMailer();
    try {
        let r = await digests.processDueDigests({ nowTs: MON_NOON });
        assert.ok(r.results.some((x) => x.reason === "no-recipient"));

        digests.setEmail(setup.businessId, "needs-smtp@acme.io");
        m.smtpDown();
        r = await digests.processDueDigests({ nowTs: MON_NOON });
        assert.ok(r.results.some((x) => x.reason === "smtp-not-configured"));
        assert.strictEqual(m.captured.length, 0);
        assert.strictEqual(digests.getConfig(setup.businessId).lastSentWeek, "", "failed weeks must retry later");
    } finally {
        m.restore();
    }
});

test("admin API: configure, preview without sending, force-send", async (t) => {
    const server = await startServer();
    t.after(() => server.close());
    const setup = await setupBusiness(server.baseUrl);
    const base = `/api/admin/businesses/${setup.businessId}`;

    const put = await api(server.baseUrl, "PUT", `${base}/digest-config`, {
        token: setup.adminToken,
        body: { email: "founder-view@acme.io", enabled: true },
    });
    assert.strictEqual(put.status, 200);
    assert.strictEqual(put.data.enabled, true);
    assert.strictEqual(put.data.email, "founder-view@acme.io");

    const prev = await api(server.baseUrl, "POST", `${base}/digest/run?preview=1`, { token: setup.adminToken });
    assert.strictEqual(prev.status, 200);
    assert.strictEqual(prev.data.preview, true);
    assert.match(prev.data.subject, /your weekly report/);
    assert.strictEqual(digestsEngine().getConfig(setup.businessId).lastSentWeek, "", "preview must not mark the week as sent");

    const m = stubMailer();
    try {
        const run = await api(server.baseUrl, "POST", `${base}/digest/run`, { token: setup.adminToken });
        assert.strictEqual(run.status, 200);
        assert.strictEqual(run.data.sent, true);
        assert.strictEqual(m.captured.length, 1);
        assert.notStrictEqual(digestsEngine().getConfig(setup.businessId).lastSentWeek, "");
    } finally {
        m.restore();
    }

    const bad = await api(server.baseUrl, "PUT", `${base}/digest-config`, {
        token: setup.adminToken,
        body: { email: "not-an-email" },
    });
    assert.strictEqual(bad.status, 400);
});

test("portal: digest-settings gated by founder flag; owner manages their own address", async (t) => {
    const server = await startServer();
    t.after(() => server.close());

    const reg = await api(server.baseUrl, "POST", "/api/admin/auth/register", {
        body: { email: `sa-${Date.now()}@test.io`, password: "super-secret-8" },
    });
    const adminTok = reg.data.accessToken;
    const biz = (
        await api(server.baseUrl, "POST", "/api/admin/businesses", { token: adminTok, body: { businessName: "G" } })
    ).data;

    const pu = await api(server.baseUrl, "POST", `/api/admin/businesses/${biz.business.businessId}/portal-users`, {
        token: adminTok,
        body: { email: "owner@g.io", password: "portal-pass-8" },
    });
    assert.strictEqual(pu.status, 201);

    const login = await api(server.baseUrl, "POST", "/api/portal/auth/login", {
        body: { email: "owner@g.io", password: "portal-pass-8" },
    });
    assert.strictEqual(login.status, 200);
    const tok = login.data.token;

    const denied = await api(server.baseUrl, "GET", "/api/portal/digest-settings", { token: tok });
    assert.strictEqual(denied.status, 403);
    assert.strictEqual(denied.data.error.code, "feature_disabled");

    const feat = await api(server.baseUrl, "PUT", `/api/admin/businesses/${biz.business.businessId}/features`, {
        token: adminTok,
        body: { weekly_digest: true },
    });
    assert.strictEqual(feat.status, 200);

    const view = await api(server.baseUrl, "GET", "/api/portal/digest-settings", { token: tok });
    assert.strictEqual(view.status, 200);
    assert.strictEqual(view.data.enabled, true);

    const set = await api(server.baseUrl, "PUT", "/api/portal/digest-settings", {
        token: tok,
        body: { email: "Me@G.io" },
    });
    assert.strictEqual(set.status, 200);
    assert.strictEqual(set.data.email, "me@g.io");

    const invalid = await api(server.baseUrl, "PUT", "/api/portal/digest-settings", {
        token: tok,
        body: { email: "definitely-not-an-email" },
    });
    assert.strictEqual(invalid.status, 400);
});
