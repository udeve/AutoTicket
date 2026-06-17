import { describe, expect, it } from "vitest";
import {
  buildBotAck,
  buildResponse,
  computeBackoffMs,
  extractStreamPayload,
  parseFrame
} from "../src/core/bot/provider/dingtalk/dingtalk-stream.client.js";

const sampleData = {
  conversationId: "cidAsXSBLnA==",
  msgId: "msgLICYeHgY4JtMQw==",
  senderNick: "用户",
  senderStaffId: "16650698",
  sessionWebhook: "https://oapi.dingtalk.com/robot/sendBySession?session=76da36b48f59e8",
  text: { content: " 测试数据" },
  conversationType: "2",
  msgtype: "text"
};

const callbackFrame = {
  specVersion: "1.0",
  type: "CALLBACK",
  headers: { topic: "/v1.0/im/bot/messages/get", messageId: "212ca9d7_974_1898c159aa6_1783b", contentType: "application/json" },
  data: JSON.stringify(sampleData)
};

describe("dingtalk stream payload helpers", () => {
  it("parses an inbound CALLBACK frame", () => {
    const frame = parseFrame(JSON.stringify(callbackFrame));
    expect(frame?.type).toBe("CALLBACK");
    expect(frame?.headers?.topic).toBe("/v1.0/im/bot/messages/get");
  });

  it("returns null for non-string or invalid json", () => {
    expect(parseFrame(123)).toBeNull();
    expect(parseFrame("not json")).toBeNull();
  });

  it("extracts normalized payload from data object", () => {
    const payload = extractStreamPayload(sampleData);
    expect(payload?.text).toBe("测试数据"); // 去掉 @ 残留的左空格
    expect(payload?.senderId).toBe("16650698");
    expect(payload?.sessionWebhook).toContain("session=");
    expect(payload?.msgId).toBe("msgLICYeHgY4JtMQw==");
  });

  it("extracts payload from stringified data", () => {
    expect(extractStreamPayload(JSON.stringify(sampleData))?.senderId).toBe("16650698");
  });

  it("returns null when required fields missing", () => {
    expect(extractStreamPayload({ text: { content: "hi" } })).toBeNull();
    expect(extractStreamPayload(null)).toBeNull();
    expect(extractStreamPayload("not json")).toBeNull();
  });

  it("builds a 200 response echoing messageId and data", () => {
    const res = JSON.parse(buildResponse("msg-1", '{"opaque":"abc"}'));
    expect(res.code).toBe(200);
    expect(res.message).toBe("OK");
    expect(res.headers.messageId).toBe("msg-1");
    expect(res.headers.contentType).toBe("application/json");
    expect(res.data).toBe('{"opaque":"abc"}');
  });

  it("builds a bot ack with fixed null response payload", () => {
    const res = JSON.parse(buildBotAck("msg-2"));
    expect(res.code).toBe(200);
    expect(res.headers.messageId).toBe("msg-2");
    expect(JSON.parse(res.data)).toEqual({ response: null });
  });

  it("computeBackoffMs grows exponentially and caps at the max", () => {
    expect(computeBackoffMs(0)).toBe(2_000);
    expect(computeBackoffMs(1)).toBe(4_000);
    expect(computeBackoffMs(2)).toBe(8_000);
    expect(computeBackoffMs(50)).toBeLessThanOrEqual(60_000);
  });
});
