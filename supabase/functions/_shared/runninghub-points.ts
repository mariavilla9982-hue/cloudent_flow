// Provider amounts are distinct units. Never derive charges from wallet deltas.
export function amount(value: unknown): number | null {
  if (typeof value !== 'number' && (typeof value !== 'string' || !/^\d+(\.\d+)?$/.test(value.trim()))) return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}
export function accountAmounts(data: any) {
  return { points: amount(data?.remainPoint ?? data?.remainPoints), coins: amount(data?.remainCoins),
    money: amount(data?.remainMoney), currency: /^[A-Z]{3}$/.test(data?.currency) ? data.currency : null };
}
export function taskAmounts(result: any, taskId: string) {
  // V2 parent usage already totals the task. Output nodes and taskUsageList
  // repeat it; adding them would bill the 24/30 fps variants twice.
  if (String(result?.taskId ?? '') !== taskId) return null;
  const status = String(result.status ?? '').toUpperCase();
  if (!['SUCCESS', 'FAILED', 'CANCELED', 'CANCELLED'].includes(status)) return null;
  const usage = result.usage;
  const points = amount(usage?.chargedPoint ?? usage?.consumePoints);
  const coins = amount(usage?.consumeCoins);
  const money = amount(usage?.consumeMoney);
  const thirdPartyMoney = amount(usage?.thirdPartyConsumeMoney);
  const mode = String(usage?.settleMode ?? '').toUpperCase();
  const settled = mode === 'POINT' ? points !== null : points !== null || coins !== null || money !== null;
  return { provider_status: status, points, coins, money, third_party_money: thirdPartyMoney, settled };
}
