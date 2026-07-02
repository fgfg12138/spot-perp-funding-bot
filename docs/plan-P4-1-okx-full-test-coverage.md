# Phase: P4.1 — OKX Adapter Full Unit Test Coverage

## 范围
在现有 `okxAccountAdapter.test.ts`（22 tests）基础上，补全所有适配器方法的全面场景测试，实现 ≥85% 分支覆盖率。

## 涉及文件
- `lib/strategy-v121/account/adapters/okxAccountAdapter.test.ts`（已有）
- `lib/strategy-v121/account/adapters/okxAccountAdapter.ts`（只读参考）

## 任务列表

### submitOrderLeg 全面测试（约 +12 tests）
1. [ ] 正常限价单成功提交
2. [ ] 正常市价单成功提交
3. [ ] 超时场景（safeFetch timeout 参数验证 + 处理）
4. [ ] API 拒绝（HTTP 4xx）
5. [ ] 服务器错误（HTTP 5xx — specific errCode）
6. [ ] 部分成交状态映射
7. [ ] 完全成交状态映射
8. [ ] 网络错误（fetch 抛异常）
9. [ ] 限频场景（retry-after header）
10. [ ] dryRun 模式不下真实 HTTP 请求

### fetchOrderByClientOrderId 全面测试（约 +6 tests）
11. [ ] 正常返回 + 状态映射（live/filled）
12. [ ] 未找到（返回 null/空）
13. [ ] API 错误
14. [ ] 已取消状态映射
15. [ ] 部分成交状态映射
16. [ ] 超时

### transferInternal 全面测试（约 +8 tests）
17. [ ] 统一账户 spot→perp 成功
18. [ ] 子账户转账
19. [ ] 超时
20. [ ] API 拒绝
21. [ ] 已存在相同 idempotencyKey（幂等性）
22. [ ] 金额小数精度处理

### validateOrderPlan 全面测试（约 +8 tests）
23. [ ] 杠杆检查（perp leverage > max）
24. [ ] 划转检查（余额不足）
25. [ ] 现货检查（买不了最小数量）
26. [ ] 正资金费率检查
27. [ ] price diff 检查（市价单跳过）
28. [ ] 所有检查通过

### healthCheck 全面测试（约 +4 tests）
29. [ ] 正常（HTTP 200 + 数据新鲜）
30. [ ] HTTP 异常
31. [ ] 数据过时
32. [ ] 非预期响应格式

## 质量标准
- 所有 vitest 测试通过
- 不修改 adapter 实现代码（只改测试文件）
- 不增加对 real API 的依赖（纯 mock 测试）
- tsc 零错误

## 确认门禁
- [ ] CI 全绿（57 files / 555+ tests）
