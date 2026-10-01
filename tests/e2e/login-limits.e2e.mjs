// End-to-end: admin login is rate-limited per account AND per IP (uses the real rate limiter)
// Run with: npm run test:e2e   (Node 22+; uses tests/e2e/loader to run the real app code against an in-memory database)
import { fileURLToPath, pathToFileURL } from "node:url";
const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const load = (rel) => import(pathToFileURL(ROOT + rel).href);
import assert from "node:assert";
process.env.NODE_ENV = "test"; process.env.ADMIN_SESSION_SECRET = "s".repeat(48); process.env.ADMIN_PASSWORD = "shared-password-xyz"; delete process.env.ADMIN_USERS_JSON;
const login = (await load("pages/api/admin/login.js")).default;
const mkRes = () => ({ code: null, body: null, headers: {}, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; }, setHeader() {} });
const go = async (user, ip) => { const r = mkRes(); await login({ method: "POST", body: { username: user, password: "wrong" }, headers: { "x-forwarded-for": ip } }, r); return r.code; };
console.error = () => {};
const codes = []; for (let i = 0; i < 12; i++) codes.push(await go("victim", `203.0.113.${i + 1}`));   // 12 DIFFERENT IPs, one account
console.log("one account, 12 different IPs ->", codes.join(","));
assert.deepEqual(codes.slice(0, 10), Array(10).fill(401)); assert.deepEqual(codes.slice(10), [429, 429]);
const other = await go("someone-else", "203.0.113.50"); console.log("a different account is unaffected ->", other); assert.equal(other, 401);
const ipCodes = []; for (let i = 0; i < 12; i++) ipCodes.push(await go(`user${i}`, "192.0.2.9")); console.log("one IP, 12 different accounts ->", ipCodes.join(","));
assert.equal(ipCodes[10], 429); console.log("OK: limited by account AND by IP");
