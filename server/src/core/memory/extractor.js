"use strict";

/**
 * Memory extraction from chat text.
 *
 * Distinguishes:
 *  - explicit facts  ("my name is Alex")        -> origin: explicit, confidence 1
 *  - user-requested  ("remember my X is Y")     -> origin: explicit, source: user_request
 *  - forget commands ("forget X")               -> deletes matching memory
 *
 * Automatic extraction only ever stores allow-listed stable fields.
 */

const { saveMemory, deleteMemory, cleanValue } = require("./store");
const { clampText } = require("../../lib/tokens");

const FORGET_ALIASES = {
    "my name": "name",
    name: "name",
    "my location": "location",
    location: "location",
    "where i live": "location",
    "my job": "occupation",
    "my occupation": "occupation",
    occupation: "occupation",
    "my shoe size": "shoe_size",
    "shoe size": "shoe_size",
    "my shoe preference": "shoe_preference",
    "shoe preference": "shoe_preference",
    "my clothing size": "clothing_size",
    "clothing size": "clothing_size",
};

function escapeRegex(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function cleanExtractedValue(value, key) {
    let cleaned = cleanValue(value);
    if (!cleaned) return "";

    // Strip surrounding punctuation.
    cleaned = cleaned.replace(/^[,:=\s]+/, "").replace(/[.!?,;\s]+$/, "").trim();
    if (!cleaned) return "";

    // Stop compound statements for identity-like fields.
    if (["name", "location", "clothing_size"].includes(key)) {
        cleaned = cleaned.split(/\s+(?:and|but|while|because|also|however|though)\s+/i)[0].trim();
    }

    if (key === "shoe_size") {
        const match = cleaned.match(/\b(?:size\s*)?([0-9]{1,2}(?:\.[0-9]+)?)(?:\s*(?:us|uk|eu))?\b/i);
        cleaned = match ? match[1] : "";
    }

    if (key === "name") {
        cleaned = cleaned.replace(/^(?:is|called|named)\s+/i, "").trim();
        if (cleaned.length > 100) {
            cleaned = cleaned.split(/\s+/).slice(0, 5).join(" ");
        }
    }

    return cleanValue(cleaned);
}

/** Try to extract a single allow-listed field from text. */
function extractField(text, field) {
    const key = typeof field === "string" ? field : field?.key;
    if (!key) return null;

    const keywords =
        typeof field === "string"
            ? [field.replace(/_/g, " ")]
            : Array.isArray(field?.keywords) && field.keywords.length
                ? field.keywords
                : [key.replace(/_/g, " ")];

    for (const keyword of keywords) {
        if (!keyword) continue;
        const escaped = escapeRegex(keyword);

        // Explicit ownership: "my name is Alex"
        const ownership = new RegExp(
            `\\b(?:my|i am|i'm|i use|i wear|i live in|i live at|i'?m based in|i am based in)\\s+${escaped}\\s*(?:is|=|:)?\\s*([^.!?\\n]+)`,
            "i"
        );
        const ownershipMatch = text.match(ownership);
        if (ownershipMatch?.[1]) {
            const value = cleanExtractedValue(ownershipMatch[1], key);
            if (value) {
                return { key, value, category: field?.category || "stable", origin: "explicit" };
            }
        }

        // Direct form: "name is Alex" / "shoe size: 9"
        const direct = new RegExp(`\\b${escaped}\\s*(?:is|=|:|are)\\s*([^.!?\\n]+)`, "i");
        const directMatch = text.match(direct);
        if (directMatch?.[1]) {
            const value = cleanExtractedValue(directMatch[1], key);
            if (value) {
                return { key, value, category: field?.category || "stable", origin: "explicit" };
            }
        }
    }

    // Preference phrasing for shoe_preference.
    if (key === "shoe_preference") {
        const preference = text.match(/\b(?:i\s+prefer|i\s+like|i\s+love|i\s+usually\s+wear|i\s+wear)\s+(.+?)\s+shoes?\b/i);
        if (preference?.[1]) {
            const value = cleanValue(preference[1]);
            if (value) {
                return { key, value, category: "preference", origin: "explicit" };
            }
        }
    }

    // Natural location phrasing: "I live in Berlin", "I'm based in Oslo".
    if (key === "location") {
        const livePattern =
            /\b(?:i\s+(?:live|am\s+based|m\s+based|currently\s+(?:live|reside))\s+(?:in|at|near))\s+([^.!?\n]+)/i;
        const liveMatch = text.match(livePattern);
        if (liveMatch?.[1]) {
            const value = cleanExtractedValue(liveMatch[1], key);
            if (value) {
                return { key, value, category: field?.category || "identity", origin: "explicit" };
            }
        }
    }

    return null;
}

/**
 * Extract memories from a user message.
 * Returns array of operations: { action: saved|deleted|not_found, ... }
 */
function extractMemoriesFromText({ businessId, customerId, text, config }) {
    if (!businessId || !customerId || typeof text !== "string" || !text.trim()) return [];

    const operations = [];
    const trimmed = text.trim();

    // --- Forget command ----------------------------------------------------
    const forgetMatch = trimmed.match(/^forget\s+(?:that\s+)?(.+)$/i);
    if (forgetMatch) {
        const rawTarget = forgetMatch[1].trim();
        let targetNorm = cleanValue(rawTarget).toLowerCase().replace(/[.!?]+$/, "").trim();
        targetNorm = targetNorm.replace(/^[,:=\s]+/, "").replace(/[.!?,;\s]+$/, "").trim();
        let key = FORGET_ALIASES[targetNorm] || null;
        if (!key) {
            // Natural location phrasing: "i live in Berlin", "where i live", "my location"
            if (/\b(?:live\s+(?:in|at|near)|based\s+in|where\s+i\s+live|my\s+location|location)\b/i.test(targetNorm)) {
                key = "location";
            } else if (/\bmy\s+name\b/i.test(targetNorm) || targetNorm === "name") {
                key = "name";
            } else {
                for (const [alias, aliasKey] of Object.entries(FORGET_ALIASES)) {
                    if (targetNorm.includes(alias)) { key = aliasKey; break; }
                }
            }
        }
        if (key) {
            const deleted = deleteMemory(businessId, customerId, key);
            operations.push({ action: deleted ? "deleted" : "not_found", key });
            return operations;
        }
        // Generic forget: try to derive key from phrase (e.g., "my favorite color is teal" -> favorite_color)
        const stripped = targetNorm
            .replace(/\b(?:that|i|my|live|in|at|near|where|is|are|was|am|the|a|an)\b/gi, " ")
            .replace(/\s+/g, " ")
            .trim()
            .replace(/\s+/g, "_")
            .replace(/^_+|_+$/g, "")
            .slice(0, 150);
        if (stripped && stripped.length >= 2) {
            const deletedGeneric = deleteMemory(businessId, customerId, stripped);
            if (deletedGeneric) {
                operations.push({ action: "deleted", key: stripped });
                return operations;
            }
        }
        // Still a forget command — prevent re-extraction of the same sentence as a new fact
        operations.push({ action: "not_found", key: targetNorm.slice(0, 50) || "unknown" });
        return operations;
    }

    if (!config?.memory || config.memory.enabled === false) return operations;

    // --- User-requested memory ----------------------------------------------
    // Allow "remember secret=123", "remember secret is 123", "remember my team: X" etc — delimiter may have no spaces
    if (config.memory.allowExplicitRemember !== false) {
        const rememberMatch = trimmed.match(/^(?:please\s+)?remember(?:\s+that)?\s+(?:my\s+)?([\w\s'-]{2,60}?)\s*(?:is|=|:)\s*(.+)$/i);
        if (rememberMatch) {
            const rawKey = rememberMatch[1].trim().toLowerCase().replace(/\s+/g, "_");
            const value = cleanValue(rememberMatch[2]);
            if (rawKey && value && value.length <= 500) {
                const result = saveMemory({
                    businessId,
                    customerId,
                    key: rawKey,
                    value,
                    category: "user_fact",
                    confidence: 1,
                    source: "user_request",
                    origin: "explicit",
                });
                if (result.saved) {
                    operations.push({ action: result.action, key: rawKey, origin: "explicit", requestedByUser: true });
                }
                return operations;
            }
        }
    }

    // --- Allow-listed automatic extraction ----------------------------------
    const fields = Array.isArray(config.memory.stableFields) ? config.memory.stableFields : [];
    const seen = new Set();

    for (const field of fields) {
        const result = extractField(trimmed, field);
        if (!result || seen.has(result.key)) continue;
        seen.add(result.key);

        const saved = saveMemory({
            businessId,
            customerId,
            key: result.key,
            value: result.value,
            category: result.category,
            confidence: 1,
            source: "chat",
            origin: result.origin,
        });

        if (saved.saved) {
            operations.push({ action: saved.action, key: result.key, changed: saved.changed });
        }
    }

    return operations;
}

module.exports = { extractField, extractMemoriesFromText, cleanExtractedValue, clampText };
