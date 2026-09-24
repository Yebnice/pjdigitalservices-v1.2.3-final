const fs = require("node:fs");
const path = require("node:path");

const root = path.join(process.cwd(), "pages", "api");
const failures = [];

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.isFile() && entry.name.endsWith(".js")) {
      const lines = fs.readFileSync(full, "utf8").split(/\r?\n/);
      lines.forEach((line, index) => {
        if (/\brateLimit\s*\(/.test(line) && !/\bawait\s+rateLimit\s*\(/.test(line)) {
          failures.push(`${path.relative(process.cwd(), full)}:${index + 1}: rateLimit call must be awaited`);
        }
      });
    }
  }
}

walk(root);

if (failures.length) {
  console.error("Rate-limit await check failed:");
  for (const failure of failures) console.error(failure);
  process.exit(1);
}

console.log("Rate-limit await check passed.");
