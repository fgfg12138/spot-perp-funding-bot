/**
 * MAINNET_TINY Dry Run Check — 预演检查脚本。
 * 不下单，不改账户。
 */
import { checkMainnetTinyGate } from "../lib/strategy-v121/mainnetTiny/mainnetTinyGate";
import { runMainnetTinyPreflight } from "../lib/strategy-v121/mainnetTiny/mainnetTinyPreflight";
import { createOrderIntent } from "../lib/strategy-v121/execution/orderIntent";
import { getPersistenceMode } from "../lib/strategy-v121/persistence/persistenceMode";

async function main() {
  console.log("\n🔍 MAINNET_TINY Dry Run Check\n");
  const gate = checkMainnetTinyGate();

  console.log(`模式: ${gate.mode}`);
  console.log(`Gate: ${gate.allowed ? "✅ 满足" : "❌ 不满足"}`);
  if (!gate.allowed) gate.missing.forEach((m: string) => console.log(`  缺失: ${m}`));
  gate.warnings.forEach((w: string) => console.log(`  警告: ${w}`));

  console.log(`持久化: ${getPersistenceMode()}`);
  console.log(`Kill Switch: ${gate.killSwitch}`);
  console.log(`Dry Run: ${process.env.V121_MAINNET_TINY_DRY_RUN === "true" ? "是" : "否"}`);
  console.log(`Real Order: ${process.env.V121_REAL_ORDER_EXECUTION_ENABLED === "true" ? "开启 ⚠️" : "关闭 ✅"}`,);

  const preflight = runMainnetTinyPreflight();
  console.log(`\n预飞分数: ${preflight.readinessScore}/100`);
  preflight.checks.filter((c: any) => !c.passed).forEach((c: any) =>
    console.log(`  ❌ ${c.name}: ${c.chineseMessage}`));

  const intent = createOrderIntent({
    symbol: "BTC/USDT", spotExchange: "binance", perpExchange: "binance",
    plannedNotionalUsdt: 10, batchNo: 1,
    manualConfirmText: "I_UNDERSTAND_MAINNET_TINY_10U",
  });
  console.log(`\n意图: ${intent.intentId} | Gate: ${intent.gateAllowed} | DryRun: ${intent.dryRun}`);
  if (intent.blockedReasons.length) console.log(`Blocked: ${intent.blockedReasons.join("; ")}`);

  console.log("\n✅ 检查完成。当前不会真实下单。");
}

main().catch(console.error);
