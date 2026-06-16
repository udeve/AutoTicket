import { describe, expect, it } from "vitest";
import {
  buildAckFrame,
  buildPingFrame,
  buildRegisterFrame,
  computeBackoffMs,
  extractStreamPayload,
  parseFrame
} from "../src/core/bot/provider/dingtalk/dingtalk-stream.client.js";

const sampleData = {
  msgId: "msg1",
  senderStaffId: "staff001",
  senderNick: "Alice",
  conversationId: "cid",
  sessionWebhook: "https://oapi.dingtalk.com/robot/sendBySession?session=xxx",
  text: { content: "状态" }
};

describe("dingtalk stream payload helpers", () => {
  it("parses a data frame", () => {
    const frame = parseFrame(
      JSON.stringify({
        code: 200,
        headers: { topic: "/v1.0/im/bot/messages/get", messageId: "m1" },
        data: JSON.stringify(sampleData)
      })
    );
    expect(frame?.code).toBe(200);
  });

  it("returns null for non-string or invalid json", () => {
    expect(parseFrame(123)).toBeNull();
    expect(parseFrame("not json")).toBeNull();
  });

  it("extracts normalized payload from data object", () => {
    const payload = extractStreamPayload(sampleData);
    expect(payload?.text).toBe("状态");
    expect(payload?.senderId).toBe("staff001");
    expect(payload?.senderNick).toBe("Alice");
    expect(payload?.sessionWebhook).toContain("session=xxx");
    expect(payload?.msgId).toBe("msg1");
  });

  it("extracts payload from stringified data", () => {
    expect(extractStreamPayload(JSON.stringify(sampleData))?.senderId).toBe("staff001");
  });

  it("returns null when required fields missing", () => {
    expect(extractStreamPayload({ text: { content: "hi" } })).toBeNull();
    expect(extractStreamPayload(null)).toBeNull();
    expect(extractStreamPayload("not json")).toBeNull();
  });

  it("strips a leading @-mention token", () => {
    const payload = extractStreamPayload({ ...sampleData, text: { content: "@robot 状态" } });
    expect(payload?.text).toBe("状态");
  });

  it("builds frames with expected codes", () => {
    expect(JSON.parse(buildRegisterFrame("cid", "ticket")).code).toBe(1000);
    expect(JSON.parse(buildPingFrame()).code).toBe(1001);
    const ack = JSON.parse(buildAckFrame("mid"));
    expect(ack.code).toBe(1000);
    expect(ack.headers.messageId).toBe("mid");
    expect(ack.data).toBe("SUCCESS");
  });

  it("computeBackoffMs grows exponentially and caps at the max", () => {
    expect(computeBackoffMs(0)).toBe(2_000);
    expect(computeBackoffMs(1)).toBe(4_000);
    expect(computeBackoffMs(2)).toBe(8_000);
    expect(computeBackoffMs(50)).toBeLessThanOrEqual(60_000);
  });
});
