export const nowUtc = (): number => Date.now();

export function utcToUtc8(ts: number): string {
  const d = new Date(ts);
  const utc8 = new Date(d.getTime() + 8 * 60 * 60 * 1000);
  return utc8.toISOString().replace("T", " ").replace("Z", "");
}

export function formatUtc(ts: number): string {
  return new Date(ts).toISOString();
}

export function secondsToNextFunding(now: number, nextFundingTime: number): number {
  return Math.max(0, nextFundingTime - now) / 1000;
}
