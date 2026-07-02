import { describe, expect, it, vi, afterEach } from "vitest";
import { safeFetch } from "./safeFetch";

describe("safeFetch", () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it("401 分类为 auth_or_permission_error", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 401 }));
    const r = await safeFetch("https://api.binance.com/test");
    expect(r.ok).toBe(false);
    expect(r.errorType).toBe("auth_or_permission_error");
    expect(r.errorMessage).toContain("API Key");
  });

  it("403 分类为 auth_or_permission_error", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 403 }));
    const r = await safeFetch("https://api.binance.com/test");
    expect(r.errorType).toBe("auth_or_permission_error");
  });

  it("404 分类为 endpoint_not_found", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 404 }));
    const r = await safeFetch("https://api.binance.com/test");
    expect(r.errorType).toBe("endpoint_not_found");
  });

  it("429 分类为 rate_limited", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 429 }));
    const r = await safeFetch("https://api.binance.com/test");
    expect(r.errorType).toBe("rate_limited");
  });

  it("200 返回 ok=true", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ data: "ok" }), { status: 200 }));
    const r = await safeFetch("https://api.binance.com/test");
    expect(r.ok).toBe(true);
    expect(r.body.data).toBe("ok");
  });

  it("网络错误分类为 network_error", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("fetch failed"));
    const r = await safeFetch("https://api.binance.com/test");
    expect(r.errorType).toBe("network_error");
  });

  it("超时分类为 timeout", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new DOMException("Aborted", "AbortError"));
    const r = await safeFetch("https://api.binance.com/test");
    expect(r.errorType).toBe("timeout");
  });
});
