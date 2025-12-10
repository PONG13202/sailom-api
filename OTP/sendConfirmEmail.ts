import nodemailer, { SentMessageInfo } from "nodemailer";
import { getTransport } from "./mailer";

export async function sendConfirmEmail(
  to: string,
  reservation: any,
  order?: any
) {
  const from = process.env.OTP_EMAIL_FROM || "SaiLom <no-reply@example.com>";
  const transporter = await getTransport();

  try {
    await transporter.verify();
    console.log("[SMTP] verified ok (confirm email)");
  } catch (e) {
    console.error("[SMTP] verify failed (confirm email):", (e as any)?.message || e);
  }

  // แปลงวันที่ให้เป็น Date เสมอ
  const start = new Date(reservation.dateStart);
  const end = reservation.dateEnd ? new Date(reservation.dateEnd) : null;

  // ✅ HTML email content
  const html = `
    <h2>ยืนยันการจอง SaiLom Hotel</h2>
    <p>สวัสดีคุณ <b>${reservation.userName || ""}</b>,</p>
    <p>การจองของคุณได้รับการยืนยันแล้ว ✅</p>

    <h3>📌 รายละเอียดการจอง</h3>
    <p>
      โต๊ะ: <b>${reservation.tableLabel}</b><br>
      วันที่: ${start.toLocaleDateString("th-TH")}<br>
      เวลา: ${start.toLocaleTimeString("th-TH")} - ${end?.toLocaleTimeString("th-TH") || ""}
    </p>

    ${
      order && order.items?.length
        ? `
        <h3>🍽 รายการอาหาร</h3>
        <table border="1" cellspacing="0" cellpadding="6" style="border-collapse: collapse; width:100%;">
          <thead style="background:#f0f0f0;">
            <tr>
              <th align="left">เมนู</th>
              <th align="center">จำนวน</th>
              <th align="right">ราคา/หน่วย</th>
              <th align="right">ราคารวม</th>
            </tr>
          </thead>
          <tbody>
            ${order.items
              .map(
                (it: any) => `
                <tr>
                  <td>${it.name}</td>
                  <td align="center">${it.qty}</td>
                  <td align="right">${Number(it.price).toLocaleString("th-TH")} บาท</td>
                  <td align="right">${(Number(it.price) * Number(it.qty)).toLocaleString("th-TH")} บาท</td>
                </tr>
              `
              )
              .join("")}
          </tbody>
          <tfoot>
            <tr>
              <td colspan="3" align="right"><b>รวมทั้งหมด</b></td>
              <td align="right"><b>${order.total.toLocaleString("th-TH")} บาท</b></td>
            </tr>
          </tfoot>
        </table>
        `
        : "<p><b>ไม่มีการสั่งอาหารล่วงหน้า</b></p>"
    }

    <p>🙏 ขอบคุณที่ใช้บริการ <b>SaiLom Hotel</b></p>
  `;

  console.log("[ConfirmEmail] ready to send to:", to);

  let info;
  try {
    info = await transporter.sendMail({
      from,
      to,
      subject: "ยืนยันการจองโต๊ะอาหาร",
      html,
    });
  } catch (err: any) {
    console.error("[MAIL] sendMail error:", err?.message || err);
    throw err;
  }

  const preview =
    (nodemailer.getTestMessageUrl &&
      (nodemailer.getTestMessageUrl(info as SentMessageInfo) || null)) || null;

  console.log("📧 [ConfirmEmail] Message sent:", info.messageId);
  if (preview) console.log("📧 [ConfirmEmail] Preview URL:", preview);

  return { messageId: info.messageId as string, previewUrl: preview };
}
