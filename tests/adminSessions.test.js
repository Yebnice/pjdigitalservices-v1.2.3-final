import crypto from "crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { adminSessionActor, authenticateAdmin, createAdminSession, isSameOriginRequest, requireAdminPermission, requireAdminRole } from "../lib/adminAuth.js";

const hash = (pw) => {
  const salt = crypto.randomBytes(8).toString("hex");
  return `${salt}$${crypto.scryptSync(pw, salt, 32).toString("hex")}`;
};
const setUsers = (list) => { process.env.ADMIN_USERS_JSON = JSON.stringify(list); };
const cookieFor = (identity) => {
  let cookie;
  createAdminSession({ setHeader: (_k, v) => { cookie = v; } }, identity);
  return cookie.split(";")[0];
};
const req = (cookie, extra = {}) => ({ method: "GET", ...extra, headers: { cookie, host: "pjdigitalservices.online", ...(extra.headers || {}) } });
const makeRes = () => ({ code: null, status(c) { this.code = c; return this; }, json() { return this; } });

let saved;
beforeEach(() => {
  saved = { s: process.env.ADMIN_SESSION_SECRET, p: process.env.ADMIN_PASSWORD, u: process.env.ADMIN_USERS_JSON };
  process.env.ADMIN_SESSION_SECRET = "s".repeat(48);
  process.env.ADMIN_PASSWORD = "shared-pass-123";
  delete process.env.ADMIN_USERS_JSON;
});
afterEach(() => {
  for (const [k, v] of [["ADMIN_SESSION_SECRET", saved.s], ["ADMIN_PASSWORD", saved.p], ["ADMIN_USERS_JSON", saved.u]]) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
});

describe("admin sign-in roles", () => {
  it("treats a missing or misspelt role as viewer, never admin", () => {
    setUsers([{ username: "a", passwordHash: hash("pw-a-12345") }, { username: "b", role: "adminn", passwordHash: hash("pw-b-12345") }]);
    expect(authenticateAdmin("a", "pw-a-12345").role).toBe("viewer");
    expect(authenticateAdmin("b", "pw-b-12345").role).toBe("viewer");
  });

  it("refuses disabled users", () => {
    setUsers([{ username: "x", role: "admin", disabled: true, passwordHash: hash("pw-x-12345") }]);
    expect(authenticateAdmin("x", "pw-x-12345")).toBeNull();
  });
});

describe("admin sessions are re-checked against the current configuration", () => {
  it("ends a live session when the user is removed", () => {
    setUsers([{ username: "ops", role: "operator", passwordHash: hash("p-1234567") }]);
    const cookie = cookieFor({ username: "ops", role: "operator" });
    expect(adminSessionActor(req(cookie))).toEqual({ username: "ops", role: "operator" });
    setUsers([{ username: "someone-else", role: "admin", passwordHash: hash("q-1234567") }]);
    expect(adminSessionActor(req(cookie))).toBeNull();
  });

  it("ends a live session when the user is disabled", () => {
    setUsers([{ username: "ops", role: "operator", passwordHash: hash("p-1234567") }]);
    const cookie = cookieFor({ username: "ops", role: "operator" });
    setUsers([{ username: "ops", role: "operator", disabled: true, passwordHash: hash("p-1234567") }]);
    expect(adminSessionActor(req(cookie))).toBeNull();
  });

  it("applies a demotion immediately", () => {
    setUsers([{ username: "ops", role: "admin", passwordHash: hash("p-1234567") }]);
    const cookie = cookieFor({ username: "ops", role: "admin" });
    setUsers([{ username: "ops", role: "viewer", passwordHash: hash("p-1234567") }]);
    expect(adminSessionActor(req(cookie)).role).toBe("viewer");
  });

  it("never lets the role claimed inside a cookie beat the configured role", () => {
    setUsers([{ username: "ops", role: "operator", passwordHash: hash("p-1234567") }]);
    const cookie = cookieFor({ username: "ops", role: "admin" });
    expect(adminSessionActor(req(cookie)).role).toBe("operator");
  });

  it("invalidates named sessions when the deployment goes back to the shared password", () => {
    setUsers([{ username: "ops", role: "operator", passwordHash: hash("p-1234567") }]);
    const cookie = cookieFor({ username: "ops", role: "operator" });
    delete process.env.ADMIN_USERS_JSON;
    expect(adminSessionActor(req(cookie))).toBeNull();
  });

  it("still accepts shared-password sessions and rejects tampered cookies", () => {
    const cookie = cookieFor({ username: "admin", role: "admin" });
    expect(adminSessionActor(req(cookie))).toEqual({ username: "admin", role: "admin" });
    expect(adminSessionActor(req(cookie.slice(0, -3) + "abc"))).toBeNull();
  });
});

describe("cross-origin protection and the permission gate", () => {
  it("blocks cross-origin state-changing requests but not same-origin, origin-less or GET ones", () => {
    const cookie = cookieFor({ username: "admin", role: "admin" });
    const post = (headers) => { const res = makeRes(); const actor = requireAdminRole({ method: "POST", headers: { cookie, host: "pjdigitalservices.online", ...headers } }, res, ["operator"]); return { actor, code: res.code }; };
    expect(post({ origin: "https://evil.example" }).code).toBe(403);
    expect(post({ "sec-fetch-site": "cross-site" }).code).toBe(403);
    expect(post({ origin: "https://pjdigitalservices.online" }).actor).toBeTruthy();
    expect(post({}).actor).toBeTruthy();
    expect(isSameOriginRequest({ headers: { origin: "not a url", host: "x" } })).toBe(false);
    const res = makeRes();
    expect(requireAdminRole({ method: "GET", headers: { cookie, host: "pjdigitalservices.online", origin: "https://evil.example" } }, res, ["viewer"])).toBeTruthy();
  });

  it("keeps the export and manual-delivery actions away from operators", () => {
    setUsers([{ username: "op", role: "operator", passwordHash: hash("p-1234567") }, { username: "ad", role: "admin", passwordHash: hash("p-1234567") }]);
    const gate = (user, role, permission) => { const res = makeRes(); const actor = requireAdminPermission(req(cookieFor({ username: user, role })), res, permission); return { actor, code: res.code }; };
    expect(gate("op", "operator", "orders.export").code).toBe(403);
    expect(gate("op", "operator", "orders.confirm_fulfilled").code).toBe(403);
    expect(gate("ad", "admin", "orders.export").actor).toBeTruthy();
    expect(gate("op", "operator", "orders.process").actor).toBeTruthy();
  });
});
