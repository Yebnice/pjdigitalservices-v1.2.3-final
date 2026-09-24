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
  });

  it("still keeps a direct order status helper available", () => {
    expect(orderStatusReply({
      reference: "TLTEST456",
      fulfillmentStatus: "fulfilled",
      createdAt: new Date().toISOString(),
    })).toContain("completed successfully");
  });
});
