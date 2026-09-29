import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

describe("ECG and Water customer bill workflow contracts", () => {
  it("passes meter and phone into the ECG lookup request and requires resolved lookup before payment", () => {
    const bills = read("pages/bills.js");
    expect(bills).toContain("meter: meterNumber,");
    expect(bills).toContain("phone,");
    expect(bills).toContain("const ecgLookupResolved = ecgLookup && !ecgLookup.kind;");
    expect(bills).toContain("const ecgValid = ecgLookupResolved");
  });

  it("passes account and phone into Water validation and requires a resolved bill", () => {
    const bills = read("pages/bills.js");
    expect(bills).toContain("body: JSON.stringify({ account: meterNumber, phone }),");
    expect(bills).toContain("const waterResolved = waterBill && !waterBill.kind;");
    expect(bills).toContain("const waterValid = waterResolved");
  });

  // BUG FIX regression: Water's "Check bill" used to only require the meter
  // number, unlike ECG's meter+phone fraud-prevention gate. A phone number
  // is now required before the account holder's name/balance can be
  // revealed, for consistency with ECG.
  it("requires a phone number before Water's bill lookup can run, consistent with ECG", () => {
    const bills = read("pages/bills.js");
    expect(bills).toContain('disabled={meterNumber.length < 4 || phone.length < 10 || checkingBill}');
  });

  it("keeps provider errors distinct from not-found states", () => {
    const ecg = read("pages/api/techlink/ecg-lookup.js");
    const water = read("pages/api/techlink/water-validate.js");
    expect(ecg).toContain('status === 404');
    expect(ecg).toContain("ECG lookup is temporarily unavailable");
    expect(water).toContain('status === 404');
    expect(water).toContain("Ghana Water validation is temporarily unavailable");
  });

  it("uses the documented ECG phone fallback and GWCL water fallback", () => {
    const techlink = read("lib/techlink.js");
    expect(techlink).toContain("const params = new URLSearchParams");
    expect(techlink).toContain("meter: requestedMeter");
    expect(techlink).toContain("phone: requestedPhone");
    expect(techlink).toContain("validateGwclMeter({ account, phone })");
  });

  // Techlink's own ECG page will not look a meter up without a phone number,
  // and a meter-only call does not work in practice. The lookup therefore
  // always sends meter + phone in ONE call and never retries meter-only.
  it("always looks the ECG meter up with meter AND phone, never meter-only", () => {
    const techlink = read("lib/techlink.js");
    expect(techlink).toContain("const params = new URLSearchParams({ meter: requestedMeter, phone: requestedPhone });");
    expect(techlink).not.toContain("meterOnlyParams");
  });
});
