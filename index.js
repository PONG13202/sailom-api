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
const express_1 = __importDefault(require("express"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const dotenv_1 = __importDefault(require("dotenv"));
const cors_1 = __importDefault(require("cors"));
const UserController_1 = require("./controllers/UserController");
const FrontController_1 = require("./controllers/FrontController");
const multer_1 = __importDefault(require("multer"));
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const http_1 = __importDefault(require("http"));
const socket_io_1 = require("socket.io");
const Reservation_1 = require("./controllers/Reservation");
const Payment_1 = require("./controllers/Payment");
const Orders_1 = require("./controllers/Orders");
const client_1 = require("@prisma/client");
const prisma = new client_1.PrismaClient();
dotenv_1.default.config();
const app = (0, express_1.default)();
const port = 5000;
app.use((0, cors_1.default)({
    origin: ["http://localhost:3000", "http://localhost:3001"],
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    credentials: true,
}));
app.use(express_1.default.urlencoded({ extended: true }));
app.use(express_1.default.json());
const extraUploadDir = process.env.UPLOAD_DIR || "uploads";
[
    "uploads",
    "uploads/user_images",
    "uploads/menu_images",
    "uploads/slide_images",
    "uploads/slips_images",
    extraUploadDir,
].forEach((dir) => {
    const abs = path_1.default.resolve(dir);
    if (!fs_1.default.existsSync(abs))
        fs_1.default.mkdirSync(abs, { recursive: true });
});
app.use("/uploads", express_1.default.static(path_1.default.resolve("uploads")));
const server = http_1.default.createServer(app);
const io = new socket_io_1.Server(server, {
    cors: {
        origin: ["http://localhost:3000", "http://localhost:3001"],
        methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        credentials: true,
    },
});
app.set("io", io);
function expireSweep() {
    return __awaiter(this, void 0, void 0, function* () {
        const now = new Date();
        // 1) หมดเวลา Payment -> EXPIRED เฉพาะที่ "ยังไม่มีสลิป"
        const expiredPayments = yield prisma.payment.updateMany({
            where: {
                status: { in: ["PENDING", "SUBMITTED"] },
                expiresAt: { lt: now },
                slipImage: null, // ✅ มีสลิปแล้ว "อย่า" expire
            },
            data: { status: "EXPIRED" },
        });
        // 2) ใบจองที่ยังไม่คอนเฟิร์ม -> EXPIRED
        const expiredResv = yield prisma.reservation.updateMany({
            where: {
                status: { in: ["PENDING_OTP", "OTP_VERIFIED", "AWAITING_PAYMENT"] },
                OR: [
                    { paymentExpiresAt: { lt: now } },
                    { OtpCode: { is: { expiresAt: { lt: now } } } },
                ],
                // ✅ ถ้ามีสลิปแล้ว อย่าทำใบจองหมดอายุ
                NOT: { payment: { slipImage: { not: null } } },
            },
            data: { status: "EXPIRED" },
        });
        // 3) ยกเลิกออร์เดอร์ที่ PENDING แต่ payment หมดเวลา (และไม่มีสลิป)
        yield prisma.order.updateMany({
            where: { status: "PENDING", payment: { status: "EXPIRED" } },
            data: { status: "CANCELED" },
        });
        // 4) ลบ OTP ที่หมดอายุ
        yield prisma.otpCode.deleteMany({ where: { expiresAt: { lt: now } } });
        if (expiredPayments || expiredResv) {
            io.emit("reservation:expired", { at: now.toISOString() });
        }
    });
}
io.on("connection", (socket) => {
    console.log("Client connected:", socket.id);
    socket.on("join", (room) => socket.join(room));
    socket.on("leave", (room) => socket.leave(room));
    socket.on("disconnect", () => {
    });
});
// user images
const userStorage = multer_1.default.diskStorage({
    destination: (_req, _file, cb) => cb(null, "uploads/user_images"),
    filename: (_req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`),
});
const upload = (0, multer_1.default)({ storage: userStorage });
// menu images
const menuStorage = multer_1.default.diskStorage({
    destination: (_req, _file, cb) => cb(null, "uploads/menu_images"),
    filename: (_req, file, cb) => {
        const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
        const ext = path_1.default.extname(file.originalname);
        cb(null, `menu-${uniqueSuffix}${ext}`);
    },
});
const uploadMenuImage = (0, multer_1.default)({ storage: menuStorage });
// slide images
const slideStorage = multer_1.default.diskStorage({
    destination: (_req, _file, cb) => cb(null, "uploads/slide_images"),
    filename: (_req, file, cb) => {
        const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
        const ext = path_1.default.extname(file.originalname);
        cb(null, `slide-${uniqueSuffix}${ext}`);
    },
});
const uploadSlide = (0, multer_1.default)({ storage: slideStorage });
// payment slip images
const slipStorage = multer_1.default.diskStorage({
    destination: (_req, _file, cb) => cb(null, "uploads/slips_images"), // อยู่ใต้ /uploads ก็พอ
    filename: (_req, file, cb) => {
        const ext = path_1.default.extname(file.originalname);
        cb(null, `slip-${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`);
    },
});
const uploadSlip = (0, multer_1.default)({ storage: slipStorage });
// ===================== Auth middleware =====================
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers["authorization"];
    const token = authHeader && authHeader.split(" ")[1];
    if (!token) {
        res.status(401).json({ message: "ไม่ได้รับ token" });
        return;
    }
    jsonwebtoken_1.default.verify(token, process.env.JWT_SECRET, (err, decoded) => {
        var _a, _b;
        if (err) {
            res.status(403).json({ message: "token ไม่ถูกต้อง" });
            return;
        }
        req.user = decoded;
        // ✅ ยุบชื่อ field ให้เป็น userId มาตรฐานเดียว
        req.userId = Number((_b = (_a = decoded === null || decoded === void 0 ? void 0 : decoded.user_id) !== null && _a !== void 0 ? _a : decoded === null || decoded === void 0 ? void 0 : decoded.id) !== null && _b !== void 0 ? _b : decoded === null || decoded === void 0 ? void 0 : decoded.userId) || undefined;
        next();
    });
};
// 
const requireAdmin = (req, res, next) => {
    var _a;
    if (!((_a = req.user) === null || _a === void 0 ? void 0 : _a.isAdmin)) {
        res.status(403).json({ message: "Only admin" });
        return; // ✅ จบด้วย void (ไม่ return Response)
    }
    next();
};
// Orders 
app.get("/orders", authenticateToken, (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        yield Orders_1.OrdersController.list(req, res);
    }
    catch (e) {
        console.error(e);
        res.status(500).json({ message: "Internal Server Error" });
    }
}));
app.get("/orders/:id", authenticateToken, (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        yield Orders_1.OrdersController.get(req, res);
    }
    catch (e) {
        console.error(e);
        res.status(500).json({ message: "Internal Server Error" });
    }
}));
app.patch("/orders/:id", authenticateToken, (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        yield Orders_1.OrdersController.update(req, res);
    }
    catch (e) {
        console.error(e);
        res.status(500).json({ message: "Internal Server Error" });
    }
}));
// ---------------- Payment  ----------------
app.get("/payment/:id", authenticateToken, (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        yield Payment_1.PaymentController.get(req, res);
    }
    catch (e) {
        console.error(e);
        res.status(500).json({ message: "Internal Server Error" });
    }
}));
app.post("/payment/:id/confirm", authenticateToken, (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        yield Payment_1.PaymentController.confirm(req, res);
    }
    catch (e) {
        console.error(e);
        res.status(500).json({ message: "Internal Server Error" });
    }
}));
app.post("/payment/:id/cancel", authenticateToken, (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        yield Payment_1.PaymentController.cancel(req, res);
    }
    catch (e) {
        console.error(e);
        res.status(500).json({ message: "Internal Server Error" });
    }
}));
app.post("/reservations", authenticateToken, (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        yield Reservation_1.ReservationController.create(req, res);
    }
    catch (_a) {
        res.status(500).json({ message: "Internal Server Error" });
    }
}));
app.get("/reservation/:id", authenticateToken, (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        yield Reservation_1.ReservationController.get(req, res);
    }
    catch (e) {
        console.error(e);
        res.status(500).json({ message: "Internal Server Error" });
    }
}));
app.post("/reservations/:id/confirm", authenticateToken, (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        yield Reservation_1.ReservationController.confirm(req, res);
    }
    catch (_a) {
        res.status(500).json({ message: "Internal Server Error" });
    }
}));
app.patch("/reservations/:id", authenticateToken, (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        yield Reservation_1.ReservationController.update(req, res);
    }
    catch (e) {
        console.error(e);
        res.status(500).json({ message: "Internal Server Error" });
    }
}));
app.post("/reservations/:id/request-otp", authenticateToken, (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        yield Reservation_1.ReservationController.requestOtp(req, res);
    }
    catch (_a) {
        res.status(500).json({ message: "Internal Server Error" });
    }
}));
app.post("/reservations/:id/verify-otp", authenticateToken, (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        yield Reservation_1.ReservationController.verifyOtp(req, res);
    }
    catch (_a) {
        res.status(500).json({ message: "Internal Server Error" });
    }
}));
app.post("/reservations/:id/cancel", authenticateToken, (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        yield Reservation_1.ReservationController.cancel(req, res);
    }
    catch (_a) {
        res.status(500).json({ message: "Internal Server Error" });
    }
}));
// ====== Payment ======
app.get("/payment/:id", authenticateToken, (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        yield Payment_1.PaymentController.get(req, res);
    }
    catch (_a) {
        res.status(500).json({ message: "Internal Server Error" });
    }
}));
app.post("/payment/:id/slip", authenticateToken, uploadSlip.single("slip"), (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        yield Payment_1.PaymentController.uploadSlip(req, res);
    }
    catch (_a) {
        res.status(500).json({ message: "Internal Server Error" });
    }
}));
// app.post("/payment/:id/confirm",
//   authenticateToken,async (req, res) => {
//     try { await PaymentController.confirm(req, res); }
//     catch { res.status(500).json({ message: "Internal Server Error" }); }
//   }
// );
// ===================== Routes =====================
// password verify
app.get("/reservation", authenticateToken, (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        yield UserController_1.UserController.reservation(req, res);
    }
    catch (_a) {
        res.status(500).json({ message: "Internal Server Error" });
    }
}));
app.post("/verify_password", authenticateToken, (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        yield UserController_1.UserController.verify_password(req, res);
    }
    catch (_a) {
        res.status(500).json({ message: "Internal Server Error" });
    }
}));
// front checks
app.get("/check_user", (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        yield FrontController_1.FrontController.check_user(req, res);
    }
    catch (_a) {
        res.status(500).json({ message: "Internal Server Error" });
    }
}));
app.get("/check_mail", (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        yield FrontController_1.FrontController.check_mail(req, res);
    }
    catch (_a) {
        res.status(500).json({ message: "Internal Server Error" });
    }
}));
// front sign in/up
app.post("/signin", (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        yield FrontController_1.FrontController.signin(req, res);
    }
    catch (_a) {
        res.status(500).json({ message: "Internal Server Error" });
    }
}));
app.post("/signup", upload.single("user_img"), (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        yield FrontController_1.FrontController.signup(req, res);
    }
    catch (_a) {
        res.status(500).json({ message: "Internal Server Error" });
    }
}));
app.post("/google_signin", (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        yield FrontController_1.FrontController.google_signin(req, res);
    }
    catch (_a) {
        res.status(500).json({ message: "Internal Server Error" });
    }
}));
app.post("/add_profile", authenticateToken, upload.single("user_img"), (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        yield FrontController_1.FrontController.add_profile(req, res);
    }
    catch (_a) {
        res.status(500).json({ message: "Internal Server Error" });
    }
}));
app.get("/user_info", authenticateToken, (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        yield FrontController_1.FrontController.user_info(req, res);
    }
    catch (_a) {
        res.status(500).json({ message: "Internal Server Error" });
    }
}));
// grid size
app.get("/grid_size", (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        yield UserController_1.UserController.grid_size(req, res);
    }
    catch (_a) {
        res.status(500).json({ message: "Internal Server Error" });
    }
}));
app.post("/add_grid_size", (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        yield UserController_1.UserController.add_grid_size(req, res);
    }
    catch (_a) {
        res.status(500).json({ message: "Internal Server Error" });
    }
}));
// menus
app.get("/menus", (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        yield UserController_1.UserController.menus(req, res);
    }
    catch (_a) {
        res.status(500).json({ message: "Internal Server Error" });
    }
}));
app.post("/add_menu", uploadMenuImage.array("images", 10), (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        yield UserController_1.UserController.add_menu(req, res);
    }
    catch (error) {
        console.error("Error in /add_menu route:", error);
        res.status(500).json({ message: "Internal Server Error" });
    }
}));
app.put("/update_menu/:id", uploadMenuImage.array("newImages", 10), (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        yield UserController_1.UserController.update_menu(req, res);
    }
    catch (error) {
        console.error("Error in /update_menu route:", error);
        res.status(500).json({ message: "Internal Server Error" });
    }
}));
app.delete("/delete_menu/:id", (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        yield UserController_1.UserController.delete_menu(req, res);
    }
    catch (_a) {
        res.status(500).json({ message: "Internal Server Error" });
    }
}));
// admin/auth
app.post("/register", upload.single("user_img"), (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        yield UserController_1.UserController.register(req, res);
    }
    catch (_a) {
        res.status(500).json({ message: "Internal Server Error" });
    }
}));
app.post("/google_login", (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        yield UserController_1.UserController.google_login(req, res);
    }
    catch (_a) {
        res.status(500).json({ message: "Internal Server Error" });
    }
}));
app.post("/complete_profile", authenticateToken, (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        yield UserController_1.UserController.complete_profile(req, res);
    }
    catch (_a) {
        res.status(500).json({ message: "Internal Server Error" });
    }
}));
app.post("/login", (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        yield UserController_1.UserController.login(req, res);
    }
    catch (_a) {
        res.status(500).json({ message: "Internal Server Error" });
    }
}));
app.get("/check_username", (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        yield UserController_1.UserController.check_username(req, res);
    }
    catch (_a) {
        res.status(500).json({ message: "Internal Server Error" });
    }
}));
app.get("/check_email", (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        yield UserController_1.UserController.check_email(req, res);
    }
    catch (_a) {
        res.status(500).json({ message: "Internal Server Error" });
    }
}));
app.post("/add_user", upload.single("user_img"), authenticateToken, (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        yield UserController_1.UserController.add_user(req, res);
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ message: "Internal Server Error" });
    }
}));
app.get("/all_user", (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        yield UserController_1.UserController.all_user(req, res);
    }
    catch (_a) {
        res.status(500).json({ message: "Internal Server Error" });
    }
}));
app.get("/info", authenticateToken, (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        yield UserController_1.UserController.info(req, res);
    }
    catch (_a) {
        res.status(500).json({ message: "Internal Server Error" });
    }
}));
app.put("/update_user/:user_id", upload.single("user_img"), authenticateToken, (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        yield UserController_1.UserController.update_user(req, res);
    }
    catch (_a) {
        res.status(500).json({ message: "Internal Server Error" });
    }
}));
app.put("/users/:userId/status", authenticateToken, (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        yield UserController_1.UserController.update_user_status(req, res);
    }
    catch (_a) {
        res.status(500).json({ message: "Internal Server Error" });
    }
}));
app.put("/users/:userId/roles", authenticateToken, (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        yield UserController_1.UserController.update_user_roles(req, res);
    }
    catch (_a) {
        res.status(500).json({ message: "Internal Server Error" });
    }
}));
app.delete("/delete_user/:user_id", authenticateToken, (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        yield UserController_1.UserController.delete_user(req, res);
    }
    catch (_a) {
        res.status(500).json({ message: "Internal Server Error" });
    }
}));
// seats / tables / types
app.post("/add_seat", (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        yield UserController_1.UserController.add_seat(req, res);
    }
    catch (_a) {
        res.status(500).json({ message: "Internal Server Error" });
    }
}));
app.get("/seats", (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        yield UserController_1.UserController.seats(req, res);
    }
    catch (_a) {
        res.status(500).json({ message: "Internal Server Error" });
    }
}));
app.delete("/delete_seat/:id", (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        yield UserController_1.UserController.delete_seat(req, res);
    }
    catch (_a) {
        res.status(500).json({ message: "Internal Server Error" });
    }
}));
app.post("/add_TableType", (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        yield UserController_1.UserController.add_TableType(req, res);
    }
    catch (_a) {
        res.status(500).json({ message: "Internal Server Error" });
    }
}));
app.get("/table_Types", (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        yield UserController_1.UserController.table_Types(req, res);
    }
    catch (_a) {
        res.status(500).json({ message: "Internal Server Error" });
    }
}));
app.delete("/delete_TablType/:id", (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        yield UserController_1.UserController.delete_TablType(req, res);
    }
    catch (_a) {
        res.status(500).json({ message: "Internal Server Error" });
    }
}));
app.post("/add_table", (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        yield UserController_1.UserController.add_table(req, res);
    }
    catch (_a) {
        res.status(500).json({ message: "Internal Server Error" });
    }
}));
app.get("/tables", (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        yield UserController_1.UserController.tables(req, res);
    }
    catch (_a) {
        res.status(500).json({ message: "Internal Server Error" });
    }
}));
app.put("/update_table/:id", (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        yield UserController_1.UserController.update_table(req, res);
    }
    catch (_a) {
        res.status(500).json({ message: "Internal Server Error" });
    }
}));
app.post("/save_table_positions", (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        yield UserController_1.UserController.save_table_positions(req, res);
    }
    catch (_a) {
        res.status(500).json({ message: "Internal Server Error" });
    }
}));
app.put("/update_table_status/:id", (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        yield UserController_1.UserController.update_table_status(req, res);
    }
    catch (_a) {
        res.status(500).json({ message: "Internal Server Error" });
    }
}));
app.delete("/delete_table/:id", (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        yield UserController_1.UserController.delete_table(req, res);
    }
    catch (_a) {
        res.status(500).json({ message: "Internal Server Error" });
    }
}));
// food types
app.get("/foodTypes", (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        yield UserController_1.UserController.foodTypes(req, res);
    }
    catch (_a) {
        res.status(500).json({ message: "Internal Server Error" });
    }
}));
app.post("/add_FoodType", (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        yield UserController_1.UserController.add_FoodType(req, res);
    }
    catch (_a) {
        res.status(500).json({ message: "Internal Server Error" });
    }
}));
app.put("/update_FoodType/:id", (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        yield UserController_1.UserController.update_FoodType(req, res);
    }
    catch (_a) {
        res.status(500).json({ message: "Internal Server Error" });
    }
}));
app.delete("/delete_FoodType/:id", (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        yield UserController_1.UserController.delete_FoodType(req, res);
    }
    catch (_a) {
        res.status(500).json({ message: "Internal Server Error" });
    }
}));
app.get("/slides", (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        yield UserController_1.UserController.slides(req, res);
    }
    catch (_a) {
        res.status(500).json({ message: "Internal Server Error" });
    }
}));
app.post("/add_slide", uploadSlide.single("image"), (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        yield UserController_1.UserController.add_slide(req, res);
    }
    catch (_a) {
        res.status(500).json({ message: "Internal Server Error" });
    }
}));
app.put("/update_slide/:id", uploadSlide.single("image"), (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        yield UserController_1.UserController.update_slide(req, res);
    }
    catch (_a) {
        res.status(500).json({ message: "Internal Server Error" });
    }
}));
app.delete("/delete_slide/:id", (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        yield UserController_1.UserController.delete_slide(req, res);
    }
    catch (_a) {
        res.status(500).json({ message: "Internal Server Error" });
    }
}));
app.get("/location", (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        yield UserController_1.UserController.location(req, res);
    }
    catch (_a) {
        res.status(500).json({ message: "Internal Server Error" });
    }
}));
app.put("/update_location/:id", (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        yield UserController_1.UserController.update_location(req, res);
    }
    catch (_a) {
        res.status(500).json({ message: "Internal Server Error" });
    }
}));
app.get("/contacts", (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        yield UserController_1.UserController.contacts(req, res);
    }
    catch (_a) {
        res.status(500).json({ message: "Internal Server Error" });
    }
}));
app.post("/add_contact", (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        yield UserController_1.UserController.add_contact(req, res);
    }
    catch (_a) {
        res.status(500).json({ message: "Internal Server Error" });
    }
}));
app.put("/update_contact/:id", (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        yield UserController_1.UserController.update_contact(req, res);
    }
    catch (_a) {
        res.status(500).json({ message: "Internal Server Error" });
    }
}));
app.delete("/delete_contact/:id", (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        yield UserController_1.UserController.delete_contact(req, res);
    }
    catch (_a) {
        res.status(500).json({ message: "Internal Server Error" });
    }
}));
app.get("/slides_show", (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        yield FrontController_1.FrontController.slides_show(req, res);
    }
    catch (_a) {
        res.status(500).json({ message: "Internal Server Error" });
    }
}));
app.get("/seat", (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        yield FrontController_1.FrontController.seat(req, res);
    }
    catch (_a) {
        res.status(500).json({ message: "Internal Server Error" });
    }
}));
app.get("/locations", (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        yield FrontController_1.FrontController.locations(req, res);
    }
    catch (_a) {
        res.status(500).json({ message: "Internal Server Error" });
    }
}));
app.get("/table", (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        yield FrontController_1.FrontController.table(req, res);
    }
    catch (_a) {
        res.status(500).json({ message: "Internal Server Error" });
    }
}));
app.get("/grid", (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        yield FrontController_1.FrontController.grid(req, res);
    }
    catch (_a) {
        res.status(500).json({ message: "Internal Server Error" });
    }
}));
app.get("/menu", (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        yield FrontController_1.FrontController.menu(req, res);
    }
    catch (_a) {
        res.status(500).json({ message: "Internal Server Error" });
    }
}));
app.get("/foodType", (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        yield FrontController_1.FrontController.foodType(req, res);
    }
    catch (_a) {
        res.status(500).json({ message: "Internal Server Error" });
    }
}));
// ประวัติการจองของฉัน (ลูกค้าฝั่งหน้าบ้าน)
app.get("/my_reservations", authenticateToken, (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        yield FrontController_1.FrontController.my_reservations(req, res);
    }
    catch (e) {
        console.error(e);
        res.status(500).json({ message: "Internal Server Error" });
    }
}));
// อัปโหลดรูปโปรไฟล์ (อย่าลืมใช้ storage user_images ที่ประกาศไว้)
app.post("/upload_avatar", authenticateToken, upload.single("file"), (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        yield FrontController_1.FrontController.upload_avatar(req, res);
    }
    catch (_a) {
        res.status(500).json({ message: "Internal Server Error" });
    }
}));
// อัปเดตข้อมูลโปรไฟล์
// เดิม: app.put("/update_profile", authenticateToken, async (req,res)=>{...})
app.put("/update_profile", authenticateToken, upload.single("user_img"), // << เพิ่ม multer ตรงนี้ ฟิลด์ชื่อ user_img
(req, res) => __awaiter(void 0, void 0, void 0, function* () { yield FrontController_1.FrontController.update_profile(req, res); }));
// เปลี่ยนรหัสผ่าน
app.post("/change_password", authenticateToken, (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        yield FrontController_1.FrontController.change_password(req, res);
    }
    catch (_a) {
        res.status(500).json({ message: "Internal Server Error" });
    }
}));
// (ทางเลือก) health check
app.get("/health", (_req, res) => {
    res.status(200).json({ ok: true });
});
// เริ่มเซิร์ฟเวอร์
server.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});
