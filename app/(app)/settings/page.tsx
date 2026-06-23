"use client";

import { useEffect, useRef, useState } from "react";
import {
  DEFAULT_USER_STRATEGY_SETTINGS,
  normalizeSettings,
  type UserStrategySettings,
} from "@/lib/strategy-v121/settings/userStrategySettings";
import { ExchangeAccountsSection } from "@/components/v121/ExchangeAccountsSection";

/**
 * 设置页 — 用户可调的套利参数。
 *
 * 不显示系统模式（READ_ONLY/PAPER/SHADOW/MAINNET_TINY/CONTROLLED_LIVE），
 * 那些由环境变量决定，属于开发者/运维配置，不是用户设置。
 * Kill Switch 文案改为"风险保护开关"，功能不变。
 */

const DEFAULT_SETTINGS = DEFAULT_USER_STRATEGY_SETTINGS;

const KS_LABEL: Record<string, string> = {
  OFF: "关闭",
  READ_ONLY_ONLY: "仅只读",
  PAUSE_NEW_ENTRIES: "暂停新开仓",
  PAUSE_ALL_AUTOMATION: "暂停全部",
};

const KS_ORDER = ["OFF", "READ_ONLY_ONLY", "PAUSE_NEW_ENTRIES", "PAUSE_ALL_AUTOMATION"] as const;

export default function SettingsPage() {
  const [s, setS] = useState<UserStrategySettings | null>(null);
  const [ks, setKs] = useState<any>(null);
  const [msg, setMsg] = useState("");
  const exchangeAccountsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/api/v121/settings")
      .then((r) => r.json())
      .then((d) => {
        setS(normalizeSettings(d.settings ?? d));
      })
      .catch(() => {
        setS(DEFAULT_SETTINGS);
      });

    fetch("/api/v121/risk/kill-switch")
      .then((r) => r.json())
      .then(setKs)
      .catch(() => {});
  }, []);

  // 支持 /settings?section=exchange-accounts 直接滚动到交易所账户区块
  useEffect(() => {
    if (typeof window === "undefined") return;
    const section = new URLSearchParams(window.location.search).get("section");
    if (section === "exchange-accounts" && exchangeAccountsRef.current) {
      const timer = setTimeout(() => {
        exchangeAccountsRef.current?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        });
      }, 200);
      return () => clearTimeout(timer);
    }
  }, [s]);

  const patch = (path: string, val: any) => {
    setS((prev) => {
      const base = normalizeSettings(prev ?? DEFAULT_SETTINGS);
      const copy: any = JSON.parse(JSON.stringify(base));
      const parts = path.split(".");
      let cur = copy;

      for (let i = 0; i < parts.length - 1; i++) {
        const key = parts[i];
        if (!cur[key] || typeof cur[key] !== "object") {
          cur[key] = {};
        }
        cur = cur[key];
      }

      cur[parts[parts.length - 1]] = val;
      return normalizeSettings(copy);
    });
  };

  const save = async () => {
    try {
      const payload = normalizeSettings(s ?? DEFAULT_SETTINGS);

      const r = await fetch("/api/v121/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const d = await r.json();

      if (r.ok && d.ok) {
        setS(normalizeSettings(d.settings ?? payload));
        setMsg("保存成功");
        setTimeout(() => setMsg(""), 2000);
      } else {
        const errors = d.errors ?? [d.error ?? JSON.stringify(d)];
        setMsg(`保存失败: ${errors.join("; ")}`);
      }
    } catch (e: any) {
      setMsg(`保存失败: ${e.message}`);
    }
  };

  const restore = async () => {
    const defaults = normalizeSettings(DEFAULT_SETTINGS);
    setS(defaults);

    try {
      const r = await fetch("/api/v121/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(defaults),
      });

      const d = await r.json();

      if (r.ok && d.ok) {
        setS(normalizeSettings(d.settings ?? defaults));
        setMsg("已恢复默认值");
        setTimeout(() => setMsg(""), 2000);
      } else {
        const errors = d.errors ?? [d.error ?? JSON.stringify(d)];
        setMsg(`恢复失败: ${errors.join("; ")}`);
      }
    } catch (e: any) {
      setMsg(`恢复失败: ${e.message}`);
    }
  };

  if (!s) return <div className="p-3 text-gray-500">加载中...</div>;

  const txMode = s.transfer?.mode ?? "disabled";
  const txAllowed = s.transfer?.allowAutoTransfer ?? false;

  return (
    <div className="text-[15px] text-gray-100">
      <h2 className="mb-4 text-2xl font-bold">设置</h2>

      {msg ? (
        <div className="mb-3 rounded border border-emerald-700/40 bg-emerald-900/30 px-3 py-2 text-sm text-emerald-200">
          {msg}
        </div>
      ) : null}

      <div className="grid gap-4">
        <section
          ref={exchangeAccountsRef}
          className="scroll-mt-16 rounded-lg border border-gray-800 bg-gray-900 p-3"
        >
          <ExchangeAccountsSection showTitle={true} />
        </section>

        <section className="rounded-lg border border-gray-800 bg-gray-900 p-3">
          <h3 className="mb-2 text-xl font-semibold text-red-400">风险保护开关</h3>
          <div className="text-[15px]">
            <span className="text-gray-400">当前状态: </span>
            <span
              className={
                ks?.killSwitch === "OFF"
                  ? "font-bold text-emerald-400"
                  : "font-bold text-red-400"
              }
            >
              {ks ? (KS_LABEL[ks.killSwitch] ?? ks.killSwitch) : "—"}
            </span>
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            {KS_ORDER.map((sw) => (
              <button
                key={sw}
                onClick={async () => {
                  await fetch("/api/v121/risk/kill-switch", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ state: sw }),
                  });
                  const r = await fetch("/api/v121/risk/kill-switch");
                  setKs(await r.json());
                }}
                className={`rounded border px-3 py-1.5 text-sm font-medium ${
                  ks?.killSwitch === sw
                    ? "border-cyan-400 bg-cyan-900 text-cyan-200"
                    : "border-gray-700 text-gray-400 hover:bg-gray-800"
                }`}
              >
                {KS_LABEL[sw] ?? sw}
              </button>
            ))}
          </div>
          <p className="mt-2 text-sm text-gray-500">
            "暂停全部"会阻断所有自动化操作。详细风控请前往风控页。
          </p>
        </section>

        <section className="rounded-lg border border-gray-800 bg-gray-900 p-3">
          <h3 className="mb-2 text-xl font-semibold text-emerald-400">资金费与成交额</h3>
          <div className="grid grid-cols-1 gap-2 text-[15px] md:grid-cols-2">
            <ParamEdit label="最低资金费率" val={s.funding?.minFundingRate8h} onChange={(v) => patch("funding.minFundingRate8h", v)} fmt={(v) => `${(v * 100).toFixed(3)}%`} />
            <ParamEdit label="最低净收益率" val={s.funding?.minNetProfitRate ?? 0} onChange={(v) => patch("funding.minNetProfitRate", v)} fmt={(v) => `${(v * 100).toFixed(2)}%`} />
            <ParamEdit label="计划开仓金额" val={s.notional?.plannedNotionalUsdt} onChange={(v) => patch("notional.plannedNotionalUsdt", v)} fmt={(v) => `$${v} USDT`} />
            <ParamEdit label="单笔最大金额" val={s.notional?.maxOrderNotionalUsdt} onChange={(v) => patch("notional.maxOrderNotionalUsdt", v)} fmt={(v) => `$${v} USDT`} />
            <ParamEdit label="现货最低24h成交额" val={s.universe?.minSpotVolume24hUsdt ?? 0} onChange={(v) => patch("universe.minSpotVolume24hUsdt", v)} fmt={(v) => `$${v.toLocaleString()}`} />
            <ParamEdit label="合约最低24h成交额" val={s.universe?.minPerpVolume24hUsdt ?? 0} onChange={(v) => patch("universe.minPerpVolume24hUsdt", v)} fmt={(v) => `$${v.toLocaleString()}`} />
            <ParamEdit label="动态监控池每所上限" val={s.universe?.maxDynamicSymbolsPerExchange ?? 50} onChange={(v) => patch("universe.maxDynamicSymbolsPerExchange", v)} fmt={(v) => `${v} 个`} />
            <ToggleRow label="使用动态监控池" checked={s.universe?.useDynamicUniverse ?? false} onChange={(v) => patch("universe.useDynamicUniverse", v)} />
            <ToggleRow label="资金不足时自动缩减" checked={s.notional?.allowAutoDownsize ?? false} onChange={(v) => patch("notional.allowAutoDownsize", v)} />
          </div>
        </section>

        <section className="rounded-lg border border-gray-800 bg-gray-900 p-3">
          <h3 className="mb-2 text-xl font-semibold text-amber-400">自动内部划转</h3>
          <div className="grid grid-cols-1 gap-2 text-[15px] md:grid-cols-2">
            <ToggleRow label="允许自动内部划转" checked={txAllowed} onChange={(v) => patch("transfer.allowAutoTransfer", v)} />
            <div className="flex items-center justify-between border-b border-gray-800 py-1.5">
              <span className="text-sm text-gray-400">划转模式</span>
              <select
                value={txMode}
                onChange={(e) => patch("transfer.mode", e.target.value)}
                className="rounded border border-gray-700 bg-gray-800 px-3 py-1.5 text-sm text-gray-200"
              >
                <option value="disabled">禁用</option>
                <option value="suggest_only">仅建议</option>
                <option value="auto_transfer">自动划转</option>
              </select>
            </div>
            <ParamEdit label="单次最大划转金额" val={s.transfer?.maxAutoTransferUsdt ?? 50} onChange={(v) => patch("transfer.maxAutoTransferUsdt", v)} fmt={(v) => `$${v}`} />
            <ToggleRow label="划转后重新检查" checked={s.transfer?.requireReauditAfterTransfer ?? true} onChange={(v) => patch("transfer.requireReauditAfterTransfer", v)} />
          </div>
          <p className="mt-2 border-t border-gray-800 pt-2 text-sm leading-relaxed text-gray-500">
            自动划转仅允许同一交易所内部账户划转，不允许跨交易所、不允许链上提现。划转后会重新读取余额并重新检查，不会直接下单。
          </p>
        </section>

        <section className="rounded-lg border border-gray-800 bg-gray-900 p-3">
          <h3 className="mb-2 text-xl font-semibold text-blue-400">执行设置</h3>
          <div className="space-y-1.5 text-[15px]">
            <ReadonlyRow label="人工确认" value={s.execution?.requireHumanApproval ? "必须" : "不必须"} />
            <ReadonlyRow label="未知订单→暂停保护" value={s.execution?.freezeOnUnknownOrder ? "启用" : "禁用"} />
            <ReadonlyRow label="未知划转→暂停保护" value={s.execution?.freezeOnUnknownTransfer ? "启用" : "禁用"} />
            <ReadonlyRow label="数量偏差容忍" value={`${(s.execution?.maxLegDeviationRate ?? 0.01) * 100}%`} mono />
            <ReadonlyRow label="订单超时" value={`${s.execution?.orderTimeoutMs ?? 15000}ms`} mono />
          </div>
        </section>

        <div className="flex gap-2">
          <button
            onClick={save}
            className="rounded bg-cyan-700 px-5 py-2 text-base font-semibold text-white transition-colors hover:bg-cyan-600"
          >
            保存设置
          </button>
          <button
            onClick={restore}
            className="rounded bg-gray-700 px-5 py-2 text-base text-gray-200 transition-colors hover:bg-gray-600"
          >
            恢复默认值
          </button>
        </div>
      </div>
    </div>
  );
}

function ToggleRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between border-b border-gray-800 py-1.5">
      <span className="text-sm text-gray-400">{label}</span>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="h-4 w-4 accent-cyan-500" />
    </div>
  );
}

function ReadonlyRow({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex justify-between border-b border-gray-800 py-1.5">
      <span className="text-sm text-gray-400">{label}</span>
      <span className={mono ? "font-mono text-gray-200" : "text-cyan-300"}>{value}</span>
    </div>
  );
}

function ParamEdit({
  label,
  val,
  onChange,
  fmt,
}: {
  label: string;
  val: number;
  onChange: (v: number) => void;
  fmt: (v: number) => string;
}) {
  const [edit, setEdit] = useState(false);
  const [raw, setRaw] = useState(String(val ?? 0));
  return (
    <div className="flex items-center justify-between border-b border-gray-800 py-1.5">
      <span className="text-sm text-gray-400">{label}</span>
      {edit ? (
        <input
          type="number"
          step="any"
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          onBlur={() => {
            onChange(Number(raw));
            setEdit(false);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              onChange(Number(raw));
              setEdit(false);
            }
          }}
          autoFocus
          className="w-28 rounded border border-gray-700 bg-gray-800 px-2 py-1 text-right text-sm font-mono text-gray-200"
        />
      ) : (
        <button
          onClick={() => {
            setRaw(String(val ?? 0));
            setEdit(true);
          }}
          className="cursor-pointer text-sm font-mono text-gray-100 hover:text-cyan-300"
        >
          {fmt(val ?? 0)}
        </button>
      )}
    </div>
  );
}
