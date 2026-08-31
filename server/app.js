"use strict";

const path = require("path");
const express = require("express");
const cors = require("cors");

const env = require("./src/env");
const db = require("./src/db");
const { requestContext, corsOriginValidator, securityHeaders, validateRequestSize, rateLimit, csrfProtection, csrfIssueToken, promptInjectionGuard, notFoundHandler, errorHandler } = require("./src/http/middleware");
const { startDigestCron } = require("./src/core/digests/cron");

const chatRoutes = require("./src/routes/v1/chat");
const customerRoutes = require("./src/routes/v1/customers");
const behaviorRoutes = require("./src/routes/v1/behavior");
const knowledgeRoutes = require("./src/routes/v1/knowledge");
const businessRoutes = require("./src/routes/v1/business");
const analyticsRoutes = require("./src/routes/v1/analytics");
const widgetRoutes = require("./src/routes/v1/widget");
const chronoRoutes = require("./src/routes/v1/chrono");
const echoRoutes = require("./src/routes/v1/echo");
const ttsRoutes = require("./src/routes/v1/tts");
const adminAuthRoutes = require("./src/routes/admin/auth");
const adminBusinessRoutes = require("./src/routes/admin/businesses");
const { authenticateIntegration } = require("./src/auth/integration");

/**
 * Build the fully-wired NOVA express app.
 * Exported as a factory so tests can create isolated instances.
 */
function createApp(options = {}) {
    db.init({ dbPath: options.dbPath });
    // Seed demo business for widget key so widget never 401 on fresh Vercel /tmp DB
    try {
        const conn = require("./src/db/connection");
        const bizCount = conn.get().prepare("SELECT COUNT(*) as n FROM businesses").get()?.n || 0;
        if (bizCount === 0) {
            const crypto = require("./src/lib/crypto");
            const now = Date.now();
            const demoId = "nova_web_demo";
            const demoKey = "nova_pk_40d32c478e27559616acfd7827347d437b1c207d3d9f1e1c0375759d81bbb6da";
            const demoName = "NOVA Web Demo";
            try {
                conn.get().prepare("INSERT OR IGNORE INTO businesses (business_id, business_name, integration_key, active, plan, created_at, updated_at) VALUES (?, ?, ?, 1, 'unlimited', ?, ?)").run(demoId, demoName, demoKey, now, now);
                const cfg = require("./src/core/config/service");
                // ensure config exists
                const existing = conn.get().prepare("SELECT 1 FROM business_configs WHERE business_id=?").get(demoId);
                if (!existing) {
                    const normalized = cfg.normalizeConfig({}, { plan: "unlimited", bypassLimit: true });
                    conn.get().prepare("INSERT OR IGNORE INTO business_configs (business_id, config_json, created_at, updated_at) VALUES (?, ?, ?, ?)").run(demoId, JSON.stringify(normalized), now, now);
                }
                // ensure chrono schedule seeded via migration already, but ensure
                require("./src/db").get();
            } catch (e) { /* ignore seed errors */ }
        }
    } catch {}

    const app = express();
    app.disable("x-powered-by");
    app.set("trust proxy", true);

    // Start weekly digest cron (only in production or when explicitly enabled)
    if (env.nodeEnv === "production" || process.env.NOVA_DIGEST_CRON === "true") {
        startDigestCron();
    }

    // --- global middleware ---------------------------------------------------
    app.use(requestContext);
    app.use(corsOriginValidator);
    app.use(securityHeaders);
    // Use cors for preflight handling only; actual origin validation in corsOriginValidator
    app.use(cors({
        origin: env.corsOrigin === "true" ? true : env.corsOrigin || true,
        credentials: false,
        methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allowedHeaders: ["Content-Type", "Authorization", "X-Nova-Key", "X-CSRF-Token", "X-Request-Id"],
    }));
    app.use(express.json({ limit: env.maxBodyBytes }));
    app.use(express.urlencoded({ extended: false, limit: env.maxBodyBytes }));
    app.use(validateRequestSize);
    app.use(promptInjectionGuard);

    // --- health -----------------------------------------------------------------
    app.get("/api/health", (req, res) => {
        res.json({
            ok: true,
            service: "NOVA",
            version: "1.0.0",
            environment: env.nodeEnv,
            model: env.ai.model,
            timestamp: Date.now(),
        });
    });

    // Echo sidecar health (proxied)
    app.get("/api/health/echo", async (req, res) => {
        try {
            const echoTranscribe = require("./src/core/echo/transcribe");
            const sidecarUrl = process.env.ECHO_SIDECAR_URL || "http://127.0.0.1:8765";
            const health = await echoTranscribe.checkSidecarHealth(sidecarUrl);
            res.json({ sidecar: health, timestamp: Date.now() });
        } catch (e) {
            res.json({ sidecar: { available: false, error: e.message }, timestamp: Date.now() });
        }
    });

    // CSRF token endpoint for portal
    app.get("/api/portal/csrf-token", rateLimit({ scope: "admin" }), (req, res) => {
        // This will be handled by portal auth middleware
        csrfIssueToken(req, res);
    });

    // --- platform API v1 ---------------------------------------------------------
    const apiRateLimit = rateLimit();
    app.use("/api/v1/chat", chatRoutes);
    app.use("/api/v1", customerRoutes); // self-authenticating
    app.use("/api/v1", behaviorRoutes);
    app.use("/api/v1", knowledgeRoutes);
    app.use("/api/v1", businessRoutes);
    app.use("/api/v1", analyticsRoutes);
    app.use("/api/v1/chrono", chronoRoutes);
    app.use("/api/v1/echo", echoRoutes);
    app.use("/api/v1/tts", ttsRoutes);
    app.use("/api/v1/widget", apiRateLimit, widgetRoutes);
    const { publicSiteRouter } = require("./src/routes/v1/site");
    app.use("/api/v1/site", publicSiteRouter);

    // --- admin API ------------------------------------------------------------------
    app.use("/api/admin/auth", adminAuthRoutes);
    app.use("/api/admin", rateLimit({ scope: "admin" }), adminBusinessRoutes);

    // --- business portal API ----------------------------------------------------------
    const portalRoutes = require("./src/routes/portal");
    const { portalSiteRouter } = require("./src/routes/v1/site");
    // Apply CSRF protection to portal state-changing routes
    app.use("/api/portal/site", portalSiteRouter); // site analyze without CSRF? kept separate
    app.use("/api/portal", rateLimit({ scope: "admin" }), csrfProtection, portalRoutes);

    // Back-compat alias for the original integration surface.
    app.use("/api/business", authenticateIntegration, (req, res) => {
        res.status(404).json({
            error: { code: "moved", message: "Use /api/v1/business instead." },
            requestId: req.requestId,
        });
    });

    // --- static assets -------------------------------------------------------------
    const clientRoot = path.join(__dirname, "..", "client");

    app.use("/widget", express.static(path.join(clientRoot, "sdk")));
    app.use("/admin", express.static(path.join(clientRoot, "admin")));
    app.use("/portal", express.static(path.join(clientRoot, "portal")));
    app.use("/", express.static(path.join(clientRoot, "welcome")));

    // --- terminal handlers ------------------------------------------------------------
    app.use(notFoundHandler);
    app.use(errorHandler);

    return app;
}

module.exports = { createApp };