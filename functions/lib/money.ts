/**
 * Money arithmetic in whole numbers.
 *
 * Lexware works in cents and rounds half up. Swell keeps prices in cents but taxes and
 * discounts with four decimals, and rounds only the order total. Both are reproduced here
 * with integers ("micros" are 1/10000 of a euro), because the same sums in floating point
 * land one cent off often enough to matter on a legal document.
 */

/** Rounds half away from zero, the way Lexware does */
export function roundHalfUp(value: number): number {
  return value < 0 ? -Math.round(-value) : Math.round(value);
}

/** Integer division rounded half away from zero. Both arguments are integers, `divisor` is positive */
export function divideRounded(value: number, divisor: number): number {
  const sign = value < 0 ? -1 : 1;
  const abs = Math.abs(value);
  const quotient = Math.floor(abs / divisor);
  return sign * (abs % divisor * 2 >= divisor ? quotient + 1 : quotient);
}

/** A Swell amount (a float with up to four decimals) as micros */
export function toMicros(amount: unknown): number {
  const value = typeof amount === "number" ? amount : Number(amount);
  return Number.isFinite(value) ? Math.round(value * 10000) : 0;
}

/** A Swell amount that is a price (two decimals) as cents */
export function toCents(amount: unknown): number {
  return divideRounded(toMicros(amount), 100);
}

export function microsToCents(micros: number): number {
  return divideRounded(micros, 100);
}

/** Cents as the decimal number Lexware expects */
export function centsToAmount(cents: number): number {
  return cents / 100;
}

/** A tax rate in percent as hundredths of a percent: 19 becomes 1900, 5.5 becomes 550 */
export function rateToBasisPoints(rate: number): number {
  return Math.round(rate * 100);
}

/** Tax on a net amount, in cents */
export function taxOnNet(netCents: number, rate: number): number {
  return divideRounded(netCents * rateToBasisPoints(rate), 10000);
}

/** The net part of a gross amount, in cents */
export function netOfGross(grossCents: number, rate: number): number {
  const basisPoints = rateToBasisPoints(rate);
  return divideRounded(grossCents * 10000, 10000 + basisPoints);
}

/**
 * Splits `total` cents over shares in proportion to `weights`, so that the parts are whole
 * cents and add up to exactly `total`. The cents left over by rounding down go to the
 * shares that lost the most.
 */
export function allocate(total: number, weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (weights.length === 0) {
    return [];
  }
  if (sum <= 0) {
    return weights.map((_, index) => (index === 0 ? total : 0));
  }
  const exact = weights.map((weight) => (total * weight) / sum);
  const parts = exact.map((value) => Math.floor(value));
  let left = total - parts.reduce((a, b) => a + b, 0);
  const order = exact
    .map((value, index) => ({ index, lost: value - Math.floor(value) }))
    .sort((a, b) => b.lost - a.lost || a.index - b.index);
  for (let i = 0; left > 0; i = (i + 1) % order.length, left--) {
    parts[order[i].index] += 1;
  }
  return parts;
}

/** "12,34" or "12.34", for messages */
export function formatCents(cents: number, language: "de" | "en" = "en"): string {
  const text = (Math.abs(cents) / 100).toFixed(2);
  return (cents < 0 ? "-" : "") + (language === "de" ? text.replace(".", ",") : text);
}
