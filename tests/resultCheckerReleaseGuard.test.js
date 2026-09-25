import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const read = (file) => fs.readFileSync(path.join(process.cwd(), file), "utf8");

describe("result checker release guards", () => {
  it("keeps voucher and lookup modes distinct", () => {
    const page = read("pages/checker.js");
    expect(page).toContain('mode === "voucher"');
    expect(page).toContain('mode === "lookup"');
    expect(page).toContain("candidateName.trim().length >= 2");
  });

  it("keeps Techlink voucher and service endpoints distinct", () => {
    const techlink = read("lib/techlink.js");
    expect(techlink).toContain('/result-checker/purchase');
    expect(techlink).toContain('/result-check-service/request');
  });
});
