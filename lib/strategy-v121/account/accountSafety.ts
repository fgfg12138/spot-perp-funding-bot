/**
 * SHADOW 模式安全门 — 禁止所有账户修改动作。
 *
 * 任何 order / cancel / modify / leverage / transfer 相关函数，
 * 在 SHADOW 模式下必须直接拒绝。
 */

const SHADOW_ERROR = "SHADOW 模式只允许读取账户，不允许修改账户或下单。";

export function assertNotShadow(mode: string, action: string): void {
  if (mode === "SHADOW") {
    throw new Error(`${SHADOW_ERROR} (操作: ${action})`);
  }
}

export function isActionBlockedInShadow(
  mode: string,
  action: string
): { blocked: boolean; reason?: string } {
  if (mode !== "SHADOW") return { blocked: false };

  const blockedActions = [
    "order", "cancel", "modify_leverage", "transfer", "withdraw", "set_margin_mode",
  ];
  if (blockedActions.includes(action)) {
    return { blocked: true, reason: SHADOW_ERROR };
  }
  return { blocked: false };
}
