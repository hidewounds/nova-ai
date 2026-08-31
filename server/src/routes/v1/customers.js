"use strict";

const express = require("express");
const { authenticateIntegration } = require("../../auth/integration");
const customers = require("../../core/customers/store");
const memoryStore = require("../../core/memory/store");
const behaviorStore = require("../../core/behavior/store");
const conversationStore = require("../../core/conversations/store");
const audit = require("../../core/audit/store");
const { badRequest, notFound } = require("../../lib/errors");

const router = express.Router();

router.use(authenticateIntegration);

function requireCustomerParam(req) {
    const customerId = customers.validateCustomerId(req.params.customerId);
    if (!customerId) throw badRequest("Invalid customer id.");
    return customerId;
}

// ---------------------------------------------------------------------------
// customer profile
// ---------------------------------------------------------------------------

router.get("/customers", (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 100, 500);
    const offset = Math.max(Number(req.query.offset) || 0, 0);
    res.json(customers.listCustomers(req.nova.businessId, { limit, offset }));
});

router.get("/customers/:customerId", (req, res, next) => {
    try {
        const customerId = requireCustomerParam(req);
        const customer = customers.getCustomer(req.nova.businessId, customerId);
        if (!customer) throw notFound("Customer not found.");
        res.json({ customer });
    } catch (error) {
        next(error);
    }
});

/** Update profile basics — used by the widget's email-capture flow. */
router.patch("/customers/:customerId", (req, res, next) => {
    try {
        const customerId = requireCustomerParam(req);
        const body = req.body || {};
        const existing = customers.getCustomer(req.nova.businessId, customerId);
        const updated = customers.upsertCustomer({
            businessId: req.nova.businessId,
            customerId,
            name: body.name !== undefined ? body.name : existing?.name,
            email: body.email !== undefined ? body.email : existing?.email,
            phone: body.phone !== undefined ? body.phone : existing?.phone,
        });
        audit.record({ businessId: req.nova.businessId, actorType: "integration", action: "customer.profile_updated", detail: { customerId } });
        res.json({ customer: updated });
    } catch (error) {
        next(error);
    }
});

router.delete("/customers/:customerId", (req, res, next) => {
    try {
        const customerId = requireCustomerParam(req);
        const deleted = customers.deleteCustomer(req.nova.businessId, customerId);
        audit.record({
            businessId: req.nova.businessId,
            actorType: "integration",
            action: "customer.deleted",
            detail: { customerId },
            ip: req.ip,
        });
        res.json({ deleted });
    } catch (error) {
        next(error);
    }
});

// ---------------------------------------------------------------------------
// memories
// ---------------------------------------------------------------------------

router.get("/customers/:customerId/memories", (req, res, next) => {
    try {
        const customerId = requireCustomerParam(req);
        const limit = Math.min(Number(req.query.limit) || 500, 1000);
        res.json({ memories: memoryStore.listMemories(req.nova.businessId, customerId, limit) });
    } catch (error) {
        next(error);
    }
});

router.delete("/customers/:customerId/memories/:key", (req, res, next) => {
    try {
        const customerId = requireCustomerParam(req);
        const key = String(req.params.key || "").trim().toLowerCase();
        const deleted = memoryStore.deleteMemory(req.nova.businessId, customerId, key);
        res.json({ deleted });
    } catch (error) {
        next(error);
    }
});

router.delete("/customers/:customerId/memories", (req, res, next) => {
    try {
        const customerId = requireCustomerParam(req);
        const deleted = memoryStore.deleteAllMemories(req.nova.businessId, customerId);
        audit.record({
            businessId: req.nova.businessId,
            actorType: "integration",
            action: "memory.all_deleted",
            detail: { customerId },
            ip: req.ip,
        });
        res.json({ deleted });
    } catch (error) {
        next(error);
    }
});

// ---------------------------------------------------------------------------
// behavior
// ---------------------------------------------------------------------------

router.get("/customers/:customerId/behavior", (req, res, next) => {
    try {
        const customerId = requireCustomerParam(req);
        const limit = Math.min(Number(req.query.limit) || 50, 200);
        const offset = Math.max(Number(req.query.offset) || 0, 0);
        res.json(behaviorStore.listRecentBehavior(req.nova.businessId, customerId, limit, offset));
    } catch (error) {
        next(error);
    }
});

router.delete("/customers/:customerId/behavior/:eventId", (req, res, next) => {
    try {
        const customerId = requireCustomerParam(req);
        const deleted = behaviorStore.deleteBehaviorEvent(req.nova.businessId, customerId, req.params.eventId);
        res.json({ deleted });
    } catch (error) {
        next(error);
    }
});

router.delete("/customers/:customerId/behavior", (req, res, next) => {
    try {
        const customerId = requireCustomerParam(req);
        const deleted = behaviorStore.deleteAllBehavior(req.nova.businessId, customerId);
        res.json({ deleted });
    } catch (error) {
        next(error);
    }
});

// ---------------------------------------------------------------------------
// conversations
// ---------------------------------------------------------------------------

router.get("/customers/:customerId/conversations", (req, res, next) => {
    try {
        const customerId = requireCustomerParam(req);
        res.json(conversationStore.listConversations(req.nova.businessId, { customerId }));
    } catch (error) {
        next(error);
    }
});

module.exports = router;
