import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // 旧 /v121/* 产品页 URL 临时重定向到成品路径。
  // 临时（permanent: false）避免开发期浏览器缓存干扰；产品稳定后可改永久。
  // 开发者页面 /v121/intents、/v121/shadow、/v121/mainnet-tiny 等保留原路径，
  // 由 app/v121/layout.tsx 的 notFound() 守卫按 V121_ENABLE_DEV_TOOLS 控制访问。
  async redirects() {
    return [
      { source: "/v121/dashboard", destination: "/dashboard", permanent: false },
      { source: "/v121/opportunities", destination: "/opportunities", permanent: false },
      { source: "/v121/execution", destination: "/trade/open", permanent: false },
      { source: "/v121/positions", destination: "/positions", permanent: false },
      { source: "/v121/risk-center", destination: "/risk", permanent: false },
      { source: "/v121/settings", destination: "/settings", permanent: false },
      { source: "/v121/review", destination: "/review", permanent: false },
    ];
  },
};

export default nextConfig;
