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
    try {
      const id = Number(req.params.id);
      if (!req.file) return res.status(400).json({ message: "no file" });

      const filePath = `/${process.env.UPLOAD_DIR || "uploads"}/${
        req.file.filename
      }`;
      const absUrl = `${process.env.PUBLIC_BASE_URL || ""}${filePath}`;

      const p = await prisma.payment.update({
        where: { id },
        data: { slipImage: absUrl, status: "SUBMITTED" },
      });
      getIO(req)?.emit("payment:submitted", {
        id: p.id,
        status: p.status,
        slipImage: p.slipImage,
      });
      return res.json({ ok: true, payment: p });
    } catch (e: any) {
      console.error(e);
      return res
        .status(500)
        .json({ message: "upload slip error", error: e.message });
    }
  },

  confirm: async (req: Request, res: Response) => {
    try {
      const id = Number(req.params.id);
      const p = await prisma.payment.update({
        where: { id },
        data: { status: "PAID", confirmedAt: new Date() },
      });

      const r = await prisma.reservation.findFirst({
        where: { paymentId: id },
      });
      if (r)
        await prisma.reservation.update({
          where: { id: r.id },
          data: { status: "CONFIRMED" },
        });

      const o = await prisma.order.findFirst({ where: { paymentId: id } });
      if (o)
        await prisma.order.update({
          where: { id: o.id },
          data: { status: "CONFIRMED" },
        });
      getIO(req)?.emit("payment:confirmed", { id: p.id, status: p.status });
      return res.json({ ok: true, payment: p });
    } catch (e: any) {
      console.error(e);
      return res
        .status(500)
        .json({ message: "confirm payment error", error: e.message });
    }
  },
};
