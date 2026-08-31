"use strict";

const test = require("node:test");
const assert = require("node:assert");
const { startServer, api, setupBusiness } = require("./helpers");

test("memory: explicit extraction from chat", async (t) => {
    const server = await startServer();
    t.after(() => server.close());
    const setup = await setupBusiness(server.baseUrl);

    const chat = await api(server.baseUrl, "POST", "/api/v1/chat", {
        key: setup.integrationKey,
        body: {
            customer: { id: "cust-mem", name: "Mem Tester" },
            messages: [{ role: "user", content: "Hi! My name is Alex and I live in Berlin." }],
        },
    });
    assert.strictEqual(chat.status, 200);
    assert.ok(chat.data.memoryOperations.some((op) => op.key === "name" && op.action === "created"));
    assert.ok(chat.data.memoryOperations.some((op) => op.key === "location" && op.action === "created"));

    const memories = await api(server.baseUrl, "GET", "/api/v1/customers/cust-mem/memories", { key: setup.integrationKey });
    const byKey = Object.fromEntries(memories.data.memories.map((m) => [m.memory_key, m]));
    assert.strictEqual(byKey.name.memory_value, "Alex");
    assert.strictEqual(byKey.location.memory_value, "Berlin");
    assert.strictEqual(byKey.name.origin, "explicit");
});

test("memory: forget command deletes reliably", async (t) => {
    const server = await startServer();
    t.after(() => server.close());
    const setup = await setupBusiness(server.baseUrl);

    await api(server.baseUrl, "POST", "/api/v1/chat", {
        key: setup.integrationKey,
        body: { customer: { id: "cust-forget" }, messages: [{ role: "user", content: "my shoe size is 42" }] },
    });
    let memories = await api(server.baseUrl, "GET", "/api/v1/customers/cust-forget/memories", { key: setup.integrationKey });
    assert.ok(memories.data.memories.some((m) => m.memory_key === "shoe_size"));

    await api(server.baseUrl, "POST", "/api/v1/chat", {
        key: setup.integrationKey,
        body: { customer: { id: "cust-forget" }, messages: [{ role: "user", content: "forget my shoe size" }] },
    });

    memories = await api(server.baseUrl, "GET", "/api/v1/customers/cust-forget/memories", { key: setup.integrationKey });
    assert.strictEqual(memories.data.memories.some((m) => m.memory_key === "shoe_size"), false);
});

test("memory: remember command stores user-requested fact", async (t) => {
    const server = await startServer();
    t.after(() => server.close());
    const setup = await setupBusiness(server.baseUrl);

    await api(server.baseUrl, "POST", "/api/v1/chat", {
        key: setup.integrationKey,
        body: {
            customer: { id: "cust-remember" },
            messages: [{ role: "user", content: "remember that my favorite team is FC Novaria" }],
        },
    });

    const memories = await api(server.baseUrl, "GET", "/api/v1/customers/cust-remember/memories", { key: setup.integrationKey });
    const favorite = memories.data.memories.find((m) => m.memory_key === "favorite_team");
    assert.ok(favorite, "requested memory should exist");
    assert.strictEqual(favorite.source, "user_request");
    assert.strictEqual(favorite.origin, "explicit");
});

test("memory: disabled memory config prevents storage", async (t) => {
    const server = await startServer();
    t.after(() => server.close());
    const setup = await setupBusiness(server.baseUrl);

    await api(server.baseUrl, "PUT", "/api/v1/config", {
        key: setup.integrationKey,
        body: { memory: { enabled: false } },
    });

    await api(server.baseUrl, "POST", "/api/v1/chat", {
        key: setup.integrationKey,
        body: { customer: { id: "cust-disabled" }, messages: [{ role: "user", content: "my name should not be stored, my name is Ghost" }] },
    });

    const memories = await api(server.baseUrl, "GET", "/api/v1/customers/cust-disabled/memories", { key: setup.integrationKey });
    assert.deepStrictEqual(memories.data.memories, []);
});

test("memory: deletion endpoints work", async (t) => {
    const server = await startServer();
    t.after(() => server.close());
    const setup = await setupBusiness(server.baseUrl);

    for (const text of ["my name is Dana", "my location is Oslo"]) {
        await api(server.baseUrl, "POST", "/api/v1/chat", {
            key: setup.integrationKey,
            body: { customer: { id: "cust-delmem" }, messages: [{ role: "user", content: text }] },
        });
    }

    // delete one
    const one = await api(server.baseUrl, "DELETE", "/api/v1/customers/cust-delmem/memories/name", { key: setup.integrationKey });
    assert.strictEqual(one.data.deleted, true);

    let memories = await api(server.baseUrl, "GET", "/api/v1/customers/cust-delmem/memories", { key: setup.integrationKey });
    assert.strictEqual(memories.data.memories.length, 1);

    // delete all
    const all = await api(server.baseUrl, "DELETE", "/api/v1/customers/cust-delmem/memories", { key: setup.integrationKey });
    assert.ok(all.data.deleted >= 1);

    memories = await api(server.baseUrl, "GET", "/api/v1/customers/cust-delmem/memories", { key: setup.integrationKey });
    assert.strictEqual(memories.data.memories.length, 0);
});
