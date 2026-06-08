import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { redactSensitive, redactText, redactUserForDisplay } from "../src/core/utils/redaction.js";
import { TaskStateRepository } from "../src/core/state/task-state.repository.js";

describe("sensitive data redaction", () => {
  it("redacts common sensitive values by key and text pattern", () => {
    const redacted = redactSensitive({
      phone: "13800001234",
      cert_no: "110101199001011234",
      ses_id: "abcdef123456",
      sendKey: "SCT1234567890",
      webhook: "https://oapi.dingtalk.com/robot/send?access_token=token",
      nested: {
        msg: "手机号 13800001234 身份证 110101199001011234"
      }
    });

    expect(redacted.phone).toBe("138****1234");
    expect(redacted.cert_no).toBe("110***********1234");
    expect(redacted.ses_id).toBe("ab****56");
    expect(redacted.sendKey).toContain("****");
    expect(redacted.webhook).toContain("****");
    expect(redacted.nested.msg).toContain("138****1234");
    expect(redacted.nested.msg).toContain("110***********1234");
  });

  it("redacts users for display without exposing sessions", () => {
    const user = redactUserForDisplay({
      id: "13800001234",
      name: "110101199001011234",
      loginName: "13800001234",
      sesId: "session"
    });

    expect(user.id).toBe("138****1234");
    expect(user.name).toBe("110***********1234");
    expect(user.loginName).toBe("138****1234");
    expect("sesId" in user).toBe(false);
    expect(user.hasSession).toBe(true);
  });

  it("rewrites existing state files with redacted summaries", async () => {
    const dir = await mkdtemp(join(tmpdir(), "autoticket-redaction-"));
    try {
      const path = join(dir, "state.json");
      await writeFile(path, JSON.stringify({
        runs: [{
          id: "r1",
          date: "2026-06-04",
          userId: "user1",
          task: "daily",
          status: "success",
          startedAt: "2026-06-04T00:00:00.000Z",
          finishedAt: "2026-06-04T00:00:01.000Z",
          message: "手机号 13800001234",
          summary: {
            raw: {
              mobile: "13800001234",
              cert_no: "110101199001011234"
            }
          }
        }],
        dailyRandomTimes: []
      }), "utf8");

      await new TaskStateRepository(path).load();
      const text = await readFile(path, "utf8");
      expect(text).not.toContain("13800001234");
      expect(text).not.toContain("110101199001011234");
      expect(text).toContain("138****1234");
      expect(text).toContain("110***********1234");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("redacts sensitive numbers embedded in plain text", () => {
    expect(redactText("联系 13800001234")).toBe("联系 138****1234");
  });
});
