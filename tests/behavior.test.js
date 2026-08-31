"use strict";

const test = require("node:test");
const assert = require("node:assert");
const { startServer, api, setupBusiness } = require("./helpers");

test("behavior: save and list events", async (t) => {
    const server = await startServer();
    t.after(() => server.close());
    const setup = await setupBusiness(server.baseUrl);

    const saved = await api(server.baseUrl, "POST", "/api/v1/behavior", {
        key: setup.integrationKey,
        body: { customerId: "cust-b1", eventType: "product_view", eventData: { productId: "shoe-9", price: 99 } },
    });
    assert.strictEqual(saved.status, 201);
    assert.ok(saved.data.eventId);
    assert.strictEqual(saved.data.eventType, "product_view");

    const list = await api(server.baseUrl, "GET", "/api/v1/behavior?customerId=cust-b1", { key: setup.integrationKey });
    assert.strictEqual(list.data.events.length, 1);
    assert.strictEqual(list.data.events[0].eventData.productId, "shoe-9");
});

test("behavior: unsupported event type rejected", async (t) => {
    const server = await startServer();
    t.after(() => server.close());
    const setup = await setupBusiness(server.baseUrl);

    const response = await api(server.baseUrl, "POST", "/api/v1/behavior", {
        key: setup.integrationKey,
        body: { customerId: "cust-b2", eventType: "sneaky_event" },
    });
    assert.strictEqual(response.status, 400);
    assert.strictEqual(response.data.error.code, "unsupported_event");
});

test("behavior: disabled event type is not stored", async (t) => {
    const server = await startServer();
    t.after(() => server.close());
    const setup = await setupBusiness(server.baseUrl);

    await api(server.baseUrl, "PUT", "/api/v1/config", {
        key: setup.integrationKey,
        body: { behavior: { events: { page_view: { enabled: false } } } },
    });

    const result = await api(server.baseUrl, "POST", "/api/v1/behavior", {
        key: setup.integrationKey,
        body: { customerId: "cust-b3", eventType: "page_view" },
    });
    assert.strictEqual(result.status, 200);
    assert.strictEqual(result.data.saved, false);

    // other events still work
    const ok = await api(server.baseUrl, "POST", "/api/v1/behavior", {
        key: setup.integrationKey,
        body: { customerId: "cust-b3", eventType: "purchase", eventData: { total: 10 } },
    });
    assert.strictEqual(ok.data.saved, true);
});

test("behavior: retention expiry removes events from retrieval", async (t) => {
    const server = await startServer();
    t.after(() => server.close());
    const setup = await setupBusiness(server.baseUrl);

    await api(server.baseUrl, "POST", "/api/v1/behavior", {
        key: setup.integrationKey,
        body: { customerId: "cust-b4", eventType: "cart", eventData: { productId: "old-1" } },
    });

    // Force-expire all events for this customer directly in the DB.
    server.db.get().prepare(
        `UPDATE behavioral_events SET expires_at = ? WHERE business_id = ? AND customer_id = ?`
    ).run(Date.now() - 1000, setup.businessId, "cust-b4");

    const list = await api(server.baseUrl, "GET", "/api/v1/behavior?customerId=cust-b4", { key: setup.integrationKey });
    assert.deepStrictEqual(list.data.events, []);
});

test("behavior: delete single and all", async (t) => {
    const server = await startServer();
    t.after(() => server.close());
    const setup = await setupBusiness(server.baseUrl);

    const e1 = await api(server.baseUrl, "POST", "/api/v1/behavior", {
        key: setup.integrationKey,
        body: { customerId: "cust-b5", eventType: "search", eventData: { query: "shoes" } },
    });
    await api(server.baseUrl, "POST", "/api/v1/behavior", {
        key: setup.integrationKey,
        body: { customerId: "cust-b5", eventType: "wishlist", eventData: { productId: "x" } },
    });

    const delOne = await api(server.baseUrl, "DELETE", `/api/v1/customers/cust-b5/behavior/${e1.data.eventId}`, { key: setup.integrationKey });
    assert.strictEqual(delOne.data.deleted, true);

    const delAll = await api(server.baseUrl, "DELETE", "/api/v1/customers/cust-b5/behavior", { key: setup.integrationKey });
    assert.ok(delAll.data.deleted >= 1);

    const list = await api(server.baseUrl, "GET", "/api/v1/behavior?customerId=cust-b5", { key: setup.integrationKey });
    assert.strictEqual(list.data.events.length, 0);
});
