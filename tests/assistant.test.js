import { describe, expect, it } from "vitest";
import { supportReply, orderStatusReply } from "../lib/assistant.js";

describe("Annette conversation routing", () => {
  it("lets ordinary complaints reach the conversational model", () => {
    expect(supportReply("I am really disappointed, this has been a frustrating experience.")).toBeNull();
    expect(supportReply("Can you help me understand what happened to my data?")).toBeNull();
  });

  it("keeps verified order status deterministic", () => {
    const reply = supportReply("Where is my order?", {
      reference: "TLTEST123",
      fulfillmentStatus: "processing",
      createdAt: new Date().toISOString(),
    });
    expect(reply).toContain("currently being processed");
    expect(reply).toContain("TLTEST123");
  });

  it("keeps security-sensitive requests deterministic", () => {
    const reply = supportReply("Should I send you my mobile money PIN?");
    expect(reply).toContain("PIN");
    expect(reply).toContain("don't send");
    expect(supportReply("I can send you my password if needed.")).toContain("don't send");
  });



  it("offers WhatsApp after six hours for a paid unresolved processing order", () => {
    const sixHoursAgo = new Date(Date.now() - 6 * 60 * 60 * 1000 - 1000).toISOString();
    const reply = orderStatusReply({
      reference: "TLPAID6H",
      status: "payment_verified",
      fulfillmentStatus: "processing",
      paymentVerifiedAt: sixHoursAgo,
      createdAt: sixHoursAgo,
    });
    expect(reply).toContain("WhatsApp");
    expect(reply).toContain("TLPAID6H");
    expect(reply).toContain("more than 6 hours");
  });

  it("offers WhatsApp after six hours for a paid queued order", () => {
    const sixHoursAgo = new Date(Date.now() - 6 * 60 * 60 * 1000 - 1000).toISOString();
    const reply = orderStatusReply({
      reference: "TLQUEUE6H",
      status: "payment_verified",
      fulfillmentStatus: "queued_with_provider",
      paymentVerifiedAt: sixHoursAgo,
      createdAt: sixHoursAgo,
    });
    expect(reply).toContain("WhatsApp");
    expect(reply).toContain("TLQUEUE6H");
    expect(reply).toContain("queued with the provider");
  });

  it("does not offer WhatsApp for an unpaid old order", () => {
    const sixHoursAgo = new Date(Date.now() - 6 * 60 * 60 * 1000 - 1000).toISOString();
    const reply = orderStatusReply({
      reference: "TLUNPAID6H",
      status: "pending",
      fulfillmentStatus: "pending",
      createdAt: sixHoursAgo,
    });
    expect(reply).not.toContain("WhatsApp");
  });

  it("still keeps a direct order status helper available", () => {
    expect(orderStatusReply({
      reference: "TLTEST456",
      fulfillmentStatus: "fulfilled",
      createdAt: new Date().toISOString(),
    })).toContain("completed successfully");
  });
});
