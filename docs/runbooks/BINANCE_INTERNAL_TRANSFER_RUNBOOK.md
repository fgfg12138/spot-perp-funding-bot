# Binance 内部 USDT 划转 Runbook

## 1. 功能边界

- 仅支持 **Binance** 同一交易所内部划转
- 仅支持 **USDT**
- 方向：`spot → perp`（MAIN_UMFUTURE）或 `perp → spot`（UMFUTURE_MAIN）
- 不会自动下单、不会跨所、不会提现

## 2. 必须开启的环境变量

```env
V121_MODE=MAINNET_TINY
V121_MAINNET_TINY_ENABLED=true
V121_CONFIRM_MAINNET_TINY_RISK=I_UNDERSTAND
V121_ENABLE_REAL_INTERNAL_TRANSFER=1
```

## 3. Binance API Key 权限要求

API Key 必须在 Binance 后台开启以下权限：

- **允许通用划转（Permits Universal Transfer）**
- 读取（现货 + 合约）

如果 API Key 没有开启此权限，调用会返回 `binance_universal_transfer_permission_required`。

## 4. 先 Dry-Run

在 MAINNET_TINY 页面点击 **"Dry-run 内部划转并重新审计"** 按钮。

Dry-run 会：
- 读取余额
- 校验设置
- 校验幂等性
- 记录 ledger（status=dry_run）
- **不执行真实划转**

预期看到 `Dry-run 划转完成（无真实划转）`。

## 5. 执行 1 USDT 真实划转

**第一笔真实测试金额只能 1 USDT。**

流程：

1. 确认 Binance API Key 已开启通用划转权限
2. 确认 `V121_ENABLE_REAL_INTERNAL_TRANSFER=1`
3. 在 MAINNET_TINY 页面点击 **"执行真实内部划转并重新审计"**
4. 弹出 prompt，输入 `EXECUTE_REAL_INTERNAL_TRANSFER`
5. 系统执行划转
6. **立刻去 Binance 页面检查余额** — 确认金额已在目标账户到账

## 6. 查看 Internal Transfer Ledger

API：

```bash
GET http://localhost:3000/api/v121/mainnet-tiny/auto-transfer
```

返回最近 20 条划转记录。每条记录包含：

| 字段 | 说明 |
|------|------|
| id | 内部 ledger ID |
| status | 当前状态 |
| amount_usdt | 划转金额 |
| from_account / to_account | 方向 |
| transfer_id | 交易所返回的 tranId |
| raw_json | 请求/响应/余额变化 JSON |

## 7. 失败状态解释

| 状态 | 含义 | 处理 |
|------|------|------|
| `failed` | 划转未执行 | 查看 error 字段 |
| `frozen` | 划转已提交但余额未确认 | 人工检查 Binance 余额 |
| `dry_run` | 仅模拟未执行 | 无操作 |
| `submitted` | 已提交到交易所 | 等待余额确认 |
| `balance_confirmed` | 余额已确认 | 系统自动重新审计中 |
| `reaudit_passed` | 重新审计通过 | 仍然不会下单 |

## 8. Frozen 后人工处理步骤

如果状态变为 `frozen`：

1. **去 Binance 页面检查余额**，确认资金是否已到账
2. 如果已到账 → 无需操作，系统已记录
3. 如果未到账 → 检查 API Key 权限，重试
4. 如果状态持续 frozen → 在 Binance 手动划转后，删除 `.v121-data/v121.sqlite` 重建

## 9. 禁止事项

- ❌ 不要直接下单
- ❌ 不要跨所划转
- ❌ 不要链上提现
- ❌ 不要绕过 `explicitConfirm`
- ❌ 不要对 `frozen` 状态自动重试
- ❌ `allowedForActualExecution` 永远为 `false`
