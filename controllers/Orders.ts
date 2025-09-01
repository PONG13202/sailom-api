// api/controllers/Orders.ts
import { Request, Response } from "express";
import { PrismaClient, OrderStatus } from "@prisma/client";
const prisma = new PrismaClient();

function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function endOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

/** สร้างชื่อผู้ใช้จาก fname/lname หรือ user_name */
function displayName(u?: { user_fname?: string | null; user_lname?: string | null; user_name?: string | null }) {
  if (!u) return undefined;
  const full = [u.user_fname, u.user_lname].filter(Boolean).join(" ").trim();
  return full || (u.user_name || undefined);
}

export const OrdersController = {
  /** ---------- LIST: GET /orders?start=YYYY-MM-DD&end=YYYY-MM-DD ---------- */
  list: async (req: Request, res: Response) => {
    const { date, start, end, page = "1", pageSize = "10", status, payStatus } = req.query as any;

    const p = Math.max(1, parseInt(page, 10) || 1);
    const ps = Math.min(100, Math.max(1, parseInt(pageSize, 10) || 10));

    // ช่วงวันที่: รองรับ ?date=YYYY-MM-DD หรือ ?start=&end=
    let from: Date | undefined;
    let to: Date | undefined;

    if (date) {
      const d = new Date(String(date));
      from = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
      to   = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, 0, 0, 0, 0);
    } else if (start || end) {
      if (start) from = new Date(String(start));
      if (end)   to   = new Date(new Date(String(end)).getTime() + 24 * 3600 * 1000); // รวมทั้งวันของ end
    }

    const where: any = {};
    if (from || to) {
      // ให้ผ่านถ้าอยู่ในช่วงตาม createdAt "หรือ" dateStart ของ reservation
      where.OR = [
        { createdAt: { gte: from, lt: to } },
        { reservation: { is: { dateStart: { gte: from, lt: to } } } },
      ];
    }
    if (status) {
      const arr = String(status).split(",").filter(Boolean);
      if (arr.length) where.status = { in: arr };
    }
    if (payStatus) {
      const arr = String(payStatus).split(",").filter(Boolean);
      if (arr.length) where.payment = { is: { status: { in: arr } } };
    }

    const [total, list] = await prisma.$transaction([
      prisma.order.count({ where }),
      prisma.order.findMany({
        where,
        include: {
          items: true,
          payment: true,
          reservation: { include: { table: true, user: true } },
          user: true,
        },
        orderBy: { createdAt: "desc" },
        skip: (p - 1) * ps,
        take: ps,
      }),
    ]);

    const data = list.map((o) => ({
      id: o.id,
      userId: o.userId,
      total: o.total,
      status: o.status,
      paymentId: o.paymentId,
      createdAt: o.createdAt.toISOString(),
      items: o.items.map((it) => ({
        id: it.id,
        menuId: it.menuId,
        name: it.name,
        price: it.price,
        qty: it.qty,
        note: it.note,
        options: it.options,
      })),
      // enrich สำหรับตาราง
      reservationId: o.reservation?.id ?? null,
      tableLabel: o.reservation?.table?.label ?? null,
      start: o.reservation?.dateStart?.toISOString() ?? null,
      user: {
        id: o.userId,
        name: o.reservation?.user?.user_name ?? o.user?.user_name ?? null,
        phone: o.reservation?.user?.user_phone ?? o.user?.user_phone ?? null,
      },
    }));

    return res.json({
      data,
      paging: { page: p, pageSize: ps, total, pages: Math.ceil(total / ps) },
    });
  },

  /** ---------- GET ONE: GET /orders/:id ---------- */
  get: async (req: Request, res: Response) => {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ message: "id required" });

    const ord = await prisma.order.findUnique({
      where: { id },
      include: { items: true, reservation: { include: { table: true } }, user: true },
    });
    if (!ord) return res.status(404).json({ message: "not found" });

    return res.json({
      id: ord.id,
      userId: ord.userId,
      total: ord.total,
      status: ord.status,
      paymentId: ord.paymentId,
      createdAt: ord.createdAt,
      reservationId: ord.reservation?.id ?? null,
      tableLabel: ord.reservation?.table?.label ?? null,
      start: ord.reservation?.dateStart?.toISOString() ?? null,
      user: ord.user
        ? {
            id: ord.user.user_id,
            name: displayName(ord.user),
            phone: ord.user.user_phone || undefined,
          }
        : undefined,
      items: ord.items.map((it) => ({
        id: it.id,
        menuId: it.menuId,
        name: it.name,
        price: it.price,
        qty: it.qty,
        note: it.note,
        options: it.options,
      })),
    });
  },

  /** ---------- UPDATE: PATCH /orders/:id ----------
   * รองรับ 2 กรณี:
   * 1) { items: [{id, menuId, qty, note}] }  -> แก้จำนวน/โน้ต และคำนวณ total ใหม่
   * 2) { status: "PENDING"|"CONFIRMED"|"CANCELED" } -> เปลี่ยนสถานะบิล
   */
  update: async (req: Request, res: Response) => {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ message: "id required" });

    const body = (req.body ?? {}) as {
      items?: Array<{ id: number; menuId: number; qty: number; note?: string | null }>;
      status?: OrderStatus | "PENDING" | "CONFIRMED" | "CANCELED";
    };

    const ord = await prisma.order.findUnique({ where: { id }, include: { items: true } });
    if (!ord) return res.status(404).json({ message: "not found" });

    let newTotal: number | undefined = undefined;

    // 1) อัปเดตรายการอาหาร (qty/note)
    if (Array.isArray(body.items)) {
      await Promise.all(
        body.items.map((it) =>
          prisma.orderItem.update({
            where: { id: it.id },
            data: { qty: Math.max(1, Number(it.qty) || 1), note: it.note ?? null },
          })
        )
      );

      const latest = await prisma.order.findUnique({ where: { id }, include: { items: true } });
      newTotal = latest?.items.reduce((a, c) => a + Number(c.price) * Number(c.qty), 0) ?? 0;

      await prisma.order.update({ where: { id }, data: { total: newTotal } });
    }

    // 2) เปลี่ยนสถานะบิล (optional)
    if (body.status) {
const allow: OrderStatus[] = ["PENDING", "CONFIRMED", "CANCELED"];
if (!allow.includes(body.status as OrderStatus)) {
  return res.status(400).json({ message: "invalid status" });
}
// if (body.status === "CANCELED") {
//   await prisma.reservation.updateMany({
//     where: { order: { id }, status: { not: "CONFIRMED" } },
//     data: { status: "CANCELED" },
//   });
// }
await prisma.order.update({ where: { id }, data: { status: body.status as OrderStatus } });
    }

    const updated = await prisma.order.findUnique({ where: { id } });
    return res.json({
      ok: true,
      id,
      total: newTotal ?? updated?.total ?? ord.total,
      status: updated?.status ?? ord.status,
    });
  },
};
