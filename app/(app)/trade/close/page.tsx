"use client";

import { Fragment, useEffect, useState } from "react";
import Link from "next/link";

/**
 * 平仓页 — 持仓列表 + 每行一个"生成平仓预案"按钮。
 *
 * 点击按钮调用 POST /api/v121/positions/[id]/close-preview，
 * 该 endpoint 在服务器端用币安公共行情 + 纯函数 shouldExitPosition
 * 生成预案，返回预估平仓价、基差、净收益、平仓建议，并明确告知
 * "平仓预案，未执行真实下单"。
 *
 * 真实平仓后端未实现（属于 Task P2），本页不提供"确认平仓"按钮，
 * 只展示预案 + 引导用户参考预案自行操作交易所。
 *
 * 持仓状态翻译：FROZEN → 已暂停保护，CLOSED → 已平仓，
 * MONITORING / OPEN → 持有中 / 监控中。
 */

interface Position {
  id: string;
  symbol: string;
  spotExchange: string;
  perpExchange: string;
  state: string;
  spotNotional?: number;
  perpNotional?: number;
  spotFilledQty?: number;
  perpFilledQty?: number;
  positionDeviation?: number;
  actualBasis?: number;
  createdAtUtc?: number;
}

interface ClosePreview {
  ok: boolean;
  status: string;
  supported?: boolean;
  positionId: string;
  symbol?: string;
  message?: string;
  disclaimer?: string;
  market?: {
    spotBid1: number;
    perpAsk1: number;
    markPrice: number;
    fundingRate: number;
    nextFundingTimeUtc: number;
    scannedAtUtc: number;
    warning?: string;
  };
  estimate?: {
    entryBasis: number;
    currentExitBasis: number;
    basisProfit: number;
    realizedFunding: number;
    estFees: number;
    estNetProfit: number;
    notional: number;
    holdingHours: number;
  };
  decision?: {
    shouldExit: boolean;
    reason: string;
    priority: "low" | "medium" | "high";
  };
}

function fmtNum(v: unknown, digits = 2, fallback = "—") {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n.toFixed(digits) : fallback;
}

function fmtUsd(v: unknown, digits = 2, fallback = "—") {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return fallback;
  return `${n >= 0 ? "" : "-"}$${Math.abs(n).toFixed(digits)}`;
}

function fmtPct(v: unknown, digits = 3, fallback = "—") {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return fallback;
  return `${(n * 100).toFixed(digits)}%`;
}

/** 持仓状态翻译成用户语言。 */
function stateLabel(state: string): { text: string; tone: string } {
  switch (state) {
    case "MONITORING":
      return { text: "监控中", tone: "text-cyan-300" };
    case "OPEN":
      return { text: "持有中", tone: "text-emerald-300" };
    case "EXITING":
      return { text: "平仓中", tone: "text-amber-300" };
    case "FROZEN":
      return { text: "已暂停保护", tone: "text-red-300" };
    case "CLOSED":
      return { text: "已平仓", tone: "text-gray-400" };
    case "FAILED":
      return { text: "开仓失败", tone: "text-red-300" };
    default:
      return { text: state ?? "—", tone: "text-gray-400" };
  }
}

export default function TradeClosePage() {
  const [data, setData] = useState<{ positions: Position[]; total?: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const [previews, setPreviews] = useState<Record<string, ClosePreview>>({});

  const fetchPositions = () => {
    fetch("/api/v121/positions").then((r) => r.json()).then(setData).catch(() => {});
  };

  useEffect(() => {
    fetchPositions();
    const i = setInterval(fetchPositions, 5000);
    return () => clearInterval(i);
  }, []);

  const positions: Position[] = data?.positions ?? [];

  const generatePreview = async (id: string) => {
    setLoading(true);
    try {
      const r = await fetch(`/api/v121/positions/${id}/close-preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const d = (await r.json()) as ClosePreview;
      setPreviews((prev) => ({ ...prev, [id]: d }));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-2xl font-bold">平仓</h2>
        <div className="flex gap-2 text-sm">
          <Link
            href="/trade/open"
            className="border border-cyan-500/60 bg-cyan-500/15 px-3 py-1 text-cyan-100 transition-colors hover:bg-cyan-500/25"
          >
            开仓
          </Link>
          <Link
            href="/positions"
            className="border border-gray-600 bg-gray-800/60 px-3 py-1 text-gray-200 transition-colors hover:bg-gray-700/60"
          >
            持仓
          </Link>
        </div>
      </div>

      <p className="mb-6 text-sm text-gray-400">
        选择一个持仓，点击"生成平仓预案"查看预估平仓价、基差、净收益与系统建议。预案仅供参考，不会真实下单。
      </p>

      {/* 持仓列表 */}
      <div className="rounded-lg border border-gray-800 bg-gray-900 p-4">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-800 text-gray-500">
              <th className="py-2 text-left">币种</th>
              <th className="py-2 text-left">路径</th>
              <th className="py-2 text-right">现货数量</th>
              <th className="py-2 text-right">合约空单</th>
              <th className="py-2 text-right">数量偏差</th>
              <th className="py-2 text-center">状态</th>
              <th className="py-2 text-center">操作</th>
            </tr>
          </thead>
          <tbody>
            {!positions.length ? (
              <tr>
                <td colSpan={7} className="py-8 text-center text-gray-500">
                  暂无持仓。如需开仓，可前往
                  <Link href="/trade/open" className="mx-1 underline hover:text-cyan-300">开仓页</Link>。
                </td>
              </tr>
            ) : (
              positions.map((p) => {
                const dev = Number(p.positionDeviation ?? 0);
                const st = stateLabel(p.state);
                const canPreview = p.state === "OPEN" || p.state === "MONITORING" || p.state === "EXITING";
                const preview = previews[p.id];
                return (
                  <Fragment key={p.id}>
                    <tr className="border-b border-gray-800">
                      <td className="py-2 font-semibold">{p.symbol}</td>
                      <td className="py-2 text-gray-400">{p.spotExchange}→{p.perpExchange}</td>
                      <td className="py-2 text-right tabular-nums">
                        {p.spotFilledQty != null ? Number(p.spotFilledQty).toFixed(6) : "—"}
                      </td>
                      <td className="py-2 text-right tabular-nums">
                        {p.perpFilledQty != null ? Number(p.perpFilledQty).toFixed(6) : "—"}
                      </td>
                      <td
                        className={`py-2 text-right tabular-nums ${
                          dev > 0.01 ? "text-red-400" : "text-emerald-400"
                        }`}
                      >
                        {(dev * 100).toFixed(2)}%
                      </td>
                      <td className={`py-2 text-center ${st.tone}`}>{st.text}</td>
                      <td className="py-2 text-center">
                        <button
                          onClick={() => generatePreview(p.id)}
                          disabled={!canPreview || loading}
                          className="border border-amber-500/60 bg-amber-500/15 px-3 py-1 text-xs text-amber-200 rounded transition-colors hover:bg-amber-500/25 disabled:opacity-30"
                        >
                          {loading && preview === undefined ? "生成中..." : "生成平仓预案"}
                        </button>
                      </td>
                    </tr>
                    {preview ? (
                      <tr className="border-b border-gray-800 bg-gray-950/40">
                        <td colSpan={7} className="py-3 px-4">
                          <PreviewPanel preview={preview} />
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <p className="mt-4 text-xs text-gray-500">
        说明：平仓预案基于当前币安盘口与持仓数据计算，仅作参考。真实平仓需前往交易所手动操作（系统暂未提供一键平仓）。
      </p>
    </div>
  );
}

// ── 平仓预案展示 ──────────────────────────────────────────

function PreviewPanel({ preview }: { preview: ClosePreview }) {
  // 不支持 / 已平仓 / 已暂停保护 / 错误
  if (!preview.ok || preview.status === "error") {
    return (
      <div className="rounded border border-red-800/40 bg-red-950/20 p-3 text-sm text-red-300">
        生成预案失败：{preview.message ?? "未知错误"}
      </div>
    );
  }
  if (preview.status === "not_found") {
    return (
      <div className="rounded border border-gray-800 bg-gray-900 p-3 text-sm text-gray-400">
        持仓不存在或已清理。
      </div>
    );
  }
  if (preview.status === "already_closed") {
    return (
      <div className="rounded border border-gray-800 bg-gray-900 p-3 text-sm text-gray-400">
        {preview.message}
      </div>
    );
  }
  if (preview.status === "frozen") {
    return (
      <div className="rounded border border-red-800/40 bg-red-950/20 p-3 text-sm text-red-300">
        {preview.message}
      </div>
    );
  }
  if (preview.status === "unsupported_exchange" || preview.supported === false) {
    return (
      <div className="rounded border border-amber-800/40 bg-amber-950/20 p-3 text-sm text-amber-300">
        {preview.message}
      </div>
    );
  }

  const est = preview.estimate;
  const mkt = preview.market;
  const dec = preview.decision;

  const decisionTone =
    dec?.shouldExit
      ? dec.priority === "high"
        ? "border-red-700/50 bg-red-950/30 text-red-200"
        : dec.priority === "medium"
          ? "border-amber-700/50 bg-amber-950/30 text-amber-200"
          : "border-cyan-700/50 bg-cyan-950/30 text-cyan-200"
      : "border-emerald-700/50 bg-emerald-950/30 text-emerald-200";

  return (
    <div className="space-y-3 rounded border border-gray-800 bg-gray-900/60 p-3">
      {/* 行情快照 */}
      <div>
        <p className="mb-1 text-xs uppercase tracking-wide text-gray-500">当前行情</p>
        <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm md:grid-cols-4">
          <Field label="现货买一" value={`$${fmtNum(mkt?.spotBid1)}`} />
          <Field label="合约卖一" value={`$${fmtNum(mkt?.perpAsk1)}`} />
          <Field label="合约标记价" value={`$${fmtNum(mkt?.markPrice)}`} />
          <Field
            label="下一期资金费"
            value={fmtPct(mkt?.fundingRate, 4)}
            tone={Number(mkt?.fundingRate ?? 0) >= 0 ? "text-emerald-300" : "text-red-300"}
          />
        </div>
        {mkt?.warning ? (
          <p className="mt-1 text-xs text-amber-400">行情提示：{mkt.warning}</p>
        ) : null}
      </div>

      {/* 预估收益 */}
      <div>
        <p className="mb-1 text-xs uppercase tracking-wide text-gray-500">平仓预估</p>
        <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm md:grid-cols-4">
          <Field label="入场基差" value={fmtPct(est?.entryBasis)} />
          <Field label="当前平仓基差" value={fmtPct(est?.currentExitBasis)} />
          <Field
            label="基差利润"
            value={fmtUsd(est?.basisProfit)}
            tone={Number(est?.basisProfit ?? 0) >= 0 ? "text-emerald-300" : "text-red-300"}
          />
          <Field
            label="已实现资金费"
            value={fmtUsd(est?.realizedFunding)}
            tone={Number(est?.realizedFunding ?? 0) >= 0 ? "text-emerald-300" : "text-red-300"}
          />
          <Field label="预估手续费" value={fmtUsd(est?.estFees)} tone="text-gray-400" />
          <Field
            label="预估净收益"
            value={fmtUsd(est?.estNetProfit)}
            tone={Number(est?.estNetProfit ?? 0) >= 0 ? "text-emerald-300" : "text-red-300"}
          />
          <Field label="持仓时长" value={`${fmtNum(est?.holdingHours, 1)}h`} />
          <Field label="名义金额" value={fmtUsd(est?.notional)} />
        </div>
      </div>

      {/* 系统建议 */}
      <div className={`rounded border p-3 ${decisionTone}`}>
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-wide opacity-70">系统建议</p>
            <p className="mt-1 text-sm font-semibold">
              {dec?.shouldExit ? "建议平仓" : "建议持有"}
            </p>
            <p className="mt-1 text-xs opacity-80">{dec?.reason ?? "—"}</p>
          </div>
          <span
            className={`whitespace-nowrap rounded border px-2 py-0.5 text-xs ${
              dec?.priority === "high"
                ? "border-red-500/60 text-red-200"
                : dec?.priority === "medium"
                  ? "border-amber-500/60 text-amber-200"
                  : "border-cyan-500/60 text-cyan-200"
            }`}
          >
            优先级 {dec?.priority ?? "—"}
          </span>
        </div>
      </div>

      <p className="text-xs text-gray-500">{preview.disclaimer}</p>
    </div>
  );
}

function Field({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: string;
}) {
  return (
    <div className="flex justify-between">
      <span className="text-gray-400">{label}</span>
      <span className={`font-mono tabular-nums ${tone ?? "text-gray-200"}`}>{value}</span>
    </div>
  );
}
