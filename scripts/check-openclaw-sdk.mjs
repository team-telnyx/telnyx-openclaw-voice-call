#!/usr/bin/env node

const REQUIRED_EXPORTS = {
  "openclaw/plugin-sdk/security-runtime": [
    "appendRegularFile",
    "privateFileStore",
    "privateFileStoreSync",
    "root",
  ],
  "openclaw/plugin-sdk/realtime-voice": [
    "createTalkSessionController",
    "recordTalkObservabilityEvent",
    "resolveRealtimeVoiceFastContextConsult",
  ],
};

const missing = [];
let openclawVersion = "unknown";

try {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const entryUrl = await import.meta.resolve("openclaw");
  let dir = path.dirname(new URL(entryUrl).pathname);
  for (let i = 0; i < 5; i += 1) {
    const packagePath = path.join(dir, "package.json");
    if (fs.existsSync(packagePath)) {
      openclawVersion = JSON.parse(fs.readFileSync(packagePath, "utf8")).version ?? openclawVersion;
      break;
    }
    dir = path.dirname(dir);
  }
} catch {
  // Some OpenClaw package layouts hide package metadata; keep version unknown.
}

for (const [specifier, names] of Object.entries(REQUIRED_EXPORTS)) {
  let mod;
  try {
    mod = await import(specifier);
  } catch (error) {
    missing.push(`${specifier}: failed to import (${error?.message ?? String(error)})`);
    continue;
  }

  for (const name of names) {
    if (!(name in mod)) {
      missing.push(`${specifier}: missing ${name}`);
    }
  }
}

if (missing.length > 0) {
  console.error("\n[voice-call] Incompatible OpenClaw SDK detected.");
  console.error(`[voice-call] Installed OpenClaw version: ${openclawVersion}`);
  console.error("[voice-call] Missing required SDK exports:");
  for (const item of missing) {
    console.error(`  - ${item}`);
  }
  console.error("\nThis AIF-126 checkout currently requires the unreleased/local OpenClaw SDK that contains the realtime voice runtime exports.");
  console.error("For local validation from Ifthikar's workspace, run:");
  console.error("  npm install --no-save /Users/ifthikar/projects/openclaw-aif-126");
  console.error("  npm run build");
  console.error("\nDo not publish this plugin against npm openclaw until those SDK exports are released or the dependency is pinned to a compatible package.\n");
  process.exit(1);
}
