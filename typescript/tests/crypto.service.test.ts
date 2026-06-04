import { describe, expect, it } from "vitest";
import { buildEncryptedPayload, des3EcbPkcs7Encrypt, md5Hash, sha1Hash } from "../src/core/crypto/crypto.service.js";

describe("crypto service", () => {
  it("encrypts DESede ECB payloads deterministically for a fixed key", () => {
    expect(des3EcbPkcs7Encrypt("ABCDEFGHIJKLMNOPQRSTUVWX", "hello")).toBe("C5i3egrhOxY=");
  });

  it("hash helpers match Node-compatible output", () => {
    expect(md5Hash("abc")).toBe("900150983cd24fb0d6963f7d28e17f72");
    expect(sha1Hash("abc")).toBe("a9993e364706816aba3e25717850c26c9cd0d89d");
  });

  it("builds encrypted app payload with required metadata", () => {
    const encrypted = buildEncryptedPayload({
      channel: "02",
      app_ver_no: "3.1.7",
      timestamp: "1",
      login_name: "user",
      ses_id: "session"
    });
    const parsed = JSON.parse(encrypted) as Record<string, unknown>;
    expect(parsed.dec_key).toEqual(expect.any(String));
    expect(parsed.key).toEqual(expect.any(String));
    expect(parsed.sign).toEqual(expect.any(String));
    expect(parsed.login_name).not.toBe("user");
    expect(parsed.ses_id).toBe("session");
  });
});
