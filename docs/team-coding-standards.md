# Team Coding Standards

> 目标：统一代码风格、消除 `as any`、立起类型安全基线、让代码可维护可测试。

---

## 1. 类型安全：禁止 `as any`

### 规则

**PR 中不允许出现 `as any`，除非：**
- 有 `// eslint-disable-next-line @typescript-eslint/no-explicit-any` 注释
- 并且在同注释中写明理由（`// needed because TS cannot infer X`）

### 错误示范

```typescript
// ❌ 不合格
await updateOrderExecution(id, { status: "frozen", frozenReason: "xxx" } as any);

// ❌ 不合格
return new BinancePublicAdapter() as any;
```

### 正确做法

**用完整类型签名**：

```typescript
// ✅ 对于 Partial update：明确声明可更新字段
async function updateTypedExecution(
  id: string,
  partial: Partial<Pick<TwoLegOrderExecutionResult, "status" | "frozenReason" | "spot" | "perp">>,
): Promise<void> {
  await updateOrderExecution(id, partial); // 不再需要 as any
}
```

**用 discriminated union 处理 adapter 差异**：

```typescript
// ✅ adapter 接口覆盖所有 exchange 的真实签名
interface UnifiedAdapter {
  exchangeId: ExchangeId;
  fetchTicker(symbol: string): Promise<TickerData>;
  fetchOrderBook(symbol: string, depth?: number): Promise<OrderBookData>;
  fetchFundingInfo?(symbol: string): Promise<FundingData>;
  // 如果有 exchange 特殊方法，正式定义它，而不是 as any
}
```

---

## 2. 异常处理：禁止空 catch

### 规则

**每个 `catch` 块必须至少满足以下一条：**
- 记录日志（`console.warn` / logger）
- 设置 fallback 值
- 重新 throw（包装后）

### 错误示范

```typescript
// ❌ 禁止 — 静默吞掉错误
try { funding = await adapter.fetchFundingInfo?.(perpSym); } catch {}

// ❌ 禁止
try { opps = JSON.parse(raw); } catch {}
```

### 正确做法

```typescript
// ✅ 记录日志
try {
  opps = JSON.parse(raw);
} catch (e) {
  console.warn(`[opportunityStore] failed to parse raw: ${e}`);
  opps = [];
}

// ✅ 统一工具函数
async function fetchWithFallback<T>(
  promise: Promise<T>,
  fallback: T,
  context: string,
): Promise<T> {
  try {
    return await promise;
  } catch (e) {
    console.warn(`[${context}] fetch failed, using fallback: ${e}`);
    return fallback;
  }
}
```

---

## 3. 函数长度：不超过 60 行

### 规则

**单个函数不超过 60 行。** 超过必须拆分为多个职责单一的小函数。

### 指标

- 40-60 行：可以考虑拆分
- 60-80 行：必须拆分，需要 team lead 批准
- >80 行：reject

### 拆分原则

```
// ❌ 一个函数做 5 件事
function doAllTheThings(): Result {
  // step 1: validate
  // step 2: load config
  // step 3: fetch data
  // step 4: compute
  // step 5: persist
}

// ✅ 拆成 5 个函数
function validateOrderPlan(): PhaseResult { /* ... */ }
function loadExecutionSettings(): Settings { /* ... */ }
function fetchAdapterData(): AdapterResult { /* ... */ }
function computeLegResults(): LegResult { /* ... */ }
function persistExecution(): void { /* ... */ }
```

---

## 4. 环境变量：统一到 config 层

### 规则

**禁止在业务代码中直接读取 `process.env`。** 所有 `V121_*` 变量必须通过 config loader 获取。

### 错误示范

```typescript
// ❌ 禁止
const ksRaw = process.env.V121_KILL_SWITCH;
const ks = (ksRaw && ksRaw !== "undefined" ? ksRaw : "OFF") as string;
```

### 正确做法

```typescript
// ✅ 在 config/ 目录定义
// lib/strategy-v121/config/envConfig.ts
export interface EnvConfig {
  killSwitch: "OFF" | "LEVEL1" | "LEVEL2";
  enableRealOrderExecution: boolean;
  enableRealInternalTransfer: boolean;
  persistenceMode: "sqlite" | "memory";
  // ...
}

export function loadEnvConfig(): EnvConfig {
  return {
    killSwitch: parseKillSwitch(process.env.V121_KILL_SWITCH),
    enableRealOrderExecution: process.env.V121_ENABLE_REAL_ORDER_EXECUTION === "1",
    // ...
  };
}

// 业务代码只依赖 config 接口
const config = loadEnvConfig();
if (config.killSwitch !== "OFF") { /* ... */ }
```

---

## 5. 测试规范

### 测试内容要求

每个函数至少覆盖：

| 场景 | 必须 |
|------|------|
| Happy path | ✅ |
| 边界条件（空数组、0 值、负值） | ✅ |
| 异常输入（null、undefined） | ✅ |
| 超时/过期 | ✅ |

### 测试命名

```typescript
// ✅ 清晰的三段式
describe("executeGuardedTwoLegOrder", () => {
  it("should return failed when orderPlan not found", ...)
  it("should return frozen when killSwitch is LEVEL1", ...)
  it("should return filled when both legs succeed", ...)
})
```

---

## 6. 代码审查 Checklist

每个 PR 必须逐项检查：

- [ ] 无 `as any`（或有注释说明理由）
- [ ] 无空 `catch {}`
- [ ] 所有新函数 ≤ 60 行
- [ ] 无直接 `process.env` 访问（应走 config loader）
- [ ] 测试覆盖 happy path + 至少一个异常分支
- [ ] 新类型没有用 `any` 定义
- [ ] catch 块要么记录日志，要么设置 fallback

---

## 7. 常见陷阱速查

| 陷阱 | 正确的做法 |
|------|-----------|
| `const x = thing as any; x.foo()` | 给 thing 正确定义类型 |
| `catch {}` | `catch (e) { console.warn(...) }` |
| `process.env.FOO` in business logic | 移到 `config/envConfig.ts` |
| 80+ 行函数 | 按职责拆成 ≤ 60 行的小函数 |
| `(o as any).symbol` | `o: { symbol: string }` |
