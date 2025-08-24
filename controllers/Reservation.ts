// api/controllers/Reservation.ts
import { Request, Response } from "express";
import crypto from "crypto";
import { PrismaClient } from "@prisma/client";// ✅ ใช้ singleton
import { sendOtpEmail } from "../OTP/mailer";
import { buildPromptPay } from "../OTP/qr";
const prisma = new PrismaClient();
const hash = (s: string) => crypto.createHash("sha256").update(s).digest("hex");

// กันชนเวลาในโต๊ะเดียวกัน
async function hasOverlap(tableId: number, start: Date, end: Date) {
  const clash = await prisma.reservation.findFirst({
    where: {
      tableId,
      status: {
        in: ["PENDING_OTP", "OTP_VERIFIED", "AWAITING_PAYMENT", "CONFIRMED"],
      },
      dateStart: { lt: end },
      dateEnd: { gt: start },
    },
  });
  return !!clash;
}

export const ReservationController = {
  // สร้างใบจอง (ยังไม่ขอ OTP)
  create: async (req: Request, res: Response) => {
    try {
      const userId = (req as any).user?.user_id;
      if (!userId) return res.status(401).json({ message: "Unauthorized" });

      const {
        tableId,
        date,
        time,
        durationMin = 90,
        people = 1,
        items,
      } = req.body;
      if (!date || !time)
        return res.status(400).json({ message: "date/time required" });

      const start = new Date(`${date}T${time}:00`);
      const end = new Date(start.getTime() + Number(durationMin) * 60_000);

      if (tableId && (await hasOverlap(Number(tableId), start, end))) {
        return res.status(409).json({ message: "ช่วงเวลานี้ถูกจองแล้ว" });
      }

      const hasItems = Array.isArray(items) && items.length > 0;
      const depositAmount = hasItems ? 0 : 100;

      // ถ้าสั่งอาหาร สร้าง Order (ยังไม่จ่าย)
      let orderId: number | null = null;
      let orderTotal = 0;
      if (hasItems) {
        for (const it of items) orderTotal += Number(it.price) * Number(it.qty);
        const order = await prisma.order.create({
          data: {
            userId,
            total: orderTotal,
            status: "PENDING",
            items: {
              create: items.map((it: any) => ({
                menuId: it.id,
                name: it.name,
                price: Number(it.price),
                qty: Number(it.qty),
                note: it.note || null,
                options: it.options ?? null,
              })),
            },
          },
        });
        orderId = order.id;
      }

      const r = await prisma.reservation.create({
        data: {
          userId,
          tableId: tableId ? Number(tableId) : null,
          dateStart: start,
          dateEnd: end,
          people: Number(people) || 1,
          status: "PENDING_OTP",
          depositAmount,
          orderId,
        },
      });

      return res
        .status(201)
        .json({ reservationId: r.id, depositAmount, orderTotal });
    } catch (e: any) {
      console.error(e);
      return res
        .status(500)
        .json({ message: "create reservation error", error: e.message });
    }
  },

  // ขอ OTP ส่งอีเมล
  requestOtp: async (req: Request, res: Response) => {
    try {
      const reservationId = Number(req.params.id);
      const user = await prisma.user.findUnique({
        where: { user_id: (req as any).user?.user_id },
      });
      if (!user?.user_email)
        return res.status(400).json({ message: "no email" });

      const code = String(Math.floor(100000 + Math.random() * 900000));
      const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

      await prisma.otpCode.upsert({
        where: { reservationId },
        update: {
          targetEmail: user.user_email,
          codeHash: hash(code),
          expiresAt,
          attempts: 5,
        },
        create: {
          reservationId,
          targetEmail: user.user_email,
          codeHash: hash(code),
          expiresAt,
        },
      });

      const { previewUrl } = await sendOtpEmail(user.user_email, code);
      return res.json({ ok: true, previewUrl });
    } catch (e: any) {
      console.error(e);
      return res
        .status(500)
        .json({ message: "requestOtp error", error: e.message });
    }
  },

  // ตรวจ OTP → ถ้าต้องจ่าย ออก QR 5 นาที
  verifyOtp: async (req: Request, res: Response) => {
    try {
      const reservationId = Number(req.params.id);
      const { code } = req.body;

      const otp = await prisma.otpCode.findUnique({ where: { reservationId } });
      if (!otp) return res.status(400).json({ message: "OTP not found" });
      if (new Date() > otp.expiresAt)
        return res.status(400).json({ message: "OTP expired" });
      if (otp.attempts <= 0)
        return res.status(400).json({ message: "Too many attempts" });

      const ok = hash(code) === otp.codeHash;
      await prisma.otpCode.update({
        where: { reservationId },
        data: { attempts: Math.max(0, otp.attempts - 1) },
      });
      if (!ok) return res.status(400).json({ message: "Invalid OTP" });

      const r = await prisma.reservation.update({
        where: { id: reservationId },
        data: { status: "OTP_VERIFIED" },
      });

      // ตัดสินใจยอดที่จะชำระ
      let payAmount = 0;
      let orderId = r.orderId ?? null;
      if (orderId) {
        const ord = await prisma.order.findUnique({ where: { id: orderId } });
        payAmount = ord?.total ?? 0;
      } else {
        payAmount = r.depositAmount || 0;
      }

      if (payAmount <= 0) {
        const confirmed = await prisma.reservation.update({
          where: { id: r.id },
          data: { status: "CONFIRMED" },
        });
        return res.json({ ok: true, status: confirmed.status, payment: null });
      }

      const expire = new Date(Date.now() + 5 * 60 * 1000);
      const { payload, dataUrl } = await buildPromptPay(payAmount);

      const payment = await prisma.payment.create({
        data: {
          userId: r.userId,
          amount: payAmount,
          status: "PENDING",
          method: "PROMPTPAY",
          qrPayload: payload,
          qrDataUrl: dataUrl,
          expiresAt: expire,
        },
      });

      if (orderId) {
        await prisma.order.update({
          where: { id: orderId },
          data: { paymentId: payment.id },
        });
      }

      await prisma.reservation.update({
        where: { id: r.id },
        data: {
          status: "AWAITING_PAYMENT",
          paymentId: payment.id,
          paymentExpiresAt: expire,
        },
      });

      return res.json({ ok: true, status: "AWAITING_PAYMENT", payment });
    } catch (e: any) {
      console.error(e);
      return res
        .status(500)
        .json({ message: "verifyOtp error", error: e.message });
    }
  },
};
