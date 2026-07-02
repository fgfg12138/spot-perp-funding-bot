# P0 静默失败修复方案设计

- **项目**：`E:\ai\spot-perp-funding-bot`
- **日期**：2026-07-01
- **范围**：`lib/strategy-v121/persistence/*` 中的空 / 静默 `catch` 块
- **目标**：消除 persistence 层静默失败，使数据库异常可被观察、审计，避免 Worker 基于空状态做真实交易决策。
- **原则**：最小改动，不修改 `IPersistenceRepository` 契约，不引入大重构。

---

## 1. 问题清单

### 1.1 静默 catch 位置

| # | 文件 | 行号 | 当前代码 | 风险 |
|---|------|------|----------|------|
| 1 | `sqliteRepository.ts` | 79 | `try { this.db.exec(ALTER TABLE ...) } catch {}` | 列已存在时正常，但其他异常（权限、损坏）不可见 |
| 2 | `sqliteRepository.ts` | 121 | `try { result[k] = JSON.parse(v) } catch { result[k] = v; }` | JSON 解析失败（脏数据）被回退为字符串，无日志 |
| 3 | `sqliteRepository.ts` | 130 | `queryAll` 外层 `catch { return []; }` | **P0**：数据库不可读时返回空数组，调用方误判 |
| 4 | `sqliteRepository.ts` | 146 | `count` 外层 `catch { return 0; }` | 数据库异常时返回 0，计数不可信 |
| 5 | `sqliteRepository.ts` | 150 | `clear` 的 `catch { /* ignore */ }` | 清理失败无感知，可能导致重复数据 |
| 6 | `sqliteRepository.ts` | 154 | `deleteById` 的 `catch { /* ignore */ }` | 删除失败无感知，重复数据 |
| 7 | `sqliteRepository.ts` | 166 | `healthCheck` 的 `catch { return false; }` | 返回 false 但不记录原因，排障困难 |
| 8 | `fileSystemRepository.ts` | 80 | `deleteById` 中 `try { JSON.parse(line) } catch { return true; }` | 脏行保留，无日志 |

> 注：`sqliteRepositoryBoolMapping.test.ts:26` 的 `catch { /* already closed ... */ }` 属于测试清理代码，作用域明确，不视为 P0 静默失败。

### 1.2 已发现日志的 catch

以下位置不属于静默失败，本次不处理：

- `auditLogger.ts:92` 已经 `console.error` + 注释说明。
- `pnlTracker.ts:139/181` 已经有 `catch` + 注释，但仍需确认是否升级到 `auditError`（本次不修改，留作后续观察）。
- `userStrategySettings.ts:292` / `userStrategySettingsStore.ts:30` 已经降级到默认值并返回，缺少日志，但属于配置读取而非 persistence 层异常，本次不处理。

---

## 2. 修复策略

### 2.1 总体策略

| 策略 | 说明 |
|------|------|
| **不修改接口契约** | 保持 `IPersistenceRepository` 的签名和返回类型不变，避免 `BasePersistence`、`ExchangeAccountRepository` 及大量直接调用方的大规模重构。 |
| **加日志/审计** | 所有空 / 静默 catch 替换为 `console.error` / `console.warn` 或注入 logger，附带表名、操作名、错误信息。 |
| **保持兼容行为** | 读操作仍返回默认值（`[]`、`0`、`undefined`），写操作仍不抛错，避免破坏现有调用方。 |
| **避免循环依赖** | `sqliteRepository.ts` 不直接引用 `auditLogger`（`auditLogger -> repositoryFactory -> sqliteRepository` 会形成循环）。日志通过 `console` 输出，或后期通过工厂注入 logger。 |
| **可选增强** | 在 `repositoryFactory.ts` 或上层包装器中注入 `logger?: { error(...), warn(...) }`，使测试可 Spy。 |

### 2.2 是否改为 `{ ok, data, error }` 模式？

**结论：本次不改为 Result 模式。**

理由：

1. `IPersistenceRepository` 被 `BasePersistence`、`ExchangeAccountRepository`、`KillSwitchStore`、`pnlTracker`、`auditLogger`、`opportunityWatcher`、`userStrategySettingsStore`、`mainnetTinyPreflight`、`finalPreExecutionAudit` 等约 20 个文件直接或间接使用。
2. 改为 Result 模式意味着所有调用方都要改 `repo.queryAll(...)` 为 `repo.queryAll(...).data`，且 `save`/`deleteById` 等 void 方法需返回值，属于大重构。
3. 当前 P0 目标是“消除静默失败”，通过加日志即可满足，Result 模式可作为 P1 后续演进方向。

### 2.3 各 catch 的修复建议

#### 2.3.1 `sqliteRepository.ts:79`（`migrate` 中 `ALTER TABLE`）

```typescript
// 当前
try { this.db.exec(`ALTER TABLE "${table}" ADD COLUMN ${col}`); } catch {}

// 修复后
try {
  this.db.exec(`ALTER TABLE "${table}" ADD COLUMN ${col}`);
} catch (err) {
  // 列已存在时抛异常是预期行为，降级为 warn；其他异常（如表不存在）也记录，便于排查
  console.warn(`[sqliteRepository.migrate] ALTER TABLE ${table}.${colName} 失败: ${formatErr(err)}`);
}
```

**原因**：`ALTER TABLE ... ADD COLUMN` 在列已存在时抛出是正常的兼容迁移行为。记录为 `warn` 而非 `error`，避免日志噪音。但表不存在或数据库损坏时仍需可见。

#### 2.3.2 `sqliteRepository.ts:121`（JSON.parse 脏数据）

```typescript
// 当前
try { result[k] = JSON.parse(v); } catch { result[k] = v; }

// 修复后
try {
  result[k] = JSON.parse(v);
} catch (err) {
  console.warn(`[sqliteRepository.queryAll] 字段 ${k} JSON 解析失败，保留原始字符串: ${formatErr(err)}`);
  result[k] = v;
}
```

**原因**：数据兼容场景（旧数据不是 JSON），回退为字符串是合理行为，但需要记录便于数据清洗。

#### 2.3.3 `sqliteRepository.ts:130`（`queryAll` 外层）⭐ P0-1

```typescript
// 当前
catch { return []; }

// 修复后
catch (err) {
  console.error(`[sqliteRepository.queryAll] 查询表 ${table} 失败: ${formatErr(err)}`);
  return [];
}
```

**原因**：这是最关键的 P0 点。数据库损坏 / 权限 / 表损坏时返回空数组，Worker 会误判。加 `error` 日志后，日志收集/告警可捕捉。

#### 2.3.4 `sqliteRepository.ts:146`（`count`）

```typescript
// 当前
catch { return 0; }

// 修复后
catch (err) {
  console.error(`[sqliteRepository.count] 统计表 ${table} 失败: ${formatErr(err)}`);
  return 0;
}
```

#### 2.3.5 `sqliteRepository.ts:150`（`clear`）⭐ P0-2

```typescript
// 当前
try { this.db.exec(`DELETE FROM "${table}"`); } catch { /* ignore */ }

// 修复后
try {
  this.db.exec(`DELETE FROM "${table}"`);
} catch (err) {
  console.error(`[sqliteRepository.clear] 清空表 ${table} 失败: ${formatErr(err)}`);
}
```

#### 2.3.6 `sqliteRepository.ts:154`（`deleteById`）⭐ P0-2

```typescript
// 当前
try { this.db.prepare(`DELETE FROM "${table}" WHERE id = ?`).run(id); } catch { /* ignore */ }

// 修复后
try {
  this.db.prepare(`DELETE FROM "${table}" WHERE id = ?`).run(id);
} catch (err) {
  console.error(`[sqliteRepository.deleteById] 删除表 ${table} 中 id=${id} 失败: ${formatErr(err)}`);
}
```

**注意**：`exchange_capabilities` 表没有 `id` 列，`deleteById` 在该表上会失败，这是预期行为（由 `ExchangeAccountRepository._deleteCapabilityByAccountId` 使用 `clear + rebuild` 处理）。日志会记录，但行为不变。

#### 2.3.7 `sqliteRepository.ts:166`（`healthCheck`）

```typescript
// 当前
try { this.db.exec("SELECT 1"); return true; } catch { return false; }

// 修复后
try {
  this.db.exec("SELECT 1");
  return true;
} catch (err) {
  console.error(`[sqliteRepository.healthCheck] 失败: ${formatErr(err)}`);
  return false;
}
```

#### 2.3.8 `fileSystemRepository.ts:80`（`deleteById` 脏行）

```typescript
// 当前
try { const rec = JSON.parse(line); return rec.id !== id; } catch { return true; }

// 修复后
try {
  const rec = JSON.parse(line);
  return rec.id !== id;
} catch (err) {
  console.warn(`[fileSystemRepository.deleteById] 脏行 JSON 解析失败，保留该行: ${formatErr(err)}`);
  return true;
}
```

#### 2.3.9 `fileSystemRepository.ts:39-44`（`queryAll` 缺少 catch）

虽然当前没有 `catch`，但 `JSON.parse(line)` 会抛出脏数据异常，导致整个 `queryAll` 失败。建议增加保护：

```typescript
return content.split("\n").map((line, index) => {
  try {
    return JSON.parse(line);
  } catch (err) {
    console.warn(`[fileSystemRepository.queryAll] 第 ${index + 1} 行 JSON 解析失败: ${formatErr(err)}`);
    return { _corrupt: true, _rawLine: line };
  }
}).filter(r => !r._corrupt);
```

或更保守地直接 `filter` 掉脏行：

```typescript
return content
  .split("\n")
  .map((line, index) => {
    try { return JSON.parse(line); } catch (err) {
      console.warn(`[fileSystemRepository.queryAll] 第 ${index + 1} 行 JSON 解析失败，已跳过: ${formatErr(err)}`);
      return undefined;
    }
  })
  .filter((r): r is Record<string, unknown> => r !== undefined);
```

### 2.4 通用辅助函数

在 `sqliteRepository.ts` 和 `fileSystemRepository.ts` 中各自定义局部 `formatErr`（不增加公共依赖）：

```typescript
function formatErr(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
```

---

## 3. 调用方影响分析

### 3.1 使用 `IPersistenceRepository` 的代码

| 调用方 | 使用方式 | 影响 |
|--------|----------|------|
| `BasePersistence` | `repo.queryAll`, `repo.save`, `repo.deleteById`, `repo.clear`, `repo.count` | 无签名变化。`save` 仍可能抛错（当前无 catch），属于正常行为。`loadFromDisk` 已有自己的 catch。 |
| `ExchangeAccountRepository` | `repo.queryAll`, `repo.save`, `repo.count`, `repo.deleteById` | 无签名变化。`deleteById` 在 capabilities 表上的失败会被记录，但行为不变。 |
| `KillSwitchStore` | 继承 `BasePersistence` | 无影响。 |
| `auditLogger` | 自己包 `try/catch` + `console.error` | 无影响。 |
| `pnlTracker` | 自己包 `try/catch` | 无影响。 |
| `opportunityWatcher` | 直接 `repo.save` / `repo.queryAll` | 无签名变化。 |
| `userStrategySettings.ts` / `userStrategySettingsStore.ts` | `getRepository().latest` / `queryAll` / `save` / `deleteById` | 无影响。 |
| `mainnetTinyPreflight.ts` / `finalPreExecutionAudit.ts` | 大量 `repo.queryAll` / `latest` / `count` | 无签名变化。失败时仍返回默认值，但会记录 error，便于事后排查。 |
| `marketRefreshService.ts` / `orderIntent.ts` / `heartbeat.ts` | 直接 `repo.save` / `queryAll` | 无影响。 |
| `closePlanLedger.ts` / `closeExecutionLedger.ts` | `repo.queryAll` / `repo.save` | 无影响。 |

### 3.2 是否需要调用方配合

**不需要。** 本次修复保持接口和返回值不变，所有调用方无需修改。仅当日志系统或测试断言对 `console` 输出敏感时，需要更新测试。

---

## 4. 文件变更清单

| 文件 | 变更内容 | 行数影响 |
|------|----------|----------|
| `lib/strategy-v121/persistence/sqliteRepository.ts` | 1. 增加 `formatErr` 辅助函数；2. 替换所有空 / 静默 catch 为带日志的 catch；3. 为 `queryAll` 的 JSON.parse 失败加日志。 | 约 +30 行 |
| `lib/strategy-v121/persistence/fileSystemRepository.ts` | 1. 增加 `formatErr` 辅助函数；2. `deleteById` 中 JSON.parse 失败加日志；3. `queryAll` 增加对脏行 JSON 的 catch 与日志。 | 约 +20 行 |
| `lib/strategy-v121/persistence/fileSystemRepository.test.ts` | 增加测试：脏行被跳过、日志输出被触发。 | 约 +25 行 |
| `lib/strategy-v121/persistence/sqliteRepositoryBoolMapping.test.ts` | 增加测试：healthCheck 失败时返回 false 并记录错误；queryAll 失败时返回 [] 并记录错误。 | 约 +30 行 |
| `lib/strategy-v121/persistence/repositoryFactory.ts` | 可选：增加 `onRepositoryError?: (err) => void` 注入点，但本次不引入，保持最小改动。 | 不修改 |
| `lib/strategy-v121/persistence/repositoryTypes.ts` | 不修改 `IPersistenceRepository` 签名。 | 不修改 |

---

## 5. 实现顺序

按依赖和风险从低到高执行：

### 阶段 1：SQLite 层静默 catch 修复（P0-1 / P0-2）

1. 修改 `sqliteRepository.ts`：
   - 增加 `formatErr`。
   - 修复 `migrate` catch（warn）。
   - 修复 `queryAll` 外层 catch（error）和内部 JSON.parse catch（warn）。
   - 修复 `count` catch（error）。
   - 修复 `clear` catch（error）。
   - 修复 `deleteById` catch（error）。
   - 修复 `healthCheck` catch（error）。

2. 运行 `npm test` 和 `npx tsc --noEmit -p tsconfig.json` 确保无回归。

### 阶段 2：FileSystem 层静默 catch 修复

1. 修改 `fileSystemRepository.ts`：
   - 增加 `formatErr`。
   - 修复 `deleteById` 中 JSON.parse catch（warn）。
   - 为 `queryAll` 增加 JSON.parse 行级保护（warn）。

2. 运行测试。

### 阶段 3：测试补强

1. 更新 `sqliteRepositoryBoolMapping.test.ts`：
   - 模拟数据库损坏（如关闭后调用 `queryAll`）验证返回 `[]` 且 `console.error` 被调用。
   - 验证 `healthCheck()` 在关闭后返回 false 并记录 error。

2. 更新 `fileSystemRepository.test.ts`：
   - 写入脏 JSON 行，验证 `queryAll` 返回有效记录并记录 warn。
   - 验证 `deleteById` 遇到脏行时保留并记录 warn。

3. 运行完整测试套件。

---

## 6. 风险分析

| 风险 | 等级 | 说明 | 缓解措施 |
|------|------|------|----------|
| 增加 `console.error` 导致日志噪音 | 低 | 仅在异常时输出，正常路径无影响。 | 使用清晰前缀 `[sqliteRepository.xxx]` / `[fileSystemRepository.xxx]`，便于日志过滤。 |
| 测试断言对 `console` 输出敏感 | 中 | 部分测试可能 `spyOn(console, ...)` 或断言无输出。 | 同步更新测试，明确 Spy 或忽略错误日志。 |
| `deleteById` 在 capabilities 表上失败被记录为 error | 低 | 这是预期行为，但会产生 error 日志。 | 可改为 `warn` 或加注释说明；但为保持一致性，建议保留 error，因为“按 id 删除失败”本身是异常。 |
| 调用方误以为异常已抛 | 低 | 接口仍返回默认值，调用方仍可能基于空数据做决策。 | 本次通过日志让异常可见；后续 P1 可考虑 Result 模式或上层重试。 |
| 循环依赖 | 低 | 如果直接引入 `auditLogger` 会导致循环依赖。 | 本次使用 `console` 输出，避免循环依赖。 |
| 未来扩展到 Result 模式 | 低 | 本次不加 Result 类型，后续需要更大改动。 | 在文档中记录，作为 P1 候选。 |

---

## 7. 备选方案（未采纳，仅记录）

### 7.1 方案 A：引入 `Result<T, E>` 模式

- 修改 `IPersistenceRepository` 为 `queryAll(table): Result<Record[], PersistenceError>` 等。
- **不采纳原因**：调用方改动面太大，违背最小改动原则。

### 7.2 方案 B：在 `save` / `saveAll` 也加 try-catch

- 当前 `save` 没有 catch，失败会抛出。有人建议也包裹并记录。
- **不采纳原因**：写操作失败通常应当抛错让上层处理（如 `BasePersistence.save` 未 catch，符合 fail-fast）。如果 `save` 静默失败，数据丢失更不可接受。保持现状。

### 7.3 方案 C：注入结构化 logger

- 在 `repositoryFactory.getRepository()` 或 `SqliteRepository` 构造函数中注入 `logger`。
- **不采纳原因**：虽然更优雅，但会增加接口和工厂复杂度。本次最小改动，使用 `console` 即可；后续若统一日志系统再考虑注入。

---

## 8. 验收标准

1. `sqliteRepository.ts` 中不存在空 catch（`catch {}`）或仅含 `/* ignore */` 的 catch。
2. `fileSystemRepository.ts` 中不存在空 catch。
3. 所有 catch 块至少包含 `console.error` 或 `console.warn`，并附带上下文（表名、操作名、错误信息）。
4. `IPersistenceRepository` 接口签名不变。
5. 现有 738 tests 全部通过。
6. `npx tsc --noEmit -p tsconfig.json` 保持当前基线（9 个测试文件错误，与本次无关）。
7. 新增测试覆盖 SQLite 查询失败、healthCheck 失败、FileSystem 脏行场景。

---

## 9. 附录：调用方引用汇总

以下文件直接或间接使用 `getRepository()` / `IPersistenceRepository`：

- `lib/strategy-v121/persistence/basePersistence.ts`
- `lib/strategy-v121/persistence/baseLedgerStore.ts`
- `lib/strategy-v121/exchange-accounts/exchangeAccountRepository.ts`
- `lib/strategy-v121/exchange-accounts/exchangeAccountService.ts`
- `lib/strategy-v121/risk/killSwitchStore.ts`
- `lib/strategy-v121/ops/auditLogger.ts`
- `lib/strategy-v121/ops/pnlTracker.ts`
- `lib/strategy-v121/opportunity/opportunityStore.ts`
- `lib/strategy-v121/opportunity/opportunityWatcher.ts`
- `lib/strategy-v121/settings/userStrategySettingsStore.ts`
- `lib/strategy-v121/config/userStrategySettings.ts`
- `lib/strategy-v121/worker/heartbeat.ts`
- `lib/strategy-v121/execution/orderIntent.ts`
- `lib/strategy-v121/market/marketRefreshService.ts`
- `lib/strategy-v121/mainnetTiny/mainnetTinyPreflight.ts`
- `lib/strategy-v121/mainnetTiny/finalPreExecutionAudit.ts`
- `lib/strategy-v121/position/closePlanLedger.ts`
- `lib/strategy-v121/position/closeExecutionLedger.ts`

> 以上文件在本次修复中无需改动，仅作为影响面评估参考。
