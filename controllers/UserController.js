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
var __rest = (this && this.__rest) || function (s, e) {
    var t = {};
    for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p) && e.indexOf(p) < 0)
        t[p] = s[p];
    if (s != null && typeof Object.getOwnPropertySymbols === "function")
        for (var i = 0, p = Object.getOwnPropertySymbols(s); i < p.length; i++) {
            if (e.indexOf(p[i]) < 0 && Object.prototype.propertyIsEnumerable.call(s, p[i]))
                t[p[i]] = s[p[i]];
        }
    return t;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.UserController = exports.ROLE_VALUES = void 0;
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const client_1 = require("@prisma/client");
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const dotenv_1 = __importDefault(require("dotenv"));
const axios_1 = __importDefault(require("axios"));
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
dotenv_1.default.config();
const prisma = new client_1.PrismaClient();
const secret = process.env.JWT_SECRET;
// api\uploads\menu_images
const UPLOADS_DIR = path_1.default.resolve("uploads/menu_images");
// api\uploads\slide_images
const SLIDE_UPLOADS_DIR = path_1.default.resolve("uploads/slide_images");
const getIO = (req) => req.app.get("io");
const emit = (req, event, payload) => {
    var _a;
    (_a = getIO(req)) === null || _a === void 0 ? void 0 : _a.emit(event, payload);
};
function dayRange(dateStr) {
    // ถ้า FE ไม่ส่งมา ให้ใช้ "วันนี้" ของไทย
    // ปลอดภัยสุดคือให้ FE ส่ง YYYY-MM-DD มาเสมอ
    const tz = "+07:00";
    const d = dateStr !== null && dateStr !== void 0 ? dateStr : new Date().toISOString().slice(0, 10); // YYYY-MM-DD (ของ UTC)
    const start = new Date(`${d}T00:00:00${tz}`);
    const end = new Date(`${d}T24:00:00${tz}`);
    return { start, end };
}
const buildRoles = (isAdmin, isStaff) => {
    const roles = [];
    if (isAdmin)
        roles.push("admin");
    if (isStaff)
        roles.push("staff");
    if (!isAdmin && !isStaff)
        roles.push("user");
    return roles;
};
exports.ROLE_VALUES = ["admin", "staff", "user"];
exports.UserController = {
    verify_password: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        var _a, _b, _c;
        try {
            const { password } = req.body;
            if (!password || typeof password !== "string") {
                return res.status(400).json({ message: "กรุณากรอกรหัสผ่าน" });
            }
            // ดึง claims ตรงๆจาก middleware (ห้ามไว้วางใจชื่อ field เดียว)
            const claims = req.user || {};
            // พยายาม extract user id จากหลายๆ field ที่พบบ่อยใน JWT
            const pickId = (v) => {
                if (typeof v === "number" && Number.isFinite(v))
                    return v;
                if (typeof v === "string" && /^\d+$/.test(v))
                    return parseInt(v, 10);
                return undefined;
            };
            const actorId = (_c = (_b = (_a = pickId(claims.user_id)) !== null && _a !== void 0 ? _a : pickId(claims.userId)) !== null && _b !== void 0 ? _b : pickId(claims.id)) !== null && _c !== void 0 ? _c : pickId(claims.sub);
            // หา user ตาม actorId ก่อน ถ้าไม่มีลอง fallback ด้วย email (ถ้า token มี)
            let user = actorId !== undefined
                ? yield prisma.user.findUnique({
                    where: { user_id: actorId },
                    select: { user_id: true, user_pass: true },
                })
                : null;
            if (!user && typeof claims.email === "string" && claims.email) {
                user = yield prisma.user.findUnique({
                    where: { user_email: claims.email },
                    select: { user_id: true, user_pass: true },
                });
            }
            if (!user) {
                // ยังยืนยันตัวตนไม่ได้เพราะไม่มีวิธีผูก token กับผู้ใช้ในระบบ
                return res.status(401).json({ message: "ไม่ได้รับอนุญาต" });
            }
            if (!user.user_pass) {
                return res.status(400).json({
                    message: "ผู้ใช้นี้ไม่ได้ตั้งรหัสผ่าน (เข้าสู่ระบบด้วย Google)",
                });
            }
            const isPasswordMatch = yield bcryptjs_1.default.compare(password, user.user_pass);
            if (!isPasswordMatch) {
                return res.status(401).json({ message: "รหัสผ่านไม่ถูกต้อง" });
            }
            return res.status(200).json({ message: "ยืนยันรหัสผ่านสำเร็จ" });
        }
        catch (error) {
            console.error("Error verifying password:", error);
            return res.status(500).json({ message: "Internal Server Error" });
        }
    }),
    check_username: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        try {
            const { user_name } = req.query;
            if (!user_name || typeof user_name !== "string") {
                return res.status(400).json({ message: "กรุณาระบุชื่อผู้ใช้" });
            }
            const user = yield prisma.user.findUnique({
                where: { user_name },
            });
            if (user) {
                return res
                    .status(200)
                    .json({ available: false, message: "ชื่อผู้ใช้นี้ถูกใช้ไปแล้ว" });
            }
            return res.status(200).json({ available: true });
        }
        catch (error) {
            console.error("Error in check_username:", error);
            return res.status(500).json({ message: "ไม่สามารถตรวจสอบชื่อผู้ใช้ได้" });
        }
    }),
    check_email: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        const { user_email } = req.query;
        if (!user_email || typeof user_email !== "string") {
            return res
                .status(400)
                .json({ available: false, message: "Invalid email" });
        }
        try {
            const existemail = yield prisma.user.findUnique({
                where: { user_email: user_email },
            });
            if (existemail) {
                return res.json({ available: false });
            }
            return res.json({ available: true });
        }
        catch (error) {
            console.error("Email check error:", error);
            return res
                .status(500)
                .json({ available: false, message: "Server error" });
        }
    }),
    register: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        var _a;
        try {
            // Use upload.single('user_profile_picture') as middleware before this controller
            // The file will be available at req.file
            const { user_name, user_pass, user_fname, user_lname, user_email, user_phone, user_status, google_id, } = req.body;
            // The uploaded file object
            const user_img_path = req.file
                ? `uploads/user_images/${req.file.filename}`
                : null;
            if (!user_email) {
                return res.status(400).json({ message: "กรุณาระบุอีเมล" });
            }
            if (!google_id) {
                if (!user_name || !user_pass) {
                    return res
                        .status(400)
                        .json({ message: "กรุณาระบุชื่อผู้ใช้และรหัสผ่าน" });
                }
                if (!user_fname || !user_lname) {
                    return res
                        .status(400)
                        .json({ message: "กรุณาระบุชื่อจริงและนามสกุล" });
                }
            }
            // ตรวจสอบการสมัครซ้ำ
            const existingUser = yield prisma.user.findFirst({
                where: {
                    OR: [
                        user_name && !google_id ? { user_name } : undefined,
                        { user_email },
                        google_id ? { google_id } : undefined,
                    ].filter(Boolean),
                },
            });
            if (existingUser) {
                // If a file was uploaded, remove it if the user already exists
                if (req.file) {
                    fs_1.default.unlink(req.file.path, (err) => {
                        if (err)
                            console.error("Error deleting uploaded file:", err);
                    });
                }
                if (user_name && existingUser.user_name === user_name && !google_id) {
                    return res.status(400).json({ message: "ชื่อผู้ใช้นี้ถูกใช้ไปแล้ว" });
                }
                if (existingUser.user_email === user_email) {
                    return res.status(400).json({ message: "อีเมลนี้ถูกใช้ไปแล้ว" });
                }
                if (google_id && existingUser.google_id === google_id) {
                    return res
                        .status(400)
                        .json({ message: "บัญชี Google นี้ถูกใช้ไปแล้ว" });
                }
            }
            // เข้ารหัสรหัสผ่านถ้ามี
            let hashedPassword = null;
            if (user_pass) {
                hashedPassword = yield bcryptjs_1.default.hash(user_pass, 10);
            }
            // สร้างผู้ใช้ใหม่
            const newUser = yield prisma.user.create({
                data: {
                    user_name: google_id ? null : user_name,
                    user_pass: hashedPassword,
                    user_fname: user_fname || null,
                    user_lname: user_lname || null,
                    user_email,
                    user_phone: user_phone || null,
                    user_img: user_img_path, // Save the path to the uploaded image
                    user_status: user_status !== null && user_status !== void 0 ? user_status : 1,
                    google_id: google_id || null,
                },
            });
            (_a = getIO(req)) === null || _a === void 0 ? void 0 : _a.emit("new_user", {
                user_id: newUser.user_id,
                user_email: newUser.user_email,
            });
            return res.status(200).json({
                message: "สมัครสมาชิกสำเร็จ",
                user: {
                    id: newUser.user_id,
                    user_name: newUser.user_name,
                    user_fname: newUser.user_fname,
                    user_lname: newUser.user_lname,
                    user_email: newUser.user_email,
                    user_phone: newUser.user_phone,
                    user_status: newUser.user_status,
                    user_img: newUser.user_img, // Return the image path
                },
            });
        }
        catch (error) {
            console.error("Error during registration:", error);
            // If an error occurs after file upload but before saving to DB, delete the file
            if (req.file) {
                fs_1.default.unlink(req.file.path, (err) => {
                    if (err)
                        console.error("Error deleting uploaded file on registration error:", err);
                });
            }
            return res.status(500).json({
                message: "เกิดข้อผิดพลาดในการสมัครสมาชิก: " + error.message,
            });
        }
    }),
    google_login: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        var _a;
        try {
            const { token } = req.body;
            if (!token) {
                return res.status(400).json({ message: "Token ไม่ถูกส่งมา" });
            }
            const googleResponse = yield axios_1.default.get(`https://oauth2.googleapis.com/tokeninfo?id_token=${token}`);
            const { sub: googleId, email, given_name: first_name, family_name: last_name, picture: profile_image, email_verified, } = googleResponse.data;
            if (!email_verified) {
                return res
                    .status(400)
                    .json({ message: "อีเมล Google ยังไม่ได้รับการยืนยัน" });
            }
            const [adminByEmail, staffByEmail] = yield Promise.all([
                prisma.admin.findFirst({ where: { user: { user_email: email } }, include: { user: true } }),
                prisma.staff.findFirst({ where: { user: { user_email: email } }, include: { user: true } }),
            ]);
            if (!adminByEmail && !staffByEmail) {
                return res.status(403).json({ message: "ไม่สามารถเข้าสู่ระบบได้ (ต้องเป็นผู้ดูแลหรือพนักงาน)" });
            }
            const existingUser = yield prisma.user.findUnique({
                where: { user_email: email },
                select: {
                    user_id: true,
                    user_name: true,
                    user_fname: true,
                    user_lname: true,
                    user_email: true,
                    user_img: true,
                    user_phone: true,
                    user_status: true,
                    google_id: true,
                },
            });
            if (existingUser) {
                const [adminRow, staffRow] = yield Promise.all([
                    prisma.admin.findFirst({ where: { user_id: existingUser.user_id } }),
                    prisma.staff.findFirst({ where: { user_id: existingUser.user_id } }),
                ]);
                const isAdmin = !!adminRow;
                const isStaff = !!staffRow;
                const roles = buildRoles(isAdmin, isStaff);
                if (!isAdmin && !isStaff) {
                    // เผื่อกรณีอีเมลถูกอนุญาตจากตารางอื่น แต่ user_id นี้ไม่ใช่ admin/staff แล้ว
                    return res.status(403).json({ message: "ไม่สามารถเข้าสู่ระบบได้ (ต้องเป็นผู้ดูแลหรือพนักงาน)" });
                }
                // --- เริ่มต้นการแก้ไขตรงนี้ ---
                // ถ้าผู้ใช้มีบัญชีอยู่แล้ว แต่อีเมลนั้นยังไม่มี google_id หรือ google_id ไม่ตรงกัน
                if (!existingUser.google_id || existingUser.google_id !== googleId) {
                    yield prisma.user.update({
                        where: { user_id: existingUser.user_id },
                        data: { google_id: googleId, user_img: profile_image },
                    });
                    existingUser.google_id = googleId;
                }
                // --- สิ้นสุดการแก้ไขตรงนี้ ---
                // ไม่จำเป็นต้องตรวจสอบ existingUser.google_id !== googleId อีกต่อไป
                // เพราะถ้าไม่ตรงกัน เราได้ทำการ update ไปแล้ว
                const jwtToken = jsonwebtoken_1.default.sign({
                    id: existingUser.user_id,
                    user_name: existingUser.user_name,
                    user_fname: existingUser.user_fname,
                    user_lname: existingUser.user_lname,
                    user_email: existingUser.user_email,
                    user_img: existingUser.user_img,
                    user_phone: existingUser.user_phone,
                    user_status: existingUser.user_status,
                    isAdmin,
                    isStaff,
                    roles,
                }, process.env.JWT_SECRET, { expiresIn: "1d" });
                const { google_id } = existingUser, safeUser = __rest(existingUser, ["google_id"]);
                return res.status(200).json({
                    message: "เข้าสู่ระบบด้วย Google สำเร็จ",
                    token: jwtToken,
                    user: Object.assign(Object.assign({}, safeUser), { isAdmin,
                        isStaff,
                        roles }),
                });
            }
            // ยังไม่มีบัญชี -> ขอข้อมูลเพิ่มก่อน
            const tempToken = jsonwebtoken_1.default.sign({
                google_id: googleId,
                email,
                first_name,
                last_name,
                profile_image,
                incompleteProfile: true,
            }, process.env.JWT_SECRET, { expiresIn: "5m" });
            return res.status(200).json({
                message: "ยังไม่มีบัญชี, ต้องกรอกข้อมูลเพิ่ม",
                incompleteProfile: true,
                tempToken,
                googleUser: {
                    email,
                    first_name,
                    last_name,
                    profile_image,
                },
            });
        }
        catch (error) {
            console.error("Google login error:", ((_a = error.response) === null || _a === void 0 ? void 0 : _a.data) || error.message);
            return res
                .status(500)
                .json({ message: "ไม่สามารถเข้าสู่ระบบด้วย Google ได้" });
        }
    }),
    complete_profile: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        try {
            const authHeader = req.headers.authorization;
            if (!(authHeader === null || authHeader === void 0 ? void 0 : authHeader.startsWith("Bearer "))) {
                return res.status(401).json({ message: "ไม่ได้รับ token" });
            }
            const token = authHeader.split(" ")[1];
            let decoded;
            try {
                decoded = jsonwebtoken_1.default.verify(token, process.env.JWT_SECRET);
            }
            catch (_a) {
                return res.status(401).json({ message: "token หมดอายุหรือไม่ถูกต้อง" });
            }
            if (!decoded.incompleteProfile || !decoded.email || !decoded.google_id) {
                return res
                    .status(400)
                    .json({ message: "Token ไม่ถูกต้องสำหรับการสมัคร" });
            }
            const { user_fname, user_lname, user_phone, user_name, user_pass } = req.body;
            if (!user_fname ||
                !user_lname ||
                !user_phone ||
                !user_name ||
                !user_pass) {
                return res.status(400).json({ message: "กรุณากรอกข้อมูลให้ครบถ้วน" });
            }
            const existingUserName = yield prisma.user.findUnique({
                where: { user_name: user_name },
            });
            if (existingUserName) {
                return res.status(400).json({ message: "ชื่อผู้ใช้นี้ถูกใช้ไปแล้ว" });
            }
            if (!/^0[0-9]{9}$/.test(user_phone)) {
                return res.status(400).json({ message: "เบอร์โทรศัพท์ไม่ถูกต้อง" });
            }
            const existingUser = yield prisma.user.findUnique({
                where: { user_email: decoded.email },
            });
            if (existingUser) {
                return res.status(400).json({ message: "มีบัญชีผู้ใช้นี้อยู่แล้ว" });
            }
            //userpass > 6
            if (user_pass.length < 6) {
                return res
                    .status(400)
                    .json({ message: "รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร" });
            }
            const hashedPassword = yield bcryptjs_1.default.hash(user_pass, 10);
            const newUser = yield prisma.user.create({
                data: {
                    user_fname,
                    user_lname,
                    user_phone,
                    user_name,
                    user_pass: hashedPassword,
                    user_email: decoded.email,
                    user_img: decoded.profile_image,
                    user_status: 1,
                    google_id: decoded.google_id,
                },
            });
            const finalToken = jsonwebtoken_1.default.sign({
                id: newUser.user_id,
                user_name: newUser.user_name,
                user_fname: newUser.user_fname,
                user_lname: newUser.user_lname,
                user_email: newUser.user_email,
                user_img: newUser.user_img,
                user_phone: newUser.user_phone,
                user_status: newUser.user_status,
            }, process.env.JWT_SECRET, { expiresIn: "1d" });
            return res.status(200).json({
                message: "สมัครบัญชีสำเร็จ",
                token: finalToken,
            });
        }
        catch (error) {
            console.error("complete_profile error:", error);
            return res.status(500).json({ message: "ไม่สามารถสร้างบัญชีได้" });
        }
    }),
    login: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        try {
            const { user_name, user_email, user_pass } = req.body;
            // ใช้ตัวเดียวในการค้นหา (รับได้ทั้ง username หรือ email)
            const loginId = (user_name || user_email || "").trim();
            if (!loginId || !user_pass) {
                return res.status(400).json({
                    message: "กรุณากรอกชื่อผู้ใช้/อีเมล และรหัสผ่าน",
                });
            }
            // ✅ แก้ where เดิมที่ผิด (เคยใส่ user_email: user_name)
            const user = yield prisma.user.findFirst({
                where: { OR: [{ user_name: loginId }, { user_email: loginId }] },
            });
            if (!user) {
                return res.status(404).json({ message: "ไม่พบผู้ใช้นี้ในระบบ" });
            }
            if (user.user_status === 0) {
                return res.status(403).json({ message: "บัญชีนี้ถูกระงับการใช้งาน" });
            }
            if (!user.user_pass) {
                // บัญชีที่สมัครด้วย Google จะไม่มีรหัสผ่านใน DB
                return res.status(400).json({ message: "บัญชีนี้เข้าสู่ระบบด้วย Google เท่านั้น" });
            }
            const isMatch = yield bcryptjs_1.default.compare(user_pass, user.user_pass);
            if (!isMatch) {
                return res.status(401).json({ message: "รหัสผ่านไม่ถูกต้อง" });
            }
            // ตรวจบทบาท
            const [adminRow, staffRow] = yield Promise.all([
                prisma.admin.findFirst({ where: { user_id: user.user_id } }),
                prisma.staff.findFirst({ where: { user_id: user.user_id } }),
            ]);
            const isAdmin = !!adminRow;
            const isStaff = !!staffRow;
            const roles = buildRoles(isAdmin, isStaff);
            // ✅ หลังบ้าน: อนุญาตเฉพาะ admin หรือ staff
            if (!isAdmin && !isStaff) {
                return res.status(403).json({ message: "เฉพาะผู้ดูแลหรือพนักงานเท่านั้น" });
            }
            const token = jsonwebtoken_1.default.sign({
                id: user.user_id,
                user_name: user.user_name,
                user_fname: user.user_fname,
                user_lname: user.user_lname,
                user_email: user.user_email,
                user_img: user.user_img,
                user_phone: user.user_phone,
                user_status: user.user_status,
                isAdmin,
                isStaff,
                roles,
            }, process.env.JWT_SECRET, { expiresIn: "1d" });
            return res.status(200).json({
                message: "เข้าสู่ระบบสำเร็จ",
                token,
                user: {
                    id: user.user_id,
                    user_name: user.user_name,
                    user_fname: user.user_fname,
                    user_lname: user.user_lname,
                    user_email: user.user_email,
                    user_phone: user.user_phone,
                    user_status: user.user_status,
                    user_img: user.user_img,
                    isAdmin,
                    isStaff,
                    roles,
                },
            });
        }
        catch (error) {
            return res.status(500).json({ message: "เกิดข้อผิดพลาดในระบบ" });
        }
    }),
    all_user: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        try {
            const users = yield prisma.user.findMany({
                select: {
                    user_id: true,
                    user_name: true,
                    user_fname: true,
                    user_lname: true,
                    user_email: true,
                    user_phone: true,
                    user_img: true,
                    user_status: true,
                },
            });
            if (!users || users.length === 0) {
                return res.status(404).json({ message: "ไม่พบผู้ใช้ในระบบ" });
            }
            const admins = yield prisma.admin.findMany({ select: { user_id: true } });
            const staffs = yield prisma.staff.findMany({ select: { user_id: true } }); // << ต้องมีตาราง staff
            const adminIds = new Set(admins.map((a) => a.user_id));
            const staffIds = new Set(staffs.map((s) => s.user_id));
            const usersWithRole = users.map((u) => {
                const isAdmin = adminIds.has(u.user_id);
                const isStaff = staffIds.has(u.user_id);
                return Object.assign(Object.assign({}, u), { isAdmin,
                    isStaff, roles: buildRoles(isAdmin, isStaff) });
            });
            return res.status(200).json(usersWithRole);
        }
        catch (error) {
            console.error(error);
            return res.status(500).json({ message: "เกิดข้อผิดพลาดในระบบ" });
        }
    }),
    info: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        try {
            const userData = req.user;
            const id = Number(userData === null || userData === void 0 ? void 0 : userData.id);
            if (!id)
                return res.status(401).json({ message: "ไม่พบ userId จาก token" });
            const user = yield prisma.user.findUnique({
                where: { user_id: id },
                select: {
                    user_id: true,
                    user_name: true,
                    user_fname: true,
                    user_lname: true,
                    user_email: true,
                    user_phone: true,
                    user_img: true,
                    user_status: true,
                },
            });
            if (!user)
                return res.status(404).json({ message: "ไม่พบผู้ใช้ในระบบ" });
            const [isAdmin, isStaff] = yield Promise.all([
                prisma.admin.findFirst({ where: { user_id: id } }).then(Boolean),
                prisma.staff.findFirst({ where: { user_id: id } }).then(Boolean),
            ]);
            return res.status(200).json(Object.assign(Object.assign({}, user), { isAdmin,
                isStaff, roles: buildRoles(isAdmin, isStaff) }));
        }
        catch (error) {
            console.error("เกิดข้อผิดพลาด:", error.message, error.stack);
            return res
                .status(500)
                .json({ message: "เกิดข้อผิดพลาดในระบบ", error: error.message });
        }
    }),
    add_user: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        try {
            const { user_name, user_pass, user_fname, user_lname, user_email, user_phone, } = req.body;
            // validate
            if (!user_name || !user_pass || !user_email) {
                return res.status(400).json({
                    message: "กรุณากรอกข้อมูลที่จำเป็น: user_name, user_pass, user_email",
                });
            }
            if (user_pass.length < 6) {
                return res
                    .status(400)
                    .json({ message: "รหัสผ่านต้องมีความยาวมากกว่า 6 ตัวอักษร" });
            }
            // กันซ้ำทั้ง username และ email
            const dup = yield prisma.user.findFirst({
                where: {
                    OR: [{ user_name }, { user_email }],
                },
                select: { user_name: true, user_email: true },
            });
            if (dup) {
                if (dup.user_name === user_name) {
                    return res.status(400).json({ message: "ชื่อผู้ใช้นี้ถูกใช้ไปแล้ว" });
                }
                if (dup.user_email === user_email) {
                    return res.status(400).json({ message: "อีเมลนี้ถูกใช้ไปแล้ว" });
                }
            }
            const hashedPass = yield bcryptjs_1.default.hash(user_pass, 10);
            const created = yield prisma.user.create({
                data: {
                    user_name,
                    user_pass: hashedPass,
                    user_fname,
                    user_lname,
                    user_email,
                    user_phone,
                    user_img: req.file
                        ? `uploads/user_images/${req.file.filename}`
                        : null,
                    // ถ้ามี default ใน schema อยู่แล้ว จะไม่ต้องส่ง user_status ก็ได้
                },
            });
            // ส่งเฉพาะฟิลด์ปลอดภัยกลับไป + emit มาตรฐาน
            const safeUser = {
                user_id: created.user_id,
                user_name: created.user_name,
                user_fname: created.user_fname,
                user_lname: created.user_lname,
                user_email: created.user_email,
                user_phone: created.user_phone,
                user_img: created.user_img,
                user_status: created.user_status,
            };
            emit(req, "user:created", safeUser);
            return res.status(200).json({
                message: "สร้างผู้ใช้สำเร็จ",
                data: safeUser,
            });
        }
        catch (error) {
            console.error(error);
            return res.status(500).json({
                message: "เกิดข้อผิดพลาดในระบบ: " + error.message,
            });
        }
    }),
    update_user: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        try {
            const { user_id } = req.params;
            if (!user_id)
                return res.status(400).json({ message: "ไม่พบ user_id" });
            const body = req.body || {};
            const user_name = body.user_name;
            const user_pass = body.user_pass;
            const user_fname = body.user_fname;
            const user_lname = body.user_lname;
            const user_email = body.user_email;
            const user_phone = body.user_phone;
            // ดึงข้อมูลผู้ใช้เดิม
            const oldUser = yield prisma.user.findUnique({
                where: { user_id: Number(user_id) },
                select: { user_pass: true, user_img: true },
            });
            if (!oldUser) {
                return res.status(404).json({ message: "ไม่พบผู้ใช้" });
            }
            // จัดการรหัสผ่าน (ใช้ค่าใหม่ถ้ามี)
            let hashedPass = oldUser.user_pass;
            if (user_pass && user_pass.trim() !== "") {
                if (user_pass.length < 6) {
                    return res
                        .status(400)
                        .json({ message: "รหัสผ่านต้องมีความยาวมากกว่า 6 ตัวอักษร" });
                }
                hashedPass = yield bcryptjs_1.default.hash(user_pass, 10);
            }
            // จัดการรูปภาพ (ใช้รูปใหม่ถ้ามี)
            let user_img = oldUser.user_img;
            if (req.file) {
                if (oldUser.user_img) {
                    const oldImagePath = path_1.default.resolve("uploads/user_images", path_1.default.basename(oldUser.user_img));
                    try {
                        if (fs_1.default.existsSync(oldImagePath))
                            fs_1.default.unlinkSync(oldImagePath);
                    }
                    catch (e) {
                        console.error("ไม่สามารถลบรูปเก่า:", e);
                    }
                }
                user_img = `uploads/user_images/${req.file.filename}`;
            }
            if (user_name) {
                const nameTaken = yield prisma.user.findFirst({
                    where: { user_name, NOT: { user_id: Number(user_id) } },
                });
                if (nameTaken)
                    return res.status(400).json({ message: "ชื่อผู้ใช้นี้ถูกใช้ไปแล้ว" });
            }
            if (user_email) {
                const emailTaken = yield prisma.user.findFirst({
                    where: { user_email, NOT: { user_id: Number(user_id) } },
                });
                if (emailTaken)
                    return res.status(400).json({ message: "อีเมลนี้ถูกใช้ไปแล้ว" });
            }
            const updatedUser = yield prisma.user.update({
                where: { user_id: Number(user_id) },
                data: {
                    user_name,
                    user_pass: hashedPass,
                    user_fname,
                    user_lname,
                    user_email,
                    user_phone,
                    user_img,
                },
            });
            // shape ข้อมูลปลอดภัย + emit
            const safeUser = {
                user_id: updatedUser.user_id,
                user_name: updatedUser.user_name,
                user_fname: updatedUser.user_fname,
                user_lname: updatedUser.user_lname,
                user_email: updatedUser.user_email,
                user_phone: updatedUser.user_phone,
                user_img: updatedUser.user_img,
                user_status: updatedUser.user_status,
            };
            emit(req, "user:updated", safeUser);
            return res.status(200).json({
                message: "อัปเดตผู้ใช้สำเร็จ",
                data: safeUser,
            });
        }
        catch (error) {
            console.error(error);
            return res
                .status(500)
                .json({ message: "เกิดข้อผิดพลาดในระบบ: " + error.message });
        }
    }),
    update_user_status: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        const actor = req.user;
        const targetId = Number(req.params.userId);
        const { status, password } = req.body;
        if (![0, 1].includes(Number(status)))
            return res.status(400).json({ message: "สถานะไม่ถูกต้อง" });
        if (!password)
            return res.status(400).json({ message: "ต้องกรอกรหัสผ่าน" });
        // ห้ามระงับตัวเอง
        if ((actor === null || actor === void 0 ? void 0 : actor.id) === targetId && Number(status) === 0) {
            return res.status(403).json({ message: "ห้ามระงับบัญชีของตนเอง" });
        }
        // ยืนยันรหัสผ่านผู้ที่ทำรายการ
        const deleter = yield prisma.user.findUnique({
            where: { user_id: Number(actor.id) },
            select: { user_pass: true },
        });
        if (!(deleter === null || deleter === void 0 ? void 0 : deleter.user_pass) ||
            !(yield bcryptjs_1.default.compare(password, deleter.user_pass))) {
            return res.status(401).json({ message: "รหัสผ่านไม่ถูกต้อง" });
        }
        yield prisma.user.update({
            where: { user_id: targetId },
            data: { user_status: Number(status) },
        });
        emit(req, "user:status_updated", {
            user_id: targetId,
            user_status: Number(status),
        });
        return res.status(200).json({ message: "อัปเดตสถานะสำเร็จ" });
    }),
    update_user_roles: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        const actor = req.user;
        const targetId = Number(req.params.userId);
        const { roles, password } = req.body;
        const ALLOWED = new Set(["admin", "staff", "user"]);
        const nextRoles = Array.from(new Set((roles || []).filter((r) => ALLOWED.has(r))));
        if (nextRoles.length === 0)
            return res.status(400).json({ message: "ต้องมีอย่างน้อย 1 สิทธิ์" });
        if (!password)
            return res.status(400).json({ message: "ต้องกรอกรหัสผ่าน" });
        // ยืนยันรหัสผ่านผู้ที่ทำรายการ
        const actorUser = yield prisma.user.findUnique({
            where: { user_id: Number(actor.id) },
            select: { user_pass: true },
        });
        if (!(actorUser === null || actorUser === void 0 ? void 0 : actorUser.user_pass) ||
            !(yield bcryptjs_1.default.compare(password, actorUser.user_pass))) {
            return res.status(401).json({ message: "รหัสผ่านไม่ถูกต้อง" });
        }
        // ห้ามถอด admin ของตัวเอง
        if ((actor === null || actor === void 0 ? void 0 : actor.id) === targetId) {
            const hadAdmin = !!(yield prisma.admin.findFirst({
                where: { user_id: targetId },
            }));
            const keepAdmin = nextRoles.includes("admin");
            if (hadAdmin && !keepAdmin) {
                return res
                    .status(403)
                    .json({ message: "ไม่สามารถถอดสิทธิ์ผู้ดูแลของตนเองได้" });
            }
        }
        yield prisma.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            // admin
            if (nextRoles.includes("admin")) {
                yield tx.admin.upsert({
                    where: { user_id: targetId },
                    update: {},
                    create: { user_id: targetId, admin_status: 1 },
                });
            }
            else {
                yield tx.admin.deleteMany({ where: { user_id: targetId } });
            }
            // staff
            if (nextRoles.includes("staff")) {
                yield tx.staff.upsert({
                    where: { user_id: targetId },
                    update: {},
                    create: { user_id: targetId, staff_status: 1 },
                });
            }
            else {
                yield tx.staff.deleteMany({ where: { user_id: targetId } });
            }
        }));
        emit(req, "user:roles_updated", { user_id: targetId, roles: nextRoles });
        return res
            .status(200)
            .json({ message: "อัปเดตสิทธิ์สำเร็จ", roles: nextRoles });
    }),
    delete_user: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        try {
            const { user_id } = req.params; // คนที่ถูกลบ
            const { password } = req.body;
            const loggedInUser = req.user; // คนที่ลบ (จาก JWT)
            if (Number(loggedInUser.id) === Number(user_id)) {
                return res.status(403).json({ message: "ห้ามลบบัญชีของตนเอง" });
            }
            if (!(loggedInUser === null || loggedInUser === void 0 ? void 0 : loggedInUser.id)) {
                return res
                    .status(400)
                    .json({ message: "ไม่พบข้อมูลผู้ใช้งานที่ล๊อกอิน" });
            }
            if (!password || password.trim() === "") {
                return res
                    .status(400)
                    .json({ message: "กรุณากรอกรหัสผ่านเพื่อยืนยัน" });
            }
            const deleter = yield prisma.user.findUnique({
                where: { user_id: Number(loggedInUser.id) },
                select: { user_pass: true },
            });
            if (!(deleter === null || deleter === void 0 ? void 0 : deleter.user_pass) ||
                !(yield bcryptjs_1.default.compare(password, deleter.user_pass))) {
                return res.status(401).json({ message: "รหัสผ่านไม่ถูกต้อง" });
            }
            yield prisma.$transaction([
                prisma.admin.deleteMany({ where: { user_id: Number(user_id) } }),
                prisma.staff.deleteMany({ where: { user_id: Number(user_id) } }),
            ]);
            // ดึงข้อมูลผู้ใช้ที่ถูกลบเพื่อเช็ครูปภาพ
            const userToDelete = yield prisma.user.findUnique({
                where: { user_id: Number(user_id) },
                select: { user_img: true },
            });
            if (!userToDelete) {
                return res.status(404).json({ message: "ไม่พบผู้ใช้ที่ต้องการลบ" });
            }
            // ลบรูปภาพถ้ามี
            if (userToDelete.user_img) {
                const imagePath = path_1.default.resolve("uploads/user_images", path_1.default.basename(userToDelete.user_img));
                try {
                    if (fs_1.default.existsSync(imagePath))
                        fs_1.default.unlinkSync(imagePath);
                }
                catch (e) {
                    console.error("ไม่สามารถลบรูปโปรไฟล์:", e);
                }
            }
            // ลบผู้ใช้จากฐานข้อมูล (เลือกเฉพาะฟิลด์ปลอดภัยเพื่อส่งกลับ)
            const deleted = yield prisma.user.delete({
                where: { user_id: Number(user_id) },
                select: { user_id: true, user_name: true, user_email: true },
            });
            emit(req, "user:deleted", { user_id: deleted.user_id });
            return res.status(200).json({ message: "ลบผู้ใช้สำเร็จ", deleted });
        }
        catch (error) {
            console.error("Delete user error:", error);
            return res.status(500).json({
                message: "เกิดข้อผิดพลาดในระบบ",
                error: error.message,
            });
        }
    }),
    seats: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        try {
            const seatOptions = yield prisma.seatOption.findMany({
                orderBy: [{ seats: "asc" }],
            });
            return res.status(200).json(seatOptions);
        }
        catch (error) {
            console.error("Error fetching seat options:", error);
            return res.status(500).json({
                success: false,
                message: "เกิดข้อผิดพลาดภายในเซิร์ฟเวอร์",
            });
        }
    }),
    add_seat: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        const { seats } = req.body;
        if (!seats || isNaN(seats) || seats <= 0) {
            return res.status(400).json({
                success: false,
                message: "จำนวนที่นั่งไม่ถูกต้อง",
            });
        }
        try {
            const newSeat = yield prisma.seatOption.create({
                data: {
                    seats: parseInt(seats),
                },
            });
            emit(req, "seat:created", newSeat);
            return res.status(200).json({
                success: true,
                data: newSeat,
                message: "เพิ่มจำนวนที่นั่งเรียบร้อยแล้ว",
            });
        }
        catch (error) {
            console.error("Error creating seat option:", error);
            return res.status(500).json({
                success: false,
                message: "เกิดข้อผิดพลาดภายในเซิร์ฟเวอร์",
            });
        }
    }),
    delete_seat: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        const { id } = req.params;
        try {
            yield prisma.seatOption.delete({
                where: { id: parseInt(id) },
            });
            emit(req, "seat:deleted", { id: parseInt(id) });
            res.status(200).json({ message: "ลบสำเร็จ" });
        }
        catch (err) {
            res.status(500).json({ error: "ไม่สามารถลบได้" });
        }
    }),
    table_Types: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        try {
            const tableTypes = yield prisma.tableType.findMany();
            return res.status(200).json(tableTypes);
        }
        catch (error) {
            console.error("Error fetching table types:", error);
            return res.status(500).json({
                success: false,
                message: "เกิดข้อผิดพลาดภายในเซิร์ฟเวอร์",
            });
        }
    }),
    add_TableType: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        const { name } = req.body;
        try {
            const newTable = yield prisma.tableType.create({
                data: {
                    name: name,
                },
            });
            emit(req, "tableType:created", newTable);
            return res.status(200).json({
                success: true,
                data: newTable,
                message: "เพิ่มโต๊ะเรียบร้อยแล้ว",
            });
        }
        catch (error) {
            console.error("Error creating table:", error);
            return res.status(500).json({
                success: false,
                message: "เกิดข้อผิดพลาดภายในเซิร์ฟเวอร์",
            });
        }
    }),
    delete_TablType: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        const { id } = req.params;
        try {
            yield prisma.tableType.delete({
                where: { id: parseInt(id) },
            });
            emit(req, "tableType:deleted", { id: parseInt(id) });
            res.status(200).json({ message: "ลบสำเร็จ" });
        }
        catch (err) {
            res.status(500).json({ error: "ไม่สามารถลบได้" });
        }
    }),
    // API: ดึงข้อมูลโต๊ะทั้งหมด
    tables: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        var _a;
        try {
            const gridId = Number((_a = req.query.gridId) !== null && _a !== void 0 ? _a : 1);
            const tables = yield prisma.tableMap.findMany({
                where: { gridId }, // ★ filter ตามกริด
                include: { seatOption: true, tableType: true },
                orderBy: { id: "asc" },
            });
            const formatted = tables.map((table) => {
                var _a, _b, _c, _d, _e, _f, _g;
                return ({
                    id: String(table.id),
                    name: table.label,
                    seats: (_b = (_a = table.seatOption) === null || _a === void 0 ? void 0 : _a.seats) !== null && _b !== void 0 ? _b : 0,
                    tableTypeId: String((_d = (_c = table.tableType) === null || _c === void 0 ? void 0 : _c.id) !== null && _d !== void 0 ? _d : ""),
                    tableTypeName: (_f = (_e = table.tableType) === null || _e === void 0 ? void 0 : _e.name) !== null && _f !== void 0 ? _f : "ไม่ระบุประเภท",
                    additionalInfo: (_g = table.additionalInfo) !== null && _g !== void 0 ? _g : "",
                    x: table.x,
                    y: table.y,
                    active: table.active,
                    // (ถ้าจะส่งกลับด้วยก็ได้)
                    gridId: table.gridId,
                });
            });
            return res.status(200).json(formatted);
        }
        catch (error) {
            console.error("Error fetching tables:", error);
            return res
                .status(500)
                .json({
                message: "เกิดข้อผิดพลาดในการดึงข้อมูลโต๊ะ",
                error: error.message,
            });
        }
    }),
    add_table: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        var _a, _b;
        try {
            const { name, seats, tableTypeId, additionalInfo, gridId } = req.body;
            const xBody = Number.isFinite(+((_a = req.body) === null || _a === void 0 ? void 0 : _a.x))
                ? parseInt(req.body.x, 10)
                : NaN;
            const yBody = Number.isFinite(+((_b = req.body) === null || _b === void 0 ? void 0 : _b.y))
                ? parseInt(req.body.y, 10)
                : NaN;
            const gid = Number(gridId !== null && gridId !== void 0 ? gridId : 1);
            if (!name || !seats || !tableTypeId) {
                return res
                    .status(400)
                    .json({
                    message: "ชื่อโต๊ะ, จำนวนที่นั่ง, และประเภทโต๊ะเป็นข้อมูลที่จำเป็น",
                });
            }
            const seatOption = yield prisma.seatOption.findFirst({
                where: { seats: parseInt(seats, 10) },
            });
            if (!seatOption)
                return res
                    .status(404)
                    .json({
                    message: `ไม่พบตัวเลือกจำนวนที่นั่งสำหรับ ${seats} ที่นั่ง`,
                });
            const parsedTypeId = parseInt(tableTypeId, 10);
            const type = yield prisma.tableType.findUnique({
                where: { id: parsedTypeId },
            });
            if (!type)
                return res
                    .status(404)
                    .json({ message: `ไม่พบประเภทโต๊ะที่มี ID: ${tableTypeId}` });
            // ✅ ชื่อซ้ำใน "กริดเดียวกัน" เท่านั้น
            const dup = yield prisma.tableMap.findUnique({
                where: { gridId_label: { gridId: gid, label: name.trim() } },
            });
            if (dup)
                return res
                    .status(409)
                    .json({ message: `ชื่อโต๊ะ '${name.trim()}' มีอยู่ในกริดนี้แล้ว` });
            // ✅ ตรวจกริด
            const grid = yield prisma.gridSize.findUnique({ where: { id: gid } });
            if (!grid)
                return res.status(404).json({ message: "ไม่พบกริด" });
            let x = Number.isFinite(xBody) ? xBody : 0;
            let y = Number.isFinite(yBody) ? yBody : 0;
            const inBounds = (xx, yy) => xx >= 0 && yy >= 0 && xx < grid.cols && yy < grid.rows;
            if (!inBounds(x, y))
                return res.status(400).json({ message: "พิกัดอยู่นอกกริด" });
            // ✅ กันซ้ำตำแหน่งด้วยคีย์ผสม
            const taken = yield prisma.tableMap.findUnique({
                where: { gridId_x_y: { gridId: gid, x, y } },
            });
            if (taken) {
                // หา cell ว่าง
                const cells = yield prisma.tableMap.findMany({
                    where: { gridId: gid },
                    select: { x: true, y: true },
                });
                const used = new Set(cells.map((c) => `${c.x},${c.y}`));
                let found = null;
                outer: for (let yy = 0; yy < grid.rows; yy++) {
                    for (let xx = 0; xx < grid.cols; xx++) {
                        if (!used.has(`${xx},${yy}`)) {
                            found = { x: xx, y: yy };
                            break outer;
                        }
                    }
                }
                if (!found)
                    return res.status(409).json({ message: "พื้นที่กริดเต็ม" });
                x = found.x;
                y = found.y;
            }
            const newTable = yield prisma.tableMap.create({
                data: {
                    label: name.trim(),
                    seatOption: { connect: { id: seatOption.id } },
                    tableType: { connect: { id: parsedTypeId } },
                    additionalInfo: (additionalInfo === null || additionalInfo === void 0 ? void 0 : additionalInfo.trim()) || null,
                    x,
                    y,
                    active: true,
                    grid: { connect: { id: gid } },
                },
            });
            emit(req, "table:created", newTable);
            return res
                .status(201)
                .json({ message: "เพิ่มโต๊ะอาหารสำเร็จ", table: newTable });
        }
        catch (error) {
            // กันเคสชน unique ที่ create (เผื่อ race)
            if ((error === null || error === void 0 ? void 0 : error.code) === "P2002") {
                // unique constraint failed
                return res
                    .status(409)
                    .json({ message: "ชื่อโต๊ะหรือพิกัดซ้ำในกริดนี้" });
            }
            console.error("Error adding table:", error);
            return res
                .status(500)
                .json({
                message: "เกิดข้อผิดพลาดในการเพิ่มโต๊ะอาหาร",
                error: error.message,
            });
        }
    }),
    update_table: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        var _a;
        const { id } = req.params; // ดึง ID ของโต๊ะจาก URL parameter
        const { name, seats, tableTypeId, additionalInfo } = req.body; // ดึงข้อมูลที่ต้องการอัปเดตจาก request body
        // ตรวจสอบความถูกต้องของข้อมูลที่ได้รับ
        if (!id) {
            return res.status(400).json({ message: "Table ID is required." });
        }
        if (!name || typeof seats === "undefined" || !tableTypeId) {
            return res
                .status(400)
                .json({ message: "Name, seats, and table type ID are required." });
        }
        const parsedSeats = parseInt(String(seats), 10);
        if (isNaN(parsedSeats) || parsedSeats <= 0) {
            return res
                .status(400)
                .json({ message: "Seats must be a valid positive number." });
        }
        // ตรวจสอบว่า seatOption ID และ tableType ID มีอยู่จริงในฐานข้อมูล
        try {
            // ค้นหา seatOption ที่มีจำนวนที่นั่งตรงกัน
            const existingSeatOption = yield prisma.seatOption.findFirst({
                where: { seats: parsedSeats },
            });
            if (!existingSeatOption) {
                return res
                    .status(404)
                    .json({ message: `Seat option for ${parsedSeats} seats not found.` });
            }
            const existingTableType = yield prisma.tableType.findUnique({
                where: { id: parseInt(String(tableTypeId), 10) },
            });
            if (!existingTableType) {
                return res.status(404).json({ message: "Table type not found." });
            }
            const updatedTable = yield prisma.tableMap.update({
                where: { id: parseInt(id, 10) },
                data: {
                    label: name, // อัปเดต label
                    seatOptionId: existingSeatOption.id, // ใช้ ID ของ seatOption ที่ค้นหาได้
                    tableTypeId: parseInt(String(tableTypeId), 10),
                    additionalInfo: additionalInfo || "",
                },
                include: {
                    seatOption: true,
                    tableType: true,
                },
            });
            const shaped = {
                id: String(updatedTable.id),
                name: updatedTable.label,
                seats: ((_a = updatedTable.seatOption) === null || _a === void 0 ? void 0 : _a.seats) || 0,
                tableTypeId: String(updatedTable.tableTypeId),
                additionalInfo: updatedTable.additionalInfo || "",
                x: updatedTable.x,
                y: updatedTable.y,
                active: updatedTable.active,
            };
            emit(req, "table:updated", shaped);
            return res
                .status(200)
                .json({ message: "Table updated successfully", table: shaped });
        }
        catch (error) {
            console.error("Error updating table:", error);
            if (error.code === "P2025") {
                // Prisma error code for record not found
                return res.status(404).json({ message: "Table not found." });
            }
            return res.status(500).json({
                message: "Failed to update table",
                error: error.message,
            });
        }
    }),
    // API: บันทึกตำแหน่งโต๊ะ (X, Y)
    save_table_positions: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        try {
            const tablePositions = req.body; // <-- ตรงนี้คาดหวัง array
            if (!Array.isArray(tablePositions)) {
                // <-- ตรวจสอบว่าเป็น array หรือไม่
                return res.status(400).json({
                    message: "Invalid request body. Expected an array of table positions.",
                });
            }
            const updates = tablePositions.map((pos) => {
                // ตรวจสอบ id, x, y เป็นตัวเลขที่ถูกต้อง
                if (!pos.id ||
                    isNaN(parseInt(pos.id)) ||
                    isNaN(pos.x) ||
                    isNaN(pos.y)) {
                    throw new Error(`Invalid table position data for ID: ${pos.id}`);
                }
                return prisma.tableMap.update({
                    where: { id: parseInt(pos.id, 10) },
                    data: { x: pos.x, y: pos.y },
                });
            });
            yield prisma.$transaction(updates); // ใช้ transaction เพื่อให้มั่นใจว่าทุกการอัปเดตสำเร็จพร้อมกัน
            emit(req, "table:positions:updated", tablePositions);
            return res
                .status(200)
                .json({ message: "Table positions updated successfully" });
        }
        catch (error) {
            console.error("Error saving table positions:", error);
            return res.status(500).json({
                message: "Failed to save table positions",
                error: error.message,
            });
        }
    }),
    // API: อัปเดตสถานะ active ของโต๊ะ
    update_table_status: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        const { id } = req.params; // ดึง id จาก URL parameter
        const { active } = req.body; // ดึง active จาก request body
        if (!id || typeof active === "undefined") {
            return res
                .status(400)
                .json({ message: "Table ID and active status are required." });
        }
        try {
            const updatedTable = yield prisma.tableMap.update({
                where: { id: parseInt(id, 10) },
                data: { active: active },
            });
            emit(req, "table:status_updated", {
                id: updatedTable.id,
                active: updatedTable.active,
            });
            return res.status(200).json({
                message: "Table status updated successfully",
                table: updatedTable,
            });
        }
        catch (error) {
            console.error("Error updating table status:", error);
            if (error.code === "P2025") {
                // Prisma error code for record not found
                return res.status(404).json({ message: "Table not found." });
            }
            return res.status(500).json({
                message: "Failed to update table status",
                error: error.message,
            });
        }
    }),
    // API: ลบโต๊ะ
    delete_table: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        const { id } = req.params; // ดึง id จาก URL parameter
        if (!id) {
            return res.status(400).json({ message: "Table ID is required." });
        }
        try {
            yield prisma.tableMap.delete({
                where: { id: parseInt(id, 10) },
            });
            emit(req, "table:deleted", { id: parseInt(id, 10) });
            return res.status(200).json({ message: "Table deleted successfully" });
        }
        catch (error) {
            console.error("Error deleting table:", error);
            if (error.code === "P2025") {
                // Prisma error code for record not found
                return res.status(404).json({ message: "Table not found." });
            }
            return res
                .status(500)
                .json({ message: "Failed to delete table", error: error.message });
        }
    }),
    foodTypes: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        try {
            const foodTypes = yield prisma.typefood.findMany();
            return res.status(200).json(foodTypes);
        }
        catch (error) {
            console.error("Error fetching food types:", error);
            return res
                .status(500)
                .json({ message: "Failed to fetch food types", error: error.message });
        }
    }),
    add_FoodType: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        const { name } = req.body;
        try {
            const newFoodType = yield prisma.typefood.create({
                data: {
                    name: name,
                },
            });
            emit(req, "foodType:created", newFoodType);
            return res.status(200).json(newFoodType);
        }
        catch (error) {
            console.error("Error creating type food:", error);
            return res
                .status(500)
                .json({ message: "Failed to create type food", error: error.message });
        }
    }),
    update_FoodType: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        const { id } = req.params;
        const { name } = req.body;
        try {
            const updated = yield prisma.typefood.update({
                where: { id: parseInt(id) },
                data: { name },
            });
            emit(req, "foodType:updated", updated);
            return res.status(200).json(updated);
        }
        catch (error) {
            console.error("Error updating food type:", error);
            return res.status(500).json({
                message: "Failed to update food type",
                error: error.message,
            });
        }
    }),
    delete_FoodType: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        const { id } = req.params;
        try {
            const deleted = yield prisma.typefood.delete({
                where: { id: parseInt(id) },
            });
            emit(req, "foodType:deleted", { id: parseInt(id) });
            return res.status(200).json({ message: "Deleted", deleted });
        }
        catch (error) {
            console.error("Error deleting food type:", error);
            return res.status(500).json({
                message: "Failed to delete food type",
                error: error.message,
            });
        }
    }),
    menus: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        var _a;
        try {
            const menus = yield prisma.foodMenu.findMany({
                orderBy: { menu_id: "asc" },
                include: {
                    MenuImages: true,
                    Typefoods: { include: { typefood: true } },
                },
            });
            (_a = getIO(req)) === null || _a === void 0 ? void 0 : _a.emit("menu:list", menus); // ใช้สำหรับ backoffice
            return res.status(200).json(menus);
        }
        catch (error) {
            console.error("Error fetching menus:", error);
            return res.status(500).json({ message: "Failed to fetch menus" });
        }
    }),
    add_menu: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        const { menu_name, menu_price, menu_description, typefoodIds, mainImageIndex, menu_status, isLimited, stock, } = req.body;
        let parsedTypefoodIds = [];
        if (typeof typefoodIds === "string") {
            try {
                parsedTypefoodIds = JSON.parse(typefoodIds).map((id) => parseInt(id));
            }
            catch (_a) {
                return res.status(400).json({ message: "Invalid typefoodIds format" });
            }
        }
        else if (Array.isArray(typefoodIds)) {
            parsedTypefoodIds = typefoodIds.map((id) => parseInt(id));
        }
        const files = req.files;
        const imagePaths = files ? files.map((f) => `/uploads/menu_images/${f.filename}`) : [];
        let parsedMainImageIndex = null;
        if (mainImageIndex !== undefined && mainImageIndex !== null) {
            parsedMainImageIndex = parseInt(mainImageIndex, 10);
            if (isNaN(parsedMainImageIndex))
                parsedMainImageIndex = null;
        }
        try {
            const newMenu = yield prisma.foodMenu.create({
                data: {
                    menu_name,
                    menu_price: parseInt(menu_price),
                    menu_description: menu_description || null,
                    menu_status: menu_status !== undefined ? parseInt(menu_status) : 1,
                    isLimited: isLimited ? parseInt(isLimited) : 0, // ✅ เพิ่ม
                    stock: stock !== undefined ? parseInt(stock) : null, // ✅ เพิ่ม
                    Typefoods: {
                        create: parsedTypefoodIds.map((id) => ({ typefood: { connect: { id } } })),
                    },
                    MenuImages: {
                        create: imagePaths.map((path, idx) => ({
                            menu_image: path,
                            menu_status: parsedMainImageIndex !== null && idx === parsedMainImageIndex ? 1 : 0,
                        })),
                    },
                },
                include: {
                    MenuImages: true,
                    Typefoods: { include: { typefood: true } },
                },
            });
            emit(req, "menu:created", newMenu);
            return res.status(200).json(newMenu);
        }
        catch (error) {
            console.error("Error creating menu:", error);
            if (files && files.length > 0) {
                files.forEach((file) => {
                    const filePath = path_1.default.join(UPLOADS_DIR, file.filename);
                    if (fs_1.default.existsSync(filePath))
                        fs_1.default.unlinkSync(filePath);
                });
            }
            return res.status(500).json({ message: "Failed to create menu", error: error.message });
        }
    }),
    // ==================== UPDATE MENU ====================
    update_menu: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        const { id } = req.params;
        const menuId = parseInt(id);
        const newFiles = req.files;
        try {
            const { menu_name, menu_price, menu_description, typefoodIds, existingImages, mainImageIdentifier, menu_status, isLimited, stock, } = req.body;
            if (isNaN(menuId))
                return res.status(400).json({ message: "Invalid Menu ID." });
            if (!menu_name || !menu_price || !typefoodIds) {
                return res.status(400).json({ message: "Missing required fields." });
            }
            const parsedTypefoodIds = JSON.parse(typefoodIds);
            const parsedExistingImages = existingImages ? JSON.parse(existingImages) : [];
            const currentMenu = yield prisma.foodMenu.findUnique({
                where: { menu_id: menuId },
                include: { MenuImages: true },
            });
            if (!currentMenu)
                return res.status(404).json({ message: "Menu not found." });
            const keepIds = new Set(parsedExistingImages.map((img) => img.menu_image_id).filter(Boolean));
            for (const dbImage of currentMenu.MenuImages) {
                if (!keepIds.has(dbImage.menu_image_id)) {
                    yield prisma.menuImage.delete({ where: { menu_image_id: dbImage.menu_image_id } });
                    const filePath = path_1.default.join(UPLOADS_DIR, path_1.default.basename(dbImage.menu_image));
                    if (fs_1.default.existsSync(filePath))
                        fs_1.default.unlinkSync(filePath);
                }
            }
            if (newFiles === null || newFiles === void 0 ? void 0 : newFiles.length) {
                yield prisma.menuImage.createMany({
                    data: newFiles.map((f) => ({
                        menu_image: `/uploads/menu_images/${f.filename}`,
                        menu_id: menuId,
                        menu_status: 0,
                    })),
                });
            }
            yield prisma.foodMenu.update({
                where: { menu_id: menuId },
                data: {
                    menu_name,
                    menu_price: parseInt(menu_price),
                    menu_description: menu_description || null,
                    menu_status: menu_status !== undefined ? parseInt(menu_status) : currentMenu.menu_status,
                    isLimited: isLimited ? parseInt(isLimited) : 0, // ✅ เพิ่ม
                    stock: stock !== undefined ? parseInt(stock) : null, // ✅ เพิ่ม
                },
            });
            yield prisma.foodMenuType.deleteMany({ where: { foodMenuId: menuId } });
            if (parsedTypefoodIds.length) {
                yield prisma.foodMenuType.createMany({
                    data: parsedTypefoodIds.map((tid) => ({ foodMenuId: menuId, typefoodId: tid })),
                });
            }
            yield prisma.menuImage.updateMany({ where: { menu_id: menuId }, data: { menu_status: 0 } });
            if (mainImageIdentifier) {
                yield prisma.menuImage.updateMany({
                    where: { menu_id: menuId, menu_image: mainImageIdentifier },
                    data: { menu_status: 1 },
                });
            }
            const updatedMenu = yield prisma.foodMenu.findUnique({
                where: { menu_id: menuId },
                include: { MenuImages: true, Typefoods: { include: { typefood: true } } },
            });
            emit(req, "menu:updated", updatedMenu);
            return res.status(200).json({ message: "Menu updated successfully.", menu: updatedMenu });
        }
        catch (error) {
            console.error("Error updating menu:", error);
            if (newFiles === null || newFiles === void 0 ? void 0 : newFiles.length) {
                newFiles.forEach((file) => {
                    const filePath = path_1.default.join(UPLOADS_DIR, file.filename);
                    if (fs_1.default.existsSync(filePath))
                        fs_1.default.unlinkSync(filePath);
                });
            }
            return res.status(500).json({ message: "Failed to update menu", error: error.message });
        }
    }),
    delete_menu: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        const { id } = req.params;
        const menuId = parseInt(id);
        try {
            // 1. ดึงข้อมูลรูปภาพทั้งหมดของเมนูนี้ก่อนทำการลบเมนู
            const menuImagesToDelete = yield prisma.menuImage.findMany({
                where: { menu_id: menuId },
                select: { menu_image: true }, // เลือกเฉพาะ field ที่เก็บ path ของรูปภาพ
            });
            // 2. ลบเมนูออกจากฐานข้อมูล
            // การลบ foodMenu จะ trigger onDelete: Cascade ใน MenuImage และ FoodMenuType
            const deletedMenu = yield prisma.foodMenu.delete({
                where: { menu_id: menuId },
            });
            // 3. ลบไฟล์รูปภาพจริงออกจากระบบไฟล์
            if (menuImagesToDelete.length > 0) {
                menuImagesToDelete.forEach((image) => {
                    // สร้าง absolute path ของไฟล์รูปภาพ
                    // ตรวจสอบให้แน่ใจว่า 'uploads/menu_images' คือ path ที่ถูกต้องของ Folder รูปภาพ
                    const imagePath = path_1.default.resolve("uploads/menu_images", path_1.default.basename(image.menu_image));
                    try {
                        if (fs_1.default.existsSync(imagePath)) {
                            fs_1.default.unlinkSync(imagePath); // ลบไฟล์
                            console.log(`ลบรูปเมนู: ${imagePath}`);
                        }
                        else {
                            console.warn(`ไม่พบไฟล์รูปเมนูที่ path: ${imagePath} (อาจถูกลบไปแล้วหรือ path ผิด)`);
                        }
                    }
                    catch (fileDeleteError) {
                        console.error(`ไม่สามารถลบไฟล์รูปเมนู: ${imagePath}, ข้อผิดพลาด: ${fileDeleteError}`);
                        // คุณอาจต้องการส่ง error กลับไปให้ client ด้วย แต่ไม่ทำให้การลบเมนูล้มเหลว
                    }
                });
            }
            emit(req, "menu:deleted", { menu_id: menuId });
            return res.status(200).json({
                message: "ลบเมนูและรูปภาพที่เกี่ยวข้องสำเร็จ",
                deleted: deletedMenu,
            });
        }
        catch (error) {
            console.error("Error deleting menu:", error);
            return res.status(500).json({
                message: "ไม่สามารถลบเมนูได้",
                error: error.message,
            });
        }
    }),
    grid_size: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        try {
            const gridSize = yield prisma.gridSize.findUnique({
                where: { id: 1 },
            });
            if (!gridSize) {
                const defaultGridSize = yield prisma.gridSize.create({
                    data: {
                        id: 1,
                        rows: 10,
                        cols: 10,
                    },
                });
                return res.status(200).json(defaultGridSize);
            }
            return res.status(200).json(gridSize);
        }
        catch (error) {
            console.error("Error fetching grid size:", error);
            return res.status(500).json({
                message: "Failed to fetch grid size",
                error: error.message,
            });
        }
    }),
    add_grid_size: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        try {
            const { rows, cols } = req.body;
            if (!Number.isInteger(rows) ||
                !Number.isInteger(cols) ||
                rows <= 0 ||
                cols <= 0) {
                return res.status(400).json({
                    message: "Rows and columns must be positive integers.",
                });
            }
            const updatedGridSize = yield prisma.gridSize.upsert({
                where: { id: 1 },
                update: {
                    rows,
                    cols,
                    updatedAt: new Date(),
                },
                create: {
                    id: 1,
                    rows,
                    cols,
                },
            });
            return res.status(200).json({
                message: "Grid size updated successfully",
                data: updatedGridSize,
            });
        }
        catch (error) {
            console.error("Error updating grid size:", error);
            return res.status(500).json({
                message: "Failed to update grid size",
                error: error.message,
            });
        }
    }),
    // ===== Slides API =====
    slides: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        try {
            const items = yield prisma.slide.findMany({
                orderBy: { slide_id: "asc" },
            });
            return res.status(200).json(items);
        }
        catch (error) {
            console.error("Error fetching slides:", error);
            return res
                .status(500)
                .json({ message: "ไม่สามารถดึงข้อมูลสไลด์ได้", error: error.message });
        }
    }),
    add_slide: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        var _a, _b, _c, _d, _e, _f, _g, _h;
        // ต้องมี middleware multer: upload.single('image')
        try {
            const nameRaw = (_d = (_b = (_a = req.body) === null || _a === void 0 ? void 0 : _a.name) !== null && _b !== void 0 ? _b : (_c = req.body) === null || _c === void 0 ? void 0 : _c.slide_name) !== null && _d !== void 0 ? _d : "";
            const slide_name = nameRaw.trim();
            if (!slide_name) {
                // ถ้าอัปโหลดไฟล์มาแล้วแต่ชื่อไม่ถูกต้อง ให้ลบไฟล์ทิ้ง
                if (req.file) {
                    const p = path_1.default.join(SLIDE_UPLOADS_DIR, req.file.filename);
                    try {
                        if (fs_1.default.existsSync(p))
                            fs_1.default.unlinkSync(p);
                    }
                    catch (_j) { }
                }
                return res.status(400).json({ message: "กรุณากรอกชื่อสไลด์" });
            }
            // แปลงสถานะให้เป็น 0/1 รองรับ true/false หรือ "1"/"0"
            const rawStatus = (_h = (_f = (_e = req.body) === null || _e === void 0 ? void 0 : _e.status) !== null && _f !== void 0 ? _f : (_g = req.body) === null || _g === void 0 ? void 0 : _g.slide_status) !== null && _h !== void 0 ? _h : 1;
            const slide_status = String(rawStatus).toLowerCase() === "true"
                ? 1
                : String(rawStatus).toLowerCase() === "false"
                    ? 0
                    : Number(rawStatus)
                        ? 1
                        : 0;
            // ต้องมีรูปภาพตอนเพิ่ม
            const file = req.file;
            if (!file) {
                return res.status(400).json({ message: "กรุณาอัปโหลดภาพสไลด์" });
            }
            const slide_img = `/uploads/slide_images/${file.filename}`;
            // กันชื่อซ้ำแบบตรงตัว (ถ้าไม่ต้องการกันซ้ำ ลบบล็อกนี้ได้)
            const dup = yield prisma.slide.findFirst({
                where: { slide_name },
            });
            if (dup) {
                // ลบไฟล์ใหม่ทิ้งเพราะไม่ใช้แล้ว
                const p = path_1.default.join(SLIDE_UPLOADS_DIR, file.filename);
                try {
                    if (fs_1.default.existsSync(p))
                        fs_1.default.unlinkSync(p);
                }
                catch (_k) { }
                return res
                    .status(409)
                    .json({ message: "ชื่อนี้มีอยู่แล้ว กรุณาใช้ชื่ออื่น" });
            }
            const created = yield prisma.slide.create({
                data: {
                    slide_name,
                    slide_img,
                    slide_status,
                },
            });
            emit(req, "slide:created", created);
            return res
                .status(201)
                .json({ message: "เพิ่มสไลด์สำเร็จ", slide: created });
        }
        catch (error) {
            // ถ้าผิดพลาดให้ลบไฟล์ที่อัปโหลดไว้เพื่อไม่ให้ค้างในเครื่อง
            if (req.file) {
                const p = path_1.default.join(SLIDE_UPLOADS_DIR, req.file.filename);
                try {
                    if (fs_1.default.existsSync(p))
                        fs_1.default.unlinkSync(p);
                }
                catch (_l) { }
            }
            console.error("Error adding slide:", error);
            return res
                .status(500)
                .json({ message: "ไม่สามารถเพิ่มสไลด์ได้", error: error.message });
        }
    }),
    update_slide: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        var _a, _b, _c, _d, _e, _f, _g, _h;
        const idRaw = (_c = (_a = req.params.id) !== null && _a !== void 0 ? _a : (_b = req.body) === null || _b === void 0 ? void 0 : _b.slide_id) !== null && _c !== void 0 ? _c : (_d = req.body) === null || _d === void 0 ? void 0 : _d.id;
        const slide_id = parseInt(idRaw, 10);
        if (!slide_id || Number.isNaN(slide_id)) {
            // ลบไฟล์ใหม่ (ถ้ามี) ทิ้งเพราะ id ไม่ถูกต้อง
            if (req.file) {
                const newFilePath = path_1.default.join(SLIDE_UPLOADS_DIR, req.file.filename);
                try {
                    if (fs_1.default.existsSync(newFilePath))
                        fs_1.default.unlinkSync(newFilePath);
                }
                catch (_j) { }
            }
            return res.status(400).json({ message: "รหัสสไลด์ไม่ถูกต้อง" });
        }
        try {
            const existing = yield prisma.slide.findUnique({ where: { slide_id } });
            if (!existing) {
                if (req.file) {
                    const newFilePath = path_1.default.join(SLIDE_UPLOADS_DIR, req.file.filename);
                    try {
                        if (fs_1.default.existsSync(newFilePath))
                            fs_1.default.unlinkSync(newFilePath);
                    }
                    catch (_k) { }
                }
                return res.status(404).json({ message: "ไม่พบสไลด์" });
            }
            const nextName = ((_f = (_e = req.body.name) !== null && _e !== void 0 ? _e : req.body.slide_name) !== null && _f !== void 0 ? _f : existing.slide_name).trim();
            // แปลงสถานะ (ถ้าไม่ส่งมา ใช้ค่าเดิม)
            const rawStatus = (_h = (_g = req.body.status) !== null && _g !== void 0 ? _g : req.body.slide_status) !== null && _h !== void 0 ? _h : existing.slide_status;
            const nextStatus = String(rawStatus).toLowerCase() === "true"
                ? 1
                : String(rawStatus).toLowerCase() === "false"
                    ? 0
                    : Number(rawStatus)
                        ? 1
                        : 0;
            let newImgPath;
            if (req.file) {
                newImgPath = `/uploads/slide_images/${req.file.filename}`;
            }
            const updated = yield prisma.slide.update({
                where: { slide_id },
                data: Object.assign({ slide_name: nextName, slide_status: nextStatus }, (newImgPath ? { slide_img: newImgPath } : {})),
            });
            // ถ้ามีไฟล์ใหม่ ให้ลบไฟล์เก่า
            if (req.file && existing.slide_img) {
                const oldPath = path_1.default.join(SLIDE_UPLOADS_DIR, path_1.default.basename(existing.slide_img));
                try {
                    if (fs_1.default.existsSync(oldPath))
                        fs_1.default.unlinkSync(oldPath);
                }
                catch (err) {
                    console.error("Failed to delete old slide image:", err);
                    // ไม่ทำให้การอัปเดตล้มเหลว
                }
            }
            emit(req, "slide:updated", updated);
            return res
                .status(200)
                .json({ message: "อัปเดตสไลด์สำเร็จ", slide: updated });
        }
        catch (error) {
            // ลบไฟล์ใหม่ทิ้งหากอัปเดตล้มเหลว
            if (req.file) {
                const newFilePath = path_1.default.join(SLIDE_UPLOADS_DIR, req.file.filename);
                try {
                    if (fs_1.default.existsSync(newFilePath))
                        fs_1.default.unlinkSync(newFilePath);
                }
                catch (_l) { }
            }
            console.error("Error updating slide:", error);
            return res
                .status(500)
                .json({ message: "ไม่สามารถอัปเดตสไลด์ได้", error: error.message });
        }
    }),
    delete_slide: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        var _a, _b, _c, _d;
        const idRaw = (_c = (_a = req.params.id) !== null && _a !== void 0 ? _a : (_b = req.body) === null || _b === void 0 ? void 0 : _b.slide_id) !== null && _c !== void 0 ? _c : (_d = req.body) === null || _d === void 0 ? void 0 : _d.id;
        const slide_id = parseInt(idRaw, 10);
        if (!slide_id || Number.isNaN(slide_id)) {
            return res.status(400).json({ message: "รหัสสไลด์ไม่ถูกต้อง" });
        }
        try {
            const slide = yield prisma.slide.findUnique({ where: { slide_id } });
            if (!slide) {
                return res.status(404).json({ message: "ไม่พบสไลด์" });
            }
            yield prisma.slide.delete({ where: { slide_id } });
            // ลบไฟล์ภาพจริง
            if (slide.slide_img) {
                const imgPath = path_1.default.join(SLIDE_UPLOADS_DIR, path_1.default.basename(slide.slide_img));
                try {
                    if (fs_1.default.existsSync(imgPath)) {
                        fs_1.default.unlinkSync(imgPath);
                        console.log(`ลบรูปสไลด์: ${imgPath}`);
                    }
                }
                catch (err) {
                    console.error("ไม่สามารถลบไฟล์สไลด์:", err);
                    // ไม่ทำให้การลบสไลด์ล้มเหลว
                }
            }
            emit(req, "slide:deleted", { slide_id });
            return res.status(200).json({ message: "ลบสไลด์สำเร็จ" });
        }
        catch (error) {
            console.error("Error deleting slide:", error);
            return res
                .status(500)
                .json({ message: "ไม่สามารถลบสไลด์ได้", error: error.message });
        }
    }),
    // ===== End Slides API =====
    // ===== Location & Contacts API =====
    location: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        try {
            // มีได้แค่ 1 แถว: ถ้ายังไม่มี ให้สร้างแถวว่างไว้เลย
            let row = yield prisma.location.findFirst();
            if (!row) {
                row = yield prisma.location.create({
                    data: {
                        location_name: "",
                        location_link: "",
                        location_map: "",
                    },
                });
            }
            return res.status(200).json(row);
        }
        catch (error) {
            console.error("Error fetching location:", error);
            return res
                .status(500)
                .json({
                message: "ไม่สามารถดึงข้อมูลสถานที่ได้",
                error: error.message,
            });
        }
    }),
    update_location: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        var _a;
        const idRaw = req.params.id;
        const location_id = parseInt(idRaw, 10);
        if (!location_id || Number.isNaN(location_id)) {
            return res.status(400).json({ message: "รหัสสถานที่ไม่ถูกต้อง" });
        }
        try {
            const { location_name, location_link, location_map } = (_a = req.body) !== null && _a !== void 0 ? _a : {};
            if (!location_name || !String(location_name).trim()) {
                return res.status(400).json({ message: "กรุณากรอกชื่อสถานที่" });
            }
            const existing = yield prisma.location.findUnique({
                where: { location_id },
            });
            if (!existing) {
                return res.status(404).json({ message: "ไม่พบสถานที่" });
            }
            const updated = yield prisma.location.update({
                where: { location_id },
                data: {
                    location_name: String(location_name).trim(),
                    // ใน schema เป็น String (non-null) ทั้งคู่ → ใส่เป็น "" ถ้า undefined
                    location_link: location_link !== null && location_link !== void 0 ? location_link : "",
                    location_map: location_map !== null && location_map !== void 0 ? location_map : "",
                },
            });
            emit(req, "location:updated", updated);
            return res.status(200).json(updated);
        }
        catch (error) {
            console.error("Error updating location:", error);
            return res
                .status(500)
                .json({ message: "ไม่สามารถอัปเดตสถานที่ได้", error: error.message });
        }
    }),
    // --- Contacts API (schema ใหม่: contact_name, contact_link) ---
    contacts: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        try {
            const items = yield prisma.contact.findMany({
                orderBy: { contact_id: "desc" },
            });
            return res.status(200).json(items);
        }
        catch (error) {
            console.error("Error fetching contacts:", error);
            return res
                .status(500)
                .json({
                message: "ไม่สามารถดึงข้อมูลการติดต่อได้",
                error: error.message,
            });
        }
    }),
    add_contact: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        var _a;
        try {
            const { contact_name, contact_link } = (_a = req.body) !== null && _a !== void 0 ? _a : {};
            if (!contact_name || !String(contact_name).trim()) {
                return res.status(400).json({ message: "กรุณากรอกชื่อช่องทาง" });
            }
            const created = yield prisma.contact.create({
                data: {
                    contact_name: String(contact_name).trim(),
                    contact_link: contact_link ? String(contact_link).trim() : null,
                },
            });
            emit(req, "contact:created", created);
            return res.status(201).json(created);
        }
        catch (error) {
            console.error("Error creating contact:", error);
            return res
                .status(500)
                .json({
                message: "ไม่สามารถเพิ่มข้อมูลติดต่อได้",
                error: error.message,
            });
        }
    }),
    update_contact: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        var _a;
        const idRaw = req.params.id;
        const contact_id = parseInt(idRaw, 10);
        if (!contact_id || Number.isNaN(contact_id)) {
            return res.status(400).json({ message: "รหัสข้อมูลติดต่อไม่ถูกต้อง" });
        }
        try {
            const { contact_name, contact_link } = (_a = req.body) !== null && _a !== void 0 ? _a : {};
            if (!contact_name || !String(contact_name).trim()) {
                return res.status(400).json({ message: "กรุณากรอกชื่อช่องทาง" });
            }
            const existing = yield prisma.contact.findUnique({
                where: { contact_id },
            });
            if (!existing) {
                return res.status(404).json({ message: "ไม่พบข้อมูลติดต่อ" });
            }
            const updated = yield prisma.contact.update({
                where: { contact_id },
                data: {
                    contact_name: String(contact_name).trim(),
                    contact_link: contact_link ? String(contact_link).trim() : null,
                },
            });
            emit(req, "contact:updated", updated);
            return res.status(200).json(updated);
        }
        catch (error) {
            console.error("Error updating contact:", error);
            return res
                .status(500)
                .json({
                message: "ไม่สามารถอัปเดตข้อมูลติดต่อได้",
                error: error.message,
            });
        }
    }),
    delete_contact: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        const idRaw = req.params.id;
        const contact_id = parseInt(idRaw, 10);
        if (!contact_id || Number.isNaN(contact_id)) {
            return res.status(400).json({ message: "รหัสข้อมูลติดต่อไม่ถูกต้อง" });
        }
        try {
            yield prisma.contact.delete({ where: { contact_id } });
            emit(req, "contact:deleted", { contact_id });
            return res.status(200).json({ message: "ลบข้อมูลติดต่อสำเร็จ" });
        }
        catch (error) {
            console.error("Error deleting contact:", error);
            if ((error === null || error === void 0 ? void 0 : error.code) === "P2025") {
                return res.status(404).json({ message: "ไม่พบข้อมูลติดต่อ" });
            }
            return res
                .status(500)
                .json({ message: "ไม่สามารถลบข้อมูลติดต่อได้", error: error.message });
        }
    }),
    reservation: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        try {
            const { date, tableId, includeCanceled } = req.query;
            const { start, end } = dayRange(date);
            const active = [
                "PENDING_OTP",
                "OTP_VERIFIED",
                "AWAITING_PAYMENT",
                "CONFIRMED",
            ];
            const whereStatus = includeCanceled === "1" ? { not: "EXPIRED" } : { in: active };
            const where = {
                status: whereStatus,
                dateStart: { lt: end },
                dateEnd: { gt: start },
            };
            if (tableId)
                where.tableId = Number(tableId);
            const rows = yield prisma.reservation.findMany({
                where,
                include: {
                    table: { select: { id: true, label: true } },
                    user: { select: { user_id: true, user_fname: true, user_lname: true, user_phone: true } },
                    // ถ้าจำเป็น (ขึ้นกับ schema):
                    // order:   { select: { id: true } },
                    // payment: { select: { id: true } },
                },
                orderBy: [{ tableId: "asc" }, { dateStart: "asc" }],
            });
            const data = rows.map((r) => {
                var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k;
                return ({
                    id: r.id,
                    tableId: r.tableId,
                    tableLabel: (_b = (_a = r.table) === null || _a === void 0 ? void 0 : _a.label) !== null && _b !== void 0 ? _b : "-",
                    start: (_c = r.dateStart) === null || _c === void 0 ? void 0 : _c.toISOString(), // ✅ ส่งเป็น string
                    end: r.dateEnd ? r.dateEnd.toISOString() : null, // ✅ ส่งเป็น string
                    people: r.people,
                    status: r.status,
                    // ✅ เพิ่มฟิลด์ที่ FE ใช้ทำ reservationOnly และ map order
                    orderId: (_d = r.orderId) !== null && _d !== void 0 ? _d : null, // ถ้า schema มี relation ให้ select มา หรือใช้ r.orderId ถ้ามี
                    paymentId: (_e = r.paymentId) !== null && _e !== void 0 ? _e : null, // เช่นเดียวกัน
                    depositAmount: (_f = r.depositAmount) !== null && _f !== void 0 ? _f : 0, // มัดจำ
                    user: {
                        id: r.userId,
                        name: [(_g = r.user) === null || _g === void 0 ? void 0 : _g.user_fname, (_h = r.user) === null || _h === void 0 ? void 0 : _h.user_lname]
                            .filter(Boolean)
                            .join(" ")
                            .trim() || String(r.userId),
                        phone: (_k = (_j = r.user) === null || _j === void 0 ? void 0 : _j.user_phone) !== null && _k !== void 0 ? _k : null,
                    },
                });
            });
            emit === null || emit === void 0 ? void 0 : emit(req, "reservation:day", { date, data }); // ชื่ออีเวนต์จะตั้งอะไรก็ได้
            return res.json({
                date: date !== null && date !== void 0 ? date : new Date().toISOString().slice(0, 10),
                start,
                end,
                data,
            });
        }
        catch (e) {
            console.error(e);
            return res.status(500).json({ message: "listByDay error" });
        }
    }),
    // ดึงรายละเอียดใบจอง (ใช้ในหน้าแอดมินดูบิล/สลิป)
    detail: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p;
        try {
            const id = Number(req.params.id);
            if (!id)
                return res.status(400).json({ message: "id required" });
            const r = yield prisma.reservation.findUnique({
                where: { id },
                include: {
                    user: true,
                    table: true,
                    order: { select: { id: true, status: true } },
                    payment: {
                        select: {
                            id: true,
                            status: true,
                            amount: true,
                            expiresAt: true,
                            slipImage: true,
                        },
                    },
                },
            });
            if (!r)
                return res.status(404).json({ message: "ไม่พบรายการ" });
            // สร้างชื่อผู้ใช้จากฟิลด์ที่มีอยู่จริงในฐานข้อมูลของคุณ
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
                dateEnd: r.dateEnd ? r.dateEnd.toISOString() : null, // ถ้ามี
                people: r.people,
                status: r.status,
                orderId: (_d = (_c = r.order) === null || _c === void 0 ? void 0 : _c.id) !== null && _d !== void 0 ? _d : null,
                paymentId: (_f = (_e = r.payment) === null || _e === void 0 ? void 0 : _e.id) !== null && _f !== void 0 ? _f : null,
                depositAmount: (_g = r.depositAmount) !== null && _g !== void 0 ? _g : 0,
                paymentExpiresAt: ((_h = r.payment) === null || _h === void 0 ? void 0 : _h.expiresAt)
                    ? r.payment.expiresAt.toISOString()
                    : null,
                slipImage: (_k = (_j = r.payment) === null || _j === void 0 ? void 0 : _j.slipImage) !== null && _k !== void 0 ? _k : null,
                user: {
                    id: (_m = (_l = anyUser === null || anyUser === void 0 ? void 0 : anyUser.user_id) !== null && _l !== void 0 ? _l : anyUser === null || anyUser === void 0 ? void 0 : anyUser.id) !== null && _m !== void 0 ? _m : r.userId,
                    name: userName,
                    phone: (_o = anyUser === null || anyUser === void 0 ? void 0 : anyUser.user_phone) !== null && _o !== void 0 ? _o : null,
                    email: (_p = anyUser === null || anyUser === void 0 ? void 0 : anyUser.user_email) !== null && _p !== void 0 ? _p : null,
                },
            });
        }
        catch (e) {
            console.error(e);
            return res.status(500).json({ message: "detail error", error: e.message });
        }
    }),
};
