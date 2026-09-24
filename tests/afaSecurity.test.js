import { describe, expect, it } from "vitest";
import { decryptAfaDetails, encryptAfaDetails } from "../lib/afaSecurity.js";

describe("AFA encryption", () => {
  it("round-trips sensitive registration fields", () => {
    const old = process.env.AFA_ENCRYPTION_KEY;
    process.env.AFA_ENCRYPTION_KEY = "test-only-afa-secret-32-characters-minimum";
    try {
      const original = {
        fullName: "Test Customer",
        ghanaCard: "GHA-TEST-123",
        dob: "1995-04-12",
        region: "Greater Accra",
        location: "Accra",
        occupation: "Trader",
      };
      const encrypted = encryptAfaDetails(original);
      expect(typeof encrypted).toBe("string");
      expect(encrypted).toMatch(/^v1:/);
      expect(encrypted).not.toContain(original.ghanaCard);
      expect(decryptAfaDetails(encrypted)).toEqual(original);
    } finally {
      if (old === undefined) delete process.env.AFA_ENCRYPTION_KEY;
      else process.env.AFA_ENCRYPTION_KEY = old;
    }
  });

  it("rejects an unsafe missing encryption key", () => {
    const old = process.env.AFA_ENCRYPTION_KEY;
    delete process.env.AFA_ENCRYPTION_KEY;
    try {
      expect(() => encryptAfaDetails({ ghanaCard: "secret" })).toThrow(/AFA_ENCRYPTION_KEY/);
    } finally {
      if (old !== undefined) process.env.AFA_ENCRYPTION_KEY = old;
    }
  });
});
