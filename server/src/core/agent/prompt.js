"use strict";

/**
 * DEPRECATED — Prompt with role constraints removed.
 * Unified Brain uses server/src/core/agent/brain.js buildUnifiedPrompt
 * This file is a shim for backward compat. All role-constraint prompts deleted.
 */

const brain = require("./brain");

module.exports = {
    SECURITY_RULES: brain.SECURITY_RULES,
    buildSystemPrompt: brain.buildSystemPrompt,
    estimateSystemPromptTokens: brain.estimateSystemPromptTokens,
    buildUnifiedPrompt: brain.buildUnifiedPrompt,
    assessSituation: brain.assessSituation,
};
