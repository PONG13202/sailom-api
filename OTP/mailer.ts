// OTP/mailer.ts
import nodemailer, { Transporter, SentMessageInfo } from "nodemailer";

export async function getTransport(): Promise<Transporter> {
  if (!process.env.SMTP_HOST) {
    const test = await nodemailer.createTestAccount();
    return nodemailer.createTransport({
      host: test.smtp.host,
      port: test.smtp.port,
      secure: test.smtp.secure,
      auth: { user: test.user, pass: test.pass },
    });
  }

  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: Number(process.env.SMTP_PORT) === 465,
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
      : undefined,
  });
}

export async function sendOtpEmail(to: string, code: string): Promise<{
  messageId: string;
  previewUrl: string | null;
}> {
  const from = process.env.OTP_EMAIL_FROM || "SaiLom <no-reply@example.com>";
  const transporter = await getTransport();

  const info = await transporter.sendMail({
    from,
    to,
    subject: "รหัสยืนยันการจอง (OTP)",
    text: `OTP: ${code} (อายุ 5 นาที)`,
    html: `<p>รหัส OTP: <b>${code}</b> (อายุ 5 นาที)</p>`,
  });

  // ถ้าเป็น Ethereal จะมีลิงก์ preview
  const preview =
    (nodemailer.getTestMessageUrl &&
      (nodemailer.getTestMessageUrl(info as SentMessageInfo) || null)) ||
    null;

  return { messageId: info.messageId as string, previewUrl: preview };
}
