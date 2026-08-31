"use strict";

/**
 * Application error with safe external representation.
 * Only `expose: true` errors reveal their message to clients.
 */
class AppError extends Error {
    constructor(status, code, message, { expose = true, cause = null } = {}) {
        super(message);
        this.name = "AppError";
        this.status = status;
        this.code = code;
        this.expose = expose;
        this.cause = cause;
    }
}

const badRequest = (message = "Invalid request.", code = "bad_request") =>
    new AppError(400, code, message);
const unauthorized = (message = "Authentication required.", code = "unauthorized") =>
    new AppError(401, code, message);
const forbidden = (message = "Not allowed.", code = "forbidden") =>
    new AppError(403, code, message);
const notFound = (message = "Not found.", code = "not_found") =>
    new AppError(404, code, message);
const conflict = (message = "Conflict.", code = "conflict") =>
    new AppError(409, code, message);
const payloadTooLarge = (message = "Request body is too large.", code = "payload_too_large") =>
    new AppError(413, code, message);
const tooManyRequests = (message = "Too many requests.", code = "rate_limited") =>
    new AppError(429, code, message);
const unavailable = (message = "Service temporarily unavailable.", code = "unavailable") =>
    new AppError(503, code, message);

/** Wrap an internal failure so details stay server-side. */
function internal(message = "Internal server error.", cause = null) {
    return new AppError(500, "internal_error", message, { expose: false, cause });
}

module.exports = {
    AppError,
    badRequest,
    unauthorized,
    forbidden,
    notFound,
    conflict,
    payloadTooLarge,
    tooManyRequests,
    unavailable,
    internal,
};
