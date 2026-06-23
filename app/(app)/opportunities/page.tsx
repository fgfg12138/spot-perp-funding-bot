"use client";

import { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import {
  filterOpportunitiesByCapability,
  aggregateCapability,
  type AccountCapabilitySummary,
  type OpportunityWithCapability,
  type CapabilityAggregate,
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

const SORT_LABELS: Record<SortField, string> = {
  fundingRate: "资金费率",
  entryBasis: "开仓基差",
  netProfit: "预计净收益",
  updatedAt: "更新时间",
};

export default function OpportunitiesPage() {
  const [data, setData] = useState<any>(null);
  const [accounts, setAccounts] = useState<AccountCapabilitySummary[]>([]);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [tab, setTab] = useState<"same" | "cross">("same");
  const [sortField, setSortField] = useState<SortField>("fundingRate");
  const [sortDesc, setSortDesc] = useState(true);

  const fetchOpps = () => {
    fetch("/api/v121/opportunities").then((r) => r.json()).then(setData).catch(() => {});
  };

  const fetchAccounts = () => {
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
  };

  useEffect(() => {
    fetchOpps();
    fetchAccounts();
    const i = setInterval(() => {
      fetchOpps();
      fetchAccounts();
    }, 15000);
    return () => clearInterval(i);
  }, []);

  const doScan = async () => {
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
  };

  const allOpps: any[] = data?.opportunities ?? [];

  // 应用能力过滤
  const filteredOpps = useMemo(
    () => filterOpportunitiesByCapability(allOpps, accounts),
    [allOpps, accounts],
  );

  const agg: CapabilityAggregate = useMemo(
    () => aggregateCapability(filteredOpps),
    [filteredOpps],
  );

  // 按 tab 分组
  const tabOpps = useMemo(() => {
    const list = filteredOpps.filter((r) =>
      tab === "same" ? !r.capabilityResult.isCrossExchange : r.capabilityResult.isCrossExchange,
    );
    // 排序
    const sorted = [...list].sort((a, b) => {
      const ra = execStatus(a.capabilityResult);
      const rb = execStatus(b.capabilityResult);
      const rank: Record<ExecStatus, number> = { 可执行: 0, 观察中: 1, 不可执行: 2 };
      if (rank[ra] !== rank[rb]) return rank[ra] - rank[rb];

      // 同级按排序字段
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

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-2xl font-bold">机会</h2>
        <button
          onClick={doScan}
          disabled={scanning}
          className="border border-cyan-400/60 bg-cyan-400/15 px-3 py-1 text-sm text-cyan-100 transition-colors hover:bg-cyan-400/25 disabled:opacity-50"
        >
          {scanning ? "扫描中..." : "立即扫描"}
        </button>
      </div>

      {scanError ? (
        <div className="mb-4 rounded border border-red-800/40 bg-red-950/30 p-2 text-xs text-red-300">
          扫描失败：{scanError}
        </div>
      ) : null}

      {noAccounts ? (
        <div className="mb-4 rounded border border-amber-800/50 bg-amber-950/20 p-3 text-sm text-amber-200">
          尚未连接交易所账户，所有机会显示为不可执行。请前往
          <Link href="/settings?section=exchange-accounts" className="mx-1 underline hover:text-amber-100">
            设置页
          </Link>
          连接交易所账户。
        </div>
      ) : null}

      {data ? (
        <div className="mb-4 text-xs text-gray-500">
          <span className="text-emerald-400">可执行 {openableCount}</span>
          {" · "}
          <span className="text-amber-400">观察中 {observeCount}</span>
          {" · "}
          <span>共 {allOpps.length} 条</span>
          {data.scannedAtUtc
            ? ` · 最近扫描 ${new Date(data.scannedAtUtc).toLocaleString("zh-CN")}`
            : ""}
        </div>
      ) : null}

      {/* 套利模式可用性 */}
      <div className="mb-4 grid grid-cols-2 gap-3">
        <div
          className={`rounded border p-3 text-sm ${
            agg.sameExchangeAvailable
              ? "border-emerald-700/50 bg-emerald-950/20 text-emerald-200"
              : "border-gray-700 bg-gray-900 text-gray-400"
          }`}
        >
          <div className="text-xs text-gray-500">本所套利</div>
          <div className="mt-1 font-semibold">
            {agg.sameExchangeAvailable ? "可用" : "暂无可用"}
          </div>
          <div className="text-xs">
            可执行 {agg.sameExchangeExecutable} · 观察中 {agg.sameExchangeObservable} · 不可执行 {agg.sameExchangeBlocked}
          </div>
        </div>
        <div
          className={`rounded border p-3 text-sm ${
            agg.crossExchangeAvailable
              ? "border-emerald-700/50 bg-emerald-950/20 text-emerald-200"
              : "border-gray-700 bg-gray-900 text-gray-400"
          }`}
        >
          <div className="text-xs text-gray-500">跨所套利</div>
          <div className="mt-1 font-semibold">
            {agg.crossExchangeAvailable ? "可用" : "暂无可用"}
          </div>
          <div className="text-xs">
            可执行 {agg.crossExchangeExecutable} · 观察中 {agg.crossExchangeObservable} · 不可执行 {agg.crossExchangeBlocked}
          </div>
        </div>
      </div>

      {/* Tab 切换 */}
      <div className="mb-3 flex gap-2">
        <button
          onClick={() => setTab("same")}
          className={`rounded border px-3 py-1 text-sm transition-colors ${
            tab === "same"
              ? "border-cyan-400 bg-cyan-900/30 text-cyan-200"
              : "border-gray-700 text-gray-400 hover:bg-gray-800"
          }`}
        >
          本所套利
        </button>
        <button
          onClick={() => setTab("cross")}
          className={`rounded border px-3 py-1 text-sm transition-colors ${
            tab === "cross"
              ? "border-cyan-400 bg-cyan-900/30 text-cyan-200"
              : "border-gray-700 text-gray-400 hover:bg-gray-800"
          }`}
        >
          跨所套利
        </button>
      </div>

      {/* 排序控件 */}
      <div className="mb-3 flex items-center gap-2 text-xs text-gray-500">
        <span>排序：</span>
        {(Object.keys(SORT_LABELS) as SortField[]).map((f) => (
          <button
            key={f}
            onClick={() => {
              if (sortField === f) {
                setSortDesc(!sortDesc);
              } else {
                setSortField(f);
                setSortDesc(true);
              }
            }}
            className={`rounded border px-2 py-0.5 transition-colors ${
              sortField === f
                ? "border-cyan-500 bg-cyan-900/30 text-cyan-300"
                : "border-gray-700 text-gray-500 hover:bg-gray-800"
            }`}
          >
            {SORT_LABELS[f]}
            {sortField === f ? (sortDesc ? " ↓" : " ↑") : ""}
          </button>
        ))}
      </div>

      {/* 机会表 */}
      <div className="rounded-lg border border-gray-800 bg-gray-900 p-4">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-800 text-gray-500">
              <th className="py-2 text-left">币种</th>
              <th className="py-2 text-left">现货所</th>
              <th className="py-2 text-left">合约所</th>
              <th className="py-2 text-right">资金费率</th>
              <th className="py-2 text-right">开仓基差</th>
              <th className="py-2 text-right">预计净收益</th>
              <th className="py-2 text-center">风险等级</th>
              <th className="py-2 text-center">状态</th>
              <th className="py-2 text-left">不可执行原因</th>
            </tr>
          </thead>
          <tbody>
            {!tabOpps.length ? (
              <tr>
                <td colSpan={9} className="py-8 text-center text-gray-500">
                  {tab === "same"
                    ? "当前没有本所套利机会，系统会继续自动监控。"
                    : "当前没有跨所套利机会。跨所套利在当前版本默认关闭，仅显示候选。"}
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
                    <td className="py-1 font-semibold">
                      {o.path?.symbol ?? o.symbol ?? "—"}
                    </td>
                    <td className="py-1 text-gray-300">
                      {o.path?.spotExchange ?? "—"}
                    </td>
                    <td className="py-1 text-gray-300">
                      {o.path?.perpExchange ?? "—"}
                    </td>
                    <td className="py-1 text-right tabular-nums">
                      {fmtNum(Number(o.funding8h) * 100, 3)}%
                    </td>
                    <td className="py-1 text-right tabular-nums">
                      {fmtNum(Number(o.entryExecutableBasis) * 100, 3)}%
                    </td>
                    <td className="py-1 text-right tabular-nums">
                      {fmtNum(Number(netProfit), 2)}
                    </td>
                    <td className="py-1 text-center">
                      <span
                        className={`px-1.5 py-0.5 text-xs font-bold ${
                          o.level === "S"
                            ? "text-yellow-300 bg-yellow-900/50"
                            : o.level === "A"
                              ? "text-emerald-300 bg-emerald-900/50"
                              : o.level === "B"
                                ? "text-blue-300 bg-blue-900/50"
                                : "text-gray-500 bg-gray-800"
                        }`}
                      >
                        {o.level ?? "—"}
                      </span>
                    </td>
                    <td className="py-1 text-center">
                      <span
                        className={`inline-block rounded border px-2 py-0.5 text-xs font-medium ${toneClass}`}
                      >
                        {cls}
                      </span>
                    </td>
                    <td className="py-1 text-xs text-gray-500">{reason}</td>
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
