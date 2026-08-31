"use strict";

/**
 * Integration authentication: resolves a business from its integration key.
 * The key arrives via `x-nova-key` header or `Authorization: Bearer <key>`.
 * Tenant identity is derived ONLY from the key — never from the body.
 * Supports scoped keys: chat:read, behavior:write, knowledge:read, admin:full
 */

const { getBusinessByKey, publicBusiness } = require("../core/config/service");
const { unauthorized } = require("../lib/errors");
const env = require("../env");

const DEFAULT_SCOPES = ["chat:read", "behavior:write", "knowledge:read"];

function extractKey(req) {
    const headerKey = req.headers["x-nova-key"];
    if (typeof headerKey === "string" && headerKey.trim()) return headerKey.trim();

    const authorization = req.headers["authorization"];
    if (typeof authorization === "string") {
        const match = authorization.match(/^Bearer\s+(.+)$/i);
        if (match?.[1]) return match[1].trim();
    }
    return null;
}

function parseScopes(key) {
    // In the future, scopes could be embedded in the key format: nvk_<scopes>_<random>
    // For now, use env default
    return env.integrationKeyScopes || DEFAULT_SCOPES;
}

function hasScope(key, requiredScope) {
    const scopes = parseScopes(key);
    return scopes.includes(requiredScope) || scopes.includes("admin:full");
}

function requireScope(requiredScope) {
    return (req, res, next) => {
        try {
            const key = extractKey(req);
            if (!key) throw unauthorized("NOVA integration key is required.", "key_required");

            if (!hasScope(key, requiredScope)) {
                throw unauthorized(`Integration key missing required scope: ${requiredScope}`, "insufficient_scope");
            }
            next();
        } catch (error) {
            next(error);
        }
    };
}

function authenticateIntegration(req, res, next) {
    try {
        const key = extractKey(req);
        if (!key) throw unauthorized("NOVA integration key is required.", "key_required");
        if (key.length > 500) throw unauthorized("Invalid NOVA integration key.", "key_invalid");

        const business = getBusinessByKey(key);
        if (!business || !business.active) {
            throw unauthorized("Invalid or inactive NOVA integration key.", "key_invalid");
        }

        req.nova = {
            principalType: "integration",
            businessId: business.business_id,
            businessName: business.business_name,
            scopes: parseScopes(key),
        };
        req.novaBusiness = publicBusiness(business);
        next();
    } catch (error) {
        next(error);
    }
}

module.exports = { authenticateIntegration, extractKey, requireScope, parseScopes };
