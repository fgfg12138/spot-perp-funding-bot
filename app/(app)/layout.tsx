import Link from "next/link";
import type { ReactNode } from "react";

/**
 * 成品套利工具共享布局。
 *
 * 普通用户导航：总览 / 机会 / 开仓 / 持仓 / 平仓 / 风控 / 设置 / 复盘
 * 开发者导航：仅 V121_ENABLE_DEV_TOOLS=1 时显示，指向保留的开发者页面。
 *
 * 注意：此 layout 只包住 app/(app)/** 内的页面（路由组不影响 URL），
 * 因此 8 个成品页面必须放在本组内，否则不会套用此布局。
 */

const PRODUCT_NAV = [
  { href: "/dashboard", label: "总览" },
  { href: "/opportunities", label: "机会" },
  { href: "/trade/open", label: "开仓" },
  { href: "/positions", label: "持仓" },
  { href: "/trade/close", label: "平仓" },
  { href: "/risk", label: "风控" },
  { href: "/settings", label: "设置" },
  { href: "/review", label: "复盘" },
] as const;

const DEV_NAV = [
  { href: "/v121/intents", label: "执行意图" },
  { href: "/v121/shadow", label: "只读诊断" },
  { href: "/v121/api-keys", label: "交易所账户" },
  { href: "/v121/mainnet-tiny", label: "主网小资金" },
  { href: "/v121/mainnet-tiny/final-audit", label: "实盘前审计" },
] as const;

export default function AppLayout({ children }: { children: ReactNode }) {
  // 构建期注入：生产构建默认不带此变量 → 开发者导航不渲染。
  const devToolsEnabled = process.env.V121_ENABLE_DEV_TOOLS === "1";

  return (
    <div className="product-app-shell min-h-screen bg-gray-950 text-[15px] text-gray-100">
      <header className="border-b border-gray-800 px-3 py-2">
        <div className="flex items-center gap-4">
          <h1 className="text-xl font-bold text-cyan-400">期现套利</h1>
          <nav className="flex flex-wrap gap-3 text-base font-medium">
            {PRODUCT_NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="text-gray-300 transition-colors hover:text-cyan-300"
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </div>
        {devToolsEnabled ? (
          <div className="mt-2 flex flex-wrap items-center gap-3 border-t border-gray-800 pt-2">
            <span className="text-sm text-amber-400">开发者</span>
            {DEV_NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="text-sm text-amber-300 transition-colors hover:text-amber-200"
              >
                {item.label}
              </Link>
            ))}
          </div>
        ) : null}
      </header>
      <main className="px-3 py-3">{children}</main>
    </div>
  );
}
