"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendConfirmEmail = sendConfirmEmail;
const nodemailer_1 = __importDefault(require("nodemailer"));
const mailer_1 = require("./mailer");
function sendConfirmEmail(to, reservation, order) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
        const from = process.env.OTP_EMAIL_FROM || "SaiLom <no-reply@example.com>";
        const transporter = yield (0, mailer_1.getTransport)();
        try {
            yield transporter.verify();
            console.log("[SMTP] verified ok (confirm email)");
        }
        catch (e) {
            console.error("[SMTP] verify failed (confirm email):", (e === null || e === void 0 ? void 0 : e.message) || e);
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
      เวลา: ${start.toLocaleTimeString("th-TH")} - ${(end === null || end === void 0 ? void 0 : end.toLocaleTimeString("th-TH")) || ""}
    </p>

    ${order && ((_a = order.items) === null || _a === void 0 ? void 0 : _a.length)
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
                .map((it) => `
                <tr>
                  <td>${it.name}</td>
                  <td align="center">${it.qty}</td>
                  <td align="right">${Number(it.price).toLocaleString("th-TH")} บาท</td>
                  <td align="right">${(Number(it.price) * Number(it.qty)).toLocaleString("th-TH")} บาท</td>
                </tr>
              `)
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
            : "<p><b>ไม่มีการสั่งอาหารล่วงหน้า</b></p>"}

    <p>🙏 ขอบคุณที่ใช้บริการ <b>SaiLom Hotel</b></p>
  `;
        console.log("[ConfirmEmail] ready to send to:", to);
        let info;
        try {
            info = yield transporter.sendMail({
                from,
                to,
                subject: "ยืนยันการจองโต๊ะอาหาร",
                html,
            });
        }
        catch (err) {
            console.error("[MAIL] sendMail error:", (err === null || err === void 0 ? void 0 : err.message) || err);
            throw err;
        }
        const preview = (nodemailer_1.default.getTestMessageUrl &&
            (nodemailer_1.default.getTestMessageUrl(info) || null)) || null;
        console.log("📧 [ConfirmEmail] Message sent:", info.messageId);
        if (preview)
            console.log("📧 [ConfirmEmail] Preview URL:", preview);
        return { messageId: info.messageId, previewUrl: preview };
    });
}
