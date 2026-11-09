// Prompts for the Supabase values and writes them into .env.local, so secrets never pass through
// chat or an editor. Run with `node scripts/set-supabase-env.mjs`; press Enter to keep a current value.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

const file = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", ".env.local");
let text = existsSync(file) ? readFileSync(file, "utf8") : "";

const fields = [
  { key: "NEXT_PUBLIC_SUPABASE_URL", label: "Project URL (https://xxxx.supabase.co)", check: (v) => /^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/.test(v) },
  { key: "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", label: "Publishable key (sb_publishable_...)", check: (v) => v.startsWith("sb_publishable_") || v.startsWith("eyJ") },
  { key: "SUPABASE_SECRET_KEY", label: "Secret key (sb_secret_...)", secret: true, check: (v) => v.startsWith("sb_secret_") || v.startsWith("eyJ") },
  { key: "SUPABASE_DB_URL", label: "Session pooler connection string (postgresql://..., password filled in)", secret: true, check: (v) => v.startsWith("postgres") && !v.includes("[YOUR-PASSWORD]") },
];

const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
let muted = false;
const write = rl._writeToOutput.bind(rl);
rl._writeToOutput = (s) => (muted && !s.includes("\n") ? write("*") : write(s));

function ask(question, secret) {
  return new Promise((resolve) => {
    rl.question(`${question}: `, (answer) => {
      muted = false;
      resolve(answer.trim().replace(/^["']|["']$/g, ""));
    });
    muted = Boolean(secret);
  });
}

for (const f of fields) {
  const current = text.match(new RegExp(`^${f.key}=(.*)$`, "m"))?.[1].trim();
  for (;;) {
    const value = await ask(`${f.label}${current ? " [Enter = keep current]" : ""}`, f.secret);
    if (!value && current) break;
    if (value && f.check(value)) {
      const line = `${f.key}=${value}`;
      text = new RegExp(`^${f.key}=.*$`, "m").test(text) ? text.replace(new RegExp(`^${f.key}=.*$`, "m"), () => line) : `${text.trimEnd()}\n${line}\n`;
      break;
    }
    console.log(value ? "  That doesn't look right, please paste it again." : "  This one is required.");
  }
}
rl.close();
writeFileSync(file, text);
console.log("\nSaved to .env.local. Go back to Claude and say it's done.");
