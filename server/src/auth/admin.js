"use strict";

/**
 * Admin authentication: email/password admin accounts with HMAC-signed
 * bearer tokens (JWT-shaped, zero dependencies). The first registered
 * admin becomes a super-admin; subsequent admins are scoped to the
 * businesses they are granted access to.
 * 
 * Now supports: access tokens (15min) + refresh tokens (12h) with rotation
 * and revocation list.
 */

const db = require("../db").get;
const env = require("../env");
const crypto = require("../lib/crypto");
const { AppError, badRequest, unauthorized } = require("../lib/errors");
const { getBusiness, publicBusiness } = require("../core/config/service");

const EMAIL_PATTERN = /^[^\s@]{1,64}@[^\s@]+\.[^\s@]{1,}$/;

// ---------------------------------------------------------------------------
// token secret bootstrap
// ---------------------------------------------------------------------------

let cachedSecret = null;

function getTokenSecret() {
    if (cachedSecret) return cachedSecret;
    if (env.adminTokenSecretFromEnv) {
        cachedSecret = env.adminTokenSecretFromEnv;
        return cachedSecret;
    }
    const row = db().prepare(`SELECT value FROM meta WHERE key = 'admin_token_secret'`).get();
    if (row?.value) {
        cachedSecret = row.value;
        return cachedSecret;
    }
    const secret = crypto.randomHex(32);
    db().prepare(`INSERT OR REPLACE INTO meta (key, value) VALUES ('admin_token_secret', ?)`).run(secret);
    cachedSecret = secret;
    return secret;
}

// ---------------------------------------------------------------------------
// revocation list (stored in meta as JSON array)
// ---------------------------------------------------------------------------

function getRevokedTokens() {
    const row = db().prepare(`SELECT value FROM meta WHERE key = 'admin_revoked_tokens'`).get();
    if (!row?.value) return new Set();
    try {
        return new Set(JSON.parse(row.value));
    } catch {
        return new Set();
    }
}

function addRevokedToken(tokenHash) {
    const revoked = getRevokedTokens();
    revoked.add(tokenHash);
    // Keep only last 10000
    if (revoked.size > 10000) {
        const arr = Array.from(revoked).slice(-10000);
        revoked.clear();
        arr.forEach(h => revoked.add(h));
    }
    db().prepare(`INSERT OR REPLACE INTO meta (key, value) VALUES ('admin_revoked_tokens', ?)`).run(JSON.stringify(Array.from(revoked)));
}

function isTokenRevoked(tokenHash) {
    return getRevokedTokens().has(tokenHash);
}

// ---------------------------------------------------------------------------
// tokens
// ---------------------------------------------------------------------------

function signAdminToken(admin) {
    const issuedAt = Math.floor(Date.now() / 1000);
    const expiresAt = issuedAt + env.adminTokenTtlSec;
    const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
    const payload = Buffer.from(
        JSON.stringify({
            sub: admin.admin_uid,
            id: admin.id,
            email: admin.email,
            isSuper: Boolean(admin.is_super),
            iat: issuedAt,
            exp: expiresAt,
            type: "access",
        })
    ).toString("base64url");

    const signature = crypto.hmacSign(`${header}.${payload}`, getTokenSecret());
    return { token: `${header}.${payload}.${signature}`, expiresAt: expiresAt * 1000 };
}

function signAdminRefreshToken(admin) {
    const issuedAt = Math.floor(Date.now() / 1000);
    const expiresAt = issuedAt + env.adminRefreshTtlSec;
    const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
    const payload = Buffer.from(
        JSON.stringify({
            sub: admin.admin_uid,
            id: admin.id,
            email: admin.email,
            isSuper: Boolean(admin.is_super),
            iat: issuedAt,
            exp: expiresAt,
            type: "refresh",
            jti: crypto.randomHex(16), // unique ID for revocation
        })
    ).toString("base64url");

    const signature = crypto.hmacSign(`${header}.${payload}`, getTokenSecret());
    return { token: `${header}.${payload}.${signature}`, expiresAt: expiresAt * 1000 };
}

function verifyAdminToken(token) {
    try {
        const parts = String(token || "").split(".");
        if (parts.length !== 3) return null;
        const [header, payload, signature] = parts;
        if (!crypto.safeEqual(crypto.hmacSign(`${header}.${payload}`, getTokenSecret()), signature)) return null;

        const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
        if (!data?.sub || !data?.exp || data.exp < Math.floor(Date.now() / 1000)) return null;
        if (data.type !== "access") return null;
        if (isTokenRevoked(crypto.sha256hex(token))) return null;
        return data;
    } catch {
        return null;
    }
}

function verifyAdminRefreshToken(token) {
    try {
        const parts = String(token || "").split(".");
        if (parts.length !== 3) return null;
        const [header, payload, signature] = parts;
        if (!crypto.safeEqual(crypto.hmacSign(`${header}.${payload}`, getTokenSecret()), signature)) return null;

        const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
        if (!data?.sub || !data?.exp || data.exp < Math.floor(Date.now() / 1000)) return null;
        if (data.type !== "refresh") return null;
        if (isTokenRevoked(crypto.sha256hex(token))) return null;
        return data;
    } catch {
        return null;
    }
}

// ---------------------------------------------------------------------------
// accounts
// ---------------------------------------------------------------------------

function publicAdmin(row) {
    if (!row) return null;
    return {
        adminUid: row.admin_uid,
        email: row.email,
        name: row.name || "",
        isSuper: Boolean(row.is_super),
        createdAt: row.created_at,
    };
}

function countAdmins() {
    return db().prepare(`SELECT COUNT(*) AS n FROM admin_users`).get().n;
}

function registerAdmin({ email, password, name }) {
    const cleanEmail = String(email || "").trim().toLowerCase();
    if (!EMAIL_PATTERN.test(cleanEmail)) throw badRequest("A valid email address is required.");
    if (typeof password !== "string" || password.length < 8) {
        throw badRequest("Password must be at least 8 characters.");
    }

    const existing = db().prepare(`SELECT id FROM admin_users WHERE email = ?`).get(cleanEmail);
    if (existing) throw new AppError(409, "email_taken", "An account with this email already exists.");

    const isFirst = countAdmins() === 0;
    const timestamp = Date.now();

    db()
        .prepare(
            `INSERT INTO admin_users (admin_uid, email, name, password_hash, is_super, active, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, 1, ?, ?)`
        )
        .run(crypto.randomId("adm", 10), cleanEmail, String(name || "").trim().slice(0, 200), crypto.hashPassword(password), isFirst ? 1 : 0, timestamp, timestamp);

    const row = db().prepare(`SELECT * FROM admin_users WHERE email = ?`).get(cleanEmail);
    return { admin: publicAdmin(row), isFirst, _raw: row };
}

function verifyCredentials({ email, password }) {
    const cleanEmail = String(email || "").trim().toLowerCase();
    const row = db().prepare(`SELECT * FROM admin_users WHERE email = ? AND active = 1`).get(cleanEmail);
    if (!row || !crypto.verifyPassword(password, row.password_hash)) {
        throw unauthorized("Invalid email or password.", "invalid_credentials");
    }
    return row;
}

function getByUid(uid) {
    return (
        db()
            .prepare(`SELECT * FROM admin_users WHERE admin_uid = ? AND active = 1`)
            .get(String(uid || "")) || null
    );
}

// ---------------------------------------------------------------------------
// access control
// ---------------------------------------------------------------------------

function grantBusinessAccess(adminId, businessId) {
    db()
        .prepare(`INSERT OR IGNORE INTO admin_business_access (admin_id, business_id, granted_at) VALUES (?, ?, ?)`)
        .run(adminId, businessId, Date.now());
}

function canAccessBusiness(adminRow, businessId) {
    if (adminRow.is_super) return true;
    const row = db()
        .prepare(`SELECT 1 AS ok FROM admin_business_access WHERE admin_id = ? AND business_id = ?`)
        .get(adminRow.id, String(businessId));
    return Boolean(row);
}

function listAccessibleBusinesses(adminRow) {
    if (adminRow.is_super) {
        const rows = db().prepare(`SELECT * FROM businesses ORDER BY created_at ASC`).all();
        return rows.map(publicBusiness);
    }
    const rows = db()
        .prepare(
            `SELECT b.* FROM businesses b
             JOIN admin_business_access a ON a.business_id = b.business_id
             WHERE a.admin_id = ?
             ORDER BY b.created_at ASC`
        )
        .all(adminRow.id);
    return rows.map(publicBusiness);
}

// ---------------------------------------------------------------------------
// middleware
// ---------------------------------------------------------------------------

function requireAdmin(req, res, next) {
    try {
        const authorization = req.headers["authorization"];
        const match = typeof authorization === "string" ? authorization.match(/^Bearer\s+(.+)$/i) : null;
        const token = match?.[1] || null;
        if (!token) throw unauthorized("Admin authentication required.", "admin_token_required");

        const payload = verifyAdminToken(token);
        if (!payload) throw unauthorized("Invalid or expired admin token.", "admin_token_invalid");

        const admin = getByUid(payload.sub);
        if (!admin) throw unauthorized("Admin account is inactive.", "admin_inactive");

        req.nova = { principalType: "admin", adminId: admin.id, adminUid: admin.admin_uid, isSuper: Boolean(admin.is_super) };
        req.novaAdmin = { ...publicAdmin(admin), password_hash: undefined };
        next();
    } catch (error) {
        next(error);
    }
}

/** Load :businessId param and enforce that the admin may touch it. */
function loadOwnedBusiness(req, res, next) {
    try {
        const businessId = String(req.params.businessId || "").trim();
        const business = getBusiness(businessId);
        if (!business) throw new AppError(404, "not_found", "Business not found.");

        // Super admins bypass; otherwise explicit grant required. The default
        // seeded business is accessible to super admins only.
        if (!canAccessBusiness(db().prepare(`SELECT * FROM admin_users WHERE id = ?`).get(req.nova.adminId), business.business_id)) {
            throw new AppError(403, "forbidden", "You do not have access to this business.");
        }

        req.nova.businessId = business.business_id;
        req.novaBusiness = publicBusiness(business, { includeKey: true });
        next();
    } catch (error) {
        next(error);
    }
}

module.exports = {
    registerAdmin,
    verifyCredentials,
    getByUid,
    publicAdmin,
    signAdminToken,
    signAdminRefreshToken,
    verifyAdminToken,
    verifyAdminRefreshToken,
    addRevokedToken,
    grantBusinessAccess,
    canAccessBusiness,
    listAccessibleBusinesses,
    requireAdmin,
    loadOwnedBusiness,
};