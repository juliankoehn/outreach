import { describe, it, expect, vi } from "vitest";
import { sendEmail } from "./mailer.js";

describe("sendEmail", () => {
  it("sends via the injected transport", async () => {
    const sendMail = vi.fn(async () => ({ messageId: "1" }));
    await sendEmail({ to: "a@b.com", subject: "Hi", text: "yo" }, { transport: { sendMail } as never });
    expect(sendMail).toHaveBeenCalledOnce();
    const calls = sendMail.mock.calls as typeof sendMail.mock.calls & { 0: unknown[] };
    expect(calls[0][0]).toMatchObject({ to: "a@b.com", subject: "Hi" });
  });

  it("logs instead of throwing when no transport and SMTP is unconfigured", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await expect(sendEmail({ to: "a@b.com", subject: "Invite", text: "link: https://x/y" })).resolves.toBeUndefined();
    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });
});
