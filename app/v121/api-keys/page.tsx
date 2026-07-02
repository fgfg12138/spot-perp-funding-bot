"use client";

import { ExchangeAccountsSection } from "@/components/v121/ExchangeAccountsSection";

/**
 * 交易所账户 — 开发者模式页面。
 *
 * 此页面受 V121_ENABLE_DEV_TOOLS=1 门控，普通用户不可直达。
 * 普通用户入口在 /settings?section=exchange-accounts。
 *
 * 本页复用 ExchangeAccountsSection 组件，与设置页共用同一套 UI 与后端 API，
 * 额外提供开发者视角的说明（后端路由、加密方案、能力探测机制）。
 */
export default function ApiKeysDevPage() {
  return (
    <div>
      <h2 className="mb-6 text-2xl font-bold">交易所账户（开发者）</h2>

      <div className="mb-4 rounded border border-amber-700/40 bg-amber-900/20 p-3 text-xs leading-relaxed text-amber-200">
        开发者模式页面。普通用户请通过「设置 → 交易所账户」管理。
        <br />
        后端路由：/api/v121/exchange-accounts/**；加密：AES-256-GCM（V121_MASTER_KEY）；
        能力探测：IAccountAdapter 只读方法 → capabilityEngine 决策。
      </div>

      <ExchangeAccountsSection showTitle={false} />
    </div>
  );
}
