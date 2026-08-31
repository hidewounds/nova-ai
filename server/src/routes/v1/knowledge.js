"use strict";

const express = require("express");
const { authenticateIntegration, requireScope } = require("../../auth/integration");
const knowledge = require("../../core/knowledge/store");
const audit = require("../../core/audit/store");
const { badRequest } = require("../../lib/errors");

const router = express.Router();

router.use(authenticateIntegration);

router.get("/knowledge", requireScope("knowledge:read"), (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const offset = Math.max(Number(req.query.offset) || 0, 0);
    const result = knowledge.listKnowledge(req.nova.businessId, { includeInactive: req.query.includeInactive === "true", limit, offset });
    // listKnowledge returns {items, total, limit, offset} — return flat shape for clients
    if (result && Array.isArray(result.items)) {
        res.json({ items: result.items, total: result.total, limit: result.limit, offset: result.offset });
    } else if (Array.isArray(result)) {
        res.json({ items: result, total: result.length });
    } else {
        res.json({ items: [], total: 0 });
    }
});

router.post("/knowledge", requireScope("knowledge:write"), (req, res, next) => {
    try {
        const body = req.body || {};
        const item = knowledge.createKnowledgeItem({
            businessId: req.nova.businessId,
            title: body.title,
            knowledgeType: body.knowledgeType || body.type || "faq",
            content: body.content,
            metadata: body.metadata,
        });
        audit.record({
            businessId: req.nova.businessId,
            actorType: "integration",
            action: "knowledge.created",
            detail: { knowledgeId: item.knowledge_id },
            ip: req.ip,
        });
        res.status(201).json({ item });
    } catch (error) {
        next(error);
    }
});

router.patch("/knowledge/:knowledgeId", requireScope("knowledge:write"), (req, res, next) => {
    try {
        const item = knowledge.updateKnowledgeItem(req.nova.businessId, req.params.knowledgeId, req.body || {});
        res.json({ item });
    } catch (error) {
        next(error);
    }
});

router.delete("/knowledge/:knowledgeId", requireScope("knowledge:write"), (req, res, next) => {
    try {
        const deleted = knowledge.deleteKnowledgeItem(req.nova.businessId, req.params.knowledgeId);
        if (!deleted) throw badRequest("Knowledge item not found.");
        res.json({ deleted: true });
    } catch (error) {
        next(error);
    }
});

router.post("/knowledge/search", requireScope("knowledge:read"), (req, res, next) => {
    try {
        const query = String((req.body || {}).query || "").trim();
        if (!query) throw badRequest("query is required.");
        const limit = Math.min(Number((req.body || {}).limit) || 4, 12);
        res.json({ items: knowledge.searchKnowledge(req.nova.businessId, query, limit) });
    } catch (error) {
        next(error);
    }
});

module.exports = router;
