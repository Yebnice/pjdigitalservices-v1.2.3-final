import { describe, expect, it } from "vitest";
import { getLikelyNetwork, isLikelyAirtelTigoNumber } from "../lib/networkValidation.js";

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
