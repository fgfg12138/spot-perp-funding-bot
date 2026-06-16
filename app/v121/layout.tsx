import Link from "next/link";
import type { ReactNode } from "react";

const NAV_ITEMS = [
  { href: "/v121/dashboard", label: "控制台" },
  { href: "/v121/opportunities", label: "机会池" },
  { href: "/v121/execution", label: "执行中心" },
  { href: "/v121/positions", label: "持仓监控" },
  { href: "/v121/risk-center", label: "风控中心" },
  { href: "/v121/review", label: "复盘中心" },
  { href: "/v121/shadow", label: "SHADOW" },
  { href: "/v121/settings", label: "参数中心" },
];

export default function V121Layout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      <header className="border-b border-gray-800 px-6 py-3">
        <div className="flex items-center gap-6">
          <h1 className="text-lg font-bold text-cyan-400">v1.2.1 期现套利</h1>
          <nav className="flex gap-4 text-sm">
            {NAV_ITEMS.map((item) => (
              <Link key={item.href} href={item.href} className="hover:text-cyan-300 transition-colors">
                {item.label}
              </Link>
            ))}
          </nav>
        </div>
      </header>
      <main className="p-6">{children}</main>
    </div>
  );
}
