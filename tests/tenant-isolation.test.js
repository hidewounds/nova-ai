"use strict";

const test = require("node:test");
const assert = require("node:assert");
const { startServer, api, setupBusiness } = require("./helpers");

async function setupTwoBusinesses(server) {
    const a = await setupBusiness(server.baseUrl, { name: "Tenant A" });
    // Second business must be created via the first super-admin's token — isolated temp DB allows only one super-admin registration
    const bRaw = await api(server.baseUrl, "POST", "/api/admin/businesses", {
        token: a.adminToken,
        body: { businessName: "Tenant B" },
    });
    assert.strictEqual(bRaw.status, 201, "second business creation must succeed via super-admin token");
    const b = {
        businessId: bRaw.data.business.businessId,
        integrationKey: bRaw.data.integrationKey,
        config: bRaw.data.config,
        adminToken: a.adminToken,
    };
    return { a, b };
}

test("tenant isolation: memories never cross businesses", async (t) => {
    const server = await startServer();
    t.after(() => server.close());
    const { a, b } = await setupTwoBusinesses(server);

    // Store a memory for tenant A's customer.
    await api(server.baseUrl, "POST", "/api/v1/chat", {
        key: a.integrationKey,
        body: { customer: { id: "cust-shared" }, messages: [{ role: "user", content: "my name is Alice TenantA" }] },
    });

    const memoriesA = await api(server.baseUrl, "GET", "/api/v1/customers/cust-shared/memories", { key: a.integrationKey });
    assert.strictEqual(memoriesA.status, 200);
    assert.ok(memoriesA.data.memories.some((m) => m.memory_key === "name"));

    // Same customer id, different business -> no data.
    const memoriesB = await api(server.baseUrl, "GET", "/api/v1/customers/cust-shared/memories", { key: b.integrationKey });
    assert.strictEqual(memoriesB.status, 200);
    assert.deepStrictEqual(memoriesB.data.memories, []);
});

test("tenant isolation: behavior events never cross businesses", async (t) => {
    const server = await startServer();
    t.after(() => server.close());
    const { a, b } = await setupTwoBusinesses(server);

    await api(server.baseUrl, "POST", "/api/v1/behavior", {
        key: a.integrationKey,
        body: { customerId: "cust-x", eventType: "product_view", eventData: { productId: "p1" } },
    });

    const eventsA = await api(server.baseUrl, "GET", "/api/v1/behavior?customerId=cust-x", { key: a.integrationKey });
    assert.strictEqual(eventsA.data.events.length, 1);

    const eventsB = await api(server.baseUrl, "GET", "/api/v1/behavior?customerId=cust-x", { key: b.integrationKey });
    assert.strictEqual(eventsB.data.events.length, 0);
});

test("tenant isolation: customer profiles never cross businesses", async (t) => {
    const server = await startServer();
    t.after(() => server.close());
    const { a, b } = await setupTwoBusinesses(server);

    await api(server.baseUrl, "POST", "/api/v1/chat", {
        key: a.integrationKey,
        body: { customer: { id: "cust-y", name: "Yan" }, messages: [{ role: "user", content: "hello" }] },
    });

    const profileB = await api(server.baseUrl, "GET", "/api/v1/customers/cust-y", { key: b.integrationKey });
    assert.strictEqual(profileB.status, 404);

    const profileA = await api(server.baseUrl, "GET", "/api/v1/customers/cust-y", { key: a.integrationKey });
    assert.strictEqual(profileA.status, 200);
    assert.strictEqual(profileA.data.customer.name, "Yan");
});

test("tenant isolation: deleting a customer in A does not affect B", async (t) => {
    const server = await startServer();
    t.after(() => server.close());
    const { a, b } = await setupTwoBusinesses(server);

    for (const tenant of [a, b]) {
        await api(server.baseUrl, "POST", "/api/v1/chat", {
            key: tenant.integrationKey,
            body: { customer: { id: "cust-del" }, messages: [{ role: "user", content: "my location is Berlin" }] },
        });
    }

    await api(server.baseUrl, "DELETE", "/api/v1/customers/cust-del", { key: a.integrationKey });

    const afterA = await api(server.baseUrl, "GET", "/api/v1/customers/cust-del/memories", { key: a.integrationKey });
    const afterB = await api(server.baseUrl, "GET", "/api/v1/customers/cust-del/memories", { key: b.integrationKey });

    assert.strictEqual(afterA.data.memories.length, 0);
    assert.ok(afterB.data.memories.length > 0);
});
