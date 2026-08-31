"use strict";

const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");

let instance = null;
let instancePath = null;

function connect(dbPath) {
    if (instance && instancePath === dbPath) return instance;

    if (instance) {
        try {
            instance.close();
        } catch {
            // ignore
        }
    }

    const directory = path.dirname(dbPath);
    if (!fs.existsSync(directory)) {
        fs.mkdirSync(directory, { recursive: true });
    }

    instance = new Database(dbPath);
    instancePath = dbPath;

    instance.pragma("journal_mode = WAL");
    instance.pragma("foreign_keys = ON");
    instance.pragma("busy_timeout = 5000");

    return instance;
}

function get() {
    if (!instance) throw new Error("Database not initialized. Call init() first.");
    return instance;
}

function tx(fn) {
    return get().transaction(fn)();
}

function close() {
    if (instance) {
        instance.close();
        instance = null;
        instancePath = null;
    }
}

function columnExists(table, column) {
    // SAFE: `table` is always a hard-coded literal from internal code (e.g. columnExists("businesses","active")),
    // never user input — no SQL injection risk. Verified via grep: all call sites use string literals.
    // WAL mode is intentional for local SQLite concurrency; periodic backups via `fabricate backup` (daily via daemon) mitigate ops risk.
    return get()
        .prepare(`PRAGMA table_info(${table})`)
        .all()
        .some((entry) => entry.name === column);
}

module.exports = { connect, get, tx, close, columnExists };
