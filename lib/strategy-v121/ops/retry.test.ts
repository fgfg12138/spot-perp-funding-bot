import { describe, it, expect, vi } from "vitest";
import {
  withRetry,
  TransientError,
  PermanentError,
  isRetryable,
} from "./retry";

describe("withRetry", () => {
  it("返回成功结果（不需要重试）", async () => {
    const fn = vi.fn().mockResolvedValue("ok");
    const result = await withRetry(fn, { maxAttempts: 3 });
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("临时错误后重试成功", async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new TransientError("网络抖动"))
      .mockRejectedValueOnce(new TransientError("限流"))
      .mockResolvedValue("ok");
    const result = await withRetry(fn, { maxAttempts: 5, baseDelayMs: 10 });
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("永久错误立即失败，不重试", async () => {
    const fn = vi.fn().mockRejectedValue(new PermanentError("配置错误"));
    await expect(withRetry(fn, { maxAttempts: 3, baseDelayMs: 10 })).rejects.toThrow("配置错误");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("超过最大重试次数后抛出", async () => {
    const fn = vi.fn().mockRejectedValue(new TransientError("一直失败"));
    const onRetry = vi.fn();
    await expect(withRetry(fn, { maxAttempts: 3, baseDelayMs: 10, onRetry })).rejects.toThrow("一直失败");
    expect(fn).toHaveBeenCalledTimes(3);
    expect(onRetry).toHaveBeenCalledTimes(2);
  });

  it("调用 onRetry 回调", async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new TransientError("失败1"))
      .mockRejectedValueOnce(new TransientError("失败2"))
      .mockResolvedValue("ok");
    const onRetry = vi.fn();
    await withRetry(fn, { maxAttempts: 5, baseDelayMs: 10, onRetry });
    expect(onRetry).toHaveBeenCalledTimes(2);
    expect(onRetry.mock.calls[0][0]).toBeInstanceOf(TransientError);
    expect(onRetry.mock.calls[0][1]).toBe(1);
    expect(onRetry.mock.calls[0][2]).toBeGreaterThan(0);
  });

  it("自定义 shouldRetry 返回 false 时立即失败", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("自定义失败"));
    await expect(withRetry(fn, {
      maxAttempts: 3,
      baseDelayMs: 10,
      shouldRetry: () => false,
    })).rejects.toThrow("自定义失败");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("超时机制：超时后抛出 TransientError", async () => {
    const fn = vi.fn().mockImplementation(() => new Promise((r) => setTimeout(r, 500)));
    const onRetry = vi.fn();
    await expect(withRetry(fn, {
      maxAttempts: 2,
      baseDelayMs: 1,
      timeoutMs: 50,
      onRetry,
    })).rejects.toThrow("操作超时");
    expect(onRetry).toHaveBeenCalled();
  });

  it("默认错误信息包含 transient 关键词时自动重试", async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error("connection timeout"))
      .mockResolvedValue("ok");
    const result = await withRetry(fn, { maxAttempts: 3, baseDelayMs: 10 });
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("默认错误信息不包含关键词时仍重试（未知错误默认重试）", async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error("奇怪的错误"))
      .mockResolvedValue("ok");
    const result = await withRetry(fn, { maxAttempts: 3, baseDelayMs: 10 });
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });
});

describe("isRetryable", () => {
  it("TransientError 可重试", () => {
    expect(isRetryable(new TransientError("timeout"))).toBe(true);
  });

  it("PermanentError 不可重试", () => {
    expect(isRetryable(new PermanentError("invalid"))).toBe(false);
  });

  it("普通 Error 默认可重试", () => {
    expect(isRetryable(new Error("some error"))).toBe(true);
  });
});
