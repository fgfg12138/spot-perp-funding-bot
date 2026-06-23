"use client";

import { useEffect, useState, useCallback, forwardRef } from "react";

/**
 * 交易所账户管理区块 — 可复用客户端组件。
 *
 * 同时供成品设置页 /settings 和开发者页 /v121/api-keys 使用。
 * 复用 /api/v121/exchange-accounts 后端，不重复造后端。
 *
 * 文案面向普通用户：
 *  - "交易所账户"（不用 "API Keys"）
 *  - "连接状态"（不用 "enabled/disabled"）
 *  - "权限检测"（不用 "probe/capability detect"）
 *  - "本所套利" / "跨所套利"（不用 "same_exchange_arb"）
 */

interface ExchangeAccountSummary {
  id: string;
  exchange: string;
  label: string;
  maskedApiKey: string;
  enabled: boolean;
  createdAtUtc: string;
  updatedAtUtc: string;
  capability?: {
    readBalance: boolean;
    readSpot: boolean;
    readPerp: boolean;
    tradeSpot: boolean;
    tradePerp: boolean;
    internalTransfer: boolean;
    fundingRate: boolean;
    positions: boolean;
    orders: boolean;
    sameExchangeArbEnabled: boolean;
    crossExchangeArbEnabled: boolean;
    lastCheckedAtUtc?: string;
    lastError?: string;
  };
}

interface ProbeResult {
  probe: string;
  success: boolean;
  error?: string;
  durationMs: number;
}

interface AccountsResponse {
  ok: boolean;
  accounts: ExchangeAccountSummary[];
  masterKeyConfigured: boolean;
  count: number;
  errors?: string[];
}

const EXCHANGE_OPTIONS = [
  { value: "binance", label: "Binance" },
  { value: "okx", label: "OKX" },
  { value: "htx", label: "HTX（仅观察，不可套利）" },
];

/** 交易所中文名，用于展示。 */
const EXCHANGE_CN: Record<string, string> = {
  binance: "Binance",
  okx: "OKX",
  htx: "HTX",
};

export interface ExchangeAccountsSectionHandle {
  reload: () => void;
  getAccountCount: () => number;
}

interface ExchangeAccountsSectionProps {
  /** 是否显示标题（嵌入设置页时可设为 false，由外层提供标题）。 */
  showTitle?: boolean;
}

/**
 * 交易所账户管理区块。
 *
 * 用法：
 *   <ExchangeAccountsSection />
 *
 * 通过 ref 可获取 reload() / getAccountCount() 用于外部刷新。
 */
export const ExchangeAccountsSection = forwardRef<
  ExchangeAccountsSectionHandle,
  ExchangeAccountsSectionProps
>(function ExchangeAccountsSection({ showTitle = true }, ref) {
  const [accounts, setAccounts] = useState<ExchangeAccountSummary[]>([]);
  const [masterKeyConfigured, setMasterKeyConfigured] = useState<boolean>(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 新增表单
  const [showForm, setShowForm] = useState(false);
  const [formExchange, setFormExchange] = useState("binance");
  const [formLabel, setFormLabel] = useState("");
  const [formApiKey, setFormApiKey] = useState("");
  const [formApiSecret, setFormApiSecret] = useState("");
  const [formPassphrase, setFormPassphrase] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // 权限检测状态
  const [checkingId, setCheckingId] = useState<string | null>(null);
  const [checkResults, setCheckResults] = useState<Record<string, ProbeResult[]>>({});

  const loadAccounts = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch("/api/v121/exchange-accounts");
      const data: AccountsResponse = await r.json();
      if (data.ok) {
        setAccounts(data.accounts);
        setMasterKeyConfigured(data.masterKeyConfigured);
      } else {
        setError(data.errors?.join("; ") ?? "加载失败");
      }
    } catch (err: any) {
      setError(err.message ?? String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAccounts();
  }, [loadAccounts]);

  // 暴露 ref 方法
  useEffect(() => {
    if (ref) {
      (ref as any).current = {
        reload: loadAccounts,
        getAccountCount: () => accounts.length,
      };
    }
  }, [ref, loadAccounts, accounts.length]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const r = await fetch("/api/v121/exchange-accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          exchange: formExchange,
          label: formLabel,
          apiKey: formApiKey,
          apiSecret: formApiSecret,
          passphrase: formPassphrase || undefined,
        }),
      });
      const data = await r.json();
      if (data.ok) {
        setShowForm(false);
        setFormLabel("");
        setFormApiKey("");
        setFormApiSecret("");
        setFormPassphrase("");
        await loadAccounts();
      } else {
        setError(data.errors?.join("; ") ?? "保存失败");
      }
    } catch (err: any) {
      setError(err.message ?? String(err));
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("确认删除此交易所账户？此操作不可恢复。")) return;
    try {
      const r = await fetch(`/api/v121/exchange-accounts/${id}`, { method: "DELETE" });
      const data = await r.json();
      if (data.ok) {
        await loadAccounts();
      } else {
        setError(data.errors?.join("; ") ?? "删除失败");
      }
    } catch (err: any) {
      setError(err.message ?? String(err));
    }
  };

  const handleToggleEnabled = async (account: ExchangeAccountSummary) => {
    try {
      const r = await fetch(`/api/v121/exchange-accounts/${account.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !account.enabled }),
      });
      const data = await r.json();
      if (data.ok) {
        await loadAccounts();
      } else {
        setError(data.errors?.join("; ") ?? "更新失败");
      }
    } catch (err: any) {
      setError(err.message ?? String(err));
    }
  };

  const handleCheck = async (id: string) => {
    setCheckingId(id);
    setError(null);
    try {
      const r = await fetch(`/api/v121/exchange-accounts/${id}/check`, { method: "POST" });
      const data = await r.json();
      if (data.ok) {
        setCheckResults((prev) => ({ ...prev, [id]: data.probes }));
        await loadAccounts();
      } else {
        setError(data.errors?.join("; ") ?? "权限检测失败");
      }
    } catch (err: any) {
      setError(err.message ?? String(err));
    } finally {
      setCheckingId(null);
    }
  };

  return (
    <div>
      {showTitle && (
        <h3 className="mb-3 text-lg font-semibold text-cyan-400">交易所账户</h3>
      )}

      {/* 安全说明 */}
      <div className="mb-3 rounded border border-amber-700/40 bg-amber-900/20 p-3 text-xs leading-relaxed text-amber-200">
        密钥采用本地加密保存，仅用于服务端读取账户状态与受控套利执行，不会出现在前端。
        建议使用已关闭提币权限的 API。HTX 当前仅用于观察行情，不可执行套利。
      </div>

      {/* 本地加密密钥未配置 */}
      {!masterKeyConfigured && (
        <div className="mb-3 rounded border border-red-700/40 bg-red-900/20 p-3 text-sm text-red-200">
          本地加密密钥未配置，暂不能保存 API。请联系运维人员设置服务端加密主密钥后再添加账户。
        </div>
      )}

      {error && (
        <div className="mb-3 rounded border border-red-700/40 bg-red-900/20 p-3 text-sm text-red-200">
          {error}
        </div>
      )}

      {/* 操作按钮 */}
      <div className="mb-3 flex gap-2">
        <button
          onClick={() => setShowForm(!showForm)}
          disabled={!masterKeyConfigured}
          className="rounded border border-cyan-500/60 bg-cyan-900/30 px-3 py-1.5 text-sm text-cyan-200 transition-colors hover:bg-cyan-900/50 disabled:opacity-40"
        >
          {showForm ? "取消" : "+ 连接交易所"}
        </button>
        <button
          onClick={loadAccounts}
          disabled={loading}
          className="rounded border border-gray-600 bg-gray-800 px-3 py-1.5 text-sm text-gray-300 transition-colors hover:bg-gray-700 disabled:opacity-50"
        >
          {loading ? "刷新中..." : "刷新"}
        </button>
      </div>

      {/* 新增表单 */}
      {showForm && (
        <form
          onSubmit={handleSubmit}
          className="mb-4 rounded-lg border border-gray-800 bg-gray-900 p-4"
        >
          <div className="mb-3 text-sm font-semibold text-cyan-400">连接新的交易所账户</div>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs text-gray-400">交易所</span>
              <select
                value={formExchange}
                onChange={(e) => setFormExchange(e.target.value)}
                className="mt-1 w-full rounded border border-gray-700 bg-gray-800 px-2 py-1 text-sm"
              >
                {EXCHANGE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-xs text-gray-400">账户备注（便于识别）</span>
              <input
                value={formLabel}
                onChange={(e) => setFormLabel(e.target.value)}
                placeholder="例如：Binance 主账户"
                required
                className="mt-1 w-full rounded border border-gray-700 bg-gray-800 px-2 py-1 text-sm"
              />
            </label>
            <label className="block">
              <span className="text-xs text-gray-400">API Key</span>
              <input
                value={formApiKey}
                onChange={(e) => setFormApiKey(e.target.value)}
                placeholder="提交后加密保存"
                required
                className="mt-1 w-full rounded border border-gray-700 bg-gray-800 px-2 py-1 text-sm font-mono"
              />
            </label>
            <label className="block">
              <span className="text-xs text-gray-400">API Secret</span>
              <input
                type="password"
                value={formApiSecret}
                onChange={(e) => setFormApiSecret(e.target.value)}
                placeholder="提交后加密保存"
                required
                className="mt-1 w-full rounded border border-gray-700 bg-gray-800 px-2 py-1 text-sm font-mono"
              />
            </label>
            {formExchange === "okx" && (
              <label className="col-span-2 block">
                <span className="text-xs text-gray-400">Passphrase（OKX 必填）</span>
                <input
                  type="password"
                  value={formPassphrase}
                  onChange={(e) => setFormPassphrase(e.target.value)}
                  placeholder="OKX API 的 passphrase"
                  required
                  className="mt-1 w-full rounded border border-gray-700 bg-gray-800 px-2 py-1 text-sm font-mono"
                />
              </label>
            )}
          </div>
          <button
            type="submit"
            disabled={submitting || !masterKeyConfigured}
            className="mt-3 rounded border border-emerald-500/60 bg-emerald-900/30 px-4 py-1.5 text-sm text-emerald-200 transition-colors hover:bg-emerald-900/50 disabled:opacity-50"
          >
            {submitting ? "保存中..." : "加密保存"}
          </button>
        </form>
      )}

      {/* 账户列表 */}
      {accounts.length === 0 ? (
        <div className="rounded border border-gray-800 bg-gray-900 p-4 text-sm text-gray-500">
          暂未连接任何交易所账户。点击「连接交易所」开始。
        </div>
      ) : (
        <div className="space-y-3">
          {accounts.map((acc) => {
            const cap = acc.capability;
            const exchangeName = EXCHANGE_CN[acc.exchange] ?? acc.exchange.toUpperCase();
            return (
              <div key={acc.id} className="rounded border border-gray-700 bg-gray-900 p-3">
                {/* 头部：备注 + 交易所 + 连接状态 */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold">{acc.label}</span>
                    <span className="text-xs text-gray-500">{exchangeName}</span>
                    {acc.exchange === "htx" && (
                      <span className="text-xs text-amber-400">仅观察</span>
                    )}
                    <span
                      className={`text-xs px-1.5 py-0.5 rounded ${
                        acc.enabled
                          ? "border border-emerald-700/50 bg-emerald-900/30 text-emerald-300"
                          : "border border-gray-700 bg-gray-800 text-gray-500"
                      }`}
                    >
                      {acc.enabled ? "已连接" : "已停用"}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => handleToggleEnabled(acc)}
                      className={`rounded border px-2 py-1 text-xs ${
                        acc.enabled
                          ? "border-gray-600 text-gray-400 hover:bg-gray-800"
                          : "border-emerald-600 text-emerald-400 hover:bg-emerald-900/30"
                      }`}
                    >
                      {acc.enabled ? "停用" : "启用"}
                    </button>
                    <button
                      onClick={() => handleCheck(acc.id)}
                      disabled={checkingId === acc.id}
                      className="rounded border border-cyan-600 px-2 py-1 text-xs text-cyan-400 transition-colors hover:bg-cyan-900/30 disabled:opacity-50"
                    >
                      {checkingId === acc.id ? "检测中..." : "权限检测"}
                    </button>
                    <button
                      onClick={() => handleDelete(acc.id)}
                      className="rounded border border-red-600 px-2 py-1 text-xs text-red-400 transition-colors hover:bg-red-900/30"
                    >
                      删除
                    </button>
                  </div>
                </div>

                {/* 脱敏 Key */}
                <div className="mt-2 font-mono text-xs text-gray-500">
                  Key: {acc.maskedApiKey}
                </div>

                {/* 权限能力 */}
                {cap && (
                  <div className="mt-2 border-t border-gray-800 pt-2">
                    <div className="mb-1 text-xs text-gray-400">权限</div>
                    <div className="flex flex-wrap gap-1">
                      {(
                        [
                          ["readBalance", "读取余额"],
                          ["readSpot", "读取现货"],
                          ["readPerp", "读取合约"],
                          ["tradeSpot", "现货交易"],
                          ["tradePerp", "合约交易"],
                          ["internalTransfer", "内部划转"],
                          ["fundingRate", "资金费率"],
                          ["positions", "持仓查询"],
                          ["orders", "订单查询"],
                        ] as const
                      ).map(([key, label]) => (
                        <span
                          key={key}
                          className={`rounded px-1.5 py-0.5 text-xs ${
                            (cap as any)[key]
                              ? "border border-emerald-800/50 bg-emerald-950/40 text-emerald-400"
                              : "border border-gray-700 bg-gray-800 text-gray-600"
                          }`}
                        >
                          {label}
                        </span>
                      ))}
                    </div>

                    {/* 套利可用性 */}
                    <div className="mt-2 flex flex-wrap gap-3 text-xs">
                      <span
                        className={
                          cap.sameExchangeArbEnabled ? "text-emerald-400" : "text-gray-600"
                        }
                      >
                        本所套利: {cap.sameExchangeArbEnabled ? "可用" : "不可用"}
                      </span>
                      <span
                        className={
                          cap.crossExchangeArbEnabled ? "text-emerald-400" : "text-gray-600"
                        }
                      >
                        跨所套利: {cap.crossExchangeArbEnabled ? "可用" : "不可用"}
                      </span>
                    </div>

                    {cap.lastCheckedAtUtc && (
                      <div className="mt-1 text-xs text-gray-600">
                        最近检测:{" "}
                        {new Date(cap.lastCheckedAtUtc).toLocaleString("zh-CN")}
                      </div>
                    )}
                    {cap.lastError && (
                      <div className="mt-1 text-xs text-red-400">异常: {cap.lastError}</div>
                    )}
                  </div>
                )}

                {/* 检测明细 */}
                {checkResults[acc.id] && (
                  <div className="mt-2 border-t border-gray-800 pt-2">
                    <div className="mb-1 text-xs text-gray-400">检测明细</div>
                    {checkResults[acc.id].map((p, i) => (
                      <div key={i} className="flex justify-between text-xs">
                        <span className={p.success ? "text-emerald-400" : "text-red-400"}>
                          {p.success ? "通过" : "失败"} · {p.probe}
                        </span>
                        <span className="text-gray-600">
                          {p.durationMs}ms{p.error ? ` · ${p.error}` : ""}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
});
