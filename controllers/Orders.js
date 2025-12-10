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
Object.defineProperty(exports, "__esModule", { value: true });
exports.OrdersController = void 0;
const client_1 = require("@prisma/client");
const prisma = new client_1.PrismaClient();
function startOfDay(d) {
    const x = new Date(d);
    x.setHours(0, 0, 0, 0);
    return x;
}
function endOfDay(d) {
    const x = new Date(d);
    x.setHours(23, 59, 59, 999);
    return x;
}
/** สร้างชื่อผู้ใช้จาก fname/lname หรือ user_name */
function displayName(u) {
    if (!u)
        return undefined;
    const full = [u.user_fname, u.user_lname].filter(Boolean).join(" ").trim();
    return full || (u.user_name || undefined);
}
exports.OrdersController = {
    /** ---------- LIST: GET /orders?start=YYYY-MM-DD&end=YYYY-MM-DD ---------- */
    list: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        const { date, start, end, page = "1", pageSize = "10", status, payStatus } = req.query;
        const p = Math.max(1, parseInt(page, 10) || 1);
        const ps = Math.min(100, Math.max(1, parseInt(pageSize, 10) || 10));
        // ช่วงวันที่: รองรับ ?date=YYYY-MM-DD หรือ ?start=&end=
        let from;
        let to;
        if (date) {
            const d = new Date(String(date));
            from = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
            to = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, 0, 0, 0, 0);
        }
        else if (start || end) {
            if (start)
                from = new Date(String(start));
            if (end)
                to = new Date(new Date(String(end)).getTime() + 24 * 3600 * 1000); // รวมทั้งวันของ end
        }
        const where = {};
        if (from || to) {
            // ให้ผ่านถ้าอยู่ในช่วงตาม createdAt "หรือ" dateStart ของ reservation
            where.OR = [
                { createdAt: { gte: from, lt: to } },
                { reservation: { is: { dateStart: { gte: from, lt: to } } } },
            ];
        }
        if (status) {
            const arr = String(status).split(",").filter(Boolean);
            if (arr.length)
                where.status = { in: arr };
        }
        if (payStatus) {
            const arr = String(payStatus).split(",").filter(Boolean);
            if (arr.length)
                where.payment = { is: { status: { in: arr } } };
        }
        const [total, list] = yield prisma.$transaction([
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
        const data = list.map((o) => {
            var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k;
            return ({
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
                reservationId: (_b = (_a = o.reservation) === null || _a === void 0 ? void 0 : _a.id) !== null && _b !== void 0 ? _b : null,
                reservationStatus: (_d = (_c = o.reservation) === null || _c === void 0 ? void 0 : _c.status) !== null && _d !== void 0 ? _d : null,
                tableLabel: (_g = (_f = (_e = o.reservation) === null || _e === void 0 ? void 0 : _e.table) === null || _f === void 0 ? void 0 : _f.label) !== null && _g !== void 0 ? _g : null,
                start: (_k = (_j = (_h = o.reservation) === null || _h === void 0 ? void 0 : _h.dateStart) === null || _j === void 0 ? void 0 : _j.toISOString()) !== null && _k !== void 0 ? _k : null,
                user: o.user ? {
                    id: o.user.user_id,
                    fname: o.user.user_fname,
                    lname: o.user.user_lname,
                    email: o.user.user_email,
                    phone: o.user.user_phone,
                    img: o.user.user_img,
                } : null,
            });
        });
        return res.json({
            data,
            paging: { page: p, pageSize: ps, total, pages: Math.ceil(total / ps) },
        });
    }),
    /** ---------- GET ONE: GET /orders/:id ---------- */
    get: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        var _a, _b, _c, _d, _e, _f, _g, _h;
        const id = Number(req.params.id);
        if (!id)
            return res.status(400).json({ message: "id required" });
        const ord = yield prisma.order.findUnique({
            where: { id },
            include: { items: true, reservation: { include: { table: true } }, user: true },
        });
        if (!ord)
            return res.status(404).json({ message: "not found" });
        return res.json({
            id: ord.id,
            userId: ord.userId,
            total: ord.total,
            status: ord.status,
            paymentId: ord.paymentId,
            createdAt: ord.createdAt,
            reservationId: (_b = (_a = ord.reservation) === null || _a === void 0 ? void 0 : _a.id) !== null && _b !== void 0 ? _b : null,
            tableLabel: (_e = (_d = (_c = ord.reservation) === null || _c === void 0 ? void 0 : _c.table) === null || _d === void 0 ? void 0 : _d.label) !== null && _e !== void 0 ? _e : null,
            start: (_h = (_g = (_f = ord.reservation) === null || _f === void 0 ? void 0 : _f.dateStart) === null || _g === void 0 ? void 0 : _g.toISOString()) !== null && _h !== void 0 ? _h : null,
            user: ord.user ? {
                id: ord.user.user_id,
                fname: ord.user.user_fname,
                lname: ord.user.user_lname,
                email: ord.user.user_email,
                phone: ord.user.user_phone,
                img: ord.user.user_img,
            } : null,
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
    }),
    /** ---------- UPDATE: PATCH /orders/:id ----------
     * รองรับ 2 กรณี:
     * 1) { items: [{id, menuId, qty, note}] }  -> แก้จำนวน/โน้ต และคำนวณ total ใหม่
     * 2) { status: "PENDING"|"CONFIRMED"|"CANCELED" } -> เปลี่ยนสถานะบิล
     */
    update: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        var _a, _b, _c, _d, _e, _f;
        const id = Number(req.params.id);
        if (!id)
            return res.status(400).json({ message: "id required" });
        const body = ((_a = req.body) !== null && _a !== void 0 ? _a : {});
        const ord = yield prisma.order.findUnique({ where: { id }, include: { items: true } });
        if (!ord)
            return res.status(404).json({ message: "not found" });
        let newTotal = undefined;
        // 1) อัปเดตรายการอาหาร (qty/note)
        if (Array.isArray(body.items)) {
            yield Promise.all(body.items.map((it) => {
                var _a;
                return prisma.orderItem.update({
                    where: { id: it.id },
                    data: { qty: Math.max(1, Number(it.qty) || 1), note: (_a = it.note) !== null && _a !== void 0 ? _a : null },
                });
            }));
            const latest = yield prisma.order.findUnique({ where: { id }, include: { items: true } });
            newTotal = (_b = latest === null || latest === void 0 ? void 0 : latest.items.reduce((a, c) => a + Number(c.price) * Number(c.qty), 0)) !== null && _b !== void 0 ? _b : 0;
            yield prisma.order.update({ where: { id }, data: { total: newTotal } });
        }
        // 2) เปลี่ยนสถานะบิล (optional)
        if (body.status) {
            const allow = ["PENDING", "CONFIRMED", "CANCELED"];
            if (!allow.includes(body.status)) {
                return res.status(400).json({ message: "invalid status" });
            }
            yield prisma.order.update({ where: { id }, data: { status: body.status } });
            // ✅ ถ้า CONFIRMED → หัก stock
            if (body.status === "CONFIRMED") {
                const ordWithItems = yield prisma.order.findUnique({
                    where: { id },
                    include: { items: true },
                });
                if (ordWithItems) {
                    for (const item of ordWithItems.items) {
                        const menu = yield prisma.foodMenu.findUnique({
                            where: { menu_id: item.menuId },
                        });
                        if (menu && menu.isLimited === 1) {
                            yield prisma.foodMenu.update({
                                where: { menu_id: item.menuId },
                                data: { stock: { decrement: item.qty } },
                            });
                            // broadcast stock updated (Realtime)
                            (_c = req.app.get("io")) === null || _c === void 0 ? void 0 : _c.emit("menu:stock_updated", {
                                menuId: item.menuId,
                                newStock: ((_d = menu.stock) !== null && _d !== void 0 ? _d : 0) - item.qty,
                            });
                        }
                    }
                }
            }
        }
        const updated = yield prisma.order.findUnique({ where: { id } });
        return res.json({
            ok: true,
            id,
            total: (_e = newTotal !== null && newTotal !== void 0 ? newTotal : updated === null || updated === void 0 ? void 0 : updated.total) !== null && _e !== void 0 ? _e : ord.total,
            status: (_f = updated === null || updated === void 0 ? void 0 : updated.status) !== null && _f !== void 0 ? _f : ord.status,
        });
    }),
};
