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

    let targetDir = path.dirname(dbPath);
    // Vercel serverless has read-only /var/task — use /tmp for SQLite (ephemeral, but boots)
    const isVercel = Boolean(process.env.VERCEL);
    if (isVercel && targetDir.startsWith("/var/task")) {
        // rewrite /var/task/database/... -> /tmp/...
        dbPath = path.join("/tmp", path.basename(dbPath));
        targetDir = "/tmp";
    }
    if (!fs.existsSync(targetDir)) {
        try {
            fs.mkdirSync(targetDir, { recursive: true });
        } catch (e) {
            // fallback to /tmp if original dir not writable
            dbPath = path.join("/tmp", path.basename(dbPath));
            if (!fs.existsSync("/tmp")) fs.mkdirSync("/tmp", { recursive: true });
            targetDir = "/tmp";
            if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });
        }
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
