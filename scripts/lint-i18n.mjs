import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * i18n / 产品化术语 lint。
 *
 * 只扫描成品路由组 app/(app)/** —— 这是普通用户能看到的页面。
 * 其它目录（app/api/** 后端、app/v121/** 开发者页、components/** 旧 V1.0 组件、
 * lib/**、scripts/**、docs/**）全部豁免，因为：
 *   - 后端必须保留工程术语（orderPlan / intent / ledger / preflight / dryRun 等）；
 *   - 开发者页用 V121_ENABLE_DEV_TOOLS 门控，不在普通用户视野内；
 *   - 旧 V1.0 组件被 dashboard.test.ts 锁定，不应改动。
 *
 * 任何成品页面里出现工程术语（dry-run / OrderPlan / Intent / Ledger / Preflight /
 * Spot test / MAINNET_TINY / SHADOW / PAPER）或旧版英文交易词（Short / Long 等），
 * 都视为泄漏并让 lint 失败。
 */
const ROOT = process.cwd();
const SCAN_DIRS = [join("app", "(app)")];
const EXTENSIONS = new Set([".js", ".jsx", ".ts", ".tsx", ".mdx"]);

// 旧版禁用词（V1.0 英文交易术语，不可在成品 UI 出现）
const LEGACY_FORBIDDEN = [
  "Short",
  "Long",
  "CrossExchange",
  "SpotPerp",
  "Funding Markets",
  "Spot Markets",
  "Price direction",
  "Price Direction",
  "Exchange Count",
  "Latest",
  "Quality",
  "Volatility",
  "Decay",
  "Survival",
];

// V121 工程术语 —— 成品页面里必须用产品词替换，不可直接出现。
// 大写形式（MAINNET_TINY / SHADOW / PAPER）用于捕捉模式名渲染；
// 小写连字符 / 空格形式（dry-run / dry run）用于捕捉可见文案里的工程词。
const V121_ENGINEERING_TERMS = [
  "dry-run",
  "Dry-run",
  "dry run",
  "Dry Run",
  "Spot test",
  "OrderPlan",
  "Intent",
  "Ledger",
  "Preflight",
  "MAINNET_TINY",
  "SHADOW",
  "PAPER",
];

const FORBIDDEN_TERMS = [...LEGACY_FORBIDDEN, ...V121_ENGINEERING_TERMS];
const INTERNAL_VALUES = new Set(["CrossExchange", "SpotPerp"]);

const findings = [];

for (const dir of SCAN_DIRS) {
  const absDir = join(ROOT, dir);
  if (!existsSync(absDir)) {
    console.error(`i18n lint: scan target not found: ${dir}`);
    process.exit(1);
  }
  walk(absDir);
}

if (findings.length > 0) {
  console.error(
    "i18n lint failed: forbidden English / engineering terms remain in product UI (app/(app)/**).",
  );
  for (const finding of findings) {
    console.error(`${finding.file}:${finding.line}: ${finding.term} -> ${finding.text.trim()}`);
  }
  process.exit(1);
}

console.log("i18n lint passed: no forbidden UI terms found in app/(app)/**.");

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      if (entry === "node_modules" || entry === ".next" || entry === ".git") continue;
      walk(fullPath);
      continue;
    }

    if (!EXTENSIONS.has(getExtension(entry))) continue;
    scanFile(fullPath);
  }
}

function scanFile(file) {
  const content = readFileSync(file, "utf8");
  const lines = content.split(/\r?\n/);

  lines.forEach((line, index) => {
    for (const text of getVisibleTextCandidates(line)) {
      for (const term of FORBIDDEN_TERMS) {
        if (text.includes(term) && !isAllowedInternalText(text, term)) {
          findings.push({
            file: relative(ROOT, file),
            line: index + 1,
            term,
            text,
          });
        }
      }
    }
  });
}

function getVisibleTextCandidates(line) {
  const candidates = [];
  const stringPattern = /(["'`])((?:\\.|(?!\1).)*?)\1/g;
  let stringMatch;
  while ((stringMatch = stringPattern.exec(line)) !== null) {
    candidates.push(stringMatch[2]);
  }

  const jsxPattern = />\s*([^<>{}][^<>]*?)\s*</g;
  let jsxMatch;
  while ((jsxMatch = jsxPattern.exec(line)) !== null) {
    candidates.push(jsxMatch[1]);
  }

  return candidates;
}

function isAllowedInternalText(text, term) {
  const trimmed = text.trim();
  if (INTERNAL_VALUES.has(trimmed)) {
    return true;
  }

  // 单一标识符（如 "OrderPlanId"、"IntentId"）视为代码内部值，不是可见文案。
  return /^[A-Za-z][A-Za-z0-9_]*$/.test(trimmed) && trimmed !== term;
}

function getExtension(fileName) {
  const match = fileName.match(/(\.[^.]+)$/);
  return match?.[1] ?? "";
}
