// Module-resolution hooks for the end-to-end tests. They let the app's own
// source run in plain Node by doing what Next.js does for it:
//   - resolve extension-less imports ("./store" -> "./store.js")
//   - swap the real Supabase client for an in-memory database (memdb.mjs)
//   - stub the Upstash packages (and, unless REAL_RATE_LIMIT is set, rateLimit)
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const stub = (file) => ({ url: pathToFileURL(path.join(here, file)).href, shortCircuit: true });

export async function resolve(specifier, context, nextResolve) {
  if (specifier === "@upstash/ratelimit" || specifier === "@upstash/redis") return stub("upstashStub.mjs");
  if (/supabaseClient(\.js)?$/.test(specifier)) return stub("memdb.mjs");
  if (!process.env.REAL_RATE_LIMIT && /(^|\/)rateLimit(\.js)?$/.test(specifier)) return stub("rateLimitStub.mjs");
  if ((specifier.startsWith("./") || specifier.startsWith("../")) && context.parentURL && !path.extname(specifier)) {
    const base = path.resolve(path.dirname(fileURLToPath(context.parentURL)), specifier);
    if (existsSync(`${base}.js`)) return { url: pathToFileURL(`${base}.js`).href, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}
