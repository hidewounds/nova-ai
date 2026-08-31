"use strict";

const express = require("express");
const { authenticateIntegration, requireScope } = require("../../auth/integration");
const { transcribeParams, stubTranscribe } = require("../../core/echo/transcribe");
const { normalizeLanguage } = require("../../core/echo/languages");
const env = require("../../env");

const router = express.Router();
router.use(authenticateIntegration);

// POST /api/v1/echo/transcribe
// Body: { language?, model?, audioBase64?, mimeType?, durationMs?, customerId?, conversationId? }
// or multipart (handled as raw fallback). Stub path persists a transcript row and returns status.
router.post("/transcribe", requireScope("echo:transcribe"), express.json({ limit: "10mb" }), async (req, res, next) => {
    try {
        const body = req.body || {};
        const bizCfg = (() => { try { return require("../../core/config/service").getConfig(req.nova.businessId); } catch { return {}; } })();
        const prompt = String(body.prompt || bizCfg.echo?.initialPrompt || "").slice(0, 600);
        const params = transcribeParams({ language: body.language, model: body.model, prompt, wordTimestamps: body.wordTimestamps === true || bizCfg.echo?.wordTimestamps === true });
        const customerId = String(body.customerId || body.customer_id || "anonymous").slice(0, 80);
        const conversationId = body.conversationId ? String(body.conversationId).slice(0, 100) : null;

        // If sidecar URL configured and audio provided, try real transcription
        const sidecarUrl = env.echoSidecarUrl || (require("../../core/config/service").getConfig(req.nova.businessId).echo?.sidecarUrl);
        const hasAudio = body.audioBase64 && typeof body.audioBase64 === "string" && body.audioBase64.length > 20;

        if (hasAudio && sidecarUrl) {
            try {
                const buf = Buffer.from(body.audioBase64, "base64");
                const { callSidecar } = require("../../core/echo/transcribe");
                const result = await callSidecar({
                    sidecarUrl,
                    audioBuffer: buf,
                    filename: `audio.${(body.mimeType || "webm").split("/")[1] || "webm"}`,
                    params,
                });
                // persist real transcript
                const db = require("../../db").get();
                const crypto = require("../../lib/crypto");
                const id = `ect_${crypto.randomHex(10)}`;
                db().prepare("INSERT INTO echo_transcripts (transcript_id, business_id, customer_id, conversation_id, language, transcript, duration_ms, created_at, initial_prompt, word_timestamps_json, model) VALUES (?,?,?,?,?,?,?,?,?,?,?)")
                    .run(id, req.nova.businessId, customerId, conversationId, result.language || params.language || "", result.text || "", body.durationMs || 0, Date.now(), params.prompt || "", JSON.stringify(result.segments?.flatMap((s) => s.words || []) || []), params.model || "turbo");
                return res.json({ transcriptId: id, text: result.text, language: result.language || params.language, segments: result.segments || [], wordTimestamps: params.wordTimestamps, sidecar: true });
            } catch (e) {
                // fall through to stub
                req.log && req.log.warn && req.log.warn("echo sidecar failed, falling back to stub", { error: e.message });
            }
        }

        const audioMeta = { format: body.mimeType || "webm", bytes: hasAudio ? Buffer.from(body.audioBase64, "base64").length : 0, durationMs: body.durationMs || 0 };
        const stub = stubTranscribe({ businessId: req.nova.businessId, customerId, conversationId, language: params.language, audioMeta, prompt: params.prompt, wordTimestamps: params.wordTimestamps, model: params.model });
        res.json(stub);
    } catch (e) { next(e); }
});

// GET /api/v1/echo/languages
router.get("/languages", requireScope("echo:read"), (req, res, next) => {
    try {
        const { ECHO_LANGUAGES, LANGUAGE_NAMES } = require("../../core/echo/languages");
        res.json({ languages: ECHO_LANGUAGES, names: LANGUAGE_NAMES });
    } catch (e) { next(e); }
});

module.exports = router;
