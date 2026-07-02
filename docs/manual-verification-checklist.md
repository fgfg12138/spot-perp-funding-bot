# MAINNET_TINY 手工验证流程检查清单

> **目的**：在 MAINNET_TINY 模式下，由人工验证整个系统是否按照预期运行。
> **模式说明**：MAINNET_TINY = 读取真实行情 + 真实账户数据，但只允许 ≤10 USDT 的单笔小额交易，
> 且每步操作都需要人工确认和手动门禁解锁。

---

## 前置准备

### □ 环境配置检查

```bash
# 检查当前模式
echo $V121_MODE                    # 应为 MAINNET_TINY
echo $V121_MAINNET_TINY_ENABLED   # 应为 true
echo $V121_CONFIRM_MAINNET_TINY_RISK  # 应为 I_UNDERSTAND
echo $V121_ENABLE_REAL_ORDER_EXECUTION   # 可选（默认为空=不开）
echo $V121_ENABLE_REAL_CLOSE_EXECUTION   # 可选（默认为空=不开）
echo $V121_ENABLE_REAL_INTERNAL_TRANSFER # 可选（默认为空=不开）

# 检查交易所 API Key
echo $V121_BINANCE_API_KEY        # 应为非空
echo $V121_OKX_API_KEY            # 应为非空（如使用 OKX）
```

### □ 编译检查

```bash
npx tsc --noEmit -p tsconfig.ci.json
# 预期：零错误
```

### □ 测试全绿

```bash
npx vitest run lib/strategy-v121
# 预期：所有测试通过
```

---

## 第 1 步 — READ_ONLY 模式验证

### □ 启动 Worker（只读观察）

```bash
# 设置模式
export V121_MODE=READ_ONLY

# 启动 Worker（需要修改代码或用脚本包装）
# Worker 启动后应只扫描市场，不下单、不划转
```

### □ 验证 Worker 日志

- [ ] 确认 Worker 成功启动（心跳正常）
- [ ] 确认市场数据正在刷新（行情 tick 更新）
- [ ] 确认没有下单/划转的日志
- [ ] 确认 `accountSafety` 没有报错（SHADOW 不适用）

### □ 停止 Worker

```bash
# 停止 Worker（API 调用或 Ctrl+C）
```

---

## 第 2 步 — SHADOW 模式验证

### □ 切换到 SHADOW

```bash
export V121_MODE=SHADOW
```

### □ 验证 SHADOW 安全门

- [ ] 启动 Worker，确认只读模式正常
- [ ] 手动读取：余额、仓位、挂单应成功（如已配 API Key）
- [ ] 确认所有写操作被阻止（下单/撤单/改杠杆/划转）

### □ 验证 `assertNotShadow`

检查代码中 `assertNotShadow` 的调用，确认在 SHADOW 模式下：
- [ ] 不能下单
- [ ] 不能撤单
- [ ] 不能改杠杆
- [ ] 不能划转

### □ 停止 Worker

---

## 第 3 步 — MAINNET_TINY 基础验证（环境检查）

### □ 切换到 MAINNET_TINY

```bash
export V121_MODE=MAINNET_TINY
export V121_MAINNET_TINY_ENABLED=true
export V121_CONFIRM_MAINNET_TINY_RISK=I_UNDERSTAND
```

### □ 调用 `checkMainnetTinyGate`

通过现有的测试 `mainnetTinyGate.test.ts` 验证门禁逻辑：

```bash
npx vitest run lib/strategy-v121/mainnetTiny/mainnetTinyGate.test.ts
# 预期：全绿
```

### □ 调用 `validateOrderIntent`

手动构造不同的 intent 输入，验证门禁：

- [ ] BTC/USDT, 5 USDT, binance → allowed ✅
- [ ] BTC/USDT, 20 USDT → blocked（超 10 USDT）✅
- [ ] BTC/USDT, HTX → blocked（HTX observe-only）✅
- [ ] BTC/USDT, binance spot → okx perp → blocked（跨所）✅
- [ ] 1000PEPE/USDT → blocked（小币）✅

---

## 第 4 步 — 预执行门禁验证（不开真实下单）

### □ 检查 `preOrderExecutionGate`

保持 `V121_ENABLE_REAL_ORDER_EXECUTION` 未设置（不开启真实下单）：

```bash
unset V121_ENABLE_REAL_ORDER_EXECUTION
```

### □ 调用预执行门禁（通过测试或手动 API）

```bash
npx vitest run lib/strategy-v121/execution/preOrderExecutionGate.test.ts
# 预期：全绿
```

### □ 验证门禁输出

- [ ] `allowRealOrders !== false` → block
- [ ] exchange 能力检测 → OKX/Binance 通过，HTX block（无 adapter）
- [ ] kill switch 检查 → 如为 PAUSE 则 block
- [ ] 行情新鲜度检查 → 如 stale 则 block
- [ ] 资金费率检查 → 如 < min 则 block
- [ ] final audit 检查 → 如不通过则 block
- [ ] open orders 检查 → 如有冲突挂单则 block

---

## 第 5 步 — 划转验证

### □ 开启内部划转门禁

```bash
export V121_ENABLE_REAL_INTERNAL_TRANSFER=1
```

### □ 运行划转测试

```bash
npx vitest run lib/strategy-v121/execution/autoTransferExecutor.test.ts
# 预期：全绿
```

### □ 手动验证 OKX 划转

OKX 统一账户模式下 spot → perp 无需真实划转，但需确认：

- [ ] OKX adapter 返回 `ok: true, status: "submitted"` ✅
- [ ] OKX adapter 中的 `warnings` 包含 `okx_unified_account_no_real_transfer_needed` ✅

### □ 手动验证 Binance 划转

如需验证真实划转：

1. 确认 Binance API Key 有内转权限
2. 设置 `V121_ENABLE_REAL_INTERNAL_TRANSFER=1`
3. 运行划转（限额 ≤50 USDT）
4. 验证划转后余额变化
5. 如不需要，保持 `autoTransferExecutor` 的 `binance_only_mode` 不触发

---

## 第 6 步 — 真实下单验证（MAINNET_TINY）

> ⚠️ **高风险操作**：以下步骤会发送真实订单到交易所。
> 请确保已阅读 `strategy_rules_v121.md` 中的风险规则。

### □ 开启真实下单门禁

```bash
export V121_ENABLE_REAL_ORDER_EXECUTION=1
export V121_ENABLE_REAL_CLOSE_EXECUTION=1
```

### □ 下单前确认清单

- [ ] API Key 权限正确（只开现货+永续，不开提现）
- [ ] Binance/OKX 账户中有足够 USDT 余额（建议 ≥100 USDT）
- [ ] 手动杠杆已设为 1 倍（OKX 逐仓模式）
- [ ] 当前不是接近结算时间（避免交割波动）
- [ ] 市场深度充足（BTC/USDT 肯定满足，小币需确认）

### □ 运行下单测试（不真实触发，只验证门禁）

```bash
npx vitest run lib/strategy-v121/account/adapters/okxAccountAdapter.test.ts
npx vitest run lib/strategy-v121/account/adapters/binanceAccountAdapter.test.ts
# 预期：全绿，所有测试使用 mock 而非真实 API
```

### □ 手工触发一次真实小额下单（可选）

如需验证真实下单，使用 `dryRun=false` + `explicitConfirm` 参数：

1. 选取一个条件最宽松的标（如 BTC/USDT）
2. 使用 ≤5 USDT 的名义金额（远低于 10 USDT 上限）
3. 观察交易所确认返回

> 实际执行时，建议先使用脚本逐行调用，而非直接启动 Worker。

---

## 第 7 步 — Worker 集成运行

### □ 配置 Worker 参数

```bash
export V121_WORKER_USE_DYNAMIC_UNIVERSE=false   # 先用固定列表
export V121_WORKER_SCAN_MODE=fixed_universe     # 固定市场扫描
```

### □ 启动 Worker（非真实执行）

```bash
# 先以 dryRun=true 启动 Worker
# 观察 5-10 个 cycle，确认：
```

- [ ] Worker 心跳正常
- [ ] 行情数据持续刷新
- [ ] 没有异常错误
- [ ] 没有真实下单

### □ 启动 Worker（完整模式）

```bash
# 设置完所有门禁后启动 Worker
# 观察至少 1 小时
```

- [ ] Worker 连续运行 ≥1 小时无崩溃
- [ ] 没有意外的资金操作
- [ ] 日志中没有异常错误堆栈
- [ ] 如果有机会信号，检查门禁是否正确触发

---

## 第 8 步 — 回滚流程

### □ 紧急停止

```bash
# 方式 1: Kill Switch
export V121_KILL_SWITCH=PAUSE_ALL_AUTOMATION

# 方式 2: 停止 Worker 进程
# Ctrl+C / kill <pid>

# 方式 3: 撤回 API Key 权限
# 登录交易所后台 → API 管理 → 禁用交易权限
```

### □ 状态恢复

- [ ] 确认 Worker 已停止（`worker.isRunning() === false`）
- [ ] 确认没有未完成的挂单
- [ ] 确认持仓无异常
- [ ] 检查日志了解停止原因

### □ 环境恢复

```bash
# 恢复到安全状态
unset V121_ENABLE_REAL_ORDER_EXECUTION
unset V121_ENABLE_REAL_CLOSE_EXECUTION
unset V121_ENABLE_REAL_INTERNAL_TRANSFER
export V121_MODE=READ_ONLY
```

---

## 验证总表

| 步骤 | 内容 | 状态 |
|------|------|------|
| 前置 | 环境配置检查 | □ |
| 前置 | 编译检查 | □ |
| 前置 | 测试全绿 | □ |
| Step 1 | READ_ONLY 模式运行 | □ |
| Step 2 | SHADOW 模式验证 | □ |
| Step 3 | MAINNET_TINY 基础门禁 | □ |
| Step 4 | 预执行门禁验证 | □ |
| Step 5 | 划转验证 | □ |
| Step 6 | 真实下单验证 | □ |
| Step 7 | Worker 集成运行 | □ |
| Step 8 | 回滚流程确认 | □ |

---

## 通过标准

- [ ] 所有检查项标记为 ✅
- [ ] 未出现未预期的资金损失
- [ ] Worker 在 MAINNET_TINY 模式下稳定运行 ≥1 小时
- [ ] 未触发任何安全门禁绕过问题
