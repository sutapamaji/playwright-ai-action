# 🎭 playwright-ai-action

> **AI-powered functional tests on every PR.**
> Describe what should work in plain English. Any LLM does the rest.

[![GitHub Action](https://img.shields.io/badge/GitHub_Action-Reusable_Workflow-2088FF?logo=github-actions)](https://github.com/sutapamaji/playwright-ai-action)
[![Playwright](https://img.shields.io/badge/Browser-Playwright_Chromium-45ba4b)](https://playwright.dev)
[![Provider Agnostic](https://img.shields.io/badge/LLM-Bring_Your_Own-orange)](#supported-llm-providers)

Playwright captures what the page looks like. Your chosen LLM decides if the test passes. No brittle selectors, no flaky assertions — just intent.

---

## Quick start

### 1. Add an API key secret

Go to **Settings → Secrets → Actions → New secret** and add the key for your chosen provider:

| Provider | Secret name |
|---|---|
| Groq (free) | `GROQ_API_KEY` |
| Anthropic | `ANTHROPIC_API_KEY` |
| OpenAI | `OPENAI_API_KEY` |
| Azure OpenAI | `AZURE_OPENAI_API_KEY` |
| Ollama (local) | *(no secret needed)* |
| Any other | `LLM_API_KEY` |

### 2. Create `playwright-ai.config.json` in your repo root

```json
{
  "llm": {
    "provider": "groq",
    "model": "llama3-70b-8192"
  },
  "tests": [
    {
      "name": "Homepage loads",
      "instruction": "Verify the page has a visible heading and no error messages."
    },
    {
      "name": "Login form validates",
      "instruction": "Submit the login form empty and verify a validation error appears.",
      "selector": "form"
    }
  ]
}
```

### 3. Add the workflow

```yaml
# .github/workflows/pr-checks.yml
name: PR Checks

on:
  pull_request:
    branches: [main]

jobs:
  ai-functional-tests:
    uses: sutapamaji/playwright-ai-action/.github/workflows/playwright-ai-test.yml@main
    with:
      start_command: "npm start"
      app_port: "3000"
    secrets:
      GROQ_API_KEY: ${{ secrets.GROQ_API_KEY }}
```

Open a PR. The action starts your app, browses it, and posts a comment with pass/fail for each test.

---

## Supported LLM providers

### Groq — free, no credit card
```json
"llm": { "provider": "groq", "model": "llama3-70b-8192" }
```
Get a key at [console.groq.com](https://console.groq.com). Available models:

| Model | Speed | Notes |
|---|---|---|
| `llama3-8b-8192` | ⚡ Fastest | Great for simple smoke tests |
| `llama3-70b-8192` | ✅ Balanced | **Default** |
| `mixtral-8x7b-32768` | 🔍 Wide context | Better for content-heavy pages |

Secret: `GROQ_API_KEY`

---

### Anthropic Claude
```json
"llm": { "provider": "anthropic", "model": "claude-haiku-4-5-20251001" }
```
Get a key at [console.anthropic.com](https://console.anthropic.com). Available models:

| Model | Notes |
|---|---|
| `claude-haiku-4-5-20251001` | Fast, cheap — good default |
| `claude-sonnet-4-6` | Smarter reasoning |
| `claude-opus-4-6` | Most capable |

Secret: `ANTHROPIC_API_KEY`

---

### OpenAI / ChatGPT
```json
"llm": { "provider": "openai", "model": "gpt-4o-mini" }
```
Get a key at [platform.openai.com](https://platform.openai.com). Available models:

| Model | Notes |
|---|---|
| `gpt-4o-mini` | Cost-efficient default |
| `gpt-4o` | Most capable GPT-4 |
| `gpt-3.5-turbo` | Budget option |

Secret: `OPENAI_API_KEY`

---

### Azure OpenAI (GitHub Copilot Enterprise)
```json
"llm": {
  "provider": "azure",
  "model": "gpt-4o",
  "base_url": "https://YOUR-RESOURCE.openai.azure.com"
}
```
The `model` field is your **deployment name** in Azure, not a model slug.

Secret: `AZURE_OPENAI_API_KEY`

Workflow input for API version (optional, default `2024-02-01`):
```yaml
azure_api_version: "2024-05-01-preview"
```

---

### Ollama — fully local, no API key, no cost

Run any open-source model on your own hardware with zero data leaving your network.

```json
"llm": {
  "provider": "ollama",
  "model": "llama3"
}
```

**Default base URL:** `http://localhost:11434/v1` — no config needed if Ollama runs on the default port.

First, pull the model you want to use:
```bash
ollama pull llama3        # recommended — good reasoning
ollama pull mistral       # lighter, fast
ollama pull codellama     # better at reading code-heavy pages
```

**Using Ollama in GitHub Actions CI** — Ollama doesn't run locally in the Actions runner by default, but you can start it as a service step:

```yaml
jobs:
  ai-functional-tests:
    runs-on: ubuntu-latest
    steps:
      - name: Start Ollama
        run: |
          curl -fsSL https://ollama.com/install.sh | sh
          ollama serve &
          sleep 5
          ollama pull llama3

      # ... then call playwright-ai-action as normal
```

Secret: *(none required)*

Popular models to try:

| Model | Pull command | Notes |
|---|---|---|
| `llama3` | `ollama pull llama3` | Best general reasoning — **recommended** |
| `llama3:8b` | `ollama pull llama3:8b` | Faster, lighter |
| `mistral` | `ollama pull mistral` | Good alternative |
| `phi3` | `ollama pull phi3` | Very small, surprisingly capable |
| `codellama` | `ollama pull codellama` | Understands code-heavy UIs |

---

### Custom / OpenAI-compatible endpoint

Works with OpenRouter, LM Studio, vLLM, Together AI, and anything else that speaks the OpenAI chat completions API.

```json
"llm": {
  "provider": "custom",
  "model": "mistral-7b-instruct",
  "base_url": "https://openrouter.ai/api/v1"
}
```

Secret: `LLM_API_KEY` (omit entirely for unauthenticated local endpoints)

---

## Configuration reference

### `playwright-ai.config.json`

The `llm` block in your config file **always overrides** workflow inputs.

```jsonc
{
  "llm": {
    "provider": "groq",           // required
    "model":    "llama3-70b-8192",// optional — falls back to provider default
    "base_url": "https://...",    // required for azure + custom only
    // "api_key": "..."           // NOT recommended — use GitHub Secrets instead
  },
  "tests": [
    {
      "name":         "...",      // shown in PR comment
      "instruction":  "...",      // plain-English description of what to verify
      "selector":     "form",     // optional — CSS selector to check
      "expectedText": "success"   // optional — text that should appear on the page
    }
  ]
}
```

### Workflow inputs

| Input | Default | Description |
|---|---|---|
| `start_command` | *(required)* | Shell command to start your app |
| `app_port` | `3000` | Port your app listens on |
| `test_config` | `playwright-ai.config.json` | Path to config file |
| `startup_timeout_ms` | `30000` | Max wait for app to be ready |
| `node_version` | `20` | Node.js version |
| `llm_provider` | `groq` | Provider (overridden by config file) |
| `llm_model` | *(provider default)* | Model name (overridden by config file) |
| `llm_base_url` | — | Required for azure / custom |
| `azure_api_version` | `2024-02-01` | Azure API version |

### Priority

```
playwright-ai.config.json  llm.provider / llm.model
        ↓  overrides
workflow inputs  llm_provider / llm_model
        ↓  overrides
built-in defaults  groq / llama3-70b-8192
```

---

## Works with any stack

```yaml
start_command: "npm start"                              # Node / Next.js
start_command: "python manage.py runserver 0.0.0.0:8000"  # Django
start_command: "uvicorn main:app --port 8080"           # FastAPI
start_command: "bundle exec rails server -p 3000"       # Rails
start_command: "go run ./cmd/server"                    # Go
start_command: "docker compose up --wait"               # Docker Compose
```

---

## Architecture

```
Pull Request opened
       │
       ▼
┌──────────────────────────────────────────────────────┐
│  GitHub Actions runner  (ubuntu-latest)              │
│                                                      │
│  1. npm ci                                           │
│  2. start_command → app on localhost:PORT            │
│  3. waitForPort() — no sleep, polling TCP            │
│                                                      │
│  For each test in playwright-ai.config.json:         │
│  ┌──────────────────────────────────────────────┐    │
│  │  Playwright (headless Chromium)              │    │
│  │  → navigate to localhost                     │    │
│  │  → capture structured snapshot:             │    │
│  │      title · body text · console errors     │    │
│  │      buttons · links · inputs               │    │
│  └────────────────┬─────────────────────────────┘    │
│                   │ JSON snapshot                    │
│                   ▼                                  │
│  ┌──────────────────────────────────────────────┐    │
│  │  LLM adapter  (providers.mjs)               │    │
│  │                                              │    │
│  │  groq  │  anthropic  │  openai              │    │
│  │  azure │  ollama     │  custom              │    │
│  │                                              │    │
│  │  → send snapshot + instruction              │    │
│  │  → receive { status, notes, details }       │    │
│  └──────────────────────────────────────────────┘    │
│                                                      │
│  4. Write test-results.json                          │
│  5. Kill app process                                 │
└──────────────────────────────────────────────────────┘
       │
       ▼
PR comment  +  test-results.json artifact
```

---

## License

MIT © sutapamaji
