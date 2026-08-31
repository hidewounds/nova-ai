"use strict";

/**
 * OpenAI-compatible chat-completions provider. Works with OpenAI, Azure
 * gateways, Groq, Together, LM Studio, vLLM and any compatible endpoint.
 */

async function fetchWithTimeout(url, options, timeoutMs) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.max(1000, Number(timeoutMs) || 120000));
    try {
        return await fetch(url, { ...options, signal: controller.signal });
    } finally {
        clearTimeout(timer);
    }
}

async function chat({ messages, model, baseUrl, apiKey, temperature, timeoutMs }) {
    if (!apiKey) {
        const err = new Error("No API key configured for openai-compatible provider.");
        err.code = "ai_missing_key";
        throw err;
    }

    const root = String(baseUrl || "").replace(/\/+$/, "");
    let response;
    try {
        response = await fetchWithTimeout(
            `${root}/chat/completions`,
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${apiKey}`,
                },
                body: JSON.stringify({ model, messages, temperature }),
            },
            timeoutMs
        );
    } catch (error) {
        if (error.name === "AbortError") {
            const err = new Error("AI request timed out.");
            err.code = "ai_timeout";
            throw err;
        }
        const err = new Error(`AI endpoint unreachable: ${error.message}`);
        err.code = "ai_unreachable";
        throw err;
    }

    if (!response.ok) {
        const body = await response.text().catch(() => "");
        const err = new Error(`AI provider returned HTTP ${response.status}: ${body.slice(0, 200)}`);
        err.code = "ai_http_error";
        throw err;
    }

    const data = await response.json();
    return {
        content: data?.choices?.[0]?.message?.content ?? "",
        model: data?.model || model,
        usage: data?.usage
            ? { promptTokens: data.usage.prompt_tokens ?? null, completionTokens: data.usage.completion_tokens ?? null }
            : null,
    };
}

module.exports = { name: "openai-compatible", chat };
