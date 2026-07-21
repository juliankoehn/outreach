import nodemailer, { type Transporter } from "nodemailer";
import { env } from "./env.js";

export interface EmailMessage {
  to: string;
  subject: string;
  html?: string;
  text?: string;
}

let cached: Transporter | null = null;
function defaultTransport(): Transporter | null {
  if (!env.SMTP_HOST) return null;
  if (!cached) {
    cached = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT ?? 587,
      secure: env.SMTP_SECURE,
      auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
    });
  }
  return cached;
}

// Send an email. With no configured SMTP (and no injected transport) it logs the
// message instead of throwing, so dev without a mailer keeps working.
export async function sendEmail(msg: EmailMessage, deps?: { transport?: Transporter }): Promise<void> {
  const transport = deps?.transport ?? defaultTransport();
  if (!transport) {
    console.log(`[mailer:log-only] to=${msg.to} subject=${msg.subject}\n${msg.text ?? msg.html ?? ""}`);
    return;
  }
  await transport.sendMail({ from: env.SMTP_FROM, to: msg.to, subject: msg.subject, html: msg.html, text: msg.text });
}
