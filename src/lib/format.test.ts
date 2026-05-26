import { describe, it, expect } from "vitest";
import { formatMs, formatBytes, formatPercent, formatTimestamp } from "./format";

describe("formatMs", () => {
  it("formats sub-second values", () => {
    expect(formatMs(500)).toBe("500ms");
  });

  it("formats second values", () => {
    expect(formatMs(2500)).toBe("2.5s");
  });
});

describe("formatBytes", () => {
  it("formats bytes", () => {
    expect(formatBytes(512)).toBe("512B");
  });

  it("formats kilobytes", () => {
    expect(formatBytes(2048)).toBe("2.0K");
  });

  it("formats megabytes", () => {
    expect(formatBytes(1048576)).toBe("1.0M");
  });
});

describe("formatPercent", () => {
  it("formats decimal to percent", () => {
    expect(formatPercent(0.856)).toBe("85.6%");
  });
});

describe("formatTimestamp", () => {
  it("returns non-empty string", () => {
    const result = formatTimestamp(1704067200000);
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });
});
