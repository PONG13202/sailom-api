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
exports.FrontController = void 0;
exports.emitMyReservations = emitMyReservations;
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
const getIO = (req) => req.app.get("io");
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
// Ensure JWT_SECRET is defined
if (!secret) {
    console.error("JWT_SECRET is not defined in environment variables.");
    process.exit(1); // Exit the process if critical environment variable is missing
}
// Ensure UPLOADS_DIR exists and is correctly set for user images
const USER_UPLOADS_DIR = path_1.default.resolve("uploads/user_images");
if (!fs_1.default.existsSync(USER_UPLOADS_DIR)) {
    fs_1.default.mkdirSync(USER_UPLOADS_DIR, { recursive: true });
}
const isLocalUserImage = (p) => !!p &&
    !p.startsWith("http") &&
    (p.startsWith("uploads/user_images/") || p.startsWith("/uploads/user_images/"));
// --- End Type Augmentation ---
function emitMyReservations(req, userId) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
        const reservations = yield prisma.reservation.findMany({
            where: { userId },
            orderBy: { updatedAt: "desc" },
            include: {
                table: true,
                order: { include: { items: true } },
                payment: true,
            },
        });
        (_a = getIO(req)) === null || _a === void 0 ? void 0 : _a.to(`user:${userId}`).emit("my_reservations:update", {
            data: reservations,
            now: new Date().toISOString(),
        });
    });
}
exports.FrontController = {
    signup: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        var _a;
        try {
            const { user_name, user_pass, user_fname, user_lname, user_email, user_phone, user_status,
            // google_id should not be present for regular signup
             } = req.body;
            // ตรวจสอบว่ามีไฟล์รูปภาพถูกอัปโหลดหรือไม่
            const user_img_path = req.file
                ? `uploads/user_images/${req.file.filename}`
                : null;
            // ตรวจสอบข้อมูลที่จำเป็นสำหรับการลงทะเบียนทั่วไป
            if (!user_email) {
                // หากมีการอัปโหลดไฟล์แต่เกิดข้อผิดพลาดในการตรวจสอบข้อมูล ให้ลบไฟล์ออก
                if (req.file) {
                    fs_1.default.unlink(req.file.path, (err) => {
                        if (err)
                            console.error("Error deleting uploaded file:", err);
                    });
                }
                return res.status(400).json({ message: "กรุณาระบุอีเมล" });
            }
            if (!user_name || !user_pass) {
                if (req.file) {
                    fs_1.default.unlink(req.file.path, (err) => {
                        if (err)
                            console.error("Error deleting uploaded file:", err);
                    });
                }
                return res
                    .status(400)
                    .json({ message: "กรุณาระบุชื่อผู้ใช้และรหัสผ่าน" });
            }
            if (user_pass.length < 6) {
                if (req.file) {
                    fs_1.default.unlink(req.file.path, (err) => {
                        if (err)
                            console.error("Error deleting uploaded file:", err);
                    });
                }
                return res
                    .status(400)
                    .json({ message: "รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร" });
            }
            if (!user_fname || !user_lname) {
                if (req.file) {
                    fs_1.default.unlink(req.file.path, (err) => {
                        if (err)
                            console.error("Error deleting uploaded file:", err);
                    });
                }
                return res.status(400).json({ message: "กรุณาระบุชื่อจริงและนามสกุล" });
            }
            // ตรวจสอบการสมัครซ้ำ (user_name หรือ user_email)
            const existingUser = yield prisma.user.findFirst({
                where: {
                    OR: [{ user_name: user_name }, { user_email: user_email }],
                },
            });
            if (existingUser) {
                // หากมีการอัปโหลดไฟล์แต่ผู้ใช้มีอยู่แล้ว ให้ลบไฟล์ออก
                if (req.file) {
                    fs_1.default.unlink(req.file.path, (err) => {
                        if (err)
                            console.error("Error deleting uploaded file:", err);
                    });
                }
                if (existingUser.user_name === user_name) {
                    return res.status(400).json({ message: "ชื่อผู้ใช้นี้ถูกใช้ไปแล้ว" });
                }
                if (existingUser.user_email === user_email) {
                    return res.status(400).json({ message: "อีเมลนี้ถูกใช้ไปแล้ว" });
                }
            }
            // เข้ารหัสรหัสผ่าน
            const hashedPassword = yield bcryptjs_1.default.hash(user_pass, 10);
            // สร้างผู้ใช้ใหม่
            const newUser = yield prisma.user.create({
                data: {
                    user_name: user_name,
                    user_pass: hashedPassword,
                    user_fname: user_fname,
                    user_lname: user_lname,
                    user_email: user_email,
                    user_phone: user_phone || null,
                    user_img: user_img_path, // บันทึกพาธรูปภาพ
                    user_status: user_status !== null && user_status !== void 0 ? user_status : 1,
                    google_id: null, // การลงทะเบียนทั่วไป ไม่มี google_id
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
                    user_img: newUser.user_img,
                },
            });
        }
        catch (error) {
            console.error("Error during signup:", error);
            // หากเกิดข้อผิดพลาดหลังจากอัปโหลดไฟล์แต่ก่อนบันทึกลง DB ให้ลบไฟล์ออก
            if (req.file) {
                fs_1.default.unlink(req.file.path, (err) => {
                    if (err)
                        console.error("Error deleting uploaded file on signup error:", err);
                });
            }
            return res.status(500).json({
                message: "เกิดข้อผิดพลาดในการสมัครสมาชิก: " + error.message,
            });
        }
    }),
    google_signin: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        var _a;
        try {
            const { token } = req.body;
            if (!token) {
                return res.status(400).json({ message: "Token ไม่ถูกส่งมา" });
            }
            // ตรวจสอบ token กับ Google API
            const googleResponse = yield axios_1.default.get(`https://oauth2.googleapis.com/tokeninfo?id_token=${token}`);
            const { sub: googleId, email, given_name: first_name, family_name: last_name, picture: profile_image, email_verified, } = googleResponse.data;
            if (!email_verified) {
                return res
                    .status(400)
                    .json({ message: "อีเมล Google ยังไม่ได้รับการยืนยัน" });
            }
            // ค้นหาผู้ใช้ด้วย google_id
            let user = yield prisma.user.findUnique({
                where: { google_id: googleId },
            });
            if (!user) {
                // ถ้าไม่พบผู้ใช้ด้วย google_id ให้ลองค้นหาด้วย email
                const existingUserByEmail = yield prisma.user.findUnique({
                    where: { user_email: email },
                });
                if (existingUserByEmail) {
                    // ถ้ามีผู้ใช้ที่มีอีเมลนี้อยู่แล้ว แต่ยังไม่มี google_id
                    if (!existingUserByEmail.google_id) {
                        // อัปเดตผู้ใช้เดิมโดยเพิ่ม google_id และรูปโปรไฟล์
                        if (existingUserByEmail.user_status !== 1) {
                            return res.status(403).json({ message: "บัญชีนี้ถูกระงับการใช้งาน" });
                        }
                        user = yield prisma.user.update({
                            where: { user_email: email },
                            data: { google_id: googleId, user_img: profile_image },
                        });
                    }
                    else {
                        // ถ้าอีเมลถูกใช้โดยบัญชี Google อื่นแล้ว (มี google_id แต่ไม่ตรงกัน)
                        return res.status(400).json({
                            message: "อีเมลนี้ถูกใช้โดยบัญชี Google อื่นแล้ว",
                        });
                    }
                }
                else {
                    // ถ้ายังไม่มีบัญชีที่เชื่อมโยงกับ Google ID หรือ Email นี้เลย
                    // สร้างผู้ใช้ใหม่ แต่ยังไม่สมบูรณ์ (incompleteProfile)
                    const tempToken = jsonwebtoken_1.default.sign({
                        google_id: googleId,
                        email,
                        first_name,
                        last_name,
                        profile_image,
                        incompleteProfile: true, // ตั้งค่าสถานะว่าโปรไฟล์ยังไม่สมบูรณ์
                    }, secret, { expiresIn: "10m" } // Token ชั่วคราว มีอายุ 10 นาที
                    );
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
            }
            if (user.user_status !== 1) {
                return res.status(403).json({ message: "บัญชีนี้ถูกระงับการใช้งาน" });
            }
            // ถ้าผู้ใช้มีอยู่แล้วหรือถูกสร้าง/อัปเดตเรียบร้อยแล้ว
            // สร้าง JWT token สำหรับการเข้าสู่ระบบปกติ
            const jwtToken = jsonwebtoken_1.default.sign({
                id: user.user_id,
                user_name: user.user_name,
                user_fname: user.user_fname,
                user_lname: user.user_lname,
                user_email: user.user_email,
                user_img: user.user_img,
                user_phone: user.user_phone,
                user_status: user.user_status,
            }, secret, { expiresIn: "1d" });
            return res.status(200).json({
                message: "เข้าสู่ระบบด้วย Google สำเร็จ",
                token: jwtToken,
                user: {
                    id: user.user_id,
                    user_name: user.user_name,
                    user_fname: user.user_fname,
                    user_lname: user.user_lname,
                    user_email: user.user_email,
                    user_status: user.user_status,
                    user_img: user.user_img,
                },
            });
        }
        catch (error) {
            console.error("Google signin error:", ((_a = error.response) === null || _a === void 0 ? void 0 : _a.data) || error.message);
            return res
                .status(500)
                .json({ message: "ไม่สามารถเข้าสู่ระบบด้วย Google ได้" });
        }
    }),
    signin: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        try {
            const { user_name, user_pass } = req.body; // user_name สามารถเป็น username หรือ email ก็ได้
            if (!user_name || !user_pass) {
                return res
                    .status(400)
                    .json({ message: "กรุณากรอกชื่อผู้ใช้/อีเมลและรหัสผ่าน" });
            }
            // ค้นหาผู้ใช้ด้วย user_name หรือ user_email
            const user = yield prisma.user.findFirst({
                where: {
                    OR: [{ user_name: user_name }, { user_email: user_name }],
                },
            });
            if (!user) {
                return res.status(404).json({ message: "ไม่พบผู้ใช้นี้ในระบบ" });
            }
            // ตรวจสอบรหัสผ่าน
            if (!user.user_pass) {
                return res
                    .status(400)
                    .json({ message: "บัญชีนี้ไม่มีรหัสผ่าน (อาจลงทะเบียนด้วย Google)" });
            }
            const isMatch = yield bcryptjs_1.default.compare(user_pass, user.user_pass);
            if (!isMatch) {
                return res.status(401).json({ message: "รหัสผ่านไม่ถูกต้อง" });
            }
            if (user.user_status !== 1) {
                return res.status(403).json({ message: "บัญชีนี้ถูกระงับการใช้งาน" });
            }
            // สร้าง JWT token
            const jwtToken = jsonwebtoken_1.default.sign({
                id: user.user_id,
                user_name: user.user_name,
                user_fname: user.user_fname,
                user_lname: user.user_lname,
                user_email: user.user_email,
                user_img: user.user_img,
                user_phone: user.user_phone,
                user_status: user.user_status,
            }, secret, { expiresIn: "1d" } // Token มีอายุ 1 วัน
            );
            return res.status(200).json({
                message: "เข้าสู่ระบบสำเร็จ",
                token: jwtToken,
                user: {
                    id: user.user_id,
                    user_name: user.user_name,
                    user_fname: user.user_fname,
                    user_lname: user.user_lname,
                    user_email: user.user_email,
                    user_status: user.user_status,
                    user_img: user.user_img,
                },
            });
        }
        catch (error) {
            console.error("Signin error:", error);
            return res
                .status(500)
                .json({ message: "เกิดข้อผิดพลาดในการเข้าสู่ระบบ" });
        }
    }),
    add_profile: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        var _a;
        try {
            const authHeader = req.headers.authorization;
            if (!authHeader || !authHeader.startsWith("Bearer ")) {
                return res.status(401).json({ message: "ไม่ได้รับ token" });
            }
            const tempToken = authHeader.split(" ")[1];
            let decoded;
            try {
                decoded = jsonwebtoken_1.default.verify(tempToken, secret);
            }
            catch (err) {
                return res.status(401).json({ message: "Token หมดอายุหรือไม่ถูกต้อง" });
            }
            // ตรวจสอบว่า token เป็น tempToken สำหรับ incompleteProfile
            if (!decoded.incompleteProfile || !decoded.email || !decoded.google_id) {
                return res
                    .status(400)
                    .json({ message: "Token ไม่ถูกต้องสำหรับการกรอกข้อมูลโปรไฟล์" });
            }
            const { user_fname, user_lname, user_phone, user_name, user_pass } = req.body;
            const user_img_path = req.file
                ? `uploads/user_images/${req.file.filename}`
                : decoded.profile_image || null;
            // ตรวจสอบข้อมูลที่จำเป็น
            if (!user_fname ||
                !user_lname ||
                !user_phone ||
                !user_name ||
                !user_pass) {
                if (req.file) {
                    // Clean up uploaded file if validation fails
                    fs_1.default.unlink(req.file.path, (err) => {
                        if (err)
                            console.error("Error deleting uploaded file:", err);
                    });
                }
                return res.status(400).json({ message: "กรุณากรอกข้อมูลให้ครบถ้วน" });
            }
            if (user_pass.length < 6) {
                if (req.file) {
                    // Clean up uploaded file if validation fails
                    fs_1.default.unlink(req.file.path, (err) => {
                        if (err)
                            console.error("Error deleting uploaded file:", err);
                    });
                }
                return res
                    .status(400)
                    .json({ message: "รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร" });
            }
            // ตรวจสอบ user_name ซ้ำก่อนสร้างผู้ใช้
            const existingUserName = yield prisma.user.findUnique({
                where: { user_name: user_name },
            });
            if (existingUserName) {
                if (req.file) {
                    // Clean up uploaded file if validation fails
                    fs_1.default.unlink(req.file.path, (err) => {
                        if (err)
                            console.error("Error deleting uploaded file:", err);
                    });
                }
                return res.status(400).json({ message: "ชื่อผู้ใช้นี้ถูกใช้ไปแล้ว" });
            }
            // เข้ารหัสรหัสผ่าน
            const hashedPassword = yield bcryptjs_1.default.hash(user_pass, 10);
            // สร้างผู้ใช้ใหม่จากข้อมูล Google และข้อมูลที่ผู้ใช้กรอกเพิ่มเติม
            const newUser = yield prisma.user.create({
                data: {
                    google_id: decoded.google_id,
                    user_email: decoded.email,
                    user_fname: user_fname,
                    user_lname: user_lname,
                    user_phone: user_phone,
                    user_name: user_name,
                    user_pass: hashedPassword,
                    user_img: user_img_path, // ใช้รูปที่อัปโหลด หรือรูปจาก Google หรือ null
                    user_status: 1, // Default status
                },
            });
            // สร้าง JWT token ใหม่สำหรับผู้ใช้ที่สมบูรณ์แล้ว
            const jwtToken = jsonwebtoken_1.default.sign({
                id: newUser.user_id,
                user_name: newUser.user_name,
                user_fname: newUser.user_fname,
                user_lname: newUser.user_lname,
                user_email: newUser.user_email,
                user_img: newUser.user_img,
                user_phone: newUser.user_phone,
                user_status: newUser.user_status,
            }, secret, { expiresIn: "1d" });
            return res.status(200).json({
                message: "ข้อมูลโปรไฟล์ถูกบันทึกสำเร็จ",
                token: jwtToken,
                user: {
                    id: newUser.user_id,
                    user_name: newUser.user_name,
                    user_fname: newUser.user_fname,
                    user_lname: newUser.user_lname,
                    user_email: newUser.user_email,
                    user_status: newUser.user_status,
                    user_img: newUser.user_img,
                },
            });
        }
        catch (error) {
            console.error("Complete profile error:", ((_a = error.response) === null || _a === void 0 ? void 0 : _a.data) || error.message);
            // Clean up uploaded file if an error occurs during DB operation
            if (req.file) {
                fs_1.default.unlink(req.file.path, (err) => {
                    if (err)
                        console.error("Error deleting uploaded file on complete profile error:", err);
                });
            }
            return res.status(500).json({
                message: "ไม่สามารถบันทึกข้อมูลโปรไฟล์ได้: " + error.message,
            });
        }
    }),
    user_info: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
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
    check_user: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
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
    check_mail: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
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
                return res.json({ available: false }); // มีอีเมลนี้แล้ว
            }
            return res.json({ available: true }); // ใช้งานได้
        }
        catch (error) {
            console.error("Email check error:", error);
            return res
                .status(500)
                .json({ available: false, message: "Server error" });
        }
    }),
    slides_show: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        try {
            const slides = yield prisma.slide.findMany({
                orderBy: { slide_id: "asc" },
                select: {
                    slide_id: true,
                    slide_name: true,
                    slide_img: true,
                    slide_status: true,
                },
                where: { slide_status: 1 },
            });
            return res.status(200).json(slides);
        }
        catch (error) {
            console.error("Error fetching slides:", error);
            return res
                .status(500)
                .json({ message: "เกิดข้อผิดพลาดในการดึงข้อมูลสไลด์" });
        }
    }),
    seat: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        var _a;
        try {
            const seatOptions = yield prisma.seatOption.findMany({
                orderBy: [{ seats: "asc" }],
            });
            (_a = getIO(req)) === null || _a === void 0 ? void 0 : _a.emit("seat:list", seatOptions);
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
    locations: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        var _a;
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
            (_a = getIO(req)) === null || _a === void 0 ? void 0 : _a.emit("location", row);
            return res.status(200).json(row);
        }
        catch (error) {
            console.error("Error fetching location:", error);
            return res.status(500).json({
                message: "ไม่สามารถดึงข้อมูลสถานที่ได้",
                error: error.message,
            });
        }
    }),
    grid: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        var _a;
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
            (_a = getIO(req)) === null || _a === void 0 ? void 0 : _a.emit("gridSize", gridSize);
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
    table: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        var _a, _b;
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
            (_b = getIO(req)) === null || _b === void 0 ? void 0 : _b.emit("table:list", formatted);
            return res.status(200).json(formatted);
        }
        catch (error) {
            console.error("Error fetching tables:", error);
            return res.status(500).json({
                message: "เกิดข้อผิดพลาดในการดึงข้อมูลโต๊ะ",
                error: error.message,
            });
        }
    }),
    // GET /menus_show  (public)
    menu: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        try {
            const menus = yield prisma.foodMenu.findMany({
                where: { menu_status: 1 }, // โชว์เฉพาะเมนู Active
                orderBy: { menu_name: "asc" },
                include: {
                    MenuImages: true, // ยัง include เพื่อให้ FE เลือกรูปหลักได้
                    Typefoods: { include: { typefood: true } },
                },
            });
            // อย่า emit ที่นี่
            return res.status(200).json(menus);
        }
        catch (error) {
            console.error("Error fetching menus:", error);
            return res.status(500).json({ message: "Failed to fetch menus", error: error.message });
        }
    }),
    foodType: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        var _a;
        try {
            const foodTypes = yield prisma.typefood.findMany({
                orderBy: { name: "asc" },
            });
            (_a = getIO(req)) === null || _a === void 0 ? void 0 : _a.emit("foodType", foodTypes);
            return res.status(200).json(foodTypes);
        }
        catch (error) {
            console.error("Error fetching food types:", error);
            return res
                .status(500)
                .json({ message: "Failed to fetch food types", error: error.message });
        }
    }),
    my_reservations: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        var _a, _b;
        try {
            const userId = req.userId ||
                ((_a = req.user) === null || _a === void 0 ? void 0 : _a.id) ||
                ((_b = req.user) === null || _b === void 0 ? void 0 : _b.user_id);
            if (!userId)
                return res.status(401).json({ message: "ไม่พบผู้ใช้" });
            const reservations = yield prisma.reservation.findMany({
                where: { userId: Number(userId) },
                orderBy: { createdAt: "desc" },
                include: {
                    table: true,
                    payment: true,
                    order: {
                        include: { items: true, payment: true },
                    },
                },
            });
            // collect menu images
            const menuIds = Array.from(new Set(reservations.flatMap((r) => { var _a, _b; return ((_b = (_a = r.order) === null || _a === void 0 ? void 0 : _a.items) === null || _b === void 0 ? void 0 : _b.map((it) => it.menuId).filter(Boolean)) || []; })));
            const menus = yield prisma.foodMenu.findMany({
                where: { menu_id: { in: menuIds } },
                include: { MenuImages: true },
            });
            const imgByMenuId = new Map(menus.map((m) => { var _a, _b; return [m.menu_id, (_b = (_a = m.MenuImages[0]) === null || _a === void 0 ? void 0 : _a.menu_image) !== null && _b !== void 0 ? _b : null]; }));
            // build response
            const data = reservations.map((r) => {
                var _a, _b, _c, _d, _e;
                const pay = ((_a = r.order) === null || _a === void 0 ? void 0 : _a.payment) || r.payment || null;
                return {
                    id: r.id,
                    tableLabel: (_c = (_b = r.table) === null || _b === void 0 ? void 0 : _b.label) !== null && _c !== void 0 ? _c : null,
                    dateStart: (_d = r.dateStart) === null || _d === void 0 ? void 0 : _d.toISOString(),
                    dateEnd: (_e = r.dateEnd) === null || _e === void 0 ? void 0 : _e.toISOString(),
                    people: r.people,
                    status: r.status,
                    depositAmount: Number(r.depositAmount || 0),
                    order: r.order
                        ? {
                            id: r.order.id,
                            status: r.order.status,
                            total: Number(r.order.total || 0),
                            items: r.order.items.map((it) => ({
                                id: it.id,
                                menuId: it.menuId,
                                name: it.name,
                                price: Number(it.price || 0),
                                qty: Number(it.qty || 0),
                                note: it.note,
                                image: imgByMenuId.get(it.menuId) || null,
                            })),
                        }
                        : null,
                    payment: pay
                        ? {
                            id: pay.id,
                            status: pay.status,
                            amount: Number(pay.amount || 0),
                            expiresAt: pay.expiresAt ? pay.expiresAt.toISOString() : null,
                            confirmedAt: pay.confirmedAt ? pay.confirmedAt.toISOString() : null, // ✅ เพิ่มบรรทัดนี้
                            slipImage: pay.slipImage || null,
                            // ❌ ไม่ส่ง qrDataUrl ออกไป
                        }
                        : null,
                };
            });
            // ✅ emit แบบเดียวกับ frontend รอฟัง
            const io = getIO(req);
            io === null || io === void 0 ? void 0 : io.to(`user:${userId}`).emit("my_reservations:list", { data, now: new Date().toISOString() });
            io === null || io === void 0 ? void 0 : io.to(`user:${userId}`).emit("my_reservations:update", { data, now: new Date().toISOString() });
            return res.status(200).json({ data, now: new Date().toISOString() });
        }
        catch (error) {
            console.error("my_reservations error:", error);
            return res.status(500).json({ message: "โหลดรายการไม่สำเร็จ" });
        }
    }),
    // อัปโหลดรูปโปรไฟล์
    upload_avatar: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        var _a;
        try {
            if (!req.file)
                return res.status(400).json({ message: "ไม่พบไฟล์อัปโหลด" });
            const relPath = `uploads/user_images/${req.file.filename}`; // เก็บเป็นพาธสัมพัทธ์
            (_a = getIO(req)) === null || _a === void 0 ? void 0 : _a.emit("upload_avatar", { url: relPath, path: relPath });
            return res.status(200).json({ url: relPath, path: relPath });
        }
        catch (e) {
            console.error("upload_avatar error:", e);
            if (req.file)
                fs_1.default.unlink(req.file.path, () => { });
            return res.status(500).json({ message: "อัปโหลดรูปไม่สำเร็จ" });
        }
    }),
    update_profile: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        var _a;
        try {
            const userData = req.user;
            const id = Number(userData === null || userData === void 0 ? void 0 : userData.id);
            if (!id)
                return res.status(401).json({ message: "ไม่พบ userId จาก token" });
            const { user_name, user_fname, user_lname, user_phone, user_img } = req.body;
            // path ใหม่จากการอัปโหลดไฟล์ (ถ้ามีไฟล์แนบมาที่ฟิลด์ user_img)
            const filePath = req.file ? `uploads/user_images/${req.file.filename}` : undefined;
            // เลือกใช้ไฟล์ที่เพิ่งอัปโหลดก่อน ถ้าไม่มีค่อยใช้ user_img ที่ส่งมาใน body
            const nextImg = filePath !== null && filePath !== void 0 ? filePath : (user_img || undefined);
            // ตรวจชื่อผู้ใช้ซ้ำ (ยกเว้นของตัวเอง)
            if (user_name) {
                const exist = yield prisma.user.findFirst({
                    where: { user_name, NOT: { user_id: id } },
                });
                if (exist) {
                    // ถ้า validate ไม่ผ่านและมีอัปโหลดไฟล์มา ให้ลบทิ้ง
                    if (req.file)
                        fs_1.default.unlink(req.file.path, () => { });
                    return res.status(400).json({ message: "ชื่อผู้ใช้นี้ถูกใช้ไปแล้ว" });
                }
            }
            // อ่านค่ารูปเดิมไว้ก่อน
            const current = yield prisma.user.findUnique({
                where: { user_id: id },
                select: { user_img: true },
            });
            const updated = yield prisma.user.update({
                where: { user_id: id },
                data: {
                    user_name: user_name !== null && user_name !== void 0 ? user_name : undefined,
                    user_fname: user_fname !== null && user_fname !== void 0 ? user_fname : undefined,
                    user_lname: user_lname !== null && user_lname !== void 0 ? user_lname : undefined,
                    user_phone: user_phone !== null && user_phone !== void 0 ? user_phone : undefined,
                    user_img: nextImg, // ใช้ path ใหม่
                },
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
            // ลบไฟล์เก่า (ถ้าเป็นไฟล์ภายในและเปลี่ยนจริง)
            try {
                if ((current === null || current === void 0 ? void 0 : current.user_img) &&
                    current.user_img !== nextImg &&
                    isLocalUserImage(current.user_img)) {
                    const rel = current.user_img.startsWith("/") ? `.${current.user_img}` : current.user_img;
                    const abs = path_1.default.resolve(rel);
                    if (abs.startsWith(path_1.default.resolve("uploads")))
                        fs_1.default.unlink(abs, () => { });
                }
            }
            catch (e) {
                console.warn("unlink old avatar failed:", e.message);
            }
            (_a = getIO(req)) === null || _a === void 0 ? void 0 : _a.to(`user:${id}`).emit("user:updated", updated);
            return res.status(200).json(updated);
        }
        catch (error) {
            console.error("update_profile error:", error);
            // ถ้ามีไฟล์ใหม่อัปโหลดมา แล้วพังกลางทาง ให้ลบไฟล์นั้นทิ้ง
            if (req.file)
                fs_1.default.unlink(req.file.path, () => { });
            return res.status(500).json({ message: "บันทึกไม่สำเร็จ", error: error.message });
        }
    }),
    // เปลี่ยนรหัสผ่าน
    change_password: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        try {
            const userData = req.user;
            const id = Number(userData === null || userData === void 0 ? void 0 : userData.id);
            if (!id)
                return res.status(401).json({ message: "ไม่พบ userId จาก token" });
            const { currentPassword, newPassword } = req.body;
            if (!currentPassword || !newPassword) {
                return res.status(400).json({ message: "กรุณากรอกข้อมูลให้ครบ" });
            }
            if (newPassword.length < 6) {
                return res.status(400).json({ message: "รหัสผ่านใหม่ต้องมีอย่างน้อย 6 ตัว" });
            }
            const user = yield prisma.user.findUnique({ where: { user_id: id } });
            if (!user || !user.user_pass) {
                return res.status(400).json({ message: "บัญชีนี้ไม่มีรหัสผ่านเดิม" });
            }
            const ok = yield bcryptjs_1.default.compare(currentPassword, user.user_pass);
            if (!ok)
                return res.status(401).json({ message: "รหัสผ่านปัจจุบันไม่ถูกต้อง" });
            const hashed = yield bcryptjs_1.default.hash(newPassword, 10);
            yield prisma.user.update({ where: { user_id: id }, data: { user_pass: hashed } });
            return res.status(200).json({ message: "เปลี่ยนรหัสผ่านแล้ว" });
        }
        catch (error) {
            console.error("change_password error:", error);
            return res.status(500).json({ message: "ไม่สามารถเปลี่ยนรหัสผ่านได้" });
        }
    }),
};
