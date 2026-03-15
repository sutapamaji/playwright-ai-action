#!/usr/bin/env node
/**
 * playwright-ai-action — runner.mjs
 *
 * Spins up your app on localhost, captures structured page snapshots with
 * Playwright, and sends them to your chosen LLM for natural-language QA.
 *
 * ── LLM configuration (config file wins over env vars) ───────────────────────
 *
 *   In playwright-ai.config.json:
 *     "llm": { "provider": "groq", "model": "llama3-8b-8192", "api_key": "..." }
 *
 *   Or via environment variables:
 *     LLM_PROVIDER   groq | anthropic | openai | azure | custom
 *     LLM_API_KEY    your API key  (or GROQ_API_KEY / ANTHROPIC_API_KEY / OPENAI_API_KEY / AZURE_OPENAI_API_KEY)
 *     MODEL          model name / deployment name
 *     LLM_BASE_URL   required for azure and custom providers
 *
 * ── App configuration ─────────────────────────────────────────────────────────
 *
 *     START_COMMAND       shell command to start your app
 *     APP_PORT            port your app listens on  (default: 3000)
 *     TEST_CONFIG         path to config file       (default: playwright-ai.config.json)
 *     STARTUP_TIMEOUT_MS  ms to wait for port       (default: 30000)
 */

import { chromium }                         from "playwright";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve }                           from "path";
import { spawn }                             from "child_process";
import { createConnection }                  from "net";
import { buildProvider }                     from "./providers.mjs";

// ── Env ───────────────────────────────────────────────────────────────────────

const START_COMMAND   = process.env.START_COMMAND;
const APP_PORT        = parseInt(process.env.APP_PORT        ?? "3000",  10);
const CONFIG_PATH     = process.env.TEST_CONFIG              ?? "playwright-ai.config.json";
const STARTUP_TIMEOUT = parseInt(process.env.STARTUP_TIMEOUT_MS ?? "30000", 10);
const APP_URL         = `http://localhost:${APP_PORT}`;

// ── Load config ───────────────────────────────────────────────────────────────

let userConfig = {};

if (existsSync(resolve(CONFIG_PATH))) {
  try {
    userConfig = JSON.parse(readFileSync(resolve(CONFIG_PATH), "utf8"));
    console.log(`✅  Loaded config: ${CONFIG_PATH}`);
  } catch {
    console.warn(`⚠️   Could not parse ${CONFIG_PATH} — using defaults.`);
  }
} else {
  console.log(`ℹ️   No config at ${CONFIG_PATH} — running default smoke tests.`);
}

// ── Resolve LLM provider (config.llm beats env vars) ─────────────────────────

let callLLM;
try {
  callLLM = buildProvider(userConfig.llm ?? {});
} catch (err) {
  console.error(`\n❌  LLM setup failed: ${err.message}`);
  console.error(`    See README for configuration options.\n`);
  process.exit(1);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

const DEFAULT_TESTS = [
  {
    name: "Page loads successfully",
    instruction: "Verify the page title is non-empty and the body has visible text. Fail if the page shows a 404, 500, or blank screen.",
  },
  {
    name: "No critical JS errors on load",
    instruction: "Check the captured console errors list. Fail if any Error-level exceptions appear.",
  },
  {
    name: "Interactive elements are present",
    instruction: "Verify at least one button, link, or form input is visible. Fail if none exist.",
  },
];

const testsToRun = userConfig.tests?.length > 0 ? userConfig.tests : DEFAULT_TESTS;

// ── Helpers ───────────────────────────────────────────────────────────────────

function waitForPort(port, timeoutMs) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    const attempt  = () => {
      const socket = createConnection(port, "127.0.0.1");
      socket.once("connect", () => { socket.destroy(); resolve(); });
      socket.once("error",   () => {
        socket.destroy();
        if (Date.now() > deadline) return reject(new Error(`Timed out waiting for port ${port}`));
        setTimeout(attempt, 500);
      });
    };
    attempt();
  });
}

async function capturePageSnapshot(page, test) {
  const snapshot = {
    url:           page.url(),
    title:         await page.title(),
    bodyText:      (await page.evaluate(() => document.body?.innerText ?? ""))
                     .replace(/\s+/g, " ").trim().slice(0, 3000),
    consoleErrors: page.__capturedErrors ?? [],
    buttons:       await page.evaluate(() =>
      [...document.querySelectorAll("button,[role=button]")]
        .map(el => el.innerText?.trim() || el.getAttribute("aria-label") || "(unnamed)")
        .filter(Boolean).slice(0, 20)),
    links:         await page.evaluate(() =>
      [...document.querySelectorAll("a[href]")]
        .map(el => ({ text: el.innerText?.trim().slice(0, 60), href: el.getAttribute("href") }))
        .filter(l => l.text).slice(0, 20)),
    inputs:        await page.evaluate(() =>
      [...document.querySelectorAll("input,textarea,select")]
        .map(el => ({ type: el.type || el.tagName, name: el.name || el.placeholder || el.id }))
        .slice(0, 20)),
  };

  if (test.selector) {
    snapshot.selectorChecked = test.selector;
    snapshot.selectorPresent = await page.locator(test.selector).count() > 0;
  }
  if (test.expectedText) {
    snapshot.expectedTextChecked = test.expectedText;
    snapshot.expectedTextFound   = snapshot.bodyText.toLowerCase()
      .includes(test.expectedText.toLowerCase());
  }

  return snapshot;
}

const SYSTEM_PROMPT = `You are a QA engineer analysing a web page snapshot to determine if a functional test passes.
You will receive a test instruction and a JSON snapshot of the page state.

Respond ONLY with a valid JSON object — no markdown fences, no prose outside the object:
{
  "status": "pass" or "fail",
  "notes": "one-line verdict summary, max 120 chars",
  "details": "markdown: what you observed, what you checked, why pass or fail"
}`;

// ── App lifecycle ─────────────────────────────────────────────────────────────

let appProcess = null;

async function startApp() {
  if (!START_COMMAND) {
    console.log(`ℹ️   No START_COMMAND — assuming app is already on port ${APP_PORT}.`);
    return;
  }
  console.log(`\n🚀  Starting: ${START_COMMAND}`);
  appProcess = spawn(START_COMMAND, { shell: true, stdio: "inherit" });
  appProcess.on("error", err => console.error(`❌  App start error: ${err.message}`));

  console.log(`⏳  Waiting for port ${APP_PORT} (timeout: ${STARTUP_TIMEOUT}ms)…`);
  await waitForPort(APP_PORT, STARTUP_TIMEOUT);
  console.log(`✅  App ready → ${APP_URL}\n`);
}

function stopApp() {
  if (appProcess) { appProcess.kill("SIGTERM"); console.log("\n🛑  App stopped."); }
}

// ── Main ──────────────────────────────────────────────────────────────────────

const results = [];

try {
  await startApp();

  const browser = await chromium.launch({ headless: true });
  console.log(`\n🎭  Running ${testsToRun.length} test(s) against ${APP_URL}\n`);

  for (const test of testsToRun) {
    console.log(`▶   ${test.name}`);

    const context = await browser.newContext();
    const page    = await context.newPage();
    page.__capturedErrors = [];
    page.on("console", msg => { if (msg.type() === "error") page.__capturedErrors.push(msg.text()); });

    let snapshot;
    try {
      await page.goto(APP_URL, { waitUntil: "networkidle", timeout: 15000 });
      snapshot = await capturePageSnapshot(page, test);
    } catch (navErr) {
      snapshot = { url: APP_URL, navError: navErr.message };
    }
    await context.close();

    const userMessage = `Test: ${test.name}\nInstruction: ${test.instruction}\n\nPage snapshot:\n${JSON.stringify(snapshot, null, 2)}`;

    let result;
    try {
      result = await callLLM(SYSTEM_PROMPT, userMessage);
    } catch (llmErr) {
      result = { status: "fail", notes: `LLM error: ${llmErr.message}`, details: llmErr.stack ?? "" };
    }

    const icon = result.status === "pass" ? "✅" : "❌";
    console.log(`    ${icon} ${result.status.toUpperCase()}: ${result.notes}`);
    results.push({ name: test.name, ...result });
  }

  await browser.close();
} finally {
  stopApp();
}

// ── Output ────────────────────────────────────────────────────────────────────

writeFileSync("test-results.json", JSON.stringify(results, null, 2));

const passed = results.filter(r => r.status === "pass").length;
const failed = results.filter(r => r.status === "fail").length;

console.log(`\n────────────────────────────────────`);
console.log(`🎭  Results: ${passed} passed, ${failed} failed`);
console.log(`────────────────────────────────────\n`);

if (failed > 0) process.exit(1);
