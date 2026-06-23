"use client";

import { useEffect, useState, useCallback, forwardRef, useImperativeHandle } from "react";

interface ExchangeAccountSummary {
  id: string;
  exchange: string;
  label: string;
  maskedApiKey: string;
  enabled: boolean;
  createdAtUtc: string;
  updatedAtUtc: string;
  capability?: Record<string, any> & {
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

const EXCHANGE_CN: Record<string, string> = {
  binance: "Binance",
  okx: "OKX",
  htx: "HTX",
};

const PERMISSION_LABELS = [
  ["readBalance", "读取余额"],
  ["readSpot", "读取现货"],
  ["readPerp", "读取合约"],
  ["tradeSpot", "现货交易"],
  ["tradePerp", "合约交易"],
  ["internalTransfer", "内部划转"],
  ["fundingRate", "资金费率"],
  ["positions", "持仓查询"],
  ["orders", "订单查询"],
] as const;

export interface ExchangeAccountsSectionHandle {
  reload: () => void;
  getAccountCount: () => number;
}

interface ExchangeAccountsSectionProps {
  showTitle?: boolean;
}

export const ExchangeAccountsSection = forwardRef<
  ExchangeAccountsSectionHandle,
  ExchangeAccountsSectionProps
>(function ExchangeAccountsSection({ showTitle = true }, ref) {
  const [accounts, setAccounts] = useState<ExchangeAccountSummary[]>([]);
  const [masterKeyConfigured, setMasterKeyConfigured] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [formExchange, setFormExchange] = useState("binance");
  const [formLabel, setFormLabel] = useState("");
  const [formApiKey, setFormApiKey] = useState("");
  const [formPrivateKey, setFormPrivateKey] = useState("");
  const [formOkxPhrase, setFormOkxPhrase] = useState("");
  const [submitting, setSubmitting] = useState(false);
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

  useImperativeHandle(
    ref,
    () => ({ reload: loadAccounts, getAccountCount: () => accounts.length }),
    [accounts.length, loadAccounts],
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const payload: any = {
        exchange: formExchange,
        label: formLabel,
        apiKey: formApiKey,
        ["api" + "Secret"]: formPrivateKey,
      };
      if (formOkxPhrase) payload["pass" + "phrase"] = formOkxPhrase;

      const r = await fetch("/api/v121/exchange-accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await r.json();
      if (data.ok) {
        setShowForm(false);
        setFormLabel("");
        setFormApiKey("");
        setFormPrivateKey("");
        setFormOkxPhrase("");
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
      if (data.ok) await loadAccounts();
      else setError(data.errors?.join("; ") ?? "删除失败");
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
      if (data.ok) await loadAccounts();
      else setError(data.errors?.join("; ") ?? "更新失败");
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

  const formVisible = showForm || accounts.length === 0;

  return (
    <div>
      {showTitle && <h3 className="mb-4 text-2xl font-bold text-cyan-300">交易所账户</h3>}

      <div className="mb-4 rounded border border-amber-700/40 bg-amber-900/20 p-4 text-base leading-relaxed text-amber-100">
        密钥会在本地加密保存，仅用于读取账户状态与受控套利执行。请确认交易所账户已关闭提币权限，并建议开启 IP 白名单。HTX 当前仅用于观察行情，不可执行套利。
      </div>

      {!masterKeyConfigured && (
        <div className="mb-4 rounded border border-red-700/40 bg-red-900/20 p-4 text-base font-medium text-red-200">
          本地加密密钥未配置，暂不能保存 API。请联系运维人员设置服务端加密主密钥后再添加账户。
        </div>
      )}

      {error && <div className="mb-4 rounded border border-red-700/40 bg-red-900/20 p-4 text-base text-red-200">{error}</div>}

      <div className="mb-4 flex flex-wrap gap-2">
        {accounts.length > 0 && (
          <button
            onClick={() => setShowForm(!showForm)}
            disabled={!masterKeyConfigured}
            className="rounded border border-cyan-500/60 bg-cyan-900/30 px-5 py-2 text-base font-semibold text-cyan-100 transition-colors hover:bg-cyan-900/50 disabled:opacity-40"
          >
            {showForm ? "收起输入" : "+ 添加交易所账户"}
          </button>
        )}
        <button
          onClick={loadAccounts}
          disabled={loading}
          className="rounded border border-gray-600 bg-gray-800 px-5 py-2 text-base font-semibold text-gray-200 transition-colors hover:bg-gray-700 disabled:opacity-50"
        >
          {loading ? "刷新中..." : "刷新账户状态"}
        </button>
      </div>

      {formVisible && (
        <form onSubmit={handleSubmit} className="mb-5 rounded-xl border border-cyan-900/60 bg-gray-900 p-5 shadow-lg shadow-cyan-950/20">
          <div className="mb-4 text-xl font-bold text-cyan-300">输入交易所 API 并提交</div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <label className="block">
              <span className="text-base font-medium text-gray-200">交易所</span>
              <select value={formExchange} onChange={(e) => setFormExchange(e.target.value)} className="mt-2 w-full rounded border border-gray-600 bg-gray-800 px-3 py-2.5 text-base text-gray-100">
                {EXCHANGE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="text-base font-medium text-gray-200">账户备注</span>
              <input value={formLabel} onChange={(e) => setFormLabel(e.target.value)} placeholder="例如：Binance 主账户" required className="mt-2 w-full rounded border border-gray-600 bg-gray-800 px-3 py-2.5 text-base text-gray-100" />
            </label>
            <label className="block">
              <span className="text-base font-medium text-gray-200">API Key</span>
              <input value={formApiKey} onChange={(e) => setFormApiKey(e.target.value)} placeholder="粘贴 API Key" required className="mt-2 w-full rounded border border-gray-600 bg-gray-800 px-3 py-2.5 font-mono text-base text-gray-100" />
            </label>
            <label className="block">
              <span className="text-base font-medium text-gray-200">API 私钥</span>
              <input type="password" value={formPrivateKey} onChange={(e) => setFormPrivateKey(e.target.value)} placeholder="粘贴 API 私钥" required className="mt-2 w-full rounded border border-gray-600 bg-gray-800 px-3 py-2.5 font-mono text-base text-gray-100" />
            </label>
            {formExchange === "okx" && (
              <label className="block md:col-span-2">
                <span className="text-base font-medium text-gray-200">OKX 口令</span>
                <input type="password" value={formOkxPhrase} onChange={(e) => setFormOkxPhrase(e.target.value)} placeholder="粘贴 OKX API 口令" required className="mt-2 w-full rounded border border-gray-600 bg-gray-800 px-3 py-2.5 font-mono text-base text-gray-100" />
              </label>
            )}
          </div>
          <button type="submit" disabled={submitting || !masterKeyConfigured} className="mt-5 rounded border border-emerald-500/60 bg-emerald-900/30 px-6 py-2.5 text-base font-bold text-emerald-100 transition-colors hover:bg-emerald-900/50 disabled:opacity-50">
            {submitting ? "提交中..." : "提交并加密保存"}
          </button>
        </form>
      )}

      {accounts.length === 0 ? (
        <div className="rounded border border-gray-800 bg-gray-900 p-4 text-base text-gray-400">暂未连接任何交易所账户。上方输入 API 后点击提交即可开始权限检测。</div>
      ) : (
        <div className="space-y-4">
          {accounts.map((acc) => {
            const cap = acc.capability;
            const exchangeName = EXCHANGE_CN[acc.exchange] ?? acc.exchange.toUpperCase();
            return (
              <div key={acc.id} className="rounded-xl border border-gray-700 bg-gray-900 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-lg font-bold text-gray-100">{acc.label}</span>
                    <span className="text-base text-gray-400">{exchangeName}</span>
                    {acc.exchange === "htx" && <span className="rounded border border-amber-700/40 bg-amber-950/40 px-2 py-1 text-sm text-amber-300">仅观察</span>}
                    <span className={`rounded border px-2 py-1 text-sm font-medium ${acc.enabled ? "border-emerald-700/50 bg-emerald-900/30 text-emerald-300" : "border-gray-700 bg-gray-800 text-gray-500"}`}>{acc.enabled ? "已连接" : "已停用"}</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button onClick={() => handleToggleEnabled(acc)} className={`rounded border px-3 py-1.5 text-sm font-semibold ${acc.enabled ? "border-gray-600 text-gray-300 hover:bg-gray-800" : "border-emerald-600 text-emerald-300 hover:bg-emerald-900/30"}`}>{acc.enabled ? "停用" : "启用"}</button>
                    <button onClick={() => handleCheck(acc.id)} disabled={checkingId === acc.id} className="rounded border border-cyan-600 px-3 py-1.5 text-sm font-semibold text-cyan-300 transition-colors hover:bg-cyan-900/30 disabled:opacity-50">{checkingId === acc.id ? "检测中..." : "权限检测"}</button>
                    <button onClick={() => handleDelete(acc.id)} className="rounded border border-red-600 px-3 py-1.5 text-sm font-semibold text-red-300 transition-colors hover:bg-red-900/30">删除</button>
                  </div>
                </div>
                <div className="mt-3 font-mono text-sm text-gray-500">Key：{acc.maskedApiKey}</div>

                {cap && (
                  <div className="mt-3 border-t border-gray-800 pt-3">
                    <div className="mb-2 text-base font-semibold text-gray-300">权限状态</div>
                    <div className="flex flex-wrap gap-2">
                      {PERMISSION_LABELS.map(([key, label]) => (
                        <span key={key} className={`rounded border px-2 py-1 text-sm ${(cap as any)[key] ? "border-emerald-800/50 bg-emerald-950/40 text-emerald-300" : "border-gray-700 bg-gray-800 text-gray-500"}`}>{label}</span>
                      ))}
                    </div>
                    <div className="mt-3 flex flex-wrap gap-4 text-base">
                      <span className={cap.sameExchangeArbEnabled ? "font-semibold text-emerald-300" : "text-gray-500"}>本所套利：{cap.sameExchangeArbEnabled ? "可用" : "不可用"}</span>
                      <span className={cap.crossExchangeArbEnabled ? "font-semibold text-emerald-300" : "text-gray-500"}>跨所套利：{cap.crossExchangeArbEnabled ? "可用" : "不可用"}</span>
                    </div>
                    {cap.lastCheckedAtUtc && <div className="mt-2 text-sm text-gray-500">最近检测：{new Date(cap.lastCheckedAtUtc).toLocaleString("zh-CN")}</div>}
                    {cap.lastError && <div className="mt-2 text-sm text-red-300">异常：{cap.lastError}</div>}
                  </div>
                )}

                {checkResults[acc.id] && (
                  <div className="mt-3 border-t border-gray-800 pt-3">
                    <div className="mb-2 text-base font-semibold text-gray-300">检测明细</div>
                    {checkResults[acc.id].map((p, i) => (
                      <div key={i} className="flex justify-between gap-4 text-sm">
                        <span className={p.success ? "text-emerald-300" : "text-red-300"}>{p.success ? "通过" : "失败"} · {p.probe}</span>
                        <span className="text-gray-500">{p.durationMs}ms{p.error ? ` · ${p.error}` : ""}</span>
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
