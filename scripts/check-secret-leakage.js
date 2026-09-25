const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();
const EXTENSIONS = new Set([".js", ".jsx", ".mjs", ".cjs", ".json", ".yml", ".yaml", ".md", ".env"]);
const SKIP_DIRS = new Set([".git", ".next", "node_modules", "coverage", "dist"]);

const rawSecretPatterns = [
  { name: "Paystack secret key", regex: /\bsk_(?:live|test)_[A-Za-z0-9]{16,}\b/ },
  { name: "Google API key", regex: /\bAIza[A-Za-z0-9_-]{20,}\b/ },
  { name: "AWS access key", regex: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: "PEM private key", regex: /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/ },
  { name: "GitHub token", regex: /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/ },
  { name: "Slack token", regex: /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/ },
];

const assignmentPatterns = [
  { name: "Supabase service-role assignment", regex: /SUPABASE_SERVICE_ROLE_KEY\s*[:=]\s*["']([^"']*)["']/i },
  { name: "Paystack secret assignment", regex: /PAYSTACK_SECRET_KEY\s*[:=]\s*["']([^"']*)["']/i },
  { name: "Techlink API key assignment", regex: /TECHLINK_API_KEY\s*[:=]\s*["']([^"']*)["']/i },
  { name: "Gemini API key assignment", regex: /GEMINI_API_KEY\s*[:=]\s*["']([^"']*)["']/i },
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

function looksPlaceholder(value) {
  const v = String(value || "").trim();
  return !v ||
    /^x+$/i.test(v) ||
    /^your_/i.test(v) ||
    /^replace_/i.test(v) ||
    /^choose_/i.test(v) ||
    /^<.*>$/.test(v) ||
    /^tlg_test_/i.test(v) ||
    /^sk_(?:live|test)_x+$/i.test(v);
}

const matches = [];
for (const file of walk(ROOT)) {
  const relative = path.relative(ROOT, file);
  const text = fs.readFileSync(file, "utf8");

  for (const pattern of rawSecretPatterns) {
    if (pattern.regex.test(text)) {
      const isExample = relative === ".env.example";
      const isPlaceholderPaystack = pattern.name === "Paystack secret key" && /sk_test_x{8,}/i.test(text);
      if (!isExample || !isPlaceholderPaystack) matches.push(`${relative} — ${pattern.name}`);
    }
  }

  for (const pattern of assignmentPatterns) {
    const matchesInFile = [...text.matchAll(new RegExp(pattern.regex.source, pattern.regex.flags.includes("g") ? pattern.regex.flags : pattern.regex.flags + "g"))];
    for (const match of matchesInFile) {
      if (!looksPlaceholder(match[1])) {
        matches.push(`${relative} — ${pattern.name}`);
      }
    }
  }
}

if (matches.length) {
  console.error("Potential secret material found:");
  for (const match of matches) console.error(`- ${match}`);
  process.exit(1);
}

console.log("Secret-leakage scan passed.");
