import { describe, expect, it } from "vitest";
import {
  buildSendMessageBody,
  extractBotUpdate,
  getUpdateId,
  toChatId
} from "../src/core/bot/provider/serverchan/serverchan-bot.client.js";

describe("serverchan bot payload helpers", () => {
  it("reads update_id (number or numeric string)", () => {
    expect(getUpdateId({ update_id: 3 })).toBe(3);
    expect(getUpdateId({ update_id: "7" })).toBe(7);
    expect(getUpdateId({})).toBeNull();
    expect(getUpdateId(null)).toBeNull();
    expect(getUpdateId({ update_id: "abc" })).toBeNull();
  });

  it("extracts a text message", () => {
    const message = extractBotUpdate({
      update_id: 3,
      message: { message_id: 10, chat_id: 1, text: "状态" }
    });
    expect(message?.text).toBe("状态");
    expect(message?.chatId).toBe(1);
    expect(message?.updateId).toBe(3);
  });

  it("returns null when there is no text (e.g. sticker) so offset still advances via getUpdateId", () => {
    expect(extractBotUpdate({ update_id: 5, message: { chat_id: 1 } })).toBeNull();
    expect(extractBotUpdate({ update_id: 5 })).toBeNull();
    expect(extractBotUpdate({ message: { text: "hi" } })).toBeNull();
  });

  it("builds sendMessage body with numeric chat_id for numeric uid", () => {
    const body = buildSendMessageBody("12345", "hello");
    expect(body.chat_id).toBe(12345);
    expect(body.text).toBe("hello");
    expect(body.silent).toBe(false);
  });

  it("keeps non-numeric uid as string chat_id", () => {
    expect(toChatId("12345")).toBe(12345);
    expect(toChatId("abc")).toBe("abc");
    expect(buildSendMessageBody("abc", "hi").chat_id).toBe("abc");
  });
});
