import { describe, expect, it } from "vitest";
import { bulkPlaceholder, getLikelyNetwork, isLikelyAirtelTigoNumber, isValidGhanaNumber, phonePlaceholder, samplePhones, toLocalGhanaNumber } from "../lib/networkValidation.js";

describe("Ghana network prefix hints", () => {
  it("recognizes common MTN prefixes", () => {
    expect(getLikelyNetwork("024 123 4567")).toBe("mtn");
    expect(getLikelyNetwork("0541234567")).toBe("mtn");
    expect(getLikelyNetwork("+233 55 123 4567")).toBe("mtn");
    expect(getLikelyNetwork("+233551234567")).toBe("mtn");
  });

  // BUG FIX regression: 059 was missing from the MTN prefix list, so these
  // numbers got no network hint (no badge, no mismatch warning) at all.
  it("recognizes the 059 MTN prefix", () => {
    expect(getLikelyNetwork("0591234567")).toBe("mtn");
    expect(getLikelyNetwork("+233591234567")).toBe("mtn");
  });

  it("recognizes common Telecel prefixes", () => {
    expect(getLikelyNetwork("0201234567")).toBe("telecel");
    expect(getLikelyNetwork("0501234567")).toBe("telecel");
  });

  it("recognizes common AirtelTigo prefixes only", () => {
    expect(getLikelyNetwork("0261234567")).toBe("airteltigo");
    expect(getLikelyNetwork("0571234567")).toBe("airteltigo");
    expect(isLikelyAirtelTigoNumber("0561234567")).toBe(true);
    expect(isLikelyAirtelTigoNumber("0531234567")).toBe(false);
    expect(isLikelyAirtelTigoNumber("0231234567")).toBe(false);
  });

  it("returns no hint for an unrecognized mobile prefix", () => {
    expect(getLikelyNetwork("0311234567")).toBeNull();
  });
});

// Regression: 025 and 053 are MTN prefixes (NCA numbering plan) but were
// missing, so those numbers got no network hint or mismatch warning.
describe("complete MTN prefix list", () => {
  it("recognizes 025 and 053 as MTN, not AirtelTigo", () => {
    expect(getLikelyNetwork("0251234567")).toBe("mtn");
    expect(getLikelyNetwork("0531234567")).toBe("mtn");
    expect(isLikelyAirtelTigoNumber("0531234567")).toBe(false);
  });
});

// Regression: every page showed the MTN prefix "024 000 0000" as the example,
// including the AirtelTigo and Telecel pages.
describe("network-aware examples", () => {
  it("never uses an MTN example on the AirtelTigo or Telecel screens", () => {
    expect(getLikelyNetwork(phonePlaceholder("airteltigo"))).toBe("airteltigo");
    expect(getLikelyNetwork(phonePlaceholder("telecel"))).toBe("telecel");
    expect(getLikelyNetwork(phonePlaceholder("mtn"))).toBe("mtn");
    expect(phonePlaceholder(undefined)).toBe("0XX XXX XXXX");
  });

  it("builds bulk and CSV samples with the page's own network prefix", () => {
    expect(bulkPlaceholder("airteltigo", "data")).toBe("027XXXXXXX 5\n027YYYYYYY 10");
    expect(bulkPlaceholder("telecel", "airtime")).toBe("020XXXXXXX 10\n020YYYYYYY 20");
    for (const n of samplePhones("telecel")) expect(getLikelyNetwork(n)).toBe("telecel");
  });
});

describe("Ghana number shape", () => {
  it("normalises the usual ways customers type a number", () => {
    for (const v of ["0241234567", "024 123 4567", "024-123-4567", "+233 24 123 4567", "233241234567", "00233241234567", "241234567"]) {
      expect(toLocalGhanaNumber(v)).toBe("0241234567");
    }
  });

  it("rejects numbers Techlink would only reject after payment", () => {
    for (const v of ["", null, "12345", "024123456", "02412345678", "abc", "+2332412345678", "0233241234567"]) {
      expect(isValidGhanaNumber(v)).toBe(false);
    }
  });
});

