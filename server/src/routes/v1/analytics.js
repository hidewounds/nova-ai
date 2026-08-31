"use strict";

const express = require("express");
const { authenticateIntegration } = require("../../auth/integration");
const analytics = require("../../core/analytics/service");

const router = express.Router();

router.use(authenticateIntegration);

router.get("/analytics/summary", (req, res) => {
    res.json(analytics.summary(req.nova.businessId));
});

module.exports = router;
