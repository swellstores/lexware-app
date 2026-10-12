import { describe, expect, it } from "vitest";
import { berlinDay, displayDate, lexwareDate } from "../../functions/lib/dates";

describe("dates", () => {
  it("writes German local time with its offset, the only format Lexware accepts", () => {
    expect(lexwareDate("2026-10-10T06:47:52.656Z")).toBe("2026-10-10T08:47:52.000+02:00");
    expect(lexwareDate("2026-01-15T12:00:00.000Z")).toBe("2026-01-15T13:00:00.000+01:00");
  });

  it("dates an order placed late in the evening UTC on the next German day", () => {
    expect(lexwareDate("2026-06-30T22:30:00.000Z")).toBe("2026-07-01T00:30:00.000+02:00");
    expect(berlinDay("2026-12-31T23:30:00.000Z")).toBe("2027-01-01");
    expect(displayDate("2026-12-31T23:30:00.000Z", "de")).toBe("01.01.2027");
    expect(displayDate("2026-10-10T06:47:52.656Z", "en")).toBe("10 Oct 2026");
  });

  it("follows the switch between summer and winter time", () => {
    // The clocks go back on 25 October 2026 at 01:00 UTC
    expect(lexwareDate("2026-10-25T00:30:00.000Z")).toBe("2026-10-25T02:30:00.000+02:00");
    expect(lexwareDate("2026-10-25T01:30:00.000Z")).toBe("2026-10-25T02:30:00.000+01:00");
  });
});
