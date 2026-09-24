import { describe, expect, it, vi } from "vitest";
import { buyAirtime, purchaseDataBulk, purchaseAirtimeBulk, registerAfa } from "../lib/techlink.js";

describe("Techlink request contracts", () => {
  it("uses documented airtime fields and network codes", async () => {
    process.env.TECHLINK_API_KEY = "tlg_test_contract";
    process.env.TECHLINK_API_BASE_URL = "https://api.techlinkgh.com/api/v1";
    global.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ success: true, orderId: "TEST" }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      })
    );

    await buyAirtime({ network: "airteltigo", phone: "0240000000", amount: 10 });
    const [, request] = global.fetch.mock.calls[0];
    const body = JSON.parse(request.body);

    expect(global.fetch).toHaveBeenCalledWith(
      "https://api.techlinkgh.com/api/v1/airtime",
      expect.anything()
    );
    expect(body).toEqual({ network: "AT", phone: "0240000000", amount: 10 });
  });

  it("uses the documented AFA field names", async () => {
    process.env.TECHLINK_API_KEY = "tlg_test_contract";
    global.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ success: true, testMode: true }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      })
    );

    await registerAfa({
      network: "mtn",
      fullName: "Test Customer",
      ghanaCard: "GHA-TEST-123",
      phone: "0240000000",
      dob: "1995-04-12",
      region: "Greater Accra",
      location: "Accra",
      occupation: "Trader",
    });

    const [, request] = global.fetch.mock.calls[0];
    const body = JSON.parse(request.body);
    expect(body).toMatchObject({
      fullName: "Test Customer",
      ghanaCard: "GHA-TEST-123",
      dob: "1995-04-12",
      paymentMethod: "wallet",
    });
    expect(body).not.toHaveProperty("idNumber");
    expect(body).not.toHaveProperty("dateOfBirth");
  });

  it("sends bulk-data rows without undocumented paymentMethod fields", async () => {
    process.env.TECHLINK_API_KEY = "tlg_test_contract";
    global.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );

    await purchaseDataBulk({
      orders: [{ name: "MTN 1GB", network: "mtn", phone: "0240000000", size: 1 }],
    });

    const [, request] = global.fetch.mock.calls[0];
    const body = JSON.parse(request.body);
    expect(body).toEqual({
      orders: [{ name: "MTN 1GB", network: "MTN", phone: "0240000000", size: 1 }],
    });
  });

  it("sends bulk-airtime rows in the documented shape", async () => {
    process.env.TECHLINK_API_KEY = "tlg_test_contract";
    global.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );

    await purchaseAirtimeBulk({
      orders: [{ network: "telecel", phone: "0240000000", amount: 10 }],
    });

    const [, request] = global.fetch.mock.calls[0];
    const body = JSON.parse(request.body);
    expect(body).toEqual({
      orders: [{ network: "TELECEL", phone: "0240000000", amount: 10 }],
    });
  });
});
