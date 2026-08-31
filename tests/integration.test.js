"use strict";

const test = require("node:test");
const assert = require("node:assert");
const { startServer, api, setupBusiness } = require("./helpers");

test("admin provisioning: new admin cannot access another admin's business", async (t) => {
    const server = await startServer();
    t.after(() => server.close());

    // First (super) admin creates business.
    const superSetup = await setupBusiness(server.baseUrl, { name: "Super Biz" });

    // Second admin registers via super-admin — NOT a super admin, no access grants.
    const otherAdmin = await api(server.baseUrl, "POST", "/api/admin/auth/register", {
        token: superSetup.adminToken,
        body: { email: `other-${Date.now()}@test.io`, password: "other-password" },
    });
    assert.strictEqual(otherAdmin.status, 201);

    const peek = await api(server.baseUrl, "GET", `/api/admin/businesses/${superSetup.businessId}`, {
        token: otherAdmin.data.accessToken,
    });
    assert.strictEqual(peek.status, 403);

    const list = await api(server.baseUrl, "GET", "/api/admin/businesses", { token: otherAdmin.data.accessToken });
    assert.deepStrictEqual(list.data.businesses, []);
});

test("widget: config and chat endpoints work with public key", async (t) => {
    const server = await startServer();
    t.after(() => server.close());
    const setup = await setupBusiness(server.baseUrl);

    const config = await api(server.baseUrl, "GET", "/api/v1/widget/config", { key: setup.integrationKey });
    assert.strictEqual(config.status, 200);
    assert.ok(config.data.config.assistantName);
    assert.ok(!config.data.config.model, "no model internals exposed");
    assert.ok(!config.data.config.memory, "no memory config exposed");

    const chat = await api(server.baseUrl, "POST", "/api/v1/widget/chat", {
        key: setup.integrationKey,
        body: { customerId: "visitor-1", messages: [{ role: "user", content: "hello widget" }] },
    });
    assert.strictEqual(chat.status, 200);
    assert.ok(chat.data.reply.length > 0);
});

test("widget: disabled widget blocks access", async (t) => {
    const server = await startServer();
    t.after(() => server.close());
    const setup = await setupBusiness(server.baseUrl);

    await api(server.baseUrl, "PUT", "/api/v1/config", {
        key: setup.integrationKey,
        body: { security: { widgetEnabled: false } },
    });

    const config = await api(server.baseUrl, "GET", "/api/v1/widget/config", { key: setup.integrationKey });
    assert.strictEqual(config.status, 401);
});

test("key rotation invalidates the old key immediately", async (t) => {
    const server = await startServer();
    t.after(() => server.close());
    const setup = await setupBusiness(server.baseUrl);

    const rotated = await api(server.baseUrl, "POST", "/api/v1/business/rotate-key", { key: setup.integrationKey });
    assert.strictEqual(rotated.status, 200);
    const newKey = rotated.data.integrationKey;
    assert.notStrictEqual(newKey, setup.integrationKey);

    const oldKeyWorks = await api(server.baseUrl, "GET", "/api/v1/business", { key: setup.integrationKey });
    assert.strictEqual(oldKeyWorks.status, 401);

    const newKeyWorks = await api(server.baseUrl, "GET", "/api/v1/business", { key: newKey });
    assert.strictEqual(newKeyWorks.status, 200);
});

test("deactivating a business blocks all integration traffic", async (t) => {
    const server = await startServer();
    t.after(() => server.close());
    const setup = await setupBusiness(server.baseUrl);

    await api(server.baseUrl, "PATCH", "/api/v1/business", {
        key: setup.integrationKey,
        body: { active: false },
    });

    const blocked = await api(server.baseUrl, "GET", "/api/v1/business", { key: setup.integrationKey });
    assert.strictEqual(blocked.status, 401);

    const chatBlocked = await api(server.baseUrl, "POST", "/api/v1/chat", {
        key: setup.integrationKey,
        body: { customer: { id: "c" }, messages: [{ role: "user", content: "hi" }] },
    });
    assert.strictEqual(chatBlocked.status, 401);
});
