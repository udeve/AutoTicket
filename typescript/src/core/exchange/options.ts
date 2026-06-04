export interface ExchangeAmountOption {
  id: string;
  label: string;
}

export interface ExchangeStartTimeOption {
  value: string;
  label: string;
}

export const EXCHANGE_AMOUNT_OPTIONS: ExchangeAmountOption[] = [
  { id: "9", label: "2元" },
  { id: "10", label: "4元" },
  { id: "11", label: "6元" }
];

export const EXCHANGE_START_TIME_OPTIONS: ExchangeStartTimeOption[] = [
  { value: "07:00:00", label: "07:00" },
  { value: "11:30:00", label: "11:30" },
  { value: "17:00:00", label: "17:00" }
];

export function formatExchangeAmount(exchangeId: string): string {
  return EXCHANGE_AMOUNT_OPTIONS.find((option) => option.id === exchangeId)?.label ?? `未知面额(${exchangeId})`;
}

export function formatExchangeStartTime(startAt: string | undefined): string {
  if (!startAt) return "立即开始";
  return EXCHANGE_START_TIME_OPTIONS.find((option) => normalizeTimeToSecond(option.value) === normalizeTimeToSecond(startAt))?.label ?? normalizeTimeToSecond(startAt);
}

export function normalizeTimeToSecond(time: string): string {
  return time.replace(/\.(\d{1,3})$/, "");
}
