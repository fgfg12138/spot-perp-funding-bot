/**
 * 一键添加交易所账户脚本
 *
 * 用法:
 *   npx tsx scripts/add-exchange-account.ts <exchange> <apiKey> <apiSecret> [passphrase] [label]
 *
 * 示例:
 *   npx tsx scripts/add-exchange-account.ts binance YOUR_API_KEY YOUR_API_SECRET
 *   npx tsx scripts/add-exchange-account.ts okx YOUR_API_KEY YOUR_API_SECRET YOUR_PASSPHRASE "OKX主账户"
 *
 * 要求:
 *   - .env 中必须已设置 V121_MASTER_KEY（至少 16 字符）
 *   - 首次运行自动初始化持久化存储（默认 JSONL，数据存放在 .v121-data/）
 */

import { initPersistence, getRepository } from "../lib/strategy-v121/persistence/repositoryFactory";
import { ExchangeAccountService } from "../lib/strategy-v121/exchange-accounts/exchangeAccountService";
import type { ExchangeId } from "../lib/strategy-v121/domain/types";

// ─── 读取环境变量 ───────────────────────────────────

// dotenv 不是依赖项，手动从 .env 读取
function loadDotenv(): void {
  const fs = require("node:fs");
  const path = require("node:path");
  const envPath = path.resolve(process.cwd(), ".env");
  if (!fs.existsSync(envPath)) {
    console.warn("⚠️  未找到 .env 文件，依赖环境变量已设置");
    return;
  }
  const lines = fs.readFileSync(envPath, "utf-8").split("\n");
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eqIdx = line.indexOf("=");
    if (eqIdx === -1) continue;
    const key = line.slice(0, eqIdx).trim();
    let value = line.slice(eqIdx + 1).trim();
    // 去掉首尾引号
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

loadDotenv();

// ─── 参数解析 ───────────────────────────────────────

const args = process.argv.slice(2);

function usage(): never {
  console.error(`
用法: npx tsx scripts/add-exchange-account.ts <exchange> <apiKey> <apiSecret> [passphrase] [label]

参数:
  exchange    交易所: binance | okx | htx
  apiKey      API Key
  apiSecret   API Secret
  passphrase  OKX 必须提供 passphrase
  label       账户备注（可选，默认 "xxx主账户"）

示例:
  npx tsx scripts/add-exchange-account.ts binance ABC...123 DEF...456
  npx tsx scripts/add-exchange-account.ts okx ABC...123 DEF...456 MyPass "OKX主账户"
  npx tsx scripts/add-exchange-account.ts htx ABC...123 DEF...456 "" "HTX只读账户"
`);
  process.exit(1);
}

if (args.length < 3) usage();

const exchange = args[0].toLowerCase() as ExchangeId;
const apiKey = args[1];
const apiSecret = args[2];
const passphrase = args[3] || undefined;
const label = args[4] || `${exchange.toUpperCase()}主账户`;

// ─── 校验 ───────────────────────────────────────────

if (!["binance", "okx", "htx"].includes(exchange)) {
  console.error(`❌ 不支持的交易所: ${exchange}，可选: binance, okx, htx`);
  process.exit(1);
}

if (exchange === "okx" && !passphrase) {
  console.error("❌ OKX 必须提供 passphrase");
  process.exit(1);
}

if (!process.env.V121_MASTER_KEY || process.env.V121_MASTER_KEY.trim().length < 16) {
  console.error("❌ V121_MASTER_KEY 未设置或长度不足（至少 16 字符）。");
  console.error("   先在 .env 中设置：");
  console.error('   V121_MASTER_KEY="your_random_32_char_string_here"');
  console.error("   或运行: export V121_MASTER_KEY=your_key_here");
  process.exit(1);
}

// ─── 执行 ───────────────────────────────────────────

async function main() {
  console.log(`\n🔑  添加交易所账户`);
  console.log(`    交易所: ${exchange.toUpperCase()}`);
  console.log(`    label:  ${label}`);
  console.log(`    API Key: ${apiKey.slice(0, 4)}...${apiKey.slice(-4)}`);

  // 初始化持久化存储
  initPersistence();
  const repo = getRepository();
  const service = new ExchangeAccountService(repo);

  try {
    const summary = await service.createAccount({
      exchange,
      label,
      apiKey,
      apiSecret,
      passphrase: passphrase || undefined,
    });

    console.log(`\n✅  账户添加成功！`);
    console.log(`    ID:        ${summary.id}`);
    console.log(`    交易所:    ${summary.exchange.toUpperCase()}`);
    console.log(`    label:     ${summary.label}`);
    console.log(`    API Key:   ${summary.maskedApiKey}`);
    console.log(`    状态:      ${summary.enabled ? "已启用" : "已禁用"}`);

    // 尝试探测权限
    console.log(`\n🔍  正在探测账户权限...`);
    try {
      const report = await service.probeAccount(summary.id);
      const cap = report.capability;
      console.log(`    余额查询:  ${cap.readBalance ? "✅" : "❌"}`);
      console.log(`    现货查询:  ${cap.readSpot ? "✅" : "❌"}`);
      console.log(`    合约查询:  ${cap.readPerp ? "✅" : "❌"}`);
      console.log(`    费率查询:  ${cap.fundingRate ? "✅" : "❌"}`);
      console.log(`    同所套利:  ${cap.sameExchangeArbEnabled ? "✅ 允许" : "❌ 不允许"}`);
      if (cap.lastError) {
        console.log(`    ⚠️  探测警告: ${cap.lastError}`);
      }
      console.log(`\n✅  权限探测完成`);
    } catch (probeErr: any) {
      console.warn(`\n⚠️  权限探测失败（不影响账户保存）: ${probeErr.message ?? probeErr}`);
    }

    // 列出所有已保存的账户
    const allAccounts = service.listAccounts();
    console.log(`\n📋  当前共 ${allAccounts.length} 个账户:`);
    for (const acc of allAccounts) {
      console.log(`    ${acc.id} | ${acc.exchange.toUpperCase()} | ${acc.maskedApiKey} | ${acc.enabled ? "启用" : "禁用"}`);
    }
  } catch (err: any) {
    console.error(`\n❌  添加账户失败: ${err.message ?? err}`);
    process.exit(1);
  }
}

main();
