// api/controllers/Payment.ts
import { Request, Response } from "express";
import { PrismaClient } from "@prisma/client";
import type { Server as SocketIOServer } from "socket.io";
import { sendConfirmEmail } from "../OTP/sendConfirmEmail";
const prisma = new PrismaClient();

export const PaymentController = {
  // ---------- GET ONE: GET /payment/:id ----------
  get: async (req: Request, res: Response) => {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ message: "id required" });

    const row = await prisma.payment.findUnique({ where: { id } });
    if (!row) return res.status(404).json({ message: "payment not found" });
    return res.json(row);
  },

  // ---------- UPLOAD SLIP: POST /payment/:id/slip (multipart/form-data; field="slip") ----------
  uploadSlip: async (req: Request, res: Response) => {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ message: "id required" });
    if (!req.file) return res.status(400).json({ message: "slip file required" });

    const exists = await prisma.payment.findUnique({ where: { id } });
    if (!exists) return res.status(404).json({ message: "payment not found" });

    const slipPath = `/uploads/slips_images/${req.file.filename}`;
    const nextStatus =
      exists.status === "EXPIRED" || exists.status === "PENDING"
        ? "SUBMITTED"
        : exists.status;

    const updated = await prisma.payment.update({
      where: { id },
      data: { slipImage: slipPath, status: nextStatus },
    });

    req.app.get("io")?.emit("payment:updated", { id, status: updated.status });
    return res.json({ ok: true, id, slipImage: updated.slipImage, status: updated.status });
  },

  // ---------- CONFIRM: POST /payment/:id/confirm ----------
confirm: async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ message: "id required" });

  const pay = await prisma.payment.findUnique({
    where: { id },
    include: { order: true },
  });
  if (!pay) return res.status(404).json({ message: "not found" });

  // allow confirm even EXPIRED if slip exists
  if (pay.status === "EXPIRED" && !pay.slipImage) {
    return res.status(400).json({ message: "QR expired and no slip uploaded" });
  }

  const now = new Date();

  const result = await prisma.$transaction(async (tx) => {
    const updatedPay = await tx.payment.update({
      where: { id },
      data: { status: "PAID", confirmedAt: now },
    });

    if (pay.order && pay.order.status !== "CONFIRMED") {
      await tx.order.update({
        where: { id: pay.order.id },
        data: { status: "CONFIRMED" },
      });
    }

    const resv = await tx.reservation.findFirst({ where: { paymentId: id } });
    let confirmedResv: typeof resv | null = null;
    if (resv && resv.status !== "CONFIRMED") {
      confirmedResv = await tx.reservation.update({
        where: { id: resv.id },
        data: { status: "CONFIRMED" },
      });
    }

    return { updatedPay, confirmedResv, orderId: pay.order?.id ?? null };
  });

  const io = req.app.get("io") as SocketIOServer | undefined;
  io?.emit("payment:confirmed", { id, status: "PAID" });
  io?.emit("payment:updated", { id, status: "PAID" });

  if (result.orderId) io?.emit("order:updated", { id: result.orderId });
  if (result.confirmedResv) {
    io?.emit("reservation:confirmed", {
      id: result.confirmedResv.id,
      tableId: result.confirmedResv.tableId,
      start: result.confirmedResv.dateStart,
      end: result.confirmedResv.dateEnd,
    });
    io?.emit("reservation:updated", { id: result.confirmedResv.id });

    // ============ ส่งอีเมลยืนยันหลัง Confirm ============
    try {
      const resvFull = await prisma.reservation.findUnique({
        where: { id: result.confirmedResv.id },
        include: {
          user: true,
          table: true,
          order: { include: { items: true } },
        },
      });

      if (resvFull?.user?.user_email) {
        const reservationData = {
          userName:
            [resvFull.user.user_fname, resvFull.user.user_lname].filter(Boolean).join(" ") ||
            resvFull.user.user_name,
          tableLabel: resvFull.table?.label || "-",
          dateStart: resvFull.dateStart,
          dateEnd: resvFull.dateEnd,
        };

        const orderData = resvFull.order
          ? {
              total: resvFull.order.total,
              items: resvFull.order.items.map((it) => ({
                name: it.name,
                qty: it.qty,
                price: it.price,
              })),
            }
          : undefined;

        const info = await sendConfirmEmail(resvFull.user.user_email, reservationData, orderData);
        console.log("[MAIL] Sent confirm email:", info?.messageId);
      } else {
        console.warn("[MAIL] skip: no user_email");
      }
    } catch (e: any) {
      console.error("[MAIL] sendConfirmEmail failed:", e?.message || e);
    }
    // ===============================================
  }

  return res.json({
    ok: true,
    id,
    status: "PAID",
    confirmedAt: now.toISOString(),
  });
},


  // ---------- CANCEL: POST /payment/:id/cancel ----------
  cancel: async (req: Request, res: Response) => {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ message: "id required" });

    const exists = await prisma.payment.findUnique({ where: { id } });
    if (!exists) return res.status(404).json({ message: "not found" });

    const updated = await prisma.payment.update({
      where: { id },
      data: { status: "CANCELED" },
    });

    req.app.get("io")?.emit("payment:updated", { id, status: "CANCELED" });
    return res.json({ ok: true, id, status: "CANCELED" });
  },
};
