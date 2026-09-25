import fs from "fs";
import path from "path";

const ROOT = process.cwd();
const EXTENSIONS = new Set([".js", ".jsx", ".mjs", ".cjs", ".json", ".yml", ".yaml", ".md", ".env", ".example"]);
const SKIP_DIRS = new Set([".git", ".next", "node_modules", "coverage", "dist"]);

const patterns = [
  { name: "Paystack live/test secret key", regex: /\bsk_(?:live|test)_[A-Za-z0-9]{16,}\b/ },
  { name: "Google API key", regex: /\bAIza[A-Za-z0-9_-]{20,}\b/ },
  { name: "AWS access key", regex: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: "PEM private key", regex: /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/ },
  { name: "GitHub token", regex: /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/ },
  { name: "Slack token", regex: /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/ },
  { name: "Supabase service-role assignment", regex: /SUPABASE_SERVICE_ROLE_KEY\s*[:=]\s*["'](?!\$|your_|replace_|<)/i },
  { name: "Paystack secret assignment", regex: /PAYSTACK_SECRET_KEY\s*[:=]\s*["'](?!\$|your_|replace_|<)/i },
  { name: "Techlink API key assignment", regex: /TECHLINK_API_KEY\s*[:=]\s*["'](?!\$|your_|replace_|<)/i },
  { name: "Gemini API key assignment", regex: /GEMINI_API_KEY\s*[:=]\s*["'](?!\$|your_|replace_|<)/i },
];

function walk(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, files);
    else if (EXTENSIONS.has(path.extname(entry.name).toLowerCase()) || entry.name.startsWith(".env")) files.push(full);
  }
  return files;
}

const matches = [];
for (const file of walk(ROOT)) {
  const text = fs.readFileSync(file, "utf8");
  for (const pattern of patterns) {
    if (pattern.regex.test(text)) matches.push(`${path.relative(ROOT, file)} — ${pattern.name}`);
  }
}

if (matches.length) {
  console.error("Potential secret material found:");
  for (const match of matches) console.error(`- ${match}`);
  process.exit(1);
}

console.log("Secret-leakage scan passed.");
