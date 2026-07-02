import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";

/**
 * 开发者模式布局。
 *
 * 仅当 V121_ENABLE_DEV_TOOLS=1 时可访问 /v121/* 下的开发者页面
 * （执行意图 / 只读诊断 / 主网小资金 / 实盘前审计）。
 * 生产构建默认不带此变量 → notFound() → 404，普通用户无法直达。
 *
 * next.config.ts 的 redirects 会先把 /v121/dashboard 等旧产品 URL
 * 跳到新成品路径，此处守卫只针对保留下来的开发者页面。
 */

const DEV_NAV = [
  { href: "/v121/intents", label: "执行意图" },
  { href: "/v121/shadow", label: "只读诊断" },
  { href: "/v121/api-keys", label: "交易所账户" },
  { href: "/v121/mainnet-tiny", label: "主网小资金" },
  { href: "/v121/mainnet-tiny/final-audit", label: "实盘前审计" },
] as const;

export default function V121Layout({ children }: { children: ReactNode }) {
  if (process.env.V121_ENABLE_DEV_TOOLS !== "1") {
    notFound();
  }

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      <header className="border-b border-gray-800 px-6 py-3">
        <div className="flex items-center gap-6">
          <h1 className="text-lg font-bold text-amber-400">开发者模式</h1>
          <nav className="flex flex-wrap gap-4 text-sm">
            {DEV_NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="text-amber-200 transition-colors hover:text-amber-300"
              >
                {item.label}
              </Link>
            ))}
          </nav>
          <Link
            href="/dashboard"
            className="ml-auto text-xs text-gray-500 transition-colors hover:text-gray-300"
          >
            ← 返回成品界面
          </Link>
        </div>
      </header>
      <main className="p-6">{children}</main>
    </div>
  );
}
