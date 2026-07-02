import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { getMasterKey, isMasterKeyConfigured, resetMasterKeyCache } from "./masterKey";
import { resetRuntimeConfig } from "../config/runtimeConfig";

describe("masterKey", () => {
  const ORIGINAL = process.env.V121_MASTER_KEY;

  beforeEach(() => {
    resetMasterKeyCache();
    delete process.env.V121_MASTER_KEY;
    resetRuntimeConfig();
  });

  afterEach(() => {
    resetMasterKeyCache();
    if (ORIGINAL !== undefined) {
      process.env.V121_MASTER_KEY = ORIGINAL;
    } else {
      delete process.env.V121_MASTER_KEY;
    }
    resetRuntimeConfig();
  });

  it("未设置 V121_MASTER_KEY 时抛错", () => {
    expect(() => getMasterKey()).toThrow("未设置");
  });

  it("密钥过短（<16 字符）时抛错", () => {
    process.env.V121_MASTER_KEY = "short";
    resetRuntimeConfig();
    expect(() => getMasterKey()).toThrow("长度不足");
  });

  it("16 字符密钥正常返回", () => {
    process.env.V121_MASTER_KEY = "a".repeat(16);
    resetRuntimeConfig();
    expect(getMasterKey()).toBe("a".repeat(16));
  });

  it("更长密钥正常返回并 trim", () => {
    process.env.V121_MASTER_KEY = "  my-super-secret-master-key-32chars  ";
    resetRuntimeConfig();
    expect(getMasterKey()).toBe("my-super-secret-master-key-32chars");
  });

  it("isMasterKeyConfigured 在已配置时返回 true", () => {
    process.env.V121_MASTER_KEY = "a".repeat(16);
    resetRuntimeConfig();
    expect(isMasterKeyConfigured()).toBe(true);
  });

  it("isMasterKeyConfigured 在未配置时返回 false", () => {
    expect(isMasterKeyConfigured()).toBe(false);
  });

  it("结果被缓存，环境变量删除后仍可用", () => {
    process.env.V121_MASTER_KEY = "b".repeat(16);
    resetRuntimeConfig();
    const first = getMasterKey();
    delete process.env.V121_MASTER_KEY;
    resetRuntimeConfig();
    // 缓存存在，不抛错
    const second = getMasterKey();
    expect(first).toBe(second);
  });

  it("resetMasterKeyCache 清除缓存后依赖新环境变量", () => {
    process.env.V121_MASTER_KEY = "first-master-key!";
    resetRuntimeConfig();
    expect(getMasterKey()).toBe("first-master-key!");

    resetMasterKeyCache();
    process.env.V121_MASTER_KEY = "second-master-key";
    resetRuntimeConfig();

    expect(getMasterKey()).toBe("second-master-key");
  });
});
