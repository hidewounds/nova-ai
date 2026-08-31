"use strict";

/**
 * Deterministic mock provider for tests, CI and offline development.
 * Echoes a structured acknowledgement so pipelines can be verified end to end.
 */

async function chat({ messages }) {
    const lastUser = [...(messages || [])].reverse().find((message) => message.role === "user");
    const promptPreview = lastUser ? String(lastUser.content).slice(0, 120) : "";
    return {
        content: `[mock] Understood. You said: "${promptPreview}"`,
        model: "mock",
        usage: { promptTokens: 0, completionTokens: 0 },
    };
}

module.exports = { name: "mock", chat };
