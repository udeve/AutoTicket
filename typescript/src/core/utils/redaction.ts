const SENSITIVE_KEY_PATTERNS = [
  /(^|_)(ses|session)_?id$/i,
  /^token$/i,
  /access_?token/i,
  /secret/i,
  /password/i,
  /passwd/i,
  /webhook/i,
  /cert_?no/i,
  /id_?no/i,
  /id_?card/i,
  /card_?no/i,
  /bank_?card/i,
  /mobile/i,
  /phone/i,
  /login_?name/i
];

const PHONE_PATTERN = /(?<!\d)1[3-9]\d{9}(?!\d)/g;
const ID_CARD_PATTERN = /(?<![0-9A-Za-z])\d{6}(?:19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{3}[\dXx](?![0-9A-Za-z])/g;
const LONG_DIGIT_PATTERN = /(?<!\d)\d{13,19}(?!\d)/g;

export function redactSensitive<T>(value: T): T {
  return redactValue(value, undefined) as T;
}

export function redactText(text: string): string {
  return text
    .replace(ID_CARD_PATTERN, maskIdCard)
    .replace(PHONE_PATTERN, maskPhone)
    .replace(LONG_DIGIT_PATTERN, maskLongNumber);
}

export function redactUserForDisplay<T extends { id: string; name?: string; loginName?: string; userId?: string; sesId?: string }>(user: T): Omit<T, "sesId"> & { hasSession?: boolean } {
  const { sesId, ...rest } = user;
  return {
    ...rest,
    id: redactText(user.id),
    name: user.name ? redactText(user.name) : user.name,
    loginName: user.loginName ? redactText(maskByKey("loginName", user.loginName)) : user.loginName,
    userId: user.userId ? redactText(maskByKey("userId", user.userId)) : user.userId,
    hasSession: Boolean(sesId)
  };
}

function redactValue(value: unknown, key: string | undefined): unknown {
  if (typeof value === "string") {
    return key && isSensitiveKey(key) ? maskByKey(key, value) : redactText(value);
  }
  if (Array.isArray(value)) return value.map((item) => redactValue(item, key));
  if (typeof value !== "object" || value === null) return value;

  const result: Record<string, unknown> = {};
  for (const [childKey, childValue] of Object.entries(value)) {
    result[childKey] = redactValue(childValue, childKey);
  }
  return result;
}

function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY_PATTERNS.some((pattern) => pattern.test(key));
}

function maskByKey(key: string, value: string): string {
  if (!value) return value;
  if (/secret|password|passwd|token|webhook|ses|session/i.test(key)) return maskSecret(value);
  if (/cert|id_?no|id_?card/i.test(key)) return maskIdCard(value);
  if (/mobile|phone|login_?name/i.test(key)) return maskContact(value);
  if (/card/i.test(key)) return maskLongNumber(value);
  return redactText(value);
}

function maskPhone(value: string): string {
  return value.replace(/^(\d{3})\d{4}(\d{4})$/, "$1****$2");
}

function maskIdCard(value: string): string {
  if (value.length < 8) return maskSecret(value);
  return `${value.slice(0, 3)}***********${value.slice(-4)}`;
}

function maskLongNumber(value: string): string {
  if (value.length <= 8) return maskSecret(value);
  return `${value.slice(0, 4)}****${value.slice(-4)}`;
}

function maskSecret(value: string): string {
  if (value.length <= 4) return "****";
  return `${value.slice(0, 2)}****${value.slice(-2)}`;
}

function maskContact(value: string): string {
  const redacted = redactText(value);
  return redacted === value ? maskSecret(value) : redacted;
}
