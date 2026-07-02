import { runDiagnostics } from "../lib/strategy-v121/account/shadowDiagnostics";

async function main() {
  console.log("\n🔍 V1.2.1 SHADOW 私有账户只读诊断\n");
  const results = await runDiagnostics();

  for (const r of results) {
    const icon = r.success ? "✅" : "❌";
    console.log(`${icon} [${r.exchange}] ${r.operation}`);
    console.log(`   环境变量: ${r.envConfigured ? "已配置" : "未配置"}`);
    if (r.success) {
      console.log(`   状态: 成功 (${r.latencyMs}ms)`);
    } else {
      console.log(`   类型: ${r.errorType ?? "未知"}`);
      console.log(`   原因: ${r.chineseMessage}`);
      if (r.httpStatus) console.log(`   HTTP: ${r.httpStatus}`);
    }
    console.log();
  }

  const json = JSON.stringify(results);
  const secretOk = !json.includes("API_KEY") && !json.includes("API_SECRET") && !json.includes("PASSPHRASE");
  console.log(`Secret 泄露检查: ${secretOk ? "✅ 通过" : "❌ 失败"}`);
}

main().catch(console.error);
