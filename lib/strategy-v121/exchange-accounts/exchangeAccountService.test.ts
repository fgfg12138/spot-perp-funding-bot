import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { ExchangeAccountService } from "./exchangeAccountService";
import { FileSystemRepository } from "../persistence/fileSystemRepository";
import { resetMasterKeyCache } from "./masterKey";
import { resetRuntimeConfig } from "../config/runtimeConfig";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { decryptSecret } from "./cryptoUtils";

describe("ExchangeAccountService", () => {
  let service: ExchangeAccountService;
  let fsRepo: FileSystemRepository;
  let tmpDir: string;
  const ORIGINAL_MASTER_KEY = process.env.V121_MASTER_KEY;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "v121-svc-test-"));
    fsRepo = new FileSystemRepository(tmpDir);
    service = new ExchangeAccountService(fsRepo);
    resetMasterKeyCache();
    process.env.V121_MASTER_KEY = "test-master-key-0123456789";
    resetRuntimeConfig();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    resetMasterKeyCache();
    if (ORIGINAL_MASTER_KEY !== undefined) {
      process.env.V121_MASTER_KEY = ORIGINAL_MASTER_KEY;
    } else {
      delete process.env.V121_MASTER_KEY;
    }
    resetRuntimeConfig();
  });

  describe("createAccount", () => {
    it("创建账户并加密保存", async () => {
      const account = await service.createAccount({
        exchange: "binance",
        label: "Binance Main",
        apiKey: "abcdef1234567890",
        apiSecret: "my-secret-key-123",
      });

      expect(account.id).toMatch(/^acc_/);
      expect(account.exchange).toBe("binance");
      expect(account.label).toBe("Binance Main");
      expect(account.maskedApiKey).toBe("abcd********7890");
      expect(account.enabled).toBe(true);
      expect(account.createdAtUtc).toBeDefined();
    });

    it("加密后的密钥可以解密还原", async () => {
      const account = await service.createAccount({
        exchange: "binance",
        label: "Test",
        apiKey: "my-api-key-12345",
        apiSecret: "my-secret-value",
      });

      // 直接从 repo 读取加密记录
      const records = fsRepo.queryAll("exchange_accounts");
      expect(records).toHaveLength(1);
      const record = records[0];
      const encryptedSecret = JSON.parse(record.encrypted_secret_json as string);
      const decrypted = decryptSecret(encryptedSecret, "test-master-key-0123456789");
      expect(decrypted).toBe("my-secret-value");
    });

    it("OKX 账户需要 passphrase", async () => {
      await expect(
        service.createAccount({
          exchange: "okx",
          label: "OKX",
          apiKey: "okx-key-12345678",
          apiSecret: "okx-secret",
        }),
      ).rejects.toThrow("passphrase");
    });

    it("OKX 账户带 passphrase 正常创建", async () => {
      const account = await service.createAccount({
        exchange: "okx",
        label: "OKX Sub",
        apiKey: "okx-key-12345678",
        apiSecret: "okx-secret",
        passphrase: "okx-pass",
      });

      expect(account.exchange).toBe("okx");
      const records = fsRepo.queryAll("exchange_accounts");
      expect(records[0].encrypted_passphrase_json).toBeDefined();
    });

    it("master key 未配置时拒绝创建", async () => {
      delete process.env.V121_MASTER_KEY;
      resetMasterKeyCache();
      resetRuntimeConfig();

      await expect(
        service.createAccount({
          exchange: "binance",
          label: "Test",
          apiKey: "key",
          apiSecret: "secret",
        }),
      ).rejects.toThrow("V121_MASTER_KEY");
    });

    it("不支持 HTX 之外的交易所时拒绝（实际 HTX 也支持）", async () => {
      await expect(
        service.createAccount({
          exchange: "bybit" as any,
          label: "Test",
          apiKey: "key",
          apiSecret: "secret",
        }),
      ).rejects.toThrow("不支持的交易所");
    });

    it("空 label 拒绝", async () => {
      await expect(
        service.createAccount({
          exchange: "binance",
          label: "",
          apiKey: "key",
          apiSecret: "secret",
        }),
      ).rejects.toThrow("label");
    });

    it("空 apiKey 拒绝", async () => {
      await expect(
        service.createAccount({
          exchange: "binance",
          label: "Test",
          apiKey: "",
          apiSecret: "secret",
        }),
      ).rejects.toThrow("apiKey");
    });
  });

  describe("listAccounts", () => {
    it("列出所有账户", async () => {
      await service.createAccount({
        exchange: "binance", label: "A",
        apiKey: "key1-1234567890", apiSecret: "secret1",
      });
      await service.createAccount({
        exchange: "okx", label: "B",
        apiKey: "key2-1234567890", apiSecret: "secret2", passphrase: "pass",
      });

      const accounts = service.listAccounts();
      expect(accounts).toHaveLength(2);
      expect(accounts.every(a => !a.maskedApiKey.includes("secret"))).toBe(true);
    });
  });

  describe("getAccount", () => {
    it("获取存在的账户", async () => {
      const created = await service.createAccount({
        exchange: "binance", label: "Test",
        apiKey: "key-1234567890", apiSecret: "secret",
      });
      const found = service.getAccount(created.id);
      expect(found).toBeDefined();
      expect(found!.label).toBe("Test");
    });

    it("不存在的账户返回 undefined", () => {
      expect(service.getAccount("nonexistent")).toBeUndefined();
    });
  });

  describe("updateAccount", () => {
    it("更新 label", async () => {
      const created = await service.createAccount({
        exchange: "binance", label: "Old",
        apiKey: "key-1234567890", apiSecret: "secret",
      });
      const updated = service.updateAccount(created.id, { label: "New" });
      expect(updated.label).toBe("New");
    });

    it("更新 enabled", async () => {
      const created = await service.createAccount({
        exchange: "binance", label: "Test",
        apiKey: "key-1234567890", apiSecret: "secret",
      });
      const updated = service.updateAccount(created.id, { enabled: false });
      expect(updated.enabled).toBe(false);
    });

    it("更新不存在的账户抛错", () => {
      expect(() => service.updateAccount("nonexistent", { label: "X" })).toThrow("不存在");
    });

    it("空 label 拒绝", async () => {
      const created = await service.createAccount({
        exchange: "binance", label: "Test",
        apiKey: "key-1234567890", apiSecret: "secret",
      });
      expect(() => service.updateAccount(created.id, { label: "" })).toThrow("label");
    });
  });

  describe("deleteAccount", () => {
    it("删除账户", async () => {
      const created = await service.createAccount({
        exchange: "binance", label: "Test",
        apiKey: "key-1234567890", apiSecret: "secret",
      });
      service.deleteAccount(created.id);
      expect(service.getAccount(created.id)).toBeUndefined();
    });

    it("删除不存在的账户抛错", () => {
      expect(() => service.deleteAccount("nonexistent")).toThrow("不存在");
    });
  });

  describe("probeAccount", () => {
    it("V121_MASTER_KEY 未配置时返回空能力记录并拒绝探测", async () => {
      const created = await service.createAccount({
        exchange: "binance", label: "Test",
        apiKey: "key-1234567890", apiSecret: "secret",
      });

      // 删除 master key 后重置缓存
      delete process.env.V121_MASTER_KEY;
      resetMasterKeyCache();
      resetRuntimeConfig();

      const report = await service.probeAccount(created.id);
      expect(report.accountId).toBe(created.id);
      expect(report.capability.readBalance).toBe(false);
      expect(report.capability.lastError).toContain("加密密钥未配置");
      expect(report.probes).toHaveLength(0);

      // 能力记录被保存
      const cap = service.getCapability(created.id);
      expect(cap).toBeDefined();
      expect(cap!.lastError).toContain("加密密钥未配置");
    });

    it("探测后能力记录被保存（Binance runtime adapter 会尝试网络请求）", async () => {
      const created = await service.createAccount({
        exchange: "binance", label: "Test",
        apiKey: "key-1234567890", apiSecret: "secret",
      });

      await service.probeAccount(created.id);
      const cap = service.getCapability(created.id);
      expect(cap).toBeDefined();
      expect(cap!.accountId).toBe(created.id);
      // 用无效 key 探测真实 Binance API 会失败，readBalance 应为 false
      expect(cap!.readBalance).toBe(false);
    });

    it("探测不存在的账户抛错", async () => {
      await expect(service.probeAccount("nonexistent")).rejects.toThrow("不存在");
    });

    it("OKX 账户探测使用运行时 adapter（不误判为不可用）", async () => {
      const created = await service.createAccount({
        exchange: "okx", label: "OKX",
        apiKey: "okx-key-12345678", apiSecret: "okx-secret",
        passphrase: "okx-pass",
      });

      const report = await service.probeAccount(created.id);
      expect(report.capability.readBalance).toBe(false);
      expect(report.capability.tradeSpot).toBe(false);
      expect(report.capability.sameExchangeArbEnabled).toBe(false);
      // 使用假 key 探测真实 OKX API，会返回 401 认证错误
      expect(report.capability.lastError).toContain("401");
    });

    it("HTX 账户探测返回 observe_only", async () => {
      const created = await service.createAccount({
        exchange: "htx", label: "HTX",
        apiKey: "htx-key-12345678", apiSecret: "htx-secret",
      });

      const report = await service.probeAccount(created.id);
      expect(report.capability.sameExchangeArbEnabled).toBe(false);
      expect(report.capability.lastError).toContain("observe-only");
    });

    it("探测结果不泄露明文密钥", async () => {
      const created = await service.createAccount({
        exchange: "binance", label: "Test",
        apiKey: "plaintext-api-key-12345", apiSecret: "plaintext-secret-value",
      });

      const report = await service.probeAccount(created.id);
      const json = JSON.stringify(report);
      expect(json).not.toContain("plaintext-api-key-12345");
      expect(json).not.toContain("plaintext-secret-value");
      expect(json).not.toContain("encrypted_");
    });
  });

  describe("安全检查", () => {
    it("listAccounts 返回的摘要不包含加密密钥", async () => {
      await service.createAccount({
        exchange: "binance", label: "Test",
        apiKey: "key-1234567890", apiSecret: "secret",
      });

      const accounts = service.listAccounts();
      const json = JSON.stringify(accounts);
      expect(json).not.toContain("encrypted");
      expect(json).not.toContain("apiSecret");
      expect(json).not.toContain("passphrase");
    });

    it("getAccount 返回的摘要不包含加密密钥", async () => {
      const created = await service.createAccount({
        exchange: "binance", label: "Test",
        apiKey: "key-1234567890", apiSecret: "secret",
      });

      const account = service.getAccount(created.id);
      const json = JSON.stringify(account);
      expect(json).not.toContain("encrypted");
      expect(json).not.toContain("apiSecret");
    });

    it("probeAccount 响应不包含明文 apiKey/secret/passphrase", async () => {
      const created = await service.createAccount({
        exchange: "okx", label: "OKX",
        apiKey: "raw-okx-key-12345678",
        apiSecret: "raw-okx-secret-value",
        passphrase: "raw-okx-passphrase",
      });

      const report = await service.probeAccount(created.id);
      const json = JSON.stringify(report);
      expect(json).not.toContain("raw-okx-key-12345678");
      expect(json).not.toContain("raw-okx-secret-value");
      expect(json).not.toContain("raw-okx-passphrase");
    });

    it("probeAccount 响应不包含 encrypted_api_key/secret/passphrase", async () => {
      const created = await service.createAccount({
        exchange: "binance", label: "Test",
        apiKey: "key-1234567890", apiSecret: "secret",
      });

      const report = await service.probeAccount(created.id);
      const json = JSON.stringify(report);
      expect(json).not.toContain("encrypted_api_key");
      expect(json).not.toContain("encrypted_secret");
      expect(json).not.toContain("encrypted_passphrase");
      expect(json).not.toContain("encryptedApiKey");
      expect(json).not.toContain("encryptedSecret");
      expect(json).not.toContain("encryptedPassphrase");
    });

    it("capability 记录不包含明文/密文密钥", async () => {
      const created = await service.createAccount({
        exchange: "binance", label: "Test",
        apiKey: "secret-key-1234567890", apiSecret: "secret-secret-value",
      });

      await service.probeAccount(created.id);
      const cap = service.getCapability(created.id);
      const json = JSON.stringify(cap);
      expect(json).not.toContain("secret-key-1234567890");
      expect(json).not.toContain("secret-secret-value");
      expect(json).not.toContain("encrypted_");
    });

    it("V121_MASTER_KEY 未配置时拒绝创建账户", async () => {
      delete process.env.V121_MASTER_KEY;
      resetMasterKeyCache();
      resetRuntimeConfig();

      await expect(
        service.createAccount({
          exchange: "binance", label: "Test",
          apiKey: "key-1234567890", apiSecret: "secret",
        }),
      ).rejects.toThrow("V121_MASTER_KEY");
    });

    it("V121_MASTER_KEY 未配置时 probeAccount 返回空能力但不抛错", async () => {
      // 先在 master key 可用时创建账户
      const created = await service.createAccount({
        exchange: "binance", label: "Test",
        apiKey: "key-1234567890", apiSecret: "secret",
      });

      // 删除 master key
      delete process.env.V121_MASTER_KEY;
      resetMasterKeyCache();
      resetRuntimeConfig();

      // probeAccount 不应抛错，应返回空能力记录
      const report = await service.probeAccount(created.id);
      expect(report.capability.readBalance).toBe(false);
      expect(report.capability.lastError).toContain("加密密钥未配置");
    });
  });
});
