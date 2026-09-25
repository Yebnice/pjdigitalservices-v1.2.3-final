import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const read = (file) => fs.readFileSync(path.join(process.cwd(), file), "utf8");

describe("Result Checker flows", () => {
  it("voucher mode validates quantity and delivery method server-side", () => {
    const source = read("pages/api/orders/create.js");
    expect(source).toContain('Voucher quantity must be a whole number from 1 to 20');
    expect(source).toContain('Voucher delivery method must be email or sms');
    expect(source).toContain('checkerType');
  });

  it("lookup mode requires index number, four-digit year and candidate name", () => {
    const source = read("pages/api/orders/create.js");
    expect(source).toContain('Index number, four-digit exam year and candidate name are required');
    expect(source).toContain('candidateName.length < 2');
  });

  it("result lookup does not require an unrelated phone field", () => {
    const source = read("pages/api/orders/create.js");
    expect(source).toContain('const isChecker = orderType === "checker";');
    expect(source).toContain('if (!isBulk && !isChecker && !phone)');
  });

  it("the customer UI no longer calls candidate name optional", () => {
    const source = read("pages/checker.js");
    expect(source).toContain('label="Candidate name"');
    expect(source).toContain('candidateName.trim().length >= 2');
    expect(source).not.toContain('Candidate name (optional)');
  });
});
