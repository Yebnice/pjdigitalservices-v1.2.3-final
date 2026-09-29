import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

// lib/techlink.js reads TECHLINK_API_KEY when it is first imported, so set it
// before the dynamic import below.
let lookupEcgMeter;
beforeAll(async () => {
  process.env.TECHLINK_API_KEY = "tlg_test_key";
  ({ lookupEcgMeter } = await import("../lib/techlink.js"));
});

function mockProvider(handler) {
  vi.stubGlobal("fetch", vi.fn(async (url) => {
    const { status = 200, body = {} } = handler(String(url));
    return { ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body), headers: new Map() };
  }));
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const lookup = () => lookupEcgMeter({ meter: "15318316", phone: "0242863004" });

describe("ECG meter lookup normalisation", () => {
  // Regression: Techlink answered with `accountName` (not the documented
  // `customerName`), the raw payload was passed through, and the page showed
  // "Meter belongs to" with a blank name.
  it("maps accountName/address/meterType/region to the stable shape", async () => {
    mockProvider(() => ({ body: { success: true, meter: "15318316", accountName: "HFC BANK", address: "|5950-S. S. B.SEFWI WIAWSO", meterType: "postpaid", region: "Western" } }));
    expect(await lookup()).toEqual({
      meter: "15318316",
      customerName: "HFC BANK",
      address: "|5950-S. S. B.SEFWI WIAWSO",
      meterType: "POSTPAID",
      region: "Western",
    });
  });

  it("still supports the documented customerName/district shape", async () => {
    mockProvider(() => ({ body: { success: true, meter: "0210444711", customerName: "KOFI MENSAH", district: "Accra East" } }));
    const result = await lookup();
    expect(result.customerName).toBe("KOFI MENSAH");
    expect(result.region).toBe("Accra East");
  });

  it("unwraps a nested data object", async () => {
    mockProvider(() => ({ body: { success: true, data: { meterNumber: "15318316", name: "HFC BANK", type: "POSTPAID" } } }));
    expect((await lookup()).customerName).toBe("HFC BANK");
  });

  it("only returns whitelisted fields to the browser", async () => {
    mockProvider(() => ({ body: { meter: "1", customerName: "A", phone: "0240000000", balance: 99 } }));
    expect(Object.keys(await lookup()).sort()).toEqual(["address", "customerName", "meter", "meterType", "region"]);
  });

  it("refuses to resolve a meter whose account name cannot be read", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mockProvider(() => ({ body: { success: true, meter: "15318316", balance: 12 } }));
    await expect(lookup()).rejects.toMatchObject({ code: "ECG_NAME_UNREADABLE" });
  });

  it("sends meter and a normalised local phone in a single call, never meter-only", async () => {
    mockProvider(() => ({ body: { meter: "15318316", customerName: "HFC BANK" } }));
    await lookupEcgMeter({ meter: " 1531 8316 ", phone: "+233 24 286 3004" });
    const calls = globalThis.fetch.mock.calls.map((c) => String(c[0]));
    expect(calls).toHaveLength(1);
    const query = new URL(calls[0]).searchParams;
    expect(query.get("meter")).toBe("15318316");
    expect(query.get("phone")).toBe("0242863004");
  });

  it("rejects a missing or malformed phone before calling Techlink", async () => {
    mockProvider(() => ({ body: {} }));
    for (const phone of ["", "12345", "abc"]) {
      await expect(lookupEcgMeter({ meter: "15318316", phone })).rejects.toMatchObject({ status: 400 });
    }
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("surfaces a provider rejection as-is instead of retrying", async () => {
    mockProvider(() => ({ status: 400, body: { message: "bad" } }));
    await expect(lookup()).rejects.toMatchObject({ status: 400 });
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });
});
