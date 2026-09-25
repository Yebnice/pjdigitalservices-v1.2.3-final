import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const read = (file) => fs.readFileSync(path.join(process.cwd(), file), "utf8");

describe("deep audit invariants", () => {
  it("uses one canonical network-prefix source", () => {
    const phoneValidation = read("lib/phoneValidation.js");
    const networkValidation = read("lib/networkValidation.js");
    expect(phoneValidation).toContain("from \"./networkValidation.js\"");
    expect(phoneValidation).not.toContain('["026", "056", "027", "057", "023", "053"]');
    expect(networkValidation).toContain('mtn: ["024", "054", "055", "059"]');
    expect(networkValidation).toContain('telecel: ["020", "050"]');
    expect(networkValidation).toContain('airteltigo: ["026", "027", "056", "057"]');
  });

  it("does not keep stale AirtelTigo prefix claims in customer or AI text", () => {
    const files = [
      "pages/data.js",
      "lib/assistant.js",
      "pages/api/ai/chat.js",
      "components/TierShop.js",
      "pages/airtime.js",
    ];
    for (const file of files) {
      const source = read(file);
      expect(source).not.toContain("023, 053");
      expect(source).not.toContain("023 and 053");
    }
  });

  it("keeps provider cost and business margin fields out of public order sanitization", () => {
    const store = read("lib/store.js");
    const publicPart = store.slice(store.indexOf("export function toPublicOrder"));
    expect(publicPart).not.toContain("providerCost:");
    expect(publicPart).not.toContain("businessMarkupAmount:");
  });

  it("requires resolved ECG/Water validation before payment", () => {
    const bills = read("pages/bills.js");
    expect(bills).toContain("const ecgLookupResolved = ecgLookup && !ecgLookup.kind;");
    expect(bills).toContain("const ecgValid = ecgLookupResolved");
    expect(bills).toContain("const waterResolved = waterBill && !waterBill.kind;");
    expect(bills).toContain("const waterValid = waterResolved");
  });

  it("uses the current Gemini 3.8 Flash default and medium thinking", () => {
    const chat = read("pages/api/ai/chat.js");
    expect(chat).toContain('process.env.GEMINI_MODEL || "gemini-3.8-flash"');
    expect(chat).toContain('process.env.GEMINI_THINKING_LEVEL || "medium"');
  });
});
