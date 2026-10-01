#!/usr/bin/env node
// Creates one admin account entry (password hash + optional two-factor secret)
// for ADMIN_USERS_JSON, or a two-factor secret for the single shared login.
//
//   npm run admin:user -- --username kofi --role operator
//   npm run admin:user -- --username ama --role admin --no-2fa
//   npm run admin:user -- --shared-totp
//
// The password is read from a hidden prompt (or piped stdin), never from a
// command-line argument, so it does not end up in your shell history.

import crypto from "crypto";
import readline from "readline";
import { generateTotpSecret, otpauthUri } from "../lib/totp.js";

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const value = (name) => { const i = args.indexOf(`--${name}`); return i !== -1 ? args[i + 1] : undefined; };

function prompt(question, { hidden = false } = {}) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: Boolean(process.stdin.isTTY) });
    if (hidden && process.stdin.isTTY) {
      rl._writeToOutput = (text) => { if (text.includes(question)) process.stdout.write(text); };
    }
    rl.question(question, (answer) => { rl.close(); if (hidden && process.stdin.isTTY) process.stdout.write("\n"); resolve(answer); });
  });
}

function show2fa(secret, account) {
  console.log("\nTwo-factor secret (type this into Google Authenticator, Microsoft Authenticator, Authy or 1Password):");
  console.log(`  ${secret.match(/.{1,4}/g).join(" ")}`);
  console.log("\nOr paste this link into any tool that makes a QR code:");
  console.log(`  ${otpauthUri({ secret, account })}`);
}

if (flag("help") || flag("h")) {
  console.log("Usage:\n  npm run admin:user -- --username <name> --role <viewer|operator|admin> [--no-2fa]\n  npm run admin:user -- --shared-totp");
  process.exit(0);
}

if (flag("shared-totp")) {
  const secret = generateTotpSecret();
  console.log("Add this to your environment (Vercel → Settings → Environment Variables):\n");
  console.log(`  ADMIN_TOTP_SECRET=${secret}`);
  console.log("  ADMIN_REQUIRE_2FA=true   # optional: refuse sign-in without a code");
  show2fa(secret, "shared admin");
  console.log("\nEvery session opened without a code stops working once ADMIN_TOTP_SECRET is set.");
  process.exit(0);
}

const username = String(value("username") || "").trim().toLowerCase();
const role = String(value("role") || "").trim().toLowerCase();
if (!/^[a-z0-9._-]{2,40}$/.test(username)) { console.error("Give a username of 2-40 letters, numbers, dots, dashes or underscores: --username kofi"); process.exit(1); }
if (!["viewer", "operator", "admin"].includes(role)) { console.error("Give a role: --role viewer | operator | admin"); process.exit(1); }

const password = await prompt("Password (min 12 characters): ", { hidden: true });
if (password.length < 12) { console.error("That password is too short. Use at least 12 characters."); process.exit(1); }
if (process.stdin.isTTY) {
  const again = await prompt("Repeat password: ", { hidden: true });
  if (again !== password) { console.error("The passwords did not match."); process.exit(1); }
}

const salt = crypto.randomBytes(16).toString("hex");
const passwordHash = `${salt}$${crypto.scryptSync(password, salt, 32).toString("hex")}`;
const entry = { username, role, passwordHash };
let secret = "";
if (!flag("no-2fa")) { secret = generateTotpSecret(); entry.totpSecret = secret; }

console.log("\nAdd this object to the ADMIN_USERS_JSON array (keep the existing accounts in it):\n");
console.log(JSON.stringify(entry, null, 2));
if (secret) show2fa(secret, username);
console.log("\nADMIN_USERS_JSON must stay on ONE line in Vercel, e.g. [{...},{...}]. Redeploy after changing it.");
console.log("Once it contains any account, the shared ADMIN_PASSWORD stops working.");
