"use strict";

/**
 * DEPRECATED — Roles removed. Unified Brain now.
 * This file is a shim for backward compat. All roles are now learned patterns, not prompt constraints.
 * See server/src/core/agent/brain.js for the unified brain.
 * DELETE after all imports are migrated to brain.js
 */

const brain = require("../agent/brain");

module.exports = {
    AGENT_ROLES: brain.LEARNED_PATTERNS,
    ROLE_KEYS: brain.PATTERN_IDS,
    CORE_ROLE_KEYS: brain.PATTERN_IDS,
    getRole: brain.getRole,
    isKnownRole: brain.isKnownRole,
    isCoreRole: brain.isCoreRole,
    getPersona: () => null,
    listPersonas: () => [],
    resolvePersonaTraits: () => [],
    resolveRoleDefinition: brain.resolveRoleDefinition,
    PERSONA_CATALOG: {},
};
