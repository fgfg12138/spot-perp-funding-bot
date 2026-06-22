"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

/**
 * 总览页 — 成品首页。
 *
 * 显示系统运行状态、机会数、持仓数、风险状态，以及一句"下一步建议"。
 * 工程字段（Worker heartbeat、preflight score、scanMode 等）不展示。
 */

interface HealthState {
  mode?: string;
  modeLabel?: string;
  health?: { isHealthy?: boolean };
}

interface WorkerState {
  state?: string;
  cycleCount?: number;
}

interface RiskState {
  killSwitch?: string;
  freezeLevel?: string;
  frozenCount?: number;
  deviationCount?: number;
  canTrade?: boolean;
}

interface OppsState {
  passedCount?: number;
  total?: number;
  scannedAtUtc?: number;
  dataSource?: string;
}

export default function DashboardPage() {
  const [health, setHealth] = useState<HealthState | null>(null);
  const [worker, setWorker] = useState<WorkerState | null>(null);
  const [risk, setRisk] = useState<RiskState | null>(null);
  const [opps, setOpps] = useState<OppsState | null>(null);
  const [positions, setPositions] = useState<{ positions?: any[]; total?: number } | null>(null);

  useEffect(() => {
    const fetchAll = () => {
      fetch("/api/v121/health").then((r) => r.json()).then(setHealth).catch(() => {});
      fetch("/api/v121/worker").then((r) => r.json()).then(setWorker).catch(() => {});
      fetch("/api/v121/risk").then((r) => r.json()).then(setRisk).catch(() => {});
      fetch("/api/v121/opportunities").then((r) => r.json()).then(setOpps).catch(() => {});
      fetch("/api/v121/positions").then((r) => r.json()).then(setPositions).catch(() => {});
    };
    fetchAll();
    const i = setInterval(fetchAll, 10000);
    return () => clearInterval(i);
  }, []);

  if (!health) return <div className="p-8 text-gray-500">加载中...</div>;

  const monitoringOk = worker?.state === "running";
  const riskOk = risk?.killSwitch === "OFF" && risk?.freezeLevel === "none";
  const passedCount = opps?.passedCount ?? 0;
  const positionCount = positions?.total ?? 0;
  const hasDeviationIssue =
    (risk?.deviationCount ?? 0) > 0 ||
    (positions?.positions ?? []).some(
      (p) => Number(p.positionDeviation ?? 0) > 0.05,
    );

  // 下一步建议：按当前状态推一句用户能懂的话
  const nextStep = (() => {
    if (risk?.killSwitch && risk.killSwitch !== "OFF") {
      return {
        text: "风险保护开关已开启，新开仓已暂停。如需继续，请前往风控页关闭。",
        href: "/risk",
        label: "前往风控",
        tone: "red",
      };
    }
    if (risk?.freezeLevel && risk.freezeLevel !== "none") {
      return {
        text: "系统已进入暂停保护状态，请前往风控页查看原因并处理。",
        href: "/risk",
        label: "前往风控",
        tone: "red",
      };
    }
    if (hasDeviationIssue) {
      return {
        text: "有持仓数量偏差超限，建议前往持仓页处理。",
        href: "/positions",
        label: "前往持仓",
        tone: "yellow",
      };
    }
    if (passedCount > 0) {
      return {
        text: `当前有 ${passedCount} 个可开仓机会，可前往机会页查看。`,
        href: "/opportunities",
        label: "前往机会",
        tone: "green",
      };
    }
    return {
      text: "系统持续监控中，暂无符合条件的套利机会。市场出现机会时会自动显示。",
      href: "/opportunities",
      label: "查看机会",
      tone: "slate",
    };
  })();

  return (
    <div>
      <h2 className="mb-6 text-2xl font-bold">总览</h2>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatusCard
          label="后台监控"
          value={monitoringOk ? "运行中" : (worker?.state ?? "未启动")}
          color={monitoringOk ? "green" : "yellow"}
        />
        <StatusCard
          label="系统健康"
          value={health.health?.isHealthy ? "正常" : "异常"}
          color={health.health?.isHealthy ? "green" : "red"}
        />
        <StatusCard
          label="可开仓机会"
          value={`${passedCount}`}
          color={passedCount > 0 ? "cyan" : "slate"}
        />
        <StatusCard
          label="当前持仓"
          value={`${positionCount}`}
          color={positionCount > 0 ? "cyan" : "slate"}
        />
        <StatusCard
          label="风险保护"
          value={risk?.killSwitch === "OFF" ? "正常" : "已开启"}
          color={risk?.killSwitch === "OFF" ? "green" : "red"}
        />
        <StatusCard
          label="暂停保护"
          value={risk?.freezeLevel === "none" ? "无" : (risk?.freezeLevel ?? "—")}
          color={risk?.freezeLevel === "none" ? "green" : "red"}
        />
        <StatusCard
          label="需处理持仓"
          value={`${risk?.frozenCount ?? 0}`}
          color={(risk?.frozenCount ?? 0) > 0 ? "red" : "green"}
        />
        <StatusCard
          label="行情扫描"
          value={opps?.scannedAtUtc
            ? new Date(opps.scannedAtUtc).toLocaleTimeString("zh-CN")
            : "未扫描"}
          color="blue"
        />
      </div>

      {/* 下一步建议 */}
      <section
        className={`mt-6 rounded-lg border p-4 ${
          nextStep.tone === "red"
            ? "border-red-800/50 bg-red-950/30"
            : nextStep.tone === "yellow"
              ? "border-amber-800/50 bg-amber-950/30"
              : nextStep.tone === "green"
                ? "border-emerald-800/50 bg-emerald-950/30"
                : "border-gray-800 bg-gray-900"
        }`}
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-wide text-gray-500">下一步建议</p>
            <p
              className={`mt-1 text-sm ${
                nextStep.tone === "red"
                  ? "text-red-200"
                  : nextStep.tone === "yellow"
                    ? "text-amber-200"
                    : nextStep.tone === "green"
                      ? "text-emerald-200"
                      : "text-gray-200"
              }`}
            >
              {nextStep.text}
            </p>
          </div>
          <Link
            href={nextStep.href}
            className="whitespace-nowrap border border-cyan-500/60 bg-cyan-500/15 px-3 py-1.5 text-sm text-cyan-100 transition-colors hover:bg-cyan-500/25"
          >
            {nextStep.label}
          </Link>
        </div>
      </section>
    </div>
  );
}

function StatusCard({ label, value, color }: { label: string; value: string; color: string }) {
  const cm: Record<string, string> = {
    cyan: "text-cyan-400",
    green: "text-emerald-400",
    red: "text-red-400",
    blue: "text-blue-400",
    yellow: "text-amber-400",
    slate: "text-gray-200",
  };
  return (
    <div className="rounded-lg border border-gray-800 bg-gray-900 p-4">
      <div className="mb-1 text-sm text-gray-400">{label}</div>
      <div className={`text-2xl font-bold ${cm[color] ?? "text-white"}`}>{value}</div>
    </div>
  );
}
