export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export type PayloadValue = string | number | boolean | null | string[] | number[] | Record<string, unknown>;
export type RequestPayload = Record<string, PayloadValue>;

export interface SessionUser {
  id: string;
  loginName: string;
  userId?: string;
  sesId: string;
  name?: string;
}

export interface ApiEnvelope {
  result?: string;
  msg?: string;
  data2?: string;
  [key: string]: unknown;
}

export interface ParsedApiResponse<T = unknown> {
  envelope: ApiEnvelope;
  data?: T;
  rawData2?: string;
  statusCode: number;
  timings: {
    requestMs: number;
    decryptMs: number;
    totalMs: number;
  };
}

export interface ExchangeOptions {
  user: SessionUser;
  exchangeId: string;
}

export interface ExchangeSchedulerOptions extends ExchangeOptions {
  startAt?: string;
  concurrency: number;
  intervalMs: number;
  intervalMaxMs?: number;
  maxAttempts: number;
  requestTimeoutMs?: number;
  stopRules: ExchangeStopRule[];
  onAttempt?: (result: ExchangeAttemptResult) => void;
}

export interface ExchangeStopRule {
  match: string;
  status: "success" | "failure";
}

export interface AttemptTiming {
  attempt: number;
  encryptMs: number;
  requestMs: number;
  decryptMs: number;
  totalMs: number;
}

export interface ExchangeAttemptResult<T = unknown> {
  attempt: number;
  statusCode: number;
  data?: T;
  msg?: string;
  finalStatus?: "success" | "failure";
  isFinal: boolean;
  isError: boolean;
  error?: string;
  timing: AttemptTiming;
}
