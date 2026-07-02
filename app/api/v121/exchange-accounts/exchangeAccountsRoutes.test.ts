/**
 * Exchange Accounts API Routes — 结构与安全测试。
 *
 * 由于 Next.js Route Handlers 依赖 next/server 运行时，
 * 此测试验证路由文件的结构与安全规则，而非端到端调用。
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

function read(rel: string): string {
  return readFileSync(join(root, rel), "utf8");
}

function stripComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

describe("exchange-accounts API routes — structure & safety", () => {
  const collectionRoute = "app/api/v121/exchange-accounts/route.ts";
  const idRoute = "app/api/v121/exchange-accounts/[id]/route.ts";
  const checkRoute = "app/api/v121/exchange-accounts/[id]/check/route.ts";

  it("collection route file exists", () => {
    expect(existsSync(join(root, collectionRoute))).toBe(true);
  });

  it("[id] route file exists", () => {
    expect(existsSync(join(root, idRoute))).toBe(true);
  });

  it("[id]/check route file exists", () => {
    expect(existsSync(join(root, checkRoute))).toBe(true);
  });

  // ─── collection route ────────────────────────────

  it("collection route exports GET and POST", () => {
    const code = read(collectionRoute);
    expect(code).toContain("export async function GET");
    expect(code).toContain("export async function POST");
  });

  it("collection route GET returns masked accounts (no secrets)", () => {
    const code = stripComments(read(collectionRoute));
    expect(code).toContain("listAccounts");
    // GET 响应中不返回原始密钥
    expect(code).not.toMatch(/NextResponse\.json\(\{[^}]*apiKey/);
  });

  it("collection route POST validates input", () => {
    const code = stripComments(read(collectionRoute));
    expect(code).toContain("createAccount");
    expect(code).toMatch(/503|400/);
  });

  // ─── [id] route ──────────────────────────────────

  it("[id] route exports GET, PATCH, DELETE", () => {
    const code = read(idRoute);
    expect(code).toContain("export async function GET");
    expect(code).toContain("export async function PATCH");
    expect(code).toContain("export async function DELETE");
  });

  it("[id] route GET returns 404 for missing account", () => {
    const code = stripComments(read(idRoute));
    expect(code).toMatch(/404|不存在/);
  });

  it("[id] route PATCH does not accept apiKey/apiSecret", () => {
    const code = stripComments(read(idRoute));
    // PATCH 只接受 label / enabled
    expect(code).toContain("label");
    expect(code).toContain("enabled");
    // 不应包含密钥字段更新
    expect(code).not.toMatch(/apiKey|apiSecret|passphrase/);
  });

  // ─── [id]/check route ────────────────────────────

  it("[id]/check route exports POST only", () => {
    const code = read(checkRoute);
    expect(code).toContain("export async function POST");
    expect(code).not.toContain("export async function GET");
    expect(code).not.toContain("export async function DELETE");
  });

  it("[id]/check route calls probeAccount (read-only)", () => {
    const code = stripComments(read(checkRoute));
    expect(code).toContain("probeAccount");
  });

  // ─── 安全：不暴露密钥 ────────────────────────────

  it("no route returns raw apiKey/apiSecret in NextResponse.json bodies", () => {
    const routes = [collectionRoute, idRoute, checkRoute];
    for (const r of routes) {
      const code = stripComments(read(r));
      // 提取所有 NextResponse.json(...) 调用块，检查不含原始密钥
      // 这里用简化检查：响应对象中不应直接包含 apiKey/apiSecret 字段
      const responseBlocks = code.match(/NextResponse\.json\(\s*\{[^}]*\}/g) || [];
      for (const block of responseBlocks) {
        expect(block, `${r} response should not return raw secrets`).not.toMatch(
          /apiKey\s*:/,
        );
        expect(block, `${r} response should not return raw secrets`).not.toMatch(
          /apiSecret\s*:/,
        );
      }
    }
  });

  it("no route calls decryptSecret", () => {
    const routes = [collectionRoute, idRoute, checkRoute];
    for (const r of routes) {
      const code = stripComments(read(r));
      expect(code, `${r} should not call decryptSecret`).not.toContain("decryptSecret");
    }
  });
});
