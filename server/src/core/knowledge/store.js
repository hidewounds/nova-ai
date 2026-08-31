"use strict";

/**
 * Business knowledge store with hybrid keyword + vector retrieval.
 * The retrieval interface (search by query, ranked results) is
 * vector-store-shaped so a RAG backend can replace the scorer later.
 */

const db = require("../../db").get;
const { randomId } = require("../../lib/crypto");
const { badRequest, notFound } = require("../../lib/errors");
const { normalizeBusinessId } = require("../config/service");
const { clampText } = require("../../lib/tokens");
const embeddings = require("./embeddings");

const KNOWLEDGE_TYPES = new Set(["faq", "policy", "product", "info", "document"]);

function tokenize(text = "") {
    return String(text)
        .toLowerCase()
        .replace(/[^\p{L}\p{N}_\s-]/gu, " ")
        .split(/\s+/)
        .filter((word) => word.length >= 2);
}

function createKnowledgeItem({ businessId, title, knowledgeType = "faq", content, metadata = {} }) {
    const business = normalizeBusinessId(businessId);
    const cleanTitle = clampText(title, 200);
    const cleanContent = clampText(content, 20_000);
    const type = KNOWLEDGE_TYPES.has(knowledgeType) ? knowledgeType : "faq";

    if (!cleanContent) throw badRequest("Knowledge content is required.");
    if (!cleanTitle) throw badRequest("Knowledge title is required.");

    const knowledgeId = randomId("knw", 10);
    const timestamp = Date.now();

    let metadataJson = "{}";
    try {
        metadataJson = JSON.stringify(metadata && typeof metadata === "object" && !Array.isArray(metadata) ? metadata : {});
        if (metadataJson.length > 4000) metadataJson = "{}";
    } catch {
        metadataJson = "{}";
    }

    db()
        .prepare(
            `INSERT INTO business_knowledge (knowledge_id, business_id, title, knowledge_type, content, metadata_json, active, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`
        )
        .run(knowledgeId, business, cleanTitle, type, cleanContent, metadataJson, timestamp, timestamp);

    // Generate embeddings asynchronously (non-blocking)
    embeddings.embedKnowledgeItem(business, knowledgeId, cleanContent, cleanTitle).catch(() => {});

    return getKnowledgeItem(business, knowledgeId);
}

function getKnowledgeItem(businessId, knowledgeId) {
    return (
        db()
            .prepare(
                `SELECT id, knowledge_id, business_id, title, knowledge_type, content, metadata_json, active, created_at, updated_at
                 FROM business_knowledge
                 WHERE business_id = ? AND knowledge_id = ?
                 LIMIT 1`
            )
            .get(normalizeBusinessId(businessId), String(knowledgeId || "")) || null
    );
}

function listKnowledge(businessId, { includeInactive = false, limit = 50, offset = 0 } = {}) {
    const safeLimit = Math.max(1, Math.min(Number(limit) || 50, 200));
    const safeOffset = Math.max(0, Number(offset) || 0);
    const where = includeInactive ? "" : "AND active = 1";
    const rows = db()
        .prepare(
            `SELECT id, knowledge_id, business_id, title, knowledge_type, content, metadata_json, active, created_at, updated_at
             FROM business_knowledge
             WHERE business_id = ? ${where}
             ORDER BY updated_at DESC
             LIMIT ? OFFSET ?`
        )
        .all(normalizeBusinessId(businessId), safeLimit, safeOffset);
    
    const total = db()
        .prepare(`SELECT COUNT(*) AS n FROM business_knowledge WHERE business_id = ? ${where}`)
        .get(normalizeBusinessId(businessId)).n;
    
    return { items: includeInactive ? rows : rows.filter((row) => row.active), total, limit: safeLimit, offset: safeOffset };
}

function updateKnowledgeItem(businessId, knowledgeId, patch = {}) {
    const existing = getKnowledgeItem(businessId, knowledgeId);
    if (!existing) throw notFound("Knowledge item not found.");

    const updates = {};
    if (patch.title !== undefined) updates.title = clampText(patch.title, 200) || existing.title;
    if (patch.knowledgeType !== undefined && KNOWLEDGE_TYPES.has(patch.knowledgeType)) {
        updates.knowledge_type = patch.knowledgeType;
    }
    if (patch.content !== undefined) {
        const content = clampText(patch.content, 20_000);
        if (!content) throw badRequest("Knowledge content cannot be empty.");
        updates.content = content;
    }
    if (patch.active !== undefined) updates.active = patch.active ? 1 : 0;

    if (Object.keys(updates).length === 0) return existing;

    db()
        .prepare(
            `UPDATE business_knowledge
             SET title = COALESCE(?, title),
                 knowledge_type = COALESCE(?, knowledge_type),
                 content = COALESCE(?, content),
                 active = COALESCE(?, active),
                 updated_at = ?
             WHERE business_id = ? AND knowledge_id = ?`
        )
        .run(
            updates.title ?? null,
            updates.knowledge_type ?? null,
            updates.content ?? null,
            updates.active ?? null,
            Date.now(),
            normalizeBusinessId(businessId),
            String(knowledgeId)
        );

    // Re-embed if content changed
    if (updates.content || updates.title) {
        const embeddings = require("./embeddings");
        embeddings.deleteKnowledgeEmbeddings(businessId, knowledgeId).then(() => {
            const finalTitle = updates.title ?? existing.title;
            const finalContent = updates.content ?? existing.content;
            embeddings.embedKnowledgeItem(businessId, knowledgeId, finalContent, finalTitle).catch(() => {});
        }).catch(() => {});
    }

    return getKnowledgeItem(businessId, knowledgeId);
}

function deleteKnowledgeItem(businessId, knowledgeId) {
    const embeddings = require("./embeddings");
    embeddings.deleteKnowledgeEmbeddings(businessId, knowledgeId).catch(() => {});
    
    const result = db()
        .prepare(`DELETE FROM business_knowledge WHERE business_id = ? AND knowledge_id = ?`)
        .run(normalizeBusinessId(businessId), String(knowledgeId || ""));
    return result.changes > 0;
}

/**
 * Keyword-relevance retrieval over active knowledge for one business.
 * Returns top-N items scored against the query. Performs light
 * plural-stemming so "returns" matches "return".
 */
function searchKnowledge(businessId, query, limit = 4) {
    const result = listKnowledge(businessId);
    const items = Array.isArray(result) ? result : (result.items || []);
    if (!items.length) return [];

    const rawWords = [...new Set(tokenize(query))];
    if (rawWords.length === 0) return [];

    // Expand with simple stems to tolerate plural/singular differences.
    const words = new Set();
    for (const word of rawWords) {
        words.add(word);
        if (word.endsWith("ies") && word.length > 4) words.add(word.slice(0, -3) + "y");
        else if (word.endsWith("es") && word.length > 3) words.add(word.slice(0, -2));
        else if (word.endsWith("s") && word.length > 2) words.add(word.slice(0, -1));
    }

    const scored = [];
    for (const item of items) {
        const titleWords = new Set(tokenize(item.title));
        const contentLower = String(item.content).toLowerCase();
        let score = 0;

        for (const word of words) {
            if (titleWords.has(word)) score += 6;
            else if (contentLower.includes(word)) score += 3;
        }

        if (score > 0) scored.push({ ...item, relevanceScore: score });
    }

    scored.sort((a, b) => b.relevanceScore - a.relevanceScore || b.updated_at - a.updated_at);
    return scored.slice(0, Math.max(1, Math.min(Number(limit) || 4, 12)));
}

/** Hybrid search: keyword + vector with RRF fusion. */
async function hybridSearchKnowledge(businessId, query, limit = 4) {
    try {
        const embeddings = require("./embeddings");
        return await embeddings.hybridSearchKnowledge(businessId, query, { limit });
    } catch {
        // Fallback to keyword-only if embeddings unavailable
        return searchKnowledge(businessId, query, limit);
    }
}

module.exports = {
    KNOWLEDGE_TYPES,
    tokenize,
    createKnowledgeItem,
    getKnowledgeItem,
    listKnowledge,
    updateKnowledgeItem,
    deleteKnowledgeItem,
    searchKnowledge,
    hybridSearchKnowledge,
};