import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { FileSystemRepository } from "../persistence/fileSystemRepository";
import { ExchangeAccountRepository } from "./exchangeAccountRepository";
import type { ExchangeAccountRecord, ExchangeCapability } from "./types";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

// ─── Test Fixtures ──────────────────────────────────

function makeAccount(overrides: Partial<ExchangeAccountRecord> = {}): ExchangeAccountRecord {
  return {
    id: "acc_test_001",
    exchange: "binance",
    label: "Binance Main",
    maskedApiKey: "abcd****1234",
    encryptedApiKeyJson: '{"iv":"aa","authTag":"bb","encrypted":"cc"}',
    encryptedSecretJson: '{"iv":"dd","authTag":"ee","encrypted":"ff"}',
    enabled: true,
    createdAtUtc: "2025-06-01T00:00:00Z",
    updatedAtUtc: "2025-06-01T00:00:00Z",
    ...overrides,
  };
}

function makeCapability(overrides: Partial<ExchangeCapability> = {}): ExchangeCapability {
  return {
    accountId: "acc_test_001",
    exchange: "binance",
    readBalance: true,
    readSpot: true,
    readPerp: true,
    tradeSpot: true,
    tradePerp: true,
    internalTransfer: false,
    fundingRate: true,
    positions: true,
    orders: true,
    sameExchangeArbEnabled: true,
    crossExchangeArbEnabled: false,
    lastCheckedAtUtc: "2025-06-01T01:00:00Z",
    ...overrides,
  };
}

// ─── Tests ──────────────────────────────────────────

describe("ExchangeAccountRepository", () => {
  let repo: ExchangeAccountRepository;
  let fsRepo: FileSystemRepository;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "v121-ea-test-"));
    fsRepo = new FileSystemRepository(tmpDir);
    repo = new ExchangeAccountRepository(fsRepo);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("saveAccount + findAccountById", () => {
    it("保存并查找账户", () => {
      const acc = makeAccount();
      repo.saveAccount(acc);
      const found = repo.findAccountById("acc_test_001");
      expect(found).toBeDefined();
      expect(found!.exchange).toBe("binance");
      expect(found!.label).toBe("Binance Main");
      expect(found!.maskedApiKey).toBe("abcd****1234");
      expect(found!.enabled).toBe(true);
    });

    it("查找不存在的账户返回 undefined", () => {
      expect(repo.findAccountById("nonexistent")).toBeUndefined();
    });

    it("保存 OKX 账户（含 passphrase）", () => {
      const acc = makeAccount({
        id: "acc_okx_001",
        exchange: "okx",
        label: "OKX Sub",
        encryptedPassphraseJson: '{"iv":"gg","authTag":"hh","encrypted":"ii"}',
      });
      repo.saveAccount(acc);
      const found = repo.findAccountById("acc_okx_001");
      expect(found!.exchange).toBe("okx");
      expect(found!.encryptedPassphraseJson).toBe('{"iv":"gg","authTag":"hh","encrypted":"ii"}');
    });

    it("保存覆盖（UPSERT 语义）", () => {
      repo.saveAccount(makeAccount({ label: "Original" }));
      repo.saveAccount(makeAccount({ label: "Updated" }));
      const found = repo.findAccountById("acc_test_001");
      expect(found!.label).toBe("Updated");
    });
  });

  describe("listAccounts", () => {
    it("列出所有账户", () => {
      repo.saveAccount(makeAccount({ id: "acc_1", label: "Account 1" }));
      repo.saveAccount(makeAccount({ id: "acc_2", exchange: "okx", label: "Account 2" }));
      expect(repo.listAccounts()).toHaveLength(2);
    });

    it("空表返回空数组", () => {
      expect(repo.listAccounts()).toHaveLength(0);
    });
  });

  describe("listAccountsByExchange", () => {
    it("按交易所筛选", () => {
      repo.saveAccount(makeAccount({ id: "bn_1", exchange: "binance" }));
      repo.saveAccount(makeAccount({ id: "ok_1", exchange: "okx" }));
      repo.saveAccount(makeAccount({ id: "bn_2", exchange: "binance" }));
      expect(repo.listAccountsByExchange("binance")).toHaveLength(2);
      expect(repo.listAccountsByExchange("okx")).toHaveLength(1);
      expect(repo.listAccountsByExchange("htx")).toHaveLength(0);
    });
  });

  describe("listEnabledAccounts", () => {
    it("仅返回启用的账户", () => {
      repo.saveAccount(makeAccount({ id: "a1", enabled: true }));
      repo.saveAccount(makeAccount({ id: "a2", enabled: false }));
      repo.saveAccount(makeAccount({ id: "a3", enabled: true }));
      expect(repo.listEnabledAccounts()).toHaveLength(2);
      expect(repo.listEnabledAccounts().every(a => a.enabled)).toBe(true);
    });
  });

  describe("deleteAccount", () => {
    it("删除账户和对应的能力", () => {
      repo.saveAccount(makeAccount({ id: "del_1" }));
      repo.saveCapability(makeCapability({ accountId: "del_1" }));
      expect(repo.findAccountById("del_1")).toBeDefined();
      expect(repo.findCapabilityByAccountId("del_1")).toBeDefined();

      repo.deleteAccount("del_1");
      expect(repo.findAccountById("del_1")).toBeUndefined();
      expect(repo.findCapabilityByAccountId("del_1")).toBeUndefined();
    });

    it("删除不存在的账户不报错", () => {
      expect(() => repo.deleteAccount("nonexistent")).not.toThrow();
    });
  });

  describe("accountCount", () => {
    it("返回正确数量", () => {
      expect(repo.accountCount()).toBe(0);
      repo.saveAccount(makeAccount({ id: "c1" }));
      expect(repo.accountCount()).toBe(1);
      repo.saveAccount(makeAccount({ id: "c2" }));
      expect(repo.accountCount()).toBe(2);
    });
  });

  describe("saveCapability + findCapabilityByAccountId", () => {
    it("保存并查找能力", () => {
      const cap = makeCapability();
      repo.saveCapability(cap);
      const found = repo.findCapabilityByAccountId("acc_test_001");
      expect(found).toBeDefined();
      expect(found!.readBalance).toBe(true);
      expect(found!.tradeSpot).toBe(true);
      expect(found!.sameExchangeArbEnabled).toBe(true);
      expect(found!.crossExchangeArbEnabled).toBe(false);
    });

    it("查找不存在的能力返回 undefined", () => {
      expect(repo.findCapabilityByAccountId("nonexistent")).toBeUndefined();
    });

    it("覆盖更新能力", () => {
      repo.saveCapability(makeCapability({ tradeSpot: true }));
      repo.saveCapability(makeCapability({ tradeSpot: false, lastError: "permission denied" }));
      const found = repo.findCapabilityByAccountId("acc_test_001");
      expect(found!.tradeSpot).toBe(false);
      expect(found!.lastError).toBe("permission denied");
    });
  });
});
