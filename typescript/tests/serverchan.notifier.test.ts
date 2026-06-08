import { describe, expect, it } from "vitest";
import { formatServerChanMessage } from "../src/core/notifier/serverchan.notifier.js";

describe("serverchan notifier", () => {
  it("formats autoticket messages for ServerChan", () => {
    const payload = formatServerChanMessage("AutoTicket 兑换结束\n用户: u1\n兑换成功", "auto");

    expect(payload.title).toBe("AutoTicket 兑换结束");
    expect(payload.desp).toBe("用户: u1\n兑换成功");
    expect(payload.short).toBe("用户: u1");
    expect(payload.tags).toBe("auto");
  });
});
