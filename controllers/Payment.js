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
exports.PaymentController = void 0;
const client_1 = require("@prisma/client");
const sendConfirmEmail_1 = require("../OTP/sendConfirmEmail");
const prisma = new client_1.PrismaClient();
exports.PaymentController = {
    // ---------- GET ONE: GET /payment/:id ----------
    get: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        const id = Number(req.params.id);
        if (!id)
            return res.status(400).json({ message: "id required" });
        const row = yield prisma.payment.findUnique({ where: { id } });
        if (!row)
            return res.status(404).json({ message: "payment not found" });
        return res.json(row);
    }),
    // ---------- UPLOAD SLIP: POST /payment/:id/slip (multipart/form-data; field="slip") ----------
    uploadSlip: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        var _a;
        const id = Number(req.params.id);
        if (!id)
            return res.status(400).json({ message: "id required" });
        if (!req.file)
            return res.status(400).json({ message: "slip file required" });
        const exists = yield prisma.payment.findUnique({ where: { id } });
        if (!exists)
            return res.status(404).json({ message: "payment not found" });
        const slipPath = `/uploads/slips_images/${req.file.filename}`;
        const nextStatus = exists.status === "EXPIRED" || exists.status === "PENDING"
            ? "SUBMITTED"
            : exists.status;
        const updated = yield prisma.payment.update({
            where: { id },
            data: { slipImage: slipPath, status: nextStatus },
        });
        (_a = req.app.get("io")) === null || _a === void 0 ? void 0 : _a.emit("payment:updated", { id, status: updated.status });
        return res.json({ ok: true, id, slipImage: updated.slipImage, status: updated.status });
    }),
    // ---------- CONFIRM: POST /payment/:id/confirm ----------
    confirm: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        var _a, _b;
        const id = Number(req.params.id);
        if (!id)
            return res.status(400).json({ message: "id required" });
        const pay = yield prisma.payment.findUnique({
            where: { id },
            include: { order: true },
        });
        if (!pay)
            return res.status(404).json({ message: "not found" });
        // allow confirm even EXPIRED if slip exists
        if (pay.status === "EXPIRED" && !pay.slipImage) {
            return res.status(400).json({ message: "QR expired and no slip uploaded" });
        }
        const now = new Date();
        const result = yield prisma.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            var _a, _b;
            const updatedPay = yield tx.payment.update({
                where: { id },
                data: { status: "PAID", confirmedAt: now },
            });
            if (pay.order && pay.order.status !== "CONFIRMED") {
                yield tx.order.update({
                    where: { id: pay.order.id },
                    data: { status: "CONFIRMED" },
                });
            }
            const resv = yield tx.reservation.findFirst({ where: { paymentId: id } });
            let confirmedResv = null;
            if (resv && resv.status !== "CONFIRMED") {
                confirmedResv = yield tx.reservation.update({
                    where: { id: resv.id },
                    data: { status: "CONFIRMED" },
                });
            }
            return { updatedPay, confirmedResv, orderId: (_b = (_a = pay.order) === null || _a === void 0 ? void 0 : _a.id) !== null && _b !== void 0 ? _b : null };
        }));
        const io = req.app.get("io");
        io === null || io === void 0 ? void 0 : io.emit("payment:confirmed", { id, status: "PAID" });
        io === null || io === void 0 ? void 0 : io.emit("payment:updated", { id, status: "PAID" });
        if (result.orderId)
            io === null || io === void 0 ? void 0 : io.emit("order:updated", { id: result.orderId });
        if (result.confirmedResv) {
            io === null || io === void 0 ? void 0 : io.emit("reservation:confirmed", {
                id: result.confirmedResv.id,
                tableId: result.confirmedResv.tableId,
                start: result.confirmedResv.dateStart,
                end: result.confirmedResv.dateEnd,
            });
            io === null || io === void 0 ? void 0 : io.emit("reservation:updated", { id: result.confirmedResv.id });
            // ============ ส่งอีเมลยืนยันหลัง Confirm ============
            try {
                const resvFull = yield prisma.reservation.findUnique({
                    where: { id: result.confirmedResv.id },
                    include: {
                        user: true,
                        table: true,
                        order: { include: { items: true } },
                    },
                });
                if ((_a = resvFull === null || resvFull === void 0 ? void 0 : resvFull.user) === null || _a === void 0 ? void 0 : _a.user_email) {
                    const reservationData = {
                        userName: [resvFull.user.user_fname, resvFull.user.user_lname].filter(Boolean).join(" ") ||
                            resvFull.user.user_name,
                        tableLabel: ((_b = resvFull.table) === null || _b === void 0 ? void 0 : _b.label) || "-",
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
                    const info = yield (0, sendConfirmEmail_1.sendConfirmEmail)(resvFull.user.user_email, reservationData, orderData);
                    console.log("[MAIL] Sent confirm email:", info === null || info === void 0 ? void 0 : info.messageId);
                }
                else {
                    console.warn("[MAIL] skip: no user_email");
                }
            }
            catch (e) {
                console.error("[MAIL] sendConfirmEmail failed:", (e === null || e === void 0 ? void 0 : e.message) || e);
            }
            // ===============================================
        }
        return res.json({
            ok: true,
            id,
            status: "PAID",
            confirmedAt: now.toISOString(),
        });
    }),
    // ---------- CANCEL: POST /payment/:id/cancel ----------
    cancel: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        var _a;
        const id = Number(req.params.id);
        if (!id)
            return res.status(400).json({ message: "id required" });
        const exists = yield prisma.payment.findUnique({ where: { id } });
        if (!exists)
            return res.status(404).json({ message: "not found" });
        const updated = yield prisma.payment.update({
            where: { id },
            data: { status: "CANCELED" },
        });
        (_a = req.app.get("io")) === null || _a === void 0 ? void 0 : _a.emit("payment:updated", { id, status: "CANCELED" });
        return res.json({ ok: true, id, status: "CANCELED" });
    }),
};
