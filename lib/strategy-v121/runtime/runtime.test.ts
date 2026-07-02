import { describe, expect, it, afterEach } from "vitest";
import { isDevToolsEnabled, devToolsForbiddenResponse } from "./devToolsGate";
import { resetRuntimeConfig } from "../config/runtimeConfig";

describe("runtime / devToolsGate", () => {
  const keep = process.env.V121_ENABLE_DEV_TOOLS;

  afterEach(() => {
    process.env.V121_ENABLE_DEV_TOOLS = keep;
    resetRuntimeConfig();
  });

  it("isDevToolsEnabled returns false when env is not set", () => {
    delete process.env.V121_ENABLE_DEV_TOOLS;
    resetRuntimeConfig();
    expect(isDevToolsEnabled()).toBe(false);
  });

  it("isDevToolsEnabled returns false when env is 0", () => {
    process.env.V121_ENABLE_DEV_TOOLS = "0";
    resetRuntimeConfig();
    expect(isDevToolsEnabled()).toBe(false);
  });

  it("isDevToolsEnabled returns true when env is 1", () => {
    process.env.V121_ENABLE_DEV_TOOLS = "1";
    resetRuntimeConfig();
    expect(isDevToolsEnabled()).toBe(true);
  });

  it("devToolsForbiddenResponse returns 404 status", () => {
    const res = devToolsForbiddenResponse();
    expect(res.status).toBe(404);
  });

  it("devToolsForbiddenResponse has correct JSON shape", async () => {
    const res = devToolsForbiddenResponse();
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.status).toBe("not_found");
    expect(typeof body.message).toBe("string");
    expect(body.message.length).toBeGreaterThan(0);
  });
});
