"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  aggregateCapability,
  filterOpportunitiesByCapability,
  type AccountCapabilitySummary,
  type CapabilityAggregate,
  type OpportunityWithCapability,
} from "@/lib/strategy-v121/opportunity/opportunityCapabilityFilter";

/**
 * 机会页 — 成品套利机会列表。
 *
 * 分成「本所套利」和「跨所套利」两个 tab。
 * 每个机会根据用户绑定的交易所账户能力判断可执行性：
 *  可执行 / 观察中 / 不可执行。
 * 不显示 dataSource / scanMode / rehearsal candidate / intent 等工程概念。
 */

function fmtNum(v: unknown, digits = 2, fallback = "—") {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n.toFixed(digits) : fallback;
}

type ExecStatus = "可执行" | "观察中" | "不可执行";

function execStatus(r: OpportunityWithCapability["capabilityResult"]): ExecStatus {
  if (r.executability === "executable") return "可执行";
  if (r.executability === "observable") return "观察中";
  return "不可执行";
}

function execTone(r: OpportunityWithCapability["capabilityResult"]): "green" | "yellow" | "slate" {
  if (r.executability === "executable") return "green";
  if (r.executability === "observable") return "yellow";
  return "slate";
}

type SortField = "fundingRate" | "entryBasis" | "netProfit" | "updatedAt";

export default function OpportunitiesPage() {
  const [data, setData] = useState<any>(null);
  const [accounts, setAccounts] = useState<AccountCapabilitySummary[]>([]);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [tab, setTab] = useState<"same" | "cross">("same");
  const [sortField, setSortField] = useState<SortField>("fundingRate");
  const [sortDesc, setSortDesc] = useState(true);

  const fetchOpps = useCallback(() => {
    fetch("/api/v121/opportunities")
      .then((r) => r.json())
      .then(setData)
      .catch(() => {});
  }, []);

  const fetchAccounts = useCallback(() => {
    fetch("/api/v121/exchange-accounts")
      .then((r) => r.json())
      .then((d) => {
        if (d.ok) {
          setAccounts(
            (d.accounts ?? []).map((a: any) => ({
              id: a.id,
              exchange: a.exchange,
              enabled: a.enabled,
              capability: a.capability,
            })),
          );
        }
      })
      .catch(() => {});
  }, []);

  const doScan = useCallback(async () => {
    setScanning(true);
    setScanError(null);
    try {
      const res = await fetch("/api/v121/opportunities/scan", { method: "POST" });
      const result = await res.json();
      if (!res.ok) {
        setScanError(result.error ? `${result.error}: ${result.detail || ""}` : `HTTP ${res.status}`);
        return;
      }
      setData(result);
      fetchAccounts();
    } catch (err) {
      setScanError(String(err));
    } finally {
      setScanning(false);
    }
  }, [fetchAccounts]);

  useEffect(() => {
    fetchOpps();
    fetchAccounts();
    void doScan();
    const i = setInterval(() => {
      fetchOpps();
      fetchAccounts();
    }, 30000);
    return () => clearInterval(i);
  }, [doScan, fetchAccounts, fetchOpps]);

  const allOpps: any[] = data?.opportunities ?? [];

  const filteredOpps = useMemo(
    () => filterOpportunitiesByCapability(allOpps, accounts),
    [allOpps, accounts],
  );

  const agg: CapabilityAggregate = useMemo(
    () => aggregateCapability(filteredOpps),
    [filteredOpps],
  );

  const tabOpps = useMemo(() => {
    const list = filteredOpps.filter((r) =>
      tab === "same" ? !r.capabilityResult.isCrossExchange : r.capabilityResult.isCrossExchange,
    );
    const sorted = [...list].sort((a, b) => {
      const ra = execStatus(a.capabilityResult);
      const rb = execStatus(b.capabilityResult);
      const rank: Record<ExecStatus, number> = { 可执行: 0, 观察中: 1, 不可执行: 2 };
      if (rank[ra] !== rank[rb]) return rank[ra] - rank[rb];

      let va: number, vb: number;
      switch (sortField) {
        case "fundingRate":
          va = Number(a.opportunity.funding8h ?? 0);
          vb = Number(b.opportunity.funding8h ?? 0);
          break;
        case "entryBasis":
          va = Number(a.opportunity.entryExecutableBasis ?? 0);
          vb = Number(b.opportunity.entryExecutableBasis ?? 0);
          break;
        case "netProfit":
          va = Number(a.opportunity.netProfit?.expectedNetProfit ?? a.opportunity.expectedNetProfit ?? 0);
          vb = Number(b.opportunity.netProfit?.expectedNetProfit ?? b.opportunity.expectedNetProfit ?? 0);
          break;
        case "updatedAt":
          va = Number(a.opportunity.discoveredAtUtc ?? 0);
          vb = Number(b.opportunity.discoveredAtUtc ?? 0);
          break;
      }
      return sortDesc ? vb - va : va - vb;
    });
    return sorted;
  }, [filteredOpps, tab, sortField, sortDesc]);

  const openableCount = filteredOpps.filter(
    (r) => r.capabilityResult.executability === "executable",
  ).length;
  const observeCount = filteredOpps.filter(
    (r) => r.capabilityResult.executability === "observable",
  ).length;

  const noAccounts = accounts.length === 0;

  const sortArrow = (field: SortField) =>
    sortField === field ? (sortDesc ? " ↓" : " ↑") : " ↕";

  const sortBy = (field: SortField) => {
    if (sortField === field) {
      setSortDesc(!sortDesc);
      return;
    }
    setSortField(field);
    setSortDesc(true);
  };

  return (
    <div className="space-y-4 text-[15px] text-gray-100">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold text-gray-100">机会池</h2>
          <p className="mt-1 text-sm text-gray-400">
            动态监控负责盯盘，机会池展示最新结果。页面打开后会自动刷新。
          </p>
        </div>
        <button
          onClick={doScan}
          disabled={scanning}
          className="rounded border border-cyan-400/60 bg-cyan-400/15 px-4 py-2 text-sm font-semibold text-cyan-100 transition-colors hover:bg-cyan-400/25 disabled:opacity-50"
        >
          {scanning ? "正在刷新..." : "立即刷新"}
        </button>
      </div>

      {scanError ? (
        <div className="rounded border border-red-800/40 bg-red-950/30 px-3 py-2 text-sm text-red-300">
          刷新失败：{scanError}
        </div>
      ) : null}

      {noAccounts ? (
        <div className="rounded border border-amber-800/50 bg-amber-950/20 px-3 py-2 text-sm text-amber-200">
          尚未连接交易所账户，所有机会显示为不可执行。请前往
          <Link href="/settings?section=exchange-accounts" className="mx-1 underline hover:text-amber-100">
            设置页
          </Link>
          连接交易所账户。
        </div>
      ) : null}

      {data ? (
        <div className="text-sm text-gray-500">
          <span className="font-medium text-emerald-400">可执行 {openableCount}</span>
          {" · "}
          <span className="font-medium text-amber-400">观察中 {observeCount}</span>
          {" · "}
          <span>共 {allOpps.length} 条</span>
          {data.scannedAtUtc
            ? ` · 最近刷新 ${new Date(data.scannedAtUtc).toLocaleString("zh-CN")}`
            : ""}
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div
          className={`rounded border px-3 py-2 text-sm ${
            agg.sameExchangeAvailable
              ? "border-emerald-700/50 bg-emerald-950/20 text-emerald-200"
              : "border-gray-700 bg-gray-900 text-gray-400"
          }`}
        >
          <div className="text-sm text-gray-500">本所套利</div>
          <div className="mt-1 text-base font-semibold">
            {agg.sameExchangeAvailable ? "可用" : "暂无可用"}
          </div>
          <div className="text-sm">
            可执行 {agg.sameExchangeExecutable} · 观察中 {agg.sameExchangeObservable} · 不可执行 {agg.sameExchangeBlocked}
          </div>
        </div>
        <div
          className={`rounded border px-3 py-2 text-sm ${
            agg.crossExchangeAvailable
              ? "border-emerald-700/50 bg-emerald-950/20 text-emerald-200"
              : "border-gray-700 bg-gray-900 text-gray-400"
          }`}
        >
          <div className="text-sm text-gray-500">跨所套利</div>
          <div className="mt-1 text-base font-semibold">
            {agg.crossExchangeAvailable ? "可用" : "暂无可用"}
          </div>
          <div className="text-sm">
            可执行 {agg.crossExchangeExecutable} · 观察中 {agg.crossExchangeObservable} · 不可执行 {agg.crossExchangeBlocked}
          </div>
        </div>
      </div>

      <div className="flex gap-2">
        <button
          onClick={() => setTab("same")}
          className={`rounded border px-3 py-1.5 text-sm font-medium transition-colors ${
            tab === "same"
              ? "border-cyan-400 bg-cyan-900/30 text-cyan-200"
              : "border-gray-700 text-gray-400 hover:bg-gray-800"
          }`}
        >
          本所套利
        </button>
        <button
          onClick={() => setTab("cross")}
          className={`rounded border px-3 py-1.5 text-sm font-medium transition-colors ${
            tab === "cross"
              ? "border-cyan-400 bg-cyan-900/30 text-cyan-200"
              : "border-gray-700 text-gray-400 hover:bg-gray-800"
          }`}
        >
          跨所套利
        </button>
      </div>

      <div className="overflow-x-auto rounded-lg border border-gray-800 bg-gray-900 px-3 py-2">
        <table className="w-full min-w-[980px] text-[15px]">
          <thead>
            <tr className="border-b border-gray-800 text-sm text-gray-400">
              <th className="py-2 pr-3 text-left font-semibold">币种</th>
              <th className="py-2 pr-3 text-left font-semibold">现货所</th>
              <th className="py-2 pr-3 text-left font-semibold">合约所</th>
              <th className="py-2 pr-3 text-right font-semibold">
                <button onClick={() => sortBy("fundingRate")} className="hover:text-cyan-300">
                  资金费率{sortArrow("fundingRate")}
                </button>
              </th>
              <th className="py-2 pr-3 text-right font-semibold">
                <button onClick={() => sortBy("entryBasis")} className="hover:text-cyan-300">
                  开仓基差{sortArrow("entryBasis")}
                </button>
              </th>
              <th className="py-2 pr-3 text-right font-semibold">
                <button onClick={() => sortBy("netProfit")} className="hover:text-cyan-300">
                  预计净收益{sortArrow("netProfit")}
                </button>
              </th>
              <th className="py-2 pr-3 text-center font-semibold">风险等级</th>
              <th className="py-2 pr-3 text-center font-semibold">状态</th>
              <th className="py-2 text-left font-semibold">不可执行原因</th>
            </tr>
          </thead>
          <tbody>
            {!tabOpps.length ? (
              <tr>
                <td colSpan={9} className="py-6 text-center text-gray-500">
                  {tab === "same"
                    ? "当前没有本所套利机会，系统会继续自动监控。"
                    : "当前没有跨所套利机会。跨所套利在当前版本默认关闭，仅显示候选与原因。"}
                </td>
              </tr>
            ) : (
              tabOpps.slice(0, 100).map((r, idx) => {
                const o = r.opportunity;
                const cls = execStatus(r.capabilityResult);
                const tone = execTone(r.capabilityResult);
                const toneClass = {
                  green: "text-emerald-300 bg-emerald-900/40 border-emerald-700/40",
                  yellow: "text-amber-300 bg-amber-900/40 border-amber-700/40",
                  slate: "text-gray-400 bg-gray-800/60 border-gray-700",
                }[tone];
                const reason =
                  r.capabilityResult.blockers.length > 0
                    ? r.capabilityResult.blockers.join("；")
                    : r.capabilityResult.warnings.length > 0
                      ? r.capabilityResult.warnings.join("；")
                      : "—";
                const netProfit =
                  o.netProfit?.expectedNetProfit ?? o.expectedNetProfit;
                return (
                  <tr
                    key={o.id ?? idx}
                    className={`border-b border-gray-800 ${
                      r.capabilityResult.executability === "executable" ? "" : "opacity-70"
                    }`}
                  >
                    <td className="py-1.5 pr-3 font-semibold text-gray-100">
                      {o.path?.symbol ?? o.symbol ?? "—"}
                    </td>
                    <td className="py-1.5 pr-3 text-gray-300">
                      {o.path?.spotExchange ?? "—"}
                    </td>
                    <td className="py-1.5 pr-3 text-gray-300">
                      {o.path?.perpExchange ?? "—"}
                    </td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">
                      {fmtNum(Number(o.funding8h) * 100, 3)}%
                    </td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">
                      {fmtNum(Number(o.entryExecutableBasis) * 100, 3)}%
                    </td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">
                      {fmtNum(Number(netProfit), 2)}
                    </td>
                    <td className="py-1.5 pr-3 text-center">
                      <span
                        className={`rounded px-2 py-0.5 text-sm font-bold ${
                          o.level === "S"
                            ? "bg-yellow-900/50 text-yellow-300"
                            : o.level === "A"
                              ? "bg-emerald-900/50 text-emerald-300"
                              : o.level === "B"
                                ? "bg-blue-900/50 text-blue-300"
                                : "bg-gray-800 text-gray-500"
                        }`}
                      >
                        {o.level ?? "—"}
                      </span>
                    </td>
                    <td className="py-1.5 pr-3 text-center">
                      <span
                        className={`inline-block rounded border px-2 py-0.5 text-sm font-medium ${toneClass}`}
                      >
                        {cls}
                      </span>
                    </td>
                    <td className="py-1.5 text-sm text-gray-500">{reason}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
