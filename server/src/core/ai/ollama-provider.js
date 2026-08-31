"use strict";

/**
 * Ollama provider (OpenAI-style local runtime).
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

async function chat({ messages, model, baseUrl, temperature, timeoutMs }) {
    const root = String(baseUrl || "").replace(/\/+$/, "");
    let response;
    try {
        response = await fetchWithTimeout(
            `${root}/api/chat`,
            {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    model,
                    messages,
                    stream: false,
                    options: { temperature },
                }),
            },
            timeoutMs
        );
    } catch (error) {
        if (error.name === "AbortError") {
            const err = new Error("Ollama request timed out.");
            err.code = "ai_timeout";
            throw err;
        }
        const err = new Error(`Ollama is unreachable: ${error.message}`);
        err.code = "ai_unreachable";
        throw err;
    }

    if (!response.ok) {
        const body = await response.text().catch(() => "");
        const err = new Error(`Ollama returned HTTP ${response.status}: ${body.slice(0, 200)}`);
        err.code = "ai_http_error";
        throw err;
    }

    const data = await response.json();
    return {
        content: data?.message?.content ?? "",
        model: data?.model || model,
        usage: data?.prompt_eval_count
            ? { promptTokens: data.prompt_eval_count, completionTokens: data.eval_count ?? null }
            : null,
    };
}

module.exports = { name: "ollama", chat };
