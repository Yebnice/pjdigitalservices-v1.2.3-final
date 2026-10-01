import { describe, expect, it } from "vitest";
import { priceDiffers, priceChangeMessage } from "../lib/priceGuard.js";

describe("price guard", () => {
  it("treats sub-half-pesewa differences as rounding", () => {
    expect(priceDiffers(4.59, 4.59)).toBe(false);
    expect(priceDiffers(4.59, 4.5901)).toBe(false);
  });
  it("flags a one pesewa change", () => {
    expect(priceDiffers(4.58, 4.59)).toBe(true);
    expect(priceDiffers(4.59, 4.58)).toBe(true);
  });
  it("does nothing when no price was shown", () => {
    for (const shown of [undefined, null, 0, "", NaN]) expect(priceDiffers(shown, 4.59)).toBe(false);
  });
  it("honours a wider tolerance (bulk orders)", () => {
    expect(priceDiffers(100, 100.2, 0.5)).toBe(false);
    expect(priceDiffers(100, 101, 0.5)).toBe(true);
  });
  it("words the question with both amounts", () => {
    expect(priceChangeMessage(4.58, 4.59)).toContain("GHS 4.58");
    expect(priceChangeMessage(4.58, 4.59)).toContain("GHS 4.59");
  });
});
