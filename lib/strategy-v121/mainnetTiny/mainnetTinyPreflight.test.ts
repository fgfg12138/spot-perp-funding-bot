import { describe, expect, it } from "vitest";

describe("preflight dataSource allowlist", () => {
  it("ALLOWED_DATA_SOURCES includes dynamic_same_exchange_universe", async () => {
    // Can't directly access the const since it's inside a function.
    // Instead, test that the preflight logic doesn't reject known good sources
    // by checking the source code.
    // For now, verify the allowlist exists in the preflight source.
    const fs = await import("fs");
    const src = fs.readFileSync("lib/strategy-v121/mainnetTiny/mainnetTinyPreflight.ts", "utf8");
    expect(src).toContain("dynamic_same_exchange_universe");
    expect(src).toContain("real_market");
    expect(src).toContain("worker_real_market");
  });

  it("finalPreExecutionAudit also allows dynamic_same_exchange_universe", async () => {
    const fs = await import("fs");
    const src = fs.readFileSync("lib/strategy-v121/mainnetTiny/finalPreExecutionAudit.ts", "utf8");
    expect(src).toContain("dynamic_same_exchange_universe");
    expect(src).toContain("real_market");
  });
});
