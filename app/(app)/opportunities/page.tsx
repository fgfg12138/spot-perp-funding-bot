"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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

function timeValue(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const parsed = Date.parse(v);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
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
  const scanningRef = useRef(false);

  const fetchOpps = async () => {
    try {
      const r = await fetch("/api/v121/opportunities");
      const result = await r.json();
      setData(result);
    } catch {
      // 保持页面可用，下一轮自动刷新会继续尝试。
    }
  };

  const fetchAccounts = async () => {
    try {
      const r = await fetch("/api/v121/exchange-accounts");
      const d = await r.json();
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
    } catch {
      // 保持机会池展示，不因账户状态临时读取失败而清空页面。
    }
  };

  const doScan = async () => {
    if (scanningRef.current) return;
    scanningRef.current = true;
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
      await fetchAccounts();
    } catch (err) {
      setScanError(String(err));
    } finally {
      scanningRef.current = false;
      setScanning(false);
    }
  };

  useEffect(() => {
    fetchOpps();
    fetchAccounts();
    const firstScan = setTimeout(() => {
      void doScan();
    }, 250);
    const refresh = setInterval(() => {
      void doScan();
    }, 30000);
    return () => {
      clearTimeout(firstScan);
      clearInterval(refresh);
    };
  }, []);

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
    const sorted = [...list].sort((a, b) => {
      const ra = execStatus(a.capabilityResult);
      const rb = execStatus(b.capabilityResult);
      const rank: Record<ExecStatus, number> = { 可执行: 0, 观察中: 1, 不可执行: 2 };
      if (rank[ra] !== rank[rb]) return rank[ra] - rank[rb];

      let va: number;
      let vb: number;
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
          va = timeValue(a.opportunity.discoveredAtUtc ?? a.opportunity.updatedAtUtc ?? 0);
          vb = timeValue(b.opportunity.discoveredAtUtc ?? b.opportunity.updatedAtUtc ?? 0);
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

  const setSort = (field: SortField) => {
    if (sortField === field) {
      setSortDesc(!sortDesc);
    } else {
      setSortField(field);
      setSortDesc(true);
    }
  };

  const sortMark = (field: SortField) => {
    if (sortField !== field) return "↕";
    return sortDesc ? "↓" : "↑";
  };

  const SortHeader = ({
    field,
    children,
    align = "right",
  }: {
    field: SortField;
    children: React.ReactNode;
    align?: "left" | "right";
  }) => (
    <th className={`py-3 ${align === "right" ? "text-right" : "text-left"}`}>
      <button
        type="button"
        onClick={() => setSort(field)}
        className={`inline-flex items-center gap-1 text-sm font-semibold transition-colors hover:text-cyan-200 ${
          sortField === field ? "text-cyan-300" : "text-gray-300"
        }`}
      >
        {children}
        <span className="text-xs text-cyan-400">{sortMark(field)}</span>
      </button>
    </th>
  );

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-3xl font-bold text-gray-100">机会池</h2>
          <p className="mt-1 text-base text-gray-400">
            页面打开后会自动刷新。动态监控负责盯盘，机会池展示最新结果。
          </p>
        </div>
        <button
          onClick={doScan}
          disabled={scanning}
          className="rounded border border-cyan-400/60 bg-cyan-400/15 px-5 py-2 text-base font-semibold text-cyan-100 transition-colors hover:bg-cyan-400/25 disabled:opacity-50"
        >
          {scanning ? "正在刷新..." : "立即刷新"}
        </button>
      </div>

      {scanError ? (
        <div className="mb-4 rounded border border-red-800/40 bg-red-950/30 p-3 text-base text-red-300">
          刷新失败：{scanError}
        </div>
      ) : null}

      {noAccounts ? (
        <div className="mb-4 rounded border border-amber-800/50 bg-amber-950/20 p-4 text-base text-amber-200">
          尚未连接交易所账户，所有机会显示为不可执行。请前往
          <Link href="/settings?section=exchange-accounts" className="mx-1 font-semibold underline hover:text-amber-100">
            设置页
          </Link>
          连接交易所账户。
        </div>
      ) : null}

      {data ? (
        <div className="mb-4 text-sm text-gray-400">
          <span className="font-semibold text-emerald-400">可执行 {openableCount}</span>
          {" · "}
          <span className="font-semibold text-amber-400">观察中 {observeCount}</span>
          {" · "}
          <span>共 {allOpps.length} 条</span>
          {data.scannedAtUtc
            ? ` · 最近刷新 ${new Date(data.scannedAtUtc).toLocaleString("zh-CN")}`
            : ""}
          {scanning ? " · 正在自动刷新" : ""}
        </div>
      ) : null}

      {/* 套利模式可用性 */}
      <div className="mb-4 grid grid-cols-2 gap-3">
        <div
          className={`rounded border p-4 text-base ${
            agg.sameExchangeAvailable
              ? "border-emerald-700/50 bg-emerald-950/20 text-emerald-200"
              : "border-gray-700 bg-gray-900 text-gray-400"
          }`}
        >
          <div className="text-sm text-gray-400">本所套利</div>
          <div className="mt-1 text-lg font-semibold">
            {agg.sameExchangeAvailable ? "可用" : "暂无可用"}
          </div>
          <div className="mt-1 text-sm">
            可执行 {agg.sameExchangeExecutable} · 观察中 {agg.sameExchangeObservable} · 不可执行 {agg.sameExchangeBlocked}
          </div>
        </div>
        <div
          className={`rounded border p-4 text-base ${
            agg.crossExchangeAvailable
              ? "border-emerald-700/50 bg-emerald-950/20 text-emerald-200"
              : "border-gray-700 bg-gray-900 text-gray-400"
          }`}
        >
          <div className="text-sm text-gray-400">跨所套利</div>
          <div className="mt-1 text-lg font-semibold">
            {agg.crossExchangeAvailable ? "可用" : "暂无可用"}
          </div>
          <div className="mt-1 text-sm">
            可执行 {agg.crossExchangeExecutable} · 观察中 {agg.crossExchangeObservable} · 不可执行 {agg.crossExchangeBlocked}
          </div>
        </div>
      </div>

      {/* Tab 切换 */}
      <div className="mb-3 flex gap-2">
        <button
          onClick={() => setTab("same")}
          className={`rounded border px-4 py-2 text-base font-semibold transition-colors ${
            tab === "same"
              ? "border-cyan-400 bg-cyan-900/30 text-cyan-200"
              : "border-gray-700 text-gray-300 hover:bg-gray-800"
          }`}
        >
          本所套利
        </button>
        <button
          onClick={() => setTab("cross")}
          className={`rounded border px-4 py-2 text-base font-semibold transition-colors ${
            tab === "cross"
              ? "border-cyan-400 bg-cyan-900/30 text-cyan-200"
              : "border-gray-700 text-gray-300 hover:bg-gray-800"
          }`}
        >
          跨所套利
        </button>
      </div>

      {/* 机会表 */}
      <div className="rounded-lg border border-gray-800 bg-gray-900 p-4">
        <table className="w-full text-base">
          <thead>
            <tr className="border-b border-gray-800 text-gray-300">
              <th className="py-3 text-left text-sm font-semibold">币种</th>
              <th className="py-3 text-left text-sm font-semibold">现货所</th>
              <th className="py-3 text-left text-sm font-semibold">合约所</th>
              <SortHeader field="fundingRate">资金费率</SortHeader>
              <SortHeader field="entryBasis">开仓基差</SortHeader>
              <SortHeader field="netProfit">预计净收益</SortHeader>
              <th className="py-3 text-center text-sm font-semibold">风险等级</th>
              <th className="py-3 text-center text-sm font-semibold">状态</th>
              <th className="py-3 text-left text-sm font-semibold">不可执行原因</th>
            </tr>
          </thead>
          <tbody>
            {!tabOpps.length ? (
              <tr>
                <td colSpan={9} className="py-10 text-center text-base text-gray-400">
                  {scanning
                    ? "正在刷新机会池，请稍候..."
                    : tab === "same"
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
                      r.capabilityResult.executability === "executable" ? "" : "opacity-75"
                    }`}
                  >
                    <td className="py-2 font-semibold text-gray-100">
                      {o.path?.symbol ?? o.symbol ?? "—"}
                    </td>
                    <td className="py-2 text-gray-300">
                      {o.path?.spotExchange ?? "—"}
                    </td>
                    <td className="py-2 text-gray-300">
                      {o.path?.perpExchange ?? "—"}
                    </td>
                    <td className="py-2 text-right tabular-nums text-gray-100">
                      {fmtNum(Number(o.funding8h) * 100, 3)}%
                    </td>
                    <td className="py-2 text-right tabular-nums text-gray-100">
                      {fmtNum(Number(o.entryExecutableBasis) * 100, 3)}%
                    </td>
                    <td className="py-2 text-right tabular-nums text-gray-100">
                      {fmtNum(Number(netProfit), 2)}
                    </td>
                    <td className="py-2 text-center">
                      <span
                        className={`rounded px-2 py-1 text-sm font-bold ${
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
                    <td className="py-2 text-center">
                      <span
                        className={`inline-block rounded border px-3 py-1 text-sm font-medium ${toneClass}`}
                      >
                        {cls}
                      </span>
                    </td>
                    <td className="py-2 text-sm text-gray-400">{reason}</td>
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
