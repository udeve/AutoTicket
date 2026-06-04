import { createCipheriv, createDecipheriv, createHash, createSign, privateDecrypt, publicEncrypt, constants as cryptoConstants } from "node:crypto";
import type { RequestPayload } from "../types.js";
import {
  APP_PUBLIC_KEY_BASE64,
  RANDOM_CHARS,
  RESPONSE_PRIVATE_KEY_PEM,
  SIGN_PRIVATE_KEY_PEM,
  ZHGH_PUBLIC_KEY_BASE64,
  publicKeyPem
} from "./keys.js";

const SENSITIVE_FIELDS = new Set([
  "login_name",
  "login_auth_code",
  "auth_code",
  "pwd",
  "password",
  "newpwd",
  "amt",
  "tr_amt",
  "sms_code",
  "total_amount",
  "account_no",
  "mob_data",
  "order_amt",
  "before_amt",
  "txn_amt",
  "tel",
  "mobile",
  "new_mobile",
  "code",
  "cert_no",
  "card_no",
  "reserve_mobile",
  "reply_tel",
  "card_bal",
  "bank_card_no",
  "car_no",
  "user_id",
  "invite_code",
  "imgAuthCode",
  "imgUniCode"
]);

const EXCLUDE_SIGN_FIELDS = new Set([
  "content",
  "link_url",
  "url",
  "pic_cont",
  "advice_img1",
  "advice_img2",
  "advice_img3",
  "photo_one",
  "photo_two",
  "photo_three",
  "book_img",
  "pimge"
]);

const ZHGH_BASE_URL = "https://zhgh.hzgh.org/";
const ZHGH_SIGN_SALT = "qwerqaz.-*";
const APP_SIGN_SALT = "zSw3MLRV7VuwT!*G";
const RESPONSE_DESEDE_KEY_PREFIX = Buffer.from("HTt0Hzsu", "utf8");

export function randStr(length = 24): string {
  let result = "";
  for (let i = 0; i < length; i += 1) {
    result += RANDOM_CHARS[Math.floor(Math.random() * RANDOM_CHARS.length)];
  }
  return result.toUpperCase();
}

export function des3EcbPkcs7Encrypt(key24: string, plaintext: string): string {
  const key = Buffer.from(key24, "utf8");
  if (key.length !== 24) {
    throw new Error("DESede key must be 24 bytes");
  }

  const cipher = createCipheriv("des-ede3-ecb", key, null);
  cipher.setAutoPadding(false);

  const blockSize = 8;
  const data = Buffer.from(plaintext, "utf8");
  const padding = blockSize - (data.length % blockSize);
  const padded = Buffer.concat([data, Buffer.alloc(padding, padding)]);
  return Buffer.concat([cipher.update(padded), cipher.final()]).toString("base64");
}

export function rsaEncryptSessionKey(sessionKey: string, useZhghKey = false): string {
  const key = publicKeyPem(useZhghKey ? ZHGH_PUBLIC_KEY_BASE64 : APP_PUBLIC_KEY_BASE64);
  return publicEncrypt(
    {
      key,
      padding: cryptoConstants.RSA_PKCS1_PADDING
    },
    Buffer.from(sessionKey, "utf8")
  ).toString("base64");
}

export function md5Hash(text: string): string {
  return createHash("md5").update(text, "utf8").digest("hex");
}

export function sha1Hash(text: string): string {
  return createHash("sha1").update(text, "utf8").digest("hex");
}

export function rsaSha256Sign(message: string): string {
  const signer = createSign("RSA-SHA256");
  signer.update(message, "utf8");
  return signer.sign(SIGN_PRIVATE_KEY_PEM, "base64");
}

export function buildEncryptedPayload(payload: RequestPayload, baseUrl = ""): string {
  return baseUrl.startsWith(ZHGH_BASE_URL) ? encryptZhghBranch(payload) : encryptAppBranch(payload);
}

function encryptSensitiveFields(payload: Record<string, unknown>, sessionKey: string): void {
  for (const field of SENSITIVE_FIELDS) {
    const value = payload[field];
    if (typeof value === "string") {
      payload[field] = des3EcbPkcs7Encrypt(sessionKey, value);
    }
  }
}

function encryptZhghBranch(payload: RequestPayload): string {
  const finalPayload: Record<string, unknown> = { ...payload };
  const sessionKey = randStr();
  finalPayload.dec_key = rsaEncryptSessionKey(sessionKey, true);
  encryptSensitiveFields(finalPayload, sessionKey);

  const keyParts: string[] = [];
  const valueParts: string[] = [];
  for (const key of Object.keys(finalPayload).sort()) {
    const value = finalPayload[key];
    if (Array.isArray(value)) continue;
    keyParts.push(key);
    valueParts.push(String(value));
  }

  const sign = sha1Hash(md5Hash(`${valueParts.join("")}${ZHGH_SIGN_SALT}`.toUpperCase()).toUpperCase()).toUpperCase();
  finalPayload.key = keyParts.join(",");
  finalPayload.sign = sign;
  return JSON.stringify(finalPayload);
}

function encryptAppBranch(payload: RequestPayload): string {
  const finalPayload: Record<string, unknown> = { ...payload };
  const sessionKey = randStr();
  finalPayload.dec_key = rsaEncryptSessionKey(sessionKey, false);
  encryptSensitiveFields(finalPayload, sessionKey);

  const keyParts: string[] = [];
  const valueParts: string[] = [];
  for (const key of Object.keys(finalPayload).sort()) {
    const value = finalPayload[key];
    if (EXCLUDE_SIGN_FIELDS.has(key) || Array.isArray(value)) continue;
    keyParts.push(key);
    valueParts.push(String(value));
  }

  finalPayload.key = keyParts.join(",");
  finalPayload.sign = rsaSha256Sign(`${valueParts.join("")}${APP_SIGN_SALT}`);
  return JSON.stringify(finalPayload);
}

export function decryptData2(data2: string): string {
  if (data2.length < 172) {
    throw new Error("data2 is too short to contain RSA key material");
  }

  const encryptedMaterial = Buffer.from(data2.slice(0, 172), "base64");
  const material = privateDecrypt(
    {
      key: RESPONSE_PRIVATE_KEY_PEM,
      padding: cryptoConstants.RSA_PKCS1_PADDING
    },
    encryptedMaterial
  ).toString("utf8");

  const encryptedData = Buffer.from(data2.slice(172), "base64");
  const key = Buffer.concat([RESPONSE_DESEDE_KEY_PREFIX, Buffer.from(material, "utf8")]).subarray(0, 24);
  const iv = Buffer.from(material.slice(0, 8), "utf8");

  if (key.length !== 24) {
    throw new Error(`DESede response key length must be 24 bytes, got ${key.length}`);
  }
  if (iv.length !== 8) {
    throw new Error(`DESede response IV length must be 8 bytes, got ${iv.length}`);
  }

  const decipher = createDecipheriv("des-ede3-cbc", key, iv);
  decipher.setAutoPadding(true);
  return Buffer.concat([decipher.update(encryptedData), decipher.final()]).toString("utf8");
}

export function parseData2<T = unknown>(data2: string): T {
  const plain = decryptData2(data2);
  return JSON.parse(plain) as T;
}

export function isSlowResponse(data: { result?: unknown; msg?: unknown; trcode?: unknown }): boolean {
  return data.result === "999992" && typeof data.msg === "string" && data.msg.includes("手慢") && data.trcode === "OL41";
}
