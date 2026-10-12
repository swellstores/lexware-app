import { describe, expect, it } from "vitest";
import { allocate, divideRounded, netOfGross, taxOnNet, toCents, toMicros } from "../../functions/lib/money";

describe("money", () => {
  it("rounds half away from zero, like Lexware", () => {
    // 3 × 8.395 = 25.185, which Lexware shows as 25.19. In floating point it is 25.184999…
    expect(divideRounded(83950 * 3, 100)).toBe(2519);
    expect(divideRounded(-25185, 10)).toBe(-2519);
    expect(divideRounded(25184, 10)).toBe(2518);
  });

  it("reads Swell amounts without floating point drift", () => {
    expect(toMicros(8.796)).toBe(87960);
    expect(toMicros(0.931)).toBe(9310);
    expect(toCents(108.94)).toBe(10894);
    expect(toCents(1.005)).toBe(101);
    expect(toMicros(undefined)).toBe(0);
    expect(toMicros(null)).toBe(0);
  });

  it("computes tax the way Lexware does for net and gross amounts", () => {
    // Checked in Lexware: net 26.79 at 19 % gives 5.09, net 12.14 at 7 % gives 0.85
    expect(taxOnNet(2679, 19)).toBe(509);
    expect(taxOnNet(1214, 7)).toBe(85);
    // Checked in Lexware: gross 14.90 at 19 % is net 12.52, gross 24.48 at 7 % is net 22.88
    expect(netOfGross(1490, 19)).toBe(1252);
    expect(netOfGross(2448, 7)).toBe(2288);
    expect(netOfGross(2000, 20)).toBe(1667);
    expect(taxOnNet(1299, 5.5)).toBe(71);
  });

  it("splits an amount into parts that add up exactly", () => {
    // A refund of 10.00 on an invoice of 86.12 at 19 % and 12.51 at 7 %
    expect(allocate(1000, [8612, 1251])).toEqual([873, 127]);
    expect(allocate(100, [1, 1, 1])).toEqual([34, 33, 33]);
    expect(allocate(500, [0, 0])).toEqual([500, 0]);
    expect(allocate(999, [7287])).toEqual([999]);
  });
});
