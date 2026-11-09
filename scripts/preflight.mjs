#!/usr/bin/env node
/**
 * Pre-launch check. Usage:
 *   npm run preflight                      checks .env.production.local (or .env.local if that doesn't exist)
 *   npm run preflight -- path/to/envfile   checks a specific file (e.g. one exported from Vercel)
 * Prints pass / warn / fail for each item without ever printing a value. Exit code 1 if anything fails.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { hasFailures, runPreflight } from "./preflight-checks.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const candidates = process.argv[2] ? [path.resolve(process.argv[2])] : [".env.production.local", ".env.local"].map((f) => path.join(root, f));
const file = candidates.find((f) => existsSync(f));
if (!file) {
  console.error(`No env file found (looked for ${candidates.map((f) => path.basename(f)).join(", ")}).`);
  process.exit(1);
}

function parseEnvFile(text) {
  const env = {};
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!m) continue;
    env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, "$2");
  }
  return env;
}

const env = parseEnvFile(readFileSync(file, "utf8"));
const legalSource = readFileSync(path.join(root, "src/components/marketing/legal-page.tsx"), "utf8");
const legalReviewed = /export const LEGAL_REVIEWED = true/.test(legalSource) ? true : /export const LEGAL_REVIEWED = false/.test(legalSource) ? false : undefined;

const results = runPreflight(env, { legalReviewed });
const icon = { pass: "PASS", warn: "WARN", fail: "FAIL" };
console.log(`Checking ${path.relative(root, file) || file}\n`);
for (const r of results) console.log(`${icon[r.level]}  ${r.name}: ${r.detail}`);
const counts = Object.fromEntries(["pass", "warn", "fail"].map((l) => [l, results.filter((r) => r.level === l).length]));
console.log(`\n${counts.pass} passed, ${counts.warn} warnings, ${counts.fail} must be fixed before launch.`);
process.exit(hasFailures(results) ? 1 : 0);
