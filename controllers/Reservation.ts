import { Request, Response } from "express";
import crypto from "crypto";
import { Prisma, PrismaClient } from "@prisma/client"; // ⬅️ เพิ่ม Prisma เพื่อใช้ TransactionIsolationLevel
import { sendOtpEmail } from "../OTP/mailer";
import { buildPromptPay } from "../OTP/qr";

const prisma = new PrismaClient();
const hash = (s: string) => crypto.createHash("sha256").update(s).digest("hex");

// ===================== Helpers =====================

// กันชนเวลาในโต๊ะเดียวกัน (สำหรับเช็คเบื้องต้นนอกทรานแซกชัน)
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
    select: { id: true },
  });
  return !!clash;
}

// (ออปชัน) กันผู้ใช้คนเดิมจองทับช่วงเวลาเดียวกัน ไม่ว่าโต๊ะไหน
async function hasUserOverlap(userId: number, start: Date, end: Date) {
  const clash = await prisma.reservation.findFirst({
    where: {
      userId,
      status: {
        in: ["PENDING_OTP", "OTP_VERIFIED", "AWAITING_PAYMENT", "CONFIRMED"],
      },
      dateStart: { lt: end },
      dateEnd: { gt: start },
    },
    select: { id: true },
  });
  return !!clash;
}

// ===================== Controller =====================

export const ReservationController = {
  // สร้างใบจอง (ยังไม่ขอ OTP)
// ReservationController.get (แก้เฉพาะส่วนนี้)
get: async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ message: "Invalid id" });

  const row = await prisma.reservation.findUnique({
    where: { id },
    select: {
      id: true,
      userId: true,
      tableId: true,
      dateStart: true,
      dateEnd: true,
      people: true,
      status: true,
      orderId: true,
      paymentId: true,
      // ✅ เลือกฟิลด์ที่มีจริงใน User
      user: {
        select: {
          user_id: true,
          user_name: true,
          user_fname: true,
          user_lname: true,
          user_phone: true,
          user_email: true,
        },
      },
      table: { select: { label: true } },
    },
  });

  if (!row) return res.status(404).json({ message: "Not found" });

  // ✅ map เป็น shape ที่ FE ต้องการ
  const user = row.user
    ? {
        id: row.user.user_id,
        name:
          [row.user.user_fname, row.user.user_lname]
            .filter(Boolean)
            .join(" ")
            .trim() ||
          row.user.user_name ||
          String(row.user.user_id),
        phone: row.user.user_phone ?? null,
        email: row.user.user_email ?? null,
      }
    : null;

  res.json({
    id: row.id,
    userId: row.userId,
    tableId: row.tableId,
    tableLabel: row.table?.label ?? null,
    dateStart: row.dateStart,
    dateEnd: row.dateEnd,
    people: row.people,
    status: row.status,
    orderId: row.orderId ?? null,
    paymentId: row.paymentId ?? null,
    user,
  });
},

  create: async (req: Request, res: Response) => {
    try {
      const userId = Number((req as any).userId);
      if (!userId) return res.status(401).json({ message: "Unauthorized" });

      const {
        tableId,
        date,
        time,
        durationMin = 60,
        people = 1,
        items,
      } = req.body;

      if (!date || !time)
        return res.status(400).json({ message: "date/time required" });

      const start = new Date(`${date}T${time}:00`);
      const end = new Date(start.getTime() + Number(durationMin) * 60_000);

      // เช็คนอกทรานแซกชันแบบเร็ว ๆ (กัน UX ลั่น) — ไม่พอสำหรับกันแข่งจริง
      if (tableId && (await hasOverlap(Number(tableId), start, end))) {
        return res.status(409).json({ message: "ช่วงเวลานี้ถูกจองแล้ว" });
      }
      // (ออปชัน) ถ้าอยากกันผู้ใช้คนเดิมจองช่วงเวลาเดียวกัน
      // if (await hasUserOverlap(userId, start, end)) {
      //   return res.status(409).json({ message: "คุณมีการจองช่วงเวลาเดียวกันอยู่แล้ว" });
      // }

      // ทำให้ชัวร์: ทำในทรานแซกชัน + Serializable เพื่อกันยิงพร้อมกัน
      const result = await prisma.$transaction(async (tx) => {
        // เช็คชนเวลา "ภายใน" ทรานแซกชันอีกครั้ง
        if (
          tableId &&
          (await tx.reservation.findFirst({
            where: {
              tableId: Number(tableId),
              status: {
                in: ["PENDING_OTP", "OTP_VERIFIED", "AWAITING_PAYMENT", "CONFIRMED"],
              },
              dateStart: { lt: end },
              dateEnd: { gt: start },
            },
            select: { id: true },
          }))
        ) {
          throw new Error("TABLE_CLASH");
        }

        // (ออปชัน) กันคนเดิมจองทับช่วงเวลาเดียวกัน
        // if (
        //   await tx.reservation.findFirst({
        //     where: {
        //       userId,
        //       status: { in: ["PENDING_OTP", "OTP_VERIFIED", "AWAITING_PAYMENT", "CONFIRMED"] },
        //       dateStart: { lt: end },
        //       dateEnd: { gt: start },
        //     },
        //     select: { id: true },
        //   })
        // ) {
        //   throw new Error("USER_CLASH");
        // }

        const hasItems = Array.isArray(items) && items.length > 0;
        const depositAmount = hasItems ? 0 : 100;

        // ถ้าสั่งอาหาร สร้าง Order (ยังไม่จ่าย)
        let orderId: number | null = null;
        let orderTotal = 0;

        if (hasItems) {
          for (const it of items) {
            orderTotal += Number(it.price) * Number(it.qty);
          }
          const order = await tx.order.create({
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

        const r = await tx.reservation.create({
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

        return { r, depositAmount, orderTotal };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

      // แจ้ง realtime ให้หน้าเลือกโต๊ะ/ตารางรีเฟรช busy
      req.app.get("io")?.emit("reservation:created", {
        id: result.r.id,
        tableId,
        start,
        end,
      });

      return res
        .status(201)
        .json({ reservationId: result.r.id, depositAmount: result.depositAmount, orderTotal: result.orderTotal });
    } catch (e: any) {
      if (e?.message === "TABLE_CLASH") {
        return res.status(409).json({ message: "ช่วงเวลานี้ถูกจองแล้ว" });
      }
      if (e?.message === "USER_CLASH") {
        return res.status(409).json({ message: "คุณมีการจองช่วงเวลาเดียวกันอยู่แล้ว" });
      }
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
      if (!reservationId) {
        return res.status(400).json({ message: "reservation id required" });
      }

      const currentUserId = Number((req as any).userId);

      // ตรวจว่า reservation เป็นของผู้ใช้คนนี้
      const r = await prisma.reservation.findUnique({ where: { id: reservationId } });
      if (!r || r.userId !== currentUserId) {
        return res.status(404).json({ message: "reservation not found" });
      }

      const user = await prisma.user.findUnique({
        where: { user_id: currentUserId },
      });
      if (!user?.user_email) {
        return res.status(400).json({ message: "no email" });
      }

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
      return res.status(500).json({ message: "requestOtp error", error: e.message });
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

      // แจ้ง realtime ว่ามีการอัปเดต
      req.app.get("io")?.emit("reservation:updated", { id: r.id });

      // ตัดสินใจยอดที่จะชำระ
      let payAmount = 0;
      let orderId = r.orderId ?? null;
      if (orderId) {
        const ord = await prisma.order.findUnique({ where: { id: orderId } });
        payAmount = ord?.total ?? 0;
      } else {
        payAmount = r.depositAmount || 0;
      }

      // ถ้าไม่ต้องจ่ายอะไร → ยืนยันเลย
      if (payAmount <= 0) {
        const confirmed = await prisma.reservation.update({
          where: { id: r.id },
          data: { status: "CONFIRMED" },
        });

        // แจ้ง realtime ให้ busy lock โต๊ะ
        req.app.get("io")?.emit("reservation:confirmed", {
          id: confirmed.id,
          tableId: confirmed.tableId,
          start: confirmed.dateStart,
          end: confirmed.dateEnd,
        });

        return res.json({ ok: true, status: confirmed.status, payment: null });
      }

      // มีการจ่าย → ออก QR พร้อมอายุ 5 นาที
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

      // แจ้ง realtime ให้หน้าตาราง/เลือกโต๊ะรีเฟรช
      req.app.get("io")?.emit("reservation:updated", { id: r.id });

      return res.json({ ok: true, status: "AWAITING_PAYMENT", payment });
    } catch (e: any) {
      console.error(e);
      return res
        .status(500)
        .json({ message: "verifyOtp error", error: e.message });
    }
  },

  // ยกเลิกใบจอง (เฉพาะแอดมิน ตาม route)
  cancel: async (req: Request, res: Response) => {
    try {
      const id = Number(req.params.id);
      const r = await prisma.reservation.findUnique({ where: { id } });
      if (!r) return res.status(404).json({ message: "not found" });

      // ยกเลิกเฉพาะที่ยังไม่คอนเฟิร์ม
      if (r.status === "CONFIRMED") {
        return res.status(400).json({ message: "already confirmed" });
      }

      await prisma.reservation.update({
        where: { id },
        data: { status: "CANCELED" },
      });

      if (r.paymentId) {
        await prisma.payment.update({
          where: { id: r.paymentId },
          data: { status: "CANCELED" },
        });
      }
      if (r.orderId) {
        await prisma.order.update({
          where: { id: r.orderId },
          data: { status: "CANCELED" },
        });
      }

      req.app.get("io")?.emit("reservation:canceled", { id });
      return res.json({ ok: true });
    } catch (e: any) {
      console.error(e);
      return res.status(500).json({ message: "cancel error", error: e.message });
    }
  },
};
