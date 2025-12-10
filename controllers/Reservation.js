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
exports.ReservationController = void 0;
const crypto_1 = __importDefault(require("crypto"));
const client_1 = require("@prisma/client");
const mailer_1 = require("../OTP/mailer");
const qr_1 = require("../OTP/qr");
const sendConfirmEmail_1 = require("../OTP/sendConfirmEmail");
const prisma = new client_1.PrismaClient();
const hash = (s) => crypto_1.default.createHash("sha256").update(s).digest("hex");
// ===================== Helpers =====================
const DEFAULT_DURATION_MIN = 30;
// ช่วงวันแบบเวลาไทย (+07:00)
function dayRange(dateStr) {
    const tz = "+07:00";
    const d = dateStr !== null && dateStr !== void 0 ? dateStr : new Date().toISOString().slice(0, 10);
    const start = new Date(`${d}T00:00:00${tz}`);
    const end = new Date(`${d}T24:00:00${tz}`);
    return { start, end };
}
function fallbackEnd(startIso, end) {
    if (end)
        return end.toISOString();
    const s = new Date(startIso);
    return new Date(s.getTime() + DEFAULT_DURATION_MIN * 60000).toISOString();
}
function buildUserName(u) {
    if (!u)
        return "";
    const full = [u.user_fname, u.user_lname].filter(Boolean).join(" ").trim();
    return full || u.user_name || u.username || (u.user_id ? String(u.user_id) : "");
}
// กันชนเวลาโต๊ะเดียวกัน
function hasOverlap(tableId, start, end) {
    return __awaiter(this, void 0, void 0, function* () {
        const clash = yield prisma.reservation.findFirst({
            where: {
                tableId,
                status: { in: ["PENDING_OTP", "OTP_VERIFIED", "AWAITING_PAYMENT", "CONFIRMED"] },
                dateStart: { lt: end },
                dateEnd: { gt: start },
            },
            select: { id: true },
        });
        return !!clash;
    });
}
// ===================== Controller =====================
exports.ReservationController = {
    // ---------- LIST (สำหรับ Grid รายวัน): GET /reservation?date=YYYY-MM-DD&includeCanceled=0 ----------
    // --- แทนที่ฟังก์ชัน list ทั้งหมดใน controllers/Reservation.ts ---
    list: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        try {
            const { date, tableId, includeCanceled } = req.query;
            const { start, end } = dayRange(date);
            const active = ["PENDING_OTP", "OTP_VERIFIED", "AWAITING_PAYMENT", "CONFIRMED"];
            const whereStatus = includeCanceled === "1" ? { not: "EXPIRED" } : { in: active };
            // กรอง “รายการที่เริ่มในวันนั้น” เพื่อกันเคส dateEnd เป็น null
            const where = Object.assign({ status: whereStatus, dateStart: { gte: start, lt: end } }, (tableId ? { tableId: Number(tableId) } : {}));
            // ใช้ select เพื่อให้ type ชัดเจน และไม่อ้าง relation ที่ schema ไม่มี
            const rows = yield prisma.reservation.findMany({
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
                            user_name: true, // ✅ ใช้ user_name (ไม่มี username)
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
            const fallbackEnd = (s, e) => (e ? e : new Date(s.getTime() + DEFAULT_DURATION_MIN * 60000)).toISOString();
            const data = rows.map((r) => {
                var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k;
                return ({
                    id: r.id,
                    tableId: r.tableId,
                    tableLabel: (_b = (_a = r.table) === null || _a === void 0 ? void 0 : _a.label) !== null && _b !== void 0 ? _b : "-",
                    start: r.dateStart.toISOString(),
                    end: fallbackEnd(r.dateStart, r.dateEnd),
                    people: r.people,
                    status: r.status,
                    orderId: (_c = r.orderId) !== null && _c !== void 0 ? _c : null, // ✅ ใช้ orderId แทน r.order?.id
                    paymentId: (_d = r.paymentId) !== null && _d !== void 0 ? _d : null, // ✅ ใช้ paymentId แทน r.payment?.id
                    depositAmount: (_e = r.depositAmount) !== null && _e !== void 0 ? _e : 0,
                    user: {
                        id: r.userId,
                        name: [(_f = r.user) === null || _f === void 0 ? void 0 : _f.user_fname, (_g = r.user) === null || _g === void 0 ? void 0 : _g.user_lname].filter(Boolean).join(" ").trim() ||
                            ((_h = r.user) === null || _h === void 0 ? void 0 : _h.user_name) ||
                            String(r.userId),
                        phone: (_k = (_j = r.user) === null || _j === void 0 ? void 0 : _j.user_phone) !== null && _k !== void 0 ? _k : null,
                    },
                });
            });
            return res.json({
                date: date !== null && date !== void 0 ? date : new Date().toISOString().slice(0, 10),
                start: start.toISOString(),
                end: end.toISOString(),
                data,
            });
        }
        catch (e) {
            console.error(e);
            return res.status(500).json({ message: "list reservation error" });
        }
    }),
    // ---------- GET ONE: GET /reservation/:id ----------
    get: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r, _s, _t;
        const id = Number(req.params.id);
        if (!id)
            return res.status(400).json({ message: "Invalid id" });
        const r = yield prisma.reservation.findUnique({
            where: { id },
            include: {
                user: true,
                table: true,
                order: { select: { id: true, status: true } },
                payment: {
                    select: { id: true, status: true, amount: true, expiresAt: true, slipImage: true, qrDataUrl: true, qrPayload: true },
                },
            },
        });
        if (!r)
            return res.status(404).json({ message: "Not found" });
        const anyUser = r.user;
        const userName = [anyUser === null || anyUser === void 0 ? void 0 : anyUser.user_fname, anyUser === null || anyUser === void 0 ? void 0 : anyUser.user_lname].filter(Boolean).join(" ").trim() ||
            (anyUser === null || anyUser === void 0 ? void 0 : anyUser.user_name) ||
            (anyUser === null || anyUser === void 0 ? void 0 : anyUser.username) ||
            "";
        return res.json({
            id: r.id,
            userId: r.userId,
            tableId: r.tableId,
            tableLabel: (_b = (_a = r.table) === null || _a === void 0 ? void 0 : _a.label) !== null && _b !== void 0 ? _b : null,
            dateStart: r.dateStart.toISOString(),
            dateEnd: r.dateEnd ? r.dateEnd.toISOString() : null,
            people: r.people,
            status: r.status,
            orderId: (_d = (_c = r.order) === null || _c === void 0 ? void 0 : _c.id) !== null && _d !== void 0 ? _d : null,
            paymentId: (_f = (_e = r.payment) === null || _e === void 0 ? void 0 : _e.id) !== null && _f !== void 0 ? _f : null,
            depositAmount: (_g = r.depositAmount) !== null && _g !== void 0 ? _g : 0,
            paymentExpiresAt: ((_h = r.payment) === null || _h === void 0 ? void 0 : _h.expiresAt) ? r.payment.expiresAt.toISOString() : null,
            slipImage: (_k = (_j = r.payment) === null || _j === void 0 ? void 0 : _j.slipImage) !== null && _k !== void 0 ? _k : null,
            qrDataUrl: (_m = (_l = r.payment) === null || _l === void 0 ? void 0 : _l.qrDataUrl) !== null && _m !== void 0 ? _m : null,
            qrPayload: (_p = (_o = r.payment) === null || _o === void 0 ? void 0 : _o.qrPayload) !== null && _p !== void 0 ? _p : null,
            user: {
                id: (_r = (_q = anyUser === null || anyUser === void 0 ? void 0 : anyUser.user_id) !== null && _q !== void 0 ? _q : anyUser === null || anyUser === void 0 ? void 0 : anyUser.id) !== null && _r !== void 0 ? _r : r.userId,
                name: userName,
                phone: (_s = anyUser === null || anyUser === void 0 ? void 0 : anyUser.user_phone) !== null && _s !== void 0 ? _s : null,
                email: (_t = anyUser === null || anyUser === void 0 ? void 0 : anyUser.user_email) !== null && _t !== void 0 ? _t : null,
            },
        });
    }),
    // ---------- CREATE: POST /reservations ----------
    // ---------- CREATE: POST /reservations ----------
    create: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        var _a, _b;
        try {
            const userId = Number(req.userId);
            if (!userId)
                return res.status(401).json({ message: "Unauthorized" });
            const { tableId: tableIdRaw, date, time, durationMin = 60, people = 1, items } = req.body;
            if (!date || !time)
                return res.status(400).json({ message: "กรุณาเลือกวันและเวลา" });
            if (!tableIdRaw)
                return res.status(400).json({ message: "ต้องเลือกโต๊ะก่อนทำการจอง" });
            const tableIdNum = Number(tableIdRaw);
            const start = new Date(`${date}T${time}:00`);
            const end = new Date(start.getTime() + Number(durationMin) * 60000);
            const hasItems = Array.isArray(items) && items.length > 0;
            if (!hasItems && !(Number.isInteger(tableIdNum) && tableIdNum > 0)) {
                return res.status(400).json({ message: "กรุณาเลือกโต๊ะเมื่อไม่ได้สั่งอาหารล่วงหน้า" });
            }
            if (yield hasOverlap(tableIdNum, start, end)) {
                return res.status(409).json({ message: "ช่วงเวลานี้ถูกจองแล้ว" });
            }
            const result = yield prisma.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
                var _a, _b, _c;
                // double-check overlap
                if (yield tx.reservation.findFirst({
                    where: {
                        tableId: tableIdNum,
                        status: { in: ["PENDING_OTP", "OTP_VERIFIED", "AWAITING_PAYMENT", "CONFIRMED"] },
                        dateStart: { lt: end },
                        dateEnd: { gt: start },
                    },
                    select: { id: true },
                })) {
                    throw new Error("TABLE_CLASH");
                }
                const depositAmount = hasItems ? 0 : 100;
                let orderId = null;
                let orderTotal = 0;
                if (hasItems) {
                    // ✅ ตรวจสอบและหัก stock
                    for (const it of items) {
                        const menu = yield tx.foodMenu.findUnique({ where: { menu_id: it.id } });
                        if (!menu)
                            throw new Error(`MENU_NOT_FOUND: ${it.id}`);
                        if (menu.isLimited === 1) {
                            if (((_a = menu.stock) !== null && _a !== void 0 ? _a : 0) < it.qty) {
                                throw new Error(`OUT_OF_STOCK: ${menu.menu_name}`);
                            }
                            yield tx.foodMenu.update({
                                where: { menu_id: it.id },
                                data: { stock: { decrement: it.qty } },
                            });
                            // แจ้ง realtime ว่า stock เปลี่ยน
                            (_b = req.app.get("io")) === null || _b === void 0 ? void 0 : _b.emit("menu:stock_updated", {
                                menuId: it.id,
                                newStock: ((_c = menu.stock) !== null && _c !== void 0 ? _c : 0) - it.qty,
                            });
                        }
                        orderTotal += Number(it.price) * Number(it.qty);
                    }
                    const order = yield tx.order.create({
                        data: {
                            userId,
                            total: orderTotal,
                            status: "PENDING",
                            items: {
                                create: items.map((it) => {
                                    var _a;
                                    return ({
                                        menuId: it.id,
                                        name: it.name,
                                        price: Number(it.price),
                                        qty: Number(it.qty),
                                        note: it.note || null,
                                        options: (_a = it.options) !== null && _a !== void 0 ? _a : null,
                                    });
                                }),
                            },
                        },
                    });
                    orderId = order.id;
                }
                const r = yield tx.reservation.create({
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
            }), { isolationLevel: client_1.Prisma.TransactionIsolationLevel.Serializable });
            (_a = req.app.get("io")) === null || _a === void 0 ? void 0 : _a.emit("reservation:created", {
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
        }
        catch (e) {
            if ((e === null || e === void 0 ? void 0 : e.message) === "TABLE_CLASH") {
                return res.status(409).json({ message: "ช่วงเวลานี้ถูกจองแล้ว" });
            }
            if ((_b = e === null || e === void 0 ? void 0 : e.message) === null || _b === void 0 ? void 0 : _b.startsWith("สินค้าไม่เพียงพอ")) {
                return res.status(400).json({ message: e.message });
            }
            console.error(e);
            return res.status(500).json({ message: "create reservation error", error: e.message });
        }
    }),
    // ---------- ขอ OTP ส่งอีเมล ----------
    requestOtp: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        try {
            const reservationId = Number(req.params.id);
            if (!reservationId)
                return res.status(400).json({ message: "reservation id required" });
            const currentUserId = Number(req.userId);
            const r = yield prisma.reservation.findUnique({ where: { id: reservationId } });
            if (!r || r.userId !== currentUserId) {
                return res.status(404).json({ message: "reservation not found" });
            }
            const user = yield prisma.user.findUnique({ where: { user_id: currentUserId } });
            if (!(user === null || user === void 0 ? void 0 : user.user_email))
                return res.status(400).json({ message: "no email" });
            const code = String(Math.floor(100000 + Math.random() * 900000));
            const expiresAt = new Date(Date.now() + 5 * 60 * 1000);
            yield prisma.otpCode.upsert({
                where: { reservationId },
                update: { targetEmail: user.user_email, codeHash: hash(code), expiresAt, attempts: 5 },
                create: { reservationId, targetEmail: user.user_email, codeHash: hash(code), expiresAt },
            });
            const { previewUrl } = yield (0, mailer_1.sendOtpEmail)(user.user_email, code);
            return res.json({ ok: true, previewUrl });
        }
        catch (e) {
            console.error(e);
            return res.status(500).json({ message: "requestOtp error", error: e.message });
        }
    }),
    // ---------- ตรวจ OTP → ถ้าต้องจ่าย ออก QR 5 นาที ----------
    verifyOtp: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        var _a, _b, _c, _d, _e, _f, _g, _h;
        try {
            const reservationId = Number(req.params.id);
            const { code } = req.body;
            const otp = yield prisma.otpCode.findUnique({ where: { reservationId } });
            if (!otp)
                return res.status(400).json({ message: "OTP not found" });
            if (new Date() > otp.expiresAt)
                return res.status(400).json({ message: "OTP expired" });
            if (otp.attempts <= 0)
                return res.status(400).json({ message: "Too many attempts" });
            const ok = hash(code) === otp.codeHash;
            yield prisma.otpCode.update({
                where: { reservationId },
                data: { attempts: Math.max(0, otp.attempts - 1) },
            });
            if (!ok)
                return res.status(400).json({ message: "Invalid OTP" });
            const r = yield prisma.reservation.update({
                where: { id: reservationId },
                data: { status: "OTP_VERIFIED" },
            });
            // แจ้ง realtime
            (_a = req.app.get("io")) === null || _a === void 0 ? void 0 : _a.emit("reservation:updated", { id: r.id });
            // ตัดสินใจยอดที่จะชำระ
            let payAmount = 0;
            if (r.orderId) {
                const ord = yield prisma.order.findUnique({ where: { id: r.orderId } });
                payAmount = (_b = ord === null || ord === void 0 ? void 0 : ord.total) !== null && _b !== void 0 ? _b : 0;
            }
            else {
                payAmount = r.depositAmount || 0;
            }
            if (payAmount <= 0) {
                const confirmed = yield prisma.reservation.update({
                    where: { id: r.id },
                    data: { status: "CONFIRMED" },
                    include: { user: true, table: true, order: { include: { items: true } } }, // ✅ ดึง user, table เพิ่ม
                });
                if (confirmed.order) {
                    for (const item of confirmed.order.items) {
                        const menu = yield prisma.foodMenu.findUnique({
                            where: { menu_id: item.menuId },
                        });
                        if (menu && menu.isLimited === 1) {
                            yield prisma.foodMenu.update({
                                where: { menu_id: item.menuId },
                                data: { stock: { decrement: item.qty } },
                            });
                            (_c = req.app.get("io")) === null || _c === void 0 ? void 0 : _c.emit("menu:stock_updated", {
                                menuId: item.menuId,
                                newStock: ((_d = menu.stock) !== null && _d !== void 0 ? _d : 0) - item.qty,
                            });
                        }
                    }
                }
                if ((_e = confirmed.user) === null || _e === void 0 ? void 0 : _e.user_email) {
                    try {
                        console.log("[MAIL] Sending confirm email to:", confirmed.user.user_email);
                        const info = yield (0, sendConfirmEmail_1.sendConfirmEmail)(confirmed.user.user_email, {
                            userName: [confirmed.user.user_fname, confirmed.user.user_lname]
                                .filter(Boolean)
                                .join(" ") || confirmed.user.user_name,
                            tableLabel: (_f = confirmed.table) === null || _f === void 0 ? void 0 : _f.label,
                            dateStart: confirmed.dateStart,
                            dateEnd: confirmed.dateEnd,
                        }, confirmed.order);
                        console.log("[MAIL] Sent! MessageID:", info === null || info === void 0 ? void 0 : info.messageId);
                    }
                    catch (err) {
                        console.error("[MAIL] Failed to send confirm email:", (err === null || err === void 0 ? void 0 : err.message) || err);
                    }
                }
                (_g = req.app.get("io")) === null || _g === void 0 ? void 0 : _g.emit("reservation:confirmed", {
                    id: confirmed.id,
                    tableId: confirmed.tableId,
                    start: confirmed.dateStart,
                    end: confirmed.dateEnd,
                });
                return res.json({ ok: true, status: confirmed.status, payment: null });
            }
            const expire = new Date(Date.now() + 5 * 60 * 1000);
            const { payload, dataUrl } = yield (0, qr_1.buildPromptPay)(payAmount);
            const payment = yield prisma.payment.create({
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
                yield prisma.order.update({ where: { id: r.orderId }, data: { paymentId: payment.id } });
            }
            yield prisma.reservation.update({
                where: { id: r.id },
                data: { status: "AWAITING_PAYMENT", paymentId: payment.id, paymentExpiresAt: expire },
            });
            (_h = req.app.get("io")) === null || _h === void 0 ? void 0 : _h.emit("reservation:updated", { id: r.id });
            return res.json({ ok: true, status: "AWAITING_PAYMENT", payment });
        }
        catch (e) {
            console.error(e);
            return res.status(500).json({ message: "verifyOtp error", error: e.message });
        }
    }),
    confirm: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        var _a, _b, _c, _d, _e, _f, _g;
        const id = Number(req.params.id);
        if (!id)
            return res.status(400).json({ message: "id required" });
        const r = yield prisma.reservation.findUnique({
            where: { id },
            include: {
                order: { include: { items: true } },
            },
        });
        if (!r)
            return res.status(404).json({ message: "not found" });
        if (r.status === "CONFIRMED") {
            return res.json({ ok: true, id, status: "CONFIRMED" });
        }
        // ✅ อัปเดต stock ถ้ามี order
        if (r.order) {
            for (const item of r.order.items) {
                const menu = yield prisma.foodMenu.findUnique({
                    where: { menu_id: item.menuId },
                });
                if (menu && menu.isLimited === 1) {
                    yield prisma.foodMenu.update({
                        where: { menu_id: item.menuId },
                        data: { stock: { decrement: item.qty } },
                    });
                    (_a = req.app.get("io")) === null || _a === void 0 ? void 0 : _a.emit("menu:stock_updated", {
                        menuId: item.menuId,
                        newStock: ((_b = menu.stock) !== null && _b !== void 0 ? _b : 0) - item.qty,
                    });
                }
            }
        }
        const updated = yield prisma.reservation.update({
            where: { id },
            data: { status: "CONFIRMED" },
            include: { user: true, table: true, order: { include: { items: true } } },
        });
        // ✅ ต้องใช้ user_email และ table.label
        if ((_c = updated.user) === null || _c === void 0 ? void 0 : _c.user_email) {
            try {
                const reservationData = {
                    userName: [updated.user.user_fname, updated.user.user_lname].filter(Boolean).join(" ") ||
                        updated.user.user_name,
                    tableLabel: ((_d = updated.table) === null || _d === void 0 ? void 0 : _d.label) || "-",
                    dateStart: updated.dateStart,
                    dateEnd: updated.dateEnd,
                };
                const orderData = updated.order
                    ? {
                        total: updated.order.total,
                        items: updated.order.items.map((it) => ({
                            name: it.name,
                            qty: it.qty,
                            price: it.price,
                        })),
                    }
                    : null;
                console.log("[MAIL] sending to:", updated.user.user_email);
                const info = yield (0, sendConfirmEmail_1.sendConfirmEmail)(updated.user.user_email, reservationData, orderData);
                console.log("[MAIL] sent confirm email MessageId:", info === null || info === void 0 ? void 0 : info.messageId);
            }
            catch (e) {
                console.error("[MAIL] sendConfirmEmail failed:", e);
            }
        }
        else {
            console.warn("[MAIL] no email found for user:", (_e = updated.user) === null || _e === void 0 ? void 0 : _e.user_id);
        }
        (_f = req.app.get("io")) === null || _f === void 0 ? void 0 : _f.emit("reservation:confirmed", {
            id: updated.id,
            tableId: updated.tableId,
            start: updated.dateStart,
            end: updated.dateEnd,
        });
        (_g = req.app.get("io")) === null || _g === void 0 ? void 0 : _g.emit("reservation:updated", { id: updated.id });
        return res.json({ ok: true, id, status: "CONFIRMED" });
    }),
    // ========== TEST CONFIRM MAIL (manual) ==========
    // เพิ่มเมธอดนี้เข้าไปใน ReservationController
    update: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        var _a;
        try {
            const id = Number(req.params.id || 0);
            const { dateStart, dateEnd } = req.body;
            if (!id)
                return res.status(400).json({ message: "invalid id" });
            if (!dateStart || !dateEnd) {
                return res.status(400).json({ message: "ต้องมี dateStart และ dateEnd" });
            }
            const start = new Date(dateStart);
            const end = new Date(dateEnd);
            if (isNaN(+start) || isNaN(+end)) {
                return res.status(400).json({ message: "รูปแบบเวลาไม่ถูกต้อง" });
            }
            if (end.getTime() <= start.getTime()) {
                return res.status(400).json({ message: "เวลาสิ้นสุดต้องมากกว่าเวลาเริ่ม" });
            }
            // หาใบจองที่จะแก้
            const current = yield prisma.reservation.findUnique({
                where: { id },
                select: { id: true, tableId: true, status: true },
            });
            if (!current)
                return res.status(404).json({ message: "ไม่พบรายการจอง" });
            if (current.status === "CANCELED" || current.status === "EXPIRED") {
                return res.status(400).json({ message: "สถานะนี้ไม่สามารถแก้ไขได้" });
            }
            // กันเวลาชนกับใบจองอื่นในโต๊ะเดียวกัน (ไม่นับตัวเอง)
            if (current.tableId) {
                const clash = yield prisma.reservation.findFirst({
                    where: {
                        id: { not: id },
                        tableId: current.tableId,
                        status: { in: ["PENDING_OTP", "OTP_VERIFIED", "AWAITING_PAYMENT", "CONFIRMED"] },
                        // ซ้อนทับช่วงเวลา: start < otherEnd && end > otherStart
                        dateStart: { lt: end },
                        dateEnd: { gt: start },
                    },
                    select: { id: true },
                });
                if (clash) {
                    return res.status(409).json({ message: "ช่วงเวลานี้ชนกับการจองอื่นของโต๊ะเดียวกัน" });
                }
            }
            const updated = yield prisma.reservation.update({
                where: { id },
                data: { dateStart: start, dateEnd: end },
            });
            // แจ้ง realtime ให้ FE รีเฟรชแบบเนียนๆ
            (_a = req.app.get("io")) === null || _a === void 0 ? void 0 : _a.emit("reservation:updated", { id: updated.id });
            return res.json({
                ok: true,
                id: updated.id,
                dateStart: updated.dateStart,
                dateEnd: updated.dateEnd,
            });
        }
        catch (e) {
            console.error(e);
            return res.status(500).json({ message: "update reservation error", error: e.message });
        }
    }),
    // ---------- CANCEL (สำหรับแอดมิน) ----------
    cancel: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        var _a;
        try {
            const id = Number(req.params.id);
            const r = yield prisma.reservation.findUnique({ where: { id } });
            if (!r)
                return res.status(404).json({ message: "not found" });
            // if (r.status === "CONFIRMED") {
            //   return res.status(400).json({ message: "already confirmed" });
            // }
            yield prisma.reservation.update({ where: { id }, data: { status: "CANCELED" } });
            if (r.paymentId) {
                yield prisma.payment.update({ where: { id: r.paymentId }, data: { status: "CANCELED" } });
            }
            if (r.orderId) {
                yield prisma.order.update({ where: { id: r.orderId }, data: { status: "CANCELED" } });
            }
            (_a = req.app.get("io")) === null || _a === void 0 ? void 0 : _a.emit("reservation:canceled", { id });
            return res.json({ ok: true });
        }
        catch (e) {
            console.error(e);
            return res.status(500).json({ message: "cancel error", error: e.message });
        }
    }),
};
