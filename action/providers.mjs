/**
 * providers.mjs
 *
 * Unified LLM adapter layer. Every provider exposes one function:
 *   chat(systemPrompt, userMessage) → { status, notes, details }
 *
 * Supported providers (set via LLM_PROVIDER env / config):
 *   groq        — Groq Cloud  (Llama 3, free tier)        console.groq.com
 *   anthropic   — Anthropic Claude                         console.anthropic.com
 *   openai      — OpenAI / ChatGPT                         platform.openai.com
 *   azure       — Azure OpenAI / GitHub Copilot Enterprise portal.azure.com
 *   ollama      — Ollama local models (no API key needed)  ollama.com
 *   custom      — Any OpenAI-compatible endpoint           (set LLM_BASE_URL)
 */

// ── Default models per provider ───────────────────────────────────────────────

export const DEFAULT_MODELS = {
  groq:      "llama3-8b-8192",
  anthropic: "claude-haiku-4-5-20251001",
  openai:    "gpt-4o-mini",
  azure:     "gpt-4o",           // Azure deployment name — override via MODEL env
  ollama:    "llama3",           // must be pulled locally: ollama pull llama3
  custom:    "gpt-3.5-turbo",    // sensible default; user should override
};

// ── Default base URLs ─────────────────────────────────────────────────────────

export const DEFAULT_BASE_URLS = {
  ollama: "http://localhost:11434/v1",
  custom: "",
};

// ── Shared JSON response parser ───────────────────────────────────────────────

function parseResult(raw) {
  try {
    const cleaned = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    return JSON.parse(cleaned);
  } catch {
    return { status: "fail", notes: "Model returned non-JSON", details: raw };
  }
}

// ── Provider implementations ──────────────────────────────────────────────────

/**
 * Groq — OpenAI-compatible, free tier, supports response_format: json_object
 * https://console.groq.com
 */
async function groqChat(systemPrompt, userMessage, { model, apiKey }) {
  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      temperature: 0,
      max_tokens: 1024,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user",   content: userMessage  },
      ],
    }),
  });
  if (!res.ok) throw new Error(`Groq ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return parseResult(data.choices?.[0]?.message?.content ?? "");
}

/**
 * Anthropic Claude — native Messages API
 * https://console.anthropic.com
 */
async function anthropicChat(systemPrompt, userMessage, { model, apiKey }) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type":      "application/json",
      "x-api-key":         apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: 1024,
      system: systemPrompt,
      messages: [{ role: "user", content: userMessage }],
    }),
  });
  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const raw = data.content?.find(b => b.type === "text")?.text ?? "";
  return parseResult(raw);
}

/**
 * OpenAI — ChatGPT / GPT-4o
 * https://platform.openai.com
 */
async function openaiChat(systemPrompt, userMessage, { model, apiKey }) {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      temperature: 0,
      max_tokens: 1024,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user",   content: userMessage  },
      ],
    }),
  });
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return parseResult(data.choices?.[0]?.message?.content ?? "");
}

/**
 * Azure OpenAI — GitHub Copilot Enterprise, MSFT deployments
 * Requires: LLM_BASE_URL  = https://<resource>.openai.azure.com
 *           MODEL         = your deployment name (e.g. "gpt-4o")
 *           LLM_API_KEY   = Azure key
 *
 * Optional: AZURE_API_VERSION (default: 2024-02-01)
 */
async function azureChat(systemPrompt, userMessage, { model, apiKey, baseUrl }) {
  const apiVersion = process.env.AZURE_API_VERSION ?? "2024-02-01";
  const endpoint = `${baseUrl.replace(/\/$/, "")}/openai/deployments/${model}/chat/completions?api-version=${apiVersion}`;

  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", "api-key": apiKey },
    body: JSON.stringify({
      temperature: 0,
      max_tokens: 1024,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user",   content: userMessage  },
      ],
    }),
  });
  if (!res.ok) throw new Error(`Azure OpenAI ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return parseResult(data.choices?.[0]?.message?.content ?? "");
}

/**
 * Ollama — local models, no API key needed
 * https://ollama.com
 *
 * Requires the Ollama server to be running and the model to be pulled:
 *   ollama serve
 *   ollama pull llama3
 *
 * In CI (GitHub Actions) you can start Ollama as a service step before running
 * this action. See README for an example.
 *
 * Note: Ollama does NOT support response_format: json_object on all models.
 * We rely on the shared parseResult() to strip markdown fences if needed.
 */
async function ollamaChat(systemPrompt, userMessage, { model, baseUrl }) {
  const endpoint = `${baseUrl.replace(/\/$/, "")}/chat/completions`;

  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      temperature: 0,
      stream: false,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user",   content: userMessage  },
      ],
    }),
  });
  if (!res.ok) throw new Error(`Ollama ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return parseResult(data.choices?.[0]?.message?.content ?? "");
}

/**
 * Custom — any OpenAI-compatible endpoint
 * e.g. OpenRouter, LM Studio, vLLM, Together AI
 * Requires: LLM_BASE_URL  = base URL of the endpoint
 * Optional: LLM_API_KEY   = bearer token (omit for unauthenticated endpoints)
 */
async function customChat(systemPrompt, userMessage, { model, apiKey, baseUrl }) {
  const endpoint = `${baseUrl.replace(/\/$/, "")}/chat/completions`;
  const headers  = { "Content-Type": "application/json" };
  if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;

  const res = await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model,
      temperature: 0,
      max_tokens: 1024,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user",   content: userMessage  },
      ],
    }),
  });
  if (!res.ok) throw new Error(`Custom LLM ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return parseResult(data.choices?.[0]?.message?.content ?? "");
}

// ── Provider registry & factory ───────────────────────────────────────────────

const PROVIDERS = {
  groq:      groqChat,
  anthropic: anthropicChat,
  openai:    openaiChat,
  azure:     azureChat,
  ollama:    ollamaChat,
  custom:    customChat,
};

// Providers that need no API key
const NO_KEY_PROVIDERS = new Set(["ollama"]);

// Providers that require a base URL
const NEEDS_BASE_URL = new Set(["azure", "ollama", "custom"]);

/**
 * Build a ready-to-call chat function from env + config.
 *
 * Priority (highest → lowest):
 *   1. playwright-ai.config.json  llm.provider / llm.model / llm.base_url
 *   2. Env vars                   LLM_PROVIDER / MODEL / LLM_BASE_URL
 *   3. Hard defaults per provider
 */
export function buildProvider(configLlm = {}) {
  const provider = (configLlm.provider ?? process.env.LLM_PROVIDER ?? "groq").toLowerCase();
  const model    = configLlm.model    ?? process.env.MODEL        ?? DEFAULT_MODELS[provider] ?? DEFAULT_MODELS.groq;
  const apiKey   = configLlm.api_key  ?? process.env.LLM_API_KEY  ?? legacyKey(provider);
  const baseUrl  = configLlm.base_url ?? process.env.LLM_BASE_URL ?? DEFAULT_BASE_URLS[provider] ?? "";

  if (!PROVIDERS[provider]) {
    const valid = Object.keys(PROVIDERS).join(", ");
    throw new Error(`Unknown LLM provider "${provider}". Valid options: ${valid}`);
  }

  // API key required for cloud providers
  if (!NO_KEY_PROVIDERS.has(provider) && !apiKey) {
    throw new Error(
      `No API key found for provider "${provider}".\n` +
      `  Set the "${legacyKeyName(provider)}" GitHub secret, or add "api_key" to your config's llm block.\n` +
      `  See README → Supported LLM providers for details.`
    );
  }

  // Base URL required (or defaulted) for local/self-hosted providers
  if (NEEDS_BASE_URL.has(provider) && !baseUrl) {
    throw new Error(
      `LLM_BASE_URL is required for provider "${provider}".\n` +
      `  Set it in playwright-ai.config.json → llm.base_url or as the LLM_BASE_URL env var.`
    );
  }

  const fn = PROVIDERS[provider];
  const displayUrl = baseUrl ? `  base: ${baseUrl}` : "";
  console.log(`🤖  provider: ${provider}  |  model: ${model}${displayUrl}`);

  return (systemPrompt, userMessage) => fn(systemPrompt, userMessage, { model, apiKey, baseUrl });
}

/** Support legacy per-provider key names (GROQ_API_KEY, ANTHROPIC_API_KEY, etc.) */
function legacyKey(provider) {
  const map = {
    groq:      process.env.GROQ_API_KEY,
    anthropic: process.env.ANTHROPIC_API_KEY,
    openai:    process.env.OPENAI_API_KEY,
    azure:     process.env.AZURE_OPENAI_API_KEY,
    ollama:    undefined,  // no key needed for local Ollama
  };
  return map[provider];
}

function legacyKeyName(provider) {
  const map = {
    groq:      "GROQ_API_KEY",
    anthropic: "ANTHROPIC_API_KEY",
    openai:    "OPENAI_API_KEY",
    azure:     "AZURE_OPENAI_API_KEY",
  };
  return map[provider] ?? "LLM_API_KEY";
}
