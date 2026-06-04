export function nowTs(): string {
  return String(Date.now());
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function parseTodayTime(timeText: string, now = new Date()): Date {
  const match = /^(\d{1,2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?$/.exec(timeText.trim());
  if (!match) {
    throw new Error(`Invalid time format: ${timeText}. Expected HH:mm:ss`);
  }

  const [, h, m, s, ms = "0"] = match;
  const date = new Date(now);
  date.setHours(Number(h), Number(m), Number(s), Number(ms.padEnd(3, "0")));
  return date;
}

export async function waitUntil(target: Date): Promise<void> {
  while (true) {
    const remaining = target.getTime() - Date.now();
    if (remaining <= 0) return;
    await sleep(Math.min(remaining, remaining > 1000 ? 250 : 10));
  }
}
