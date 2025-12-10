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
exports.getTransport = getTransport;
exports.sendOtpEmail = sendOtpEmail;
// OTP/mailer.ts
const nodemailer_1 = __importDefault(require("nodemailer"));
function getTransport() {
    return __awaiter(this, void 0, void 0, function* () {
        if (!process.env.SMTP_HOST) {
            const test = yield nodemailer_1.default.createTestAccount();
            return nodemailer_1.default.createTransport({
                host: test.smtp.host,
                port: test.smtp.port,
                secure: test.smtp.secure,
                auth: { user: test.user, pass: test.pass },
            });
        }
        return nodemailer_1.default.createTransport({
            host: process.env.SMTP_HOST,
            port: Number(process.env.SMTP_PORT || 587),
            secure: Number(process.env.SMTP_PORT) === 465,
            auth: process.env.SMTP_USER
                ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
                : undefined,
        });
    });
}
function sendOtpEmail(to, code) {
    return __awaiter(this, void 0, void 0, function* () {
        const from = process.env.OTP_EMAIL_FROM || "SaiLom <no-reply@example.com>";
        const transporter = yield getTransport();
        // ✅ ชั่วคราวสำหรับดีบัก
        try {
            yield transporter.verify();
            console.log("[SMTP] verified ok");
        }
        catch (e) {
            console.error("[SMTP] verify failed:", (e === null || e === void 0 ? void 0 : e.message) || e);
        }
        const info = yield transporter.sendMail({
            from, to,
            subject: "รหัสยืนยันการจอง (OTP)",
            text: `OTP: ${code} (อายุ 5 นาที)`,
            html: `<p>รหัส OTP: <b>${code}</b> (อายุ 5 นาที)</p>`,
        });
        const preview = (nodemailer_1.default.getTestMessageUrl &&
            (nodemailer_1.default.getTestMessageUrl(info) || null)) || null;
        return { messageId: info.messageId, previewUrl: preview };
    });
}
