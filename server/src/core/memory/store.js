"use strict";

/**
 * Canonical customer memory store. Business-scoped and customer-scoped.
 * Memories carry: category, confidence, source, origin (explicit|inferred).
 */

const db = require("../../db").get;
const { randomId } = require("../../lib/crypto");
const { clampText } = require("../../lib/tokens");
const { normalizeBusinessId } = require("../config/service");
const embeddings = require("./embeddings");

const MAX_VALUE_LENGTH = 1000;
const MAX_KEY_LENGTH = 150;

function normalizeCustomerId(customerId) {
    const value = String(customerId || "").trim().slice(0, 150);
    if (!value) throw new Error("Customer ID is required.");
    return value;
}

function normalizeKey(key) {
    const value =
        String(key || "")
            .trim()
            .toLowerCase()
            .replace(/\s+/g, "_")
            .slice(0, MAX_KEY_LENGTH);
    if (!value) throw new Error("Memory key is required.");
    return value;
}

function cleanValue(value) {
    return String(value ?? "")
        .trim()
        .replace(/\s+/g, " ")
        .slice(0, MAX_VALUE_LENGTH);
}

function getMemory(businessId, customerId, key) {
    return (
        db()
            .prepare(
                `SELECT id, memory_uid, business_id, customer_id, category, memory_key, memory_value,
                        confidence, source, origin, created_at, updated_at
                 FROM memories
                 WHERE business_id = ? AND customer_id = ? AND memory_key = ?
                 LIMIT 1`
            )
            .get(normalizeBusinessId(businessId), normalizeCustomerId(customerId), normalizeKey(key)) || null
    );
}

function listMemories(businessId, customerId, limit = 500) {
    const safeLimit = Math.max(1, Math.min(Number(limit) || 500, 1000));
    return db()
        .prepare(
            `SELECT id, memory_uid, business_id, customer_id, category, memory_key, memory_value,
                    confidence, source, origin, created_at, updated_at
             FROM memories
             WHERE business_id = ? AND customer_id = ?
             ORDER BY updated_at DESC
             LIMIT ?`
        )
        .all(normalizeBusinessId(businessId), normalizeCustomerId(customerId), safeLimit);
}

/**
 * Save or update a memory. Returns { saved, changed, memory }.
 * `origin` distinguishes explicit user statements from inferred ones.
 */
function saveMemory({
    businessId,
    customerId,
    key,
    value,
    category = "stable",
    confidence = 1,
    source = "chat",
    origin = "explicit",
}) {
    const business = normalizeBusinessId(businessId);
    const customer = normalizeCustomerId(customerId);
    const memoryKey = normalizeKey(key);
    const memoryValue = cleanValue(value);

    if (!memoryValue) {
        return { saved: false, reason: "empty_value" };
    }

    const safeConfidence = Math.max(0, Math.min(Number(confidence) || 0, 1));
    const safeCategory = String(category || "stable").trim().toLowerCase().slice(0, 50) || "stable";
    const safeSource = String(source || "chat").trim().toLowerCase().slice(0, 50) || "chat";
    const safeOrigin = origin === "inferred" ? "inferred" : "explicit";
    const timestamp = Date.now();

    const existing = getMemory(business, customer, memoryKey);

    if (existing) {
        const changed = existing.memory_value !== memoryValue;
        db()
            .prepare(
                `UPDATE memories
                 SET memory_value = ?, category = ?, confidence = ?, source = ?, origin = ?, updated_at = ?
                 WHERE id = ?`
            )
            .run(memoryValue, safeCategory, safeConfidence, safeSource, safeOrigin, timestamp, existing.id);
        cleanupMemories(business, customer);
        
        // Re-embed if value changed
        if (changed) {
            embeddings.deleteMemoryEmbeddings(business, customer, existing.memory_uid).catch(() => {});
            embeddings.embedMemory(business, customer, existing.memory_uid, memoryKey, memoryValue).catch(() => {});
        }
        
        return {
            saved: true,
            updated: true,
            changed,
            action: changed ? "updated" : "unchanged",
            memory: getMemory(business, customer, memoryKey),
        };
    }

    const result = db()
        .prepare(
            `INSERT INTO memories (memory_uid, business_id, customer_id, category, memory_key, memory_value,
                                   confidence, source, origin, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(randomId("mem"), business, customer, safeCategory, memoryKey, memoryValue, safeConfidence, safeSource, safeOrigin, timestamp, timestamp);

    const newMemory = db().prepare("SELECT * FROM memories WHERE id = ?").get(result.lastInsertRowid);
    cleanupMemories(business, customer);
    
    // Generate embedding for new memory
    embeddings.embedMemory(business, customer, newMemory.memory_uid, memoryKey, memoryValue).catch(() => {});
    
    return {
        saved: true,
        updated: false,
        changed: true,
        action: "created",
        memory: newMemory,
    };
}

/** Keep only the N most recently updated memories per customer. */
function cleanupMemories(businessId, customerId, maxMemories = 50) {
    const rows = db()
        .prepare(
            `SELECT id FROM memories WHERE business_id = ? AND customer_id = ? ORDER BY updated_at DESC`
        )
        .all(normalizeBusinessId(businessId), normalizeCustomerId(customerId));

    if (rows.length <= maxMemories) return 0;

    const excess = rows.slice(maxMemories);
    const statement = db().prepare("DELETE FROM memories WHERE id = ?");
    let deleted = 0;
    for (const row of excess) {
        deleted += statement.run(row.id).changes;
    }
    return deleted;
}

function deleteMemory(businessId, customerId, key) {
    try {
        const memory = getMemory(businessId, customerId, key);
        if (memory) {
            embeddings.deleteMemoryEmbeddings(businessId, customerId, memory.memory_uid).catch(() => {});
        }
        const result = db()
            .prepare(`DELETE FROM memories WHERE business_id = ? AND customer_id = ? AND memory_key = ?`)
            .run(normalizeBusinessId(businessId), normalizeCustomerId(customerId), normalizeKey(key));
        return result.changes > 0;
    } catch {
        return false;
    }
}

function deleteAllMemories(businessId, customerId) {
    // Get all memories to delete their embeddings
    const memories = listMemories(businessId, customerId, 10000);
    for (const mem of memories) {
        embeddings.deleteMemoryEmbeddings(businessId, customerId, mem.memory_uid).catch(() => {});
    }
    return db()
        .prepare(`DELETE FROM memories WHERE business_id = ? AND customer_id = ?`)
        .run(normalizeBusinessId(businessId), normalizeCustomerId(customerId)).changes;
}

module.exports = {
    normalizeCustomerId,
    cleanValue,
    getMemory,
    listMemories,
    saveMemory,
    deleteMemory,
    deleteAllMemories,
    cleanupMemories,
    hybridSearchMemories: embeddings.hybridSearchMemories,
};
