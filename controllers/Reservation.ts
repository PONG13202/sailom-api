// api/controllers/Reservation.ts
import { Request, Response } from "express";
import crypto from "crypto";
import { Prisma, PrismaClient } from "@prisma/client";
import { sendOtpEmail } from "../OTP/mailer";
import { buildPromptPay } from "../OTP/qr";

const prisma = new PrismaClient();
const hash = (s: string) => crypto.createHash("sha256").update(s).digest("hex");

// ===================== Helpers =====================
const DEFAULT_DURATION_MIN = 30;

// ช่วงวันแบบเวลาไทย (+07:00)
function dayRange(dateStr?: string) {
  const tz = "+07:00";
  const d = dateStr ?? new Date().toISOString().slice(0, 10);
  const start = new Date(`${d}T00:00:00${tz}`);
  const end = new Date(`${d}T24:00:00${tz}`);
  return { start, end };
}

function fallbackEnd(startIso: Date | string, end: Date | null) {
  if (end) return end.toISOString();
  const s = new Date(startIso);
  return new Date(s.getTime() + DEFAULT_DURATION_MIN * 60_000).toISOString();
}

function buildUserName(u?: {
  user_name?: string | null;
  user_fname?: string | null;
  user_lname?: string | null;
  user_id?: number | null;
  username?: string | null;
}) {
  if (!u) return "";
  const full = [u.user_fname, u.user_lname].filter(Boolean).join(" ").trim();
  return full || u.user_name || u.username || (u.user_id ? String(u.user_id) : "");
}

// กันชนเวลาโต๊ะเดียวกัน
async function hasOverlap(tableId: number, start: Date, end: Date) {
  const clash = await prisma.reservation.findFirst({
    where: {
      tableId,
      status: { in: ["PENDING_OTP", "OTP_VERIFIED", "AWAITING_PAYMENT", "CONFIRMED"] },
      dateStart: { lt: end },
      dateEnd: { gt: start },
    },
    select: { id: true },
  });
  return !!clash;
}

// ===================== Controller =====================
export const ReservationController = {
  // ---------- LIST (สำหรับ Grid รายวัน): GET /reservation?date=YYYY-MM-DD&includeCanceled=0 ----------
// --- แทนที่ฟังก์ชัน list ทั้งหมดใน controllers/Reservation.ts ---
list: async (req: Request, res: Response) => {
  try {
    const { date, tableId, includeCanceled } = req.query as any;
    const { start, end } = dayRange(date);

    const active = ["PENDING_OTP", "OTP_VERIFIED", "AWAITING_PAYMENT", "CONFIRMED"] as const;
    const whereStatus =
      includeCanceled === "1" ? { not: "EXPIRED" } : { in: active as any };

    // กรอง “รายการที่เริ่มในวันนั้น” เพื่อกันเคส dateEnd เป็น null
    const where: Prisma.ReservationWhereInput = {
      status: whereStatus as any,
      dateStart: { gte: start, lt: end },
      ...(tableId ? { tableId: Number(tableId) } : {}),
    };

    // ใช้ select เพื่อให้ type ชัดเจน และไม่อ้าง relation ที่ schema ไม่มี
    const rows = await prisma.reservation.findMany({
      where,
      select: {
        id: true,
        userId: true,
        tableId: true,
        dateStart: true,
        dateEnd: true,
        people: true,
        status: true,
        depositAmount: true,
        paymentId: true,
        orderId: true,
        user: {
          select: {
            user_id: true,
            user_fname: true,
            user_lname: true,
            user_phone: true,
            user_name: true,     // ✅ ใช้ user_name (ไม่มี username)
            // username: false,   // ❌ อย่าใส่ฟิลด์ที่ไม่มีใน schema
            user_email: true,
          },
        },
        table: { select: { label: true } },
      },
      orderBy: [{ tableId: "asc" }, { dateStart: "asc" }],
    });

    // end อาจว่าง → เติม fallback (+30 นาที) เพื่อให้ FE วาดบล็อกได้
    const DEFAULT_DURATION_MIN = 30;
    const fallbackEnd = (s: Date, e: Date | null) =>
      (e ? e : new Date(s.getTime() + DEFAULT_DURATION_MIN * 60_000)).toISOString();

    const data = rows.map((r) => ({
      id: r.id,
      tableId: r.tableId,
      tableLabel: r.table?.label ?? "-",
      start: r.dateStart.toISOString(),
      end: fallbackEnd(r.dateStart, r.dateEnd),
      people: r.people,
      status: r.status,
      orderId: r.orderId ?? null,        // ✅ ใช้ orderId แทน r.order?.id
      paymentId: r.paymentId ?? null,    // ✅ ใช้ paymentId แทน r.payment?.id
      depositAmount: r.depositAmount ?? 0,
      user: {
        id: r.userId,
        name:
          [r.user?.user_fname, r.user?.user_lname].filter(Boolean).join(" ").trim() ||
          r.user?.user_name ||
          String(r.userId),
        phone: r.user?.user_phone ?? null,
      },
    }));

    return res.json({
      date: date ?? new Date().toISOString().slice(0, 10),
      start: start.toISOString(),
      end: end.toISOString(),
      data,
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ message: "list reservation error" });
  }
},


  // ---------- GET ONE: GET /reservation/:id ----------
  get: async (req: Request, res: Response) => {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ message: "Invalid id" });

    const r = await prisma.reservation.findUnique({
      where: { id },
      include: {
        user: true,
        table: true,
        order: { select: { id: true, status: true } },
        payment: {
          select: { id: true, status: true, amount: true, expiresAt: true, slipImage: true, qrDataUrl: true,qrPayload: true },
        },
      },
    });
    if (!r) return res.status(404).json({ message: "Not found" });

    const anyUser = r.user as any;
    const userName =
      [anyUser?.user_fname, anyUser?.user_lname].filter(Boolean).join(" ").trim() ||
      anyUser?.user_name ||
      anyUser?.username ||
      "";

    return res.json({
      id: r.id,
      userId: r.userId,
      tableId: r.tableId,
      tableLabel: (r as any).table?.label ?? null,
      dateStart: r.dateStart.toISOString(),
      dateEnd: r.dateEnd ? r.dateEnd.toISOString() : null,
      people: r.people,
      status: r.status,
      orderId: r.order?.id ?? null,
      paymentId: r.payment?.id ?? null,
      depositAmount: r.depositAmount ?? 0,
      paymentExpiresAt: r.payment?.expiresAt ? r.payment.expiresAt.toISOString() : null,
      slipImage: r.payment?.slipImage ?? null,
      qrDataUrl: r.payment?.qrDataUrl ?? null,
      qrPayload: r.payment?.qrPayload ?? null,
      user: {
        id: anyUser?.user_id ?? anyUser?.id ?? r.userId,
        name: userName,
        phone: anyUser?.user_phone ?? null,
        email: anyUser?.user_email ?? null,
      },
    });
  },

  // ---------- CREATE: POST /reservations ----------
  create: async (req: Request, res: Response) => {
    try {
      const userId = Number((req as any).userId);
      if (!userId) return res.status(401).json({ message: "Unauthorized" });

      const { tableId: tableIdRaw, date, time, durationMin = 60, people = 1, items } = req.body;

      if (!date || !time) return res.status(400).json({ message: "กรุณาเลือกวันและเวลา" });
      if (!tableIdRaw) return res.status(400).json({ message: "ต้องเลือกโต๊ะก่อนทำการจอง" });

      const tableIdNum = Number(tableIdRaw);
      const start = new Date(`${date}T${time}:00`);
      const end = new Date(start.getTime() + Number(durationMin) * 60_000);

      const hasItems = Array.isArray(items) && items.length > 0;

      if (!hasItems && !(Number.isInteger(tableIdNum) && tableIdNum > 0)) {
        return res.status(400).json({ message: "กรุณาเลือกโต๊ะเมื่อไม่ได้สั่งอาหารล่วงหน้า" });
      }

      if (await hasOverlap(tableIdNum, start, end)) {
        return res.status(409).json({ message: "ช่วงเวลานี้ถูกจองแล้ว" });
      }

      const result = await prisma.$transaction(
        async (tx) => {
          // double-check overlap within tx
          if (
            await tx.reservation.findFirst({
              where: {
                tableId: tableIdNum,
                status: { in: ["PENDING_OTP", "OTP_VERIFIED", "AWAITING_PAYMENT", "CONFIRMED"] },
                dateStart: { lt: end },
                dateEnd: { gt: start },
              },
              select: { id: true },
            })
          ) {
            throw new Error("TABLE_CLASH");
          }

          const depositAmount = hasItems ? 0 : 100;

          // create order if has items
          let orderId: number | null = null;
          let orderTotal = 0;
          if (hasItems) {
            for (const it of items) orderTotal += Number(it.price) * Number(it.qty);
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
              tableId: tableIdNum,
              dateStart: start,
              dateEnd: end,
              people: Number(people) || 1,
              status: "PENDING_OTP",
              depositAmount,
              orderId,
            },
          });

          return { r, depositAmount, orderTotal };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
      );

      // realtime
      req.app.get("io")?.emit("reservation:created", {
        id: result.r.id,
        tableId: result.r.tableId,
        start,
        end,
      });

      return res.status(201).json({
        reservationId: result.r.id,
        depositAmount: result.depositAmount,
        orderTotal: result.orderTotal,
      });
    } catch (e: any) {
      if (e?.message === "TABLE_CLASH") {
        return res.status(409).json({ message: "ช่วงเวลานี้ถูกจองแล้ว" });
      }
      console.error(e);
      return res.status(500).json({ message: "create reservation error", error: e.message });
    }
  },

  // ---------- ขอ OTP ส่งอีเมล ----------
  requestOtp: async (req: Request, res: Response) => {
    try {
      const reservationId = Number(req.params.id);
      if (!reservationId) return res.status(400).json({ message: "reservation id required" });

      const currentUserId = Number((req as any).userId);

      const r = await prisma.reservation.findUnique({ where: { id: reservationId } });
      if (!r || r.userId !== currentUserId) {
        return res.status(404).json({ message: "reservation not found" });
      }

      const user = await prisma.user.findUnique({ where: { user_id: currentUserId } });
      if (!user?.user_email) return res.status(400).json({ message: "no email" });

      const code = String(Math.floor(100000 + Math.random() * 900000));
      const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

      await prisma.otpCode.upsert({
        where: { reservationId },
        update: { targetEmail: user.user_email, codeHash: hash(code), expiresAt, attempts: 5 },
        create: { reservationId, targetEmail: user.user_email, codeHash: hash(code), expiresAt },
      });

      const { previewUrl } = await sendOtpEmail(user.user_email, code);
      return res.json({ ok: true, previewUrl });
    } catch (e: any) {
      console.error(e);
      return res.status(500).json({ message: "requestOtp error", error: e.message });
    }
  },

  // ---------- ตรวจ OTP → ถ้าต้องจ่าย ออก QR 5 นาที ----------
  verifyOtp: async (req: Request, res: Response) => {
    try {
      const reservationId = Number(req.params.id);
      const { code } = req.body;

      const otp = await prisma.otpCode.findUnique({ where: { reservationId } });
      if (!otp) return res.status(400).json({ message: "OTP not found" });
      if (new Date() > otp.expiresAt) return res.status(400).json({ message: "OTP expired" });
      if (otp.attempts <= 0) return res.status(400).json({ message: "Too many attempts" });

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

      // แจ้ง realtime
      req.app.get("io")?.emit("reservation:updated", { id: r.id });

      // ตัดสินใจยอดที่จะชำระ
      let payAmount = 0;
      if (r.orderId) {
        const ord = await prisma.order.findUnique({ where: { id: r.orderId } });
        payAmount = ord?.total ?? 0;
      } else {
        payAmount = r.depositAmount || 0;
      }

      // ไม่ต้องจ่าย → ยืนยันเลย
      if (payAmount <= 0) {
        const confirmed = await prisma.reservation.update({
          where: { id: r.id },
          data: { status: "CONFIRMED" },
        });

        req.app.get("io")?.emit("reservation:confirmed", {
          id: confirmed.id,
          tableId: confirmed.tableId,
          start: confirmed.dateStart,
          end: confirmed.dateEnd,
        });

        return res.json({ ok: true, status: confirmed.status, payment: null });
      }

      // ต้องจ่าย → ออก QR 5 นาที
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

      if (r.orderId) {
        await prisma.order.update({ where: { id: r.orderId }, data: { paymentId: payment.id } });
      }

      await prisma.reservation.update({
        where: { id: r.id },
        data: { status: "AWAITING_PAYMENT", paymentId: payment.id, paymentExpiresAt: expire },
      });

      req.app.get("io")?.emit("reservation:updated", { id: r.id });
      return res.json({ ok: true, status: "AWAITING_PAYMENT", payment });
    } catch (e: any) {
      console.error(e);
      return res.status(500).json({ message: "verifyOtp error", error: e.message });
    }
  },

  // ---------- แอดมินกดยืนยัน (กรณีไม่มีบิล/ไม่มีสลิป) ----------
  confirm: async (req: Request, res: Response) => {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ message: "id required" });

    const r = await prisma.reservation.findUnique({ where: { id } });
    if (!r) return res.status(404).json({ message: "not found" });

    if (r.status === "CONFIRMED") {
      return res.json({ ok: true, id, status: "CONFIRMED" });
    }

    const updated = await prisma.reservation.update({
      where: { id },
      data: { status: "CONFIRMED" },
    });

    req.app.get("io")?.emit("reservation:confirmed", {
      id: updated.id,
      tableId: updated.tableId,
      start: updated.dateStart,
      end: updated.dateEnd,
    });
    req.app.get("io")?.emit("reservation:updated", { id: updated.id });

    return res.json({ ok: true, id, status: "CONFIRMED" });
  },

  // ---------- CANCEL (สำหรับแอดมิน) ----------
  cancel: async (req: Request, res: Response) => {
    try {
      const id = Number(req.params.id);
      const r = await prisma.reservation.findUnique({ where: { id } });
      if (!r) return res.status(404).json({ message: "not found" });

      if (r.status === "CONFIRMED") {
        return res.status(400).json({ message: "already confirmed" });
      }

      await prisma.reservation.update({ where: { id }, data: { status: "CANCELED" } });

      if (r.paymentId) {
        await prisma.payment.update({ where: { id: r.paymentId }, data: { status: "CANCELED" } });
      }
      if (r.orderId) {
        await prisma.order.update({ where: { id: r.orderId }, data: { status: "CANCELED" } });
      }

      req.app.get("io")?.emit("reservation:canceled", { id });
      return res.json({ ok: true });
    } catch (e: any) {
      console.error(e);
      return res.status(500).json({ message: "cancel error", error: e.message });
    }
  },
};
