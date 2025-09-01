// C:\Users\pong1\OneDrive\เอกสาร\End-Pro\api\controllers\Payment.ts
import { Request, Response } from "express";
import { PrismaClient } from "@prisma/client";
import type { Server as SocketIOServer } from "socket.io";
const getIO = (req: Request) => req.app.get("io") as SocketIOServer | undefined;

const prisma = new PrismaClient();
export const PaymentController = {
  get: async (req: Request, res: Response) => {
    const id = Number(req.params.id);
    const row = await prisma.payment.findUnique({ where: { id } });
    if (!row) return res.status(404).json({ message: "payment not found" });
    return res.json(row);
  },

uploadSlip: async (req: Request, res: Response) => {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ message: "id required" });
    if (!req.file) return res.status(400).json({ message: "slip file required" });

    const exists = await prisma.payment.findUnique({ where: { id } });
    if (!exists) return res.status(404).json({ message: "payment not found" });

    // เก็บเป็น path ใต้ /uploads เพื่อให้ front ใช้ได้ตรงๆ
    const slipPath = `/uploads/slips_images/${req.file.filename}`;

    // ถ้าเดิม EXPIRED หรือ PENDING -> คืน/ตั้งเป็น SUBMITTED
    const nextStatus =
      exists.status === "EXPIRED" || exists.status === "PENDING"
        ? "SUBMITTED"
        : exists.status;

    const updated = await prisma.payment.update({
      where: { id },
      data: { slipImage: slipPath, status: nextStatus },
    });

    const io = req.app.get("io");
    io.emit("payment:updated", { id, status: updated.status });

    return res.json({ ok: true, id, slipImage: updated.slipImage, status: updated.status });
  },



confirm: async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ message: "id required" });

  const pay = await prisma.payment.findUnique({
    where: { id },
    include: { order: true },
  });
  if (!pay) return res.status(404).json({ message: "not found" });

  // ✅ อนุญาตยืนยันแม้ EXPIRED ถ้ามีสลิปแล้ว
  if (pay.status === "EXPIRED" && !pay.slipImage) {
    return res.status(400).json({ message: "QR expired and no slip uploaded" });
  }

  const now = new Date();

  const result = await prisma.$transaction(async (tx) => {
    // 1) ปรับสถานะการจ่ายเงินเป็น PAID
    const updatedPay = await tx.payment.update({
      where: { id },
      data: { status: "PAID", confirmedAt: now },
    });

    // 2) ถ้ามี order → คอนเฟิร์มบิล
    if (pay.order && pay.order.status !== "CONFIRMED") {
      await tx.order.update({
        where: { id: pay.order.id },
        data: { status: "CONFIRMED" },
      });
    }

    // 3) หาใบจองที่ผูกกับ payment นี้ แล้วคอนเฟิร์ม (แม้เดิมจะ EXPIRED)
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

  const io = req.app.get("io");
  io.emit("payment:confirmed", { id, status: "PAID" });
  io.emit("payment:updated", { id, status: "PAID" });

  if (result.orderId) {
    io.emit("order:updated", { id: result.orderId });
  }
  if (result.confirmedResv) {
    io.emit("reservation:confirmed", {
      id: result.confirmedResv.id,
      tableId: result.confirmedResv.tableId,
      start: result.confirmedResv.dateStart,
      end: result.confirmedResv.dateEnd,
    });
    io.emit("reservation:updated", { id: result.confirmedResv.id });
  }

  return res.json({
    ok: true,
    id,
    status: "PAID",
    confirmedAt: now.toISOString(),
  });
},


  cancel: async (req: Request, res: Response) => {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ message: "id required" });

    const exists = await prisma.payment.findUnique({ where: { id } });
    if (!exists) return res.status(404).json({ message: "not found" });

    const updated = await prisma.payment.update({
      where: { id },
      data: { status: "CANCELED" },
    });

    const io = req.app.get("io");
    io.emit("payment:updated", { id, status: "CANCELED" });

    return res.json({ ok: true, id, status: "CANCELED" });
  },

};
