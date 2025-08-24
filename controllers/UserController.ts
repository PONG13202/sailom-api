// controllers/UserController.ts
import e, { Request, Response } from "express";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";
import jwt from "jsonwebtoken";
import dotenv from "dotenv";
import axios from "axios";
import path from "path";
import fs from "fs";
import type { Server as SocketIOServer } from "socket.io";

dotenv.config();

const prisma = new PrismaClient();
const secret = process.env.JWT_SECRET;
// api\uploads\menu_images
const UPLOADS_DIR = path.resolve("uploads/menu_images");
// api\uploads\slide_images
const SLIDE_UPLOADS_DIR = path.resolve("uploads/slide_images");
const getIO = (req: Request) => req.app.get("io") as SocketIOServer | undefined;
const emit = (req: Request, event: string, payload: any) => {
  getIO(req)?.emit(event, payload);
};
function dayRange(dateStr?: string) {
  // ถ้า FE ไม่ส่งมา ให้ใช้ "วันนี้" ของไทย
  // ปลอดภัยสุดคือให้ FE ส่ง YYYY-MM-DD มาเสมอ
  const tz = "+07:00";
  const d = dateStr ?? new Date().toISOString().slice(0, 10); // YYYY-MM-DD (ของ UTC)
  const start = new Date(`${d}T00:00:00${tz}`);
  const end = new Date(`${d}T24:00:00${tz}`);
  return { start, end };
}

const buildRoles = (
  isAdmin: boolean,
  isStaff: boolean
): ("admin" | "staff" | "user")[] => {
  const roles: ("admin" | "staff" | "user")[] = [];
  if (isAdmin) roles.push("admin");
  if (isStaff) roles.push("staff");
  if (!isAdmin && !isStaff) roles.push("user");
  return roles;
};
export const ROLE_VALUES = ["admin", "staff", "user"] as const;
export type Role = (typeof ROLE_VALUES)[number];

export const UserController = {
  verify_password: async (req: Request, res: Response) => {
    try {
      const { password } = req.body;
      if (!password || typeof password !== "string") {
        return res.status(400).json({ message: "กรุณากรอกรหัสผ่าน" });
      }

      // ดึง claims ตรงๆจาก middleware (ห้ามไว้วางใจชื่อ field เดียว)
      const claims: any = (req as any).user || {};

      // พยายาม extract user id จากหลายๆ field ที่พบบ่อยใน JWT
      const pickId = (v: unknown): number | undefined => {
        if (typeof v === "number" && Number.isFinite(v)) return v;
        if (typeof v === "string" && /^\d+$/.test(v)) return parseInt(v, 10);
        return undefined;
      };

      const actorId =
        pickId(claims.user_id) ??
        pickId(claims.userId) ??
        pickId(claims.id) ??
        pickId(claims.sub);

      // หา user ตาม actorId ก่อน ถ้าไม่มีลอง fallback ด้วย email (ถ้า token มี)
      let user =
        actorId !== undefined
          ? await prisma.user.findUnique({
              where: { user_id: actorId },
              select: { user_id: true, user_pass: true },
            })
          : null;

      if (!user && typeof claims.email === "string" && claims.email) {
        user = await prisma.user.findUnique({
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

      const isPasswordMatch = await bcrypt.compare(password, user.user_pass);
      if (!isPasswordMatch) {
        return res.status(401).json({ message: "รหัสผ่านไม่ถูกต้อง" });
      }

      return res.status(200).json({ message: "ยืนยันรหัสผ่านสำเร็จ" });
    } catch (error) {
      console.error("Error verifying password:", error);
      return res.status(500).json({ message: "Internal Server Error" });
    }
  },
  check_username: async (req: Request, res: Response) => {
    try {
      const { user_name } = req.query;

      if (!user_name || typeof user_name !== "string") {
        return res.status(400).json({ message: "กรุณาระบุชื่อผู้ใช้" });
      }

      const user = await prisma.user.findUnique({
        where: { user_name },
      });

      if (user) {
        return res
          .status(200)
          .json({ available: false, message: "ชื่อผู้ใช้นี้ถูกใช้ไปแล้ว" });
      }

      return res.status(200).json({ available: true });
    } catch (error) {
      console.error("Error in check_username:", error);
      return res.status(500).json({ message: "ไม่สามารถตรวจสอบชื่อผู้ใช้ได้" });
    }
  },
  check_email: async (req: Request, res: Response) => {
    const { user_email } = req.query;

    if (!user_email || typeof user_email !== "string") {
      return res
        .status(400)
        .json({ available: false, message: "Invalid email" });
    }

    try {
      const existemail = await prisma.user.findUnique({
        where: { user_email: user_email },
      });

      if (existemail) {
        return res.json({ available: false }); // มีอีเมลนี้แล้ว
      }

      return res.json({ available: true }); // ใช้งานได้
    } catch (error) {
      console.error("Email check error:", error);
      return res
        .status(500)
        .json({ available: false, message: "Server error" });
    }
  },

  register: async (req: Request, res: Response) => {
    try {
      // Use upload.single('user_profile_picture') as middleware before this controller
      // The file will be available at req.file
      const {
        user_name,
        user_pass,
        user_fname,
        user_lname,
        user_email,
        user_phone,
        user_status,
        google_id,
      } = req.body;

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
      const existingUser = await prisma.user.findFirst({
        where: {
          OR: [
            user_name && !google_id ? { user_name } : undefined,
            { user_email },
            google_id ? { google_id } : undefined,
          ].filter(Boolean) as any,
        },
      });

      if (existingUser) {
        // If a file was uploaded, remove it if the user already exists
        if (req.file) {
          fs.unlink(req.file.path, (err) => {
            if (err) console.error("Error deleting uploaded file:", err);
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
      let hashedPassword: string | null = null;
      if (user_pass) {
        hashedPassword = await bcrypt.hash(user_pass, 10);
      }

      // สร้างผู้ใช้ใหม่
      const newUser = await prisma.user.create({
        data: {
          user_name: google_id ? null : user_name,
          user_pass: hashedPassword,
          user_fname: user_fname || null,
          user_lname: user_lname || null,
          user_email,
          user_phone: user_phone || null,
          user_img: user_img_path, // Save the path to the uploaded image
          user_status: user_status ?? 1,
          google_id: google_id || null,
        },
      });
      getIO(req)?.emit("new_user", {
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
    } catch (error) {
      console.error("Error during registration:", error);
      // If an error occurs after file upload but before saving to DB, delete the file
      if (req.file) {
        fs.unlink(req.file.path, (err) => {
          if (err)
            console.error(
              "Error deleting uploaded file on registration error:",
              err
            );
        });
      }
      return res.status(500).json({
        message: "เกิดข้อผิดพลาดในการสมัครสมาชิก: " + (error as Error).message,
      });
    }
  },
  google_login: async (req: Request, res: Response) => {
    try {
      const { token } = req.body;

      if (!token) {
        return res.status(400).json({ message: "Token ไม่ถูกส่งมา" });
      }

      const googleResponse = await axios.get(
        `https://oauth2.googleapis.com/tokeninfo?id_token=${token}`
      );

      const {
        sub: googleId,
        email,
        given_name: first_name,
        family_name: last_name,
        picture: profile_image,
        email_verified,
      } = googleResponse.data;

      if (!email_verified) {
        return res
          .status(400)
          .json({ message: "อีเมล Google ยังไม่ได้รับการยืนยัน" });
      }

      // ตรวจสอบ admin จาก email หลังจากได้ email แล้ว
      const adminByEmail = await prisma.admin.findFirst({
        where: {
          user: {
            user_email: email,
          },
        },
        include: {
          user: true,
        },
      });

      if (!adminByEmail) {
        return res.status(403).json({
          message: "ไม่สามารถเข้าสู่ระบบได้ ไม่ใช่ผู้ดูแลระบบ",
        });
      }

      const existingUser = await prisma.user.findUnique({
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
        const isAdmin = await prisma.admin.findFirst({
          where: { user_id: existingUser.user_id },
        });

        if (!isAdmin) {
          return res.status(403).json({
            message: "ผู้ใช้ไม่ใช่แอดมิน ไม่สามารถเข้าสู่ระบบหลังบ้านได้",
          });
        }

        // --- เริ่มต้นการแก้ไขตรงนี้ ---
        // ถ้าผู้ใช้มีบัญชีอยู่แล้ว แต่อีเมลนั้นยังไม่มี google_id หรือ google_id ไม่ตรงกัน
        if (!existingUser.google_id || existingUser.google_id !== googleId) {
          // อัปเดต google_id ของบัญชีที่มีอยู่
          await prisma.user.update({
            where: { user_id: existingUser.user_id },
            data: { google_id: googleId, user_img: profile_image },
          });
          // อัปเดตข้อมูล existingUser เพื่อให้ค่า google_id ล่าสุด
          existingUser.google_id = googleId;
        }
        // --- สิ้นสุดการแก้ไขตรงนี้ ---

        // ไม่จำเป็นต้องตรวจสอบ existingUser.google_id !== googleId อีกต่อไป
        // เพราะถ้าไม่ตรงกัน เราได้ทำการ update ไปแล้ว

        const jwtToken = jwt.sign(
          {
            id: existingUser.user_id,
            user_name: existingUser.user_name,
            user_fname: existingUser.user_fname,
            user_lname: existingUser.user_lname,
            user_email: existingUser.user_email,
            user_img: existingUser.user_img,
            user_phone: existingUser.user_phone,
            user_status: existingUser.user_status,
            isAdmin: true,
          },
          process.env.JWT_SECRET!,
          { expiresIn: "1d" }
        );

        const { google_id, ...safeUser } = existingUser;
        return res.status(200).json({
          message: "เข้าสู่ระบบด้วย Google สำเร็จ",
          token: jwtToken,
          user: {
            ...safeUser,
            isAdmin: true,
          },
        });
      }

      // ยังไม่มีบัญชี -> ขอข้อมูลเพิ่มก่อน
      const tempToken = jwt.sign(
        {
          google_id: googleId,
          email,
          first_name,
          last_name,
          profile_image,
          incompleteProfile: true,
        },
        process.env.JWT_SECRET!,
        { expiresIn: "5m" }
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
    } catch (error: any) {
      console.error(
        "Google login error:",
        error.response?.data || error.message
      );
      return res
        .status(500)
        .json({ message: "ไม่สามารถเข้าสู่ระบบด้วย Google ได้" });
    }
  },

  complete_profile: async (req: Request, res: Response) => {
    try {
      const authHeader = req.headers.authorization;
      if (!authHeader?.startsWith("Bearer ")) {
        return res.status(401).json({ message: "ไม่ได้รับ token" });
      }

      const token = authHeader.split(" ")[1];
      let decoded: any;
      try {
        decoded = jwt.verify(token, process.env.JWT_SECRET!);
      } catch {
        return res.status(401).json({ message: "token หมดอายุหรือไม่ถูกต้อง" });
      }

      if (!decoded.incompleteProfile || !decoded.email || !decoded.google_id) {
        return res
          .status(400)
          .json({ message: "Token ไม่ถูกต้องสำหรับการสมัคร" });
      }

      const { user_fname, user_lname, user_phone, user_name, user_pass } =
        req.body;

      if (
        !user_fname ||
        !user_lname ||
        !user_phone ||
        !user_name ||
        !user_pass
      ) {
        return res.status(400).json({ message: "กรุณากรอกข้อมูลให้ครบถ้วน" });
      }
      const existingUserName = await prisma.user.findUnique({
        where: { user_name: user_name },
      });
      if (existingUserName) {
        return res.status(400).json({ message: "ชื่อผู้ใช้นี้ถูกใช้ไปแล้ว" });
      }

      if (!/^0[0-9]{9}$/.test(user_phone)) {
        return res.status(400).json({ message: "เบอร์โทรศัพท์ไม่ถูกต้อง" });
      }

      const existingUser = await prisma.user.findUnique({
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

      const hashedPassword = await bcrypt.hash(user_pass, 10);

      const newUser = await prisma.user.create({
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

      const finalToken = jwt.sign(
        {
          id: newUser.user_id,
          user_name: newUser.user_name,
          user_fname: newUser.user_fname,
          user_lname: newUser.user_lname,
          user_email: newUser.user_email,
          user_img: newUser.user_img,
          user_phone: newUser.user_phone,
          user_status: newUser.user_status,
        },
        process.env.JWT_SECRET!,
        { expiresIn: "1d" }
      );

      return res.status(200).json({
        message: "สมัครบัญชีสำเร็จ",
        token: finalToken,
      });
    } catch (error) {
      console.error("complete_profile error:", error);
      return res.status(500).json({ message: "ไม่สามารถสร้างบัญชีได้" });
    }
  },
  login: async (req: Request, res: Response) => {
    try {
      const { user_name, user_email, user_pass } = req.body;

      // ตรวจสอบให้กรอกอย่างน้อยชื่อผู้ใช้หรืออีเมล และรหัสผ่าน
      if ((!user_name && !user_email) || !user_pass) {
        return res.status(400).json({
          message: "กรุณากรอกชื่อผู้ใช้หรืออีเมล และรหัสผ่าน",
        });
      }

      const user = await prisma.user.findFirst({
        where: {
          OR: [
            { user_name: user_name || undefined },
            { user_email: user_name || undefined },
          ],
        },
      });

      if (!user) {
        return res.status(404).json({ message: "ไม่พบผู้ใช้นี้ในระบบ" });
      }

      const isMatch = await bcrypt.compare(user_pass, user.user_pass || "");
      if (!isMatch) {
        return res.status(401).json({ message: "รหัสผ่านไม่ถูกต้อง" });
      }
      const admin = await prisma.admin.findFirst({
        where: { user_id: user.user_id },
      });
      const isAdmin = !!admin;

      const token = jwt.sign(
        {
          id: user.user_id,
          user_name: user.user_name,
          user_fname: user.user_fname,
          user_lname: user.user_lname,
          user_email: user.user_email,
          user_img: user.user_img,
          user_phone: user.user_phone,
          user_status: user.user_status,
          isAdmin,
        },
        process.env.JWT_SECRET!, // ให้แน่ใจว่า JWT_SECRET มีค่าใน .env
        { expiresIn: "1d" } // 10 seconds
      );

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
        },
      });
    } catch (error) {
      console.error(error);
      return res.status(500).json({ message: "เกิดข้อผิดพลาดในระบบ" });
    }
  },
  all_user: async (req: Request, res: Response) => {
    try {
      const users = await prisma.user.findMany({
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

      const admins = await prisma.admin.findMany({ select: { user_id: true } });
      const staffs = await prisma.staff.findMany({ select: { user_id: true } }); // << ต้องมีตาราง staff

      const adminIds = new Set(admins.map((a) => a.user_id));
      const staffIds = new Set(staffs.map((s) => s.user_id));

      const usersWithRole = users.map((u) => {
        const isAdmin = adminIds.has(u.user_id);
        const isStaff = staffIds.has(u.user_id);
        return {
          ...u,
          isAdmin,
          isStaff,
          roles: buildRoles(isAdmin, isStaff),
        };
      });

      return res.status(200).json(usersWithRole);
    } catch (error) {
      console.error(error);
      return res.status(500).json({ message: "เกิดข้อผิดพลาดในระบบ" });
    }
  },

  info: async (req: Request, res: Response) => {
    try {
      const userData = (req as any).user;
      const id = Number(userData?.id);

      if (!id)
        return res.status(401).json({ message: "ไม่พบ userId จาก token" });

      const user = await prisma.user.findUnique({
        where: { user_id: id },
        select: {
          user_id: true,
          user_fname: true,
          user_lname: true,
          user_email: true,
          user_phone: true,
          user_img: true,
          user_status: true,
        },
      });

      if (!user) return res.status(404).json({ message: "ไม่พบผู้ใช้ในระบบ" });

      const [isAdmin, isStaff] = await Promise.all([
        prisma.admin.findFirst({ where: { user_id: id } }).then(Boolean),
        prisma.staff.findFirst({ where: { user_id: id } }).then(Boolean),
      ]);

      return res.status(200).json({
        ...user,
        isAdmin,
        isStaff,
        roles: buildRoles(isAdmin, isStaff),
      });
    } catch (error: any) {
      console.error("เกิดข้อผิดพลาด:", error.message, error.stack);
      return res
        .status(500)
        .json({ message: "เกิดข้อผิดพลาดในระบบ", error: error.message });
    }
  },

  add_user: async (req: Request, res: Response) => {
    try {
      const {
        user_name,
        user_pass,
        user_fname,
        user_lname,
        user_email,
        user_phone,
      } = req.body;

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
      const dup = await prisma.user.findFirst({
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

      const hashedPass = await bcrypt.hash(user_pass, 10);

      const created = await prisma.user.create({
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
    } catch (error) {
      console.error(error);
      return res.status(500).json({
        message: "เกิดข้อผิดพลาดในระบบ: " + (error as Error).message,
      });
    }
  },

  update_user: async (req: Request, res: Response) => {
    try {
      const { user_id } = req.params;
      if (!user_id) return res.status(400).json({ message: "ไม่พบ user_id" });

      const body = req.body || {};
      const user_name = body.user_name;
      const user_pass = body.user_pass;
      const user_fname = body.user_fname;
      const user_lname = body.user_lname;
      const user_email = body.user_email;
      const user_phone = body.user_phone;

      // ดึงข้อมูลผู้ใช้เดิม
      const oldUser = await prisma.user.findUnique({
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
        hashedPass = await bcrypt.hash(user_pass, 10);
      }

      // จัดการรูปภาพ (ใช้รูปใหม่ถ้ามี)
      let user_img = oldUser.user_img;
      if (req.file) {
        if (oldUser.user_img) {
          const oldImagePath = path.resolve(
            "uploads/user_images",
            path.basename(oldUser.user_img)
          );
          try {
            if (fs.existsSync(oldImagePath)) fs.unlinkSync(oldImagePath);
          } catch (e) {
            console.error("ไม่สามารถลบรูปเก่า:", e);
          }
        }
        user_img = `uploads/user_images/${req.file.filename}`;
      }
      if (user_name) {
        const nameTaken = await prisma.user.findFirst({
          where: { user_name, NOT: { user_id: Number(user_id) } },
        });
        if (nameTaken)
          return res.status(400).json({ message: "ชื่อผู้ใช้นี้ถูกใช้ไปแล้ว" });
      }
      if (user_email) {
        const emailTaken = await prisma.user.findFirst({
          where: { user_email, NOT: { user_id: Number(user_id) } },
        });
        if (emailTaken)
          return res.status(400).json({ message: "อีเมลนี้ถูกใช้ไปแล้ว" });
      }

      const updatedUser = await prisma.user.update({
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
    } catch (error) {
      console.error(error);
      return res
        .status(500)
        .json({ message: "เกิดข้อผิดพลาดในระบบ: " + (error as Error).message });
    }
  },

  update_user_status: async (req: Request, res: Response) => {
    const actor = (req as any).user;
    const targetId = Number(req.params.userId);
    const { status, password } = req.body;

    if (![0, 1].includes(Number(status)))
      return res.status(400).json({ message: "สถานะไม่ถูกต้อง" });
    if (!password) return res.status(400).json({ message: "ต้องกรอกรหัสผ่าน" });

    // ห้ามระงับตัวเอง
    if (actor?.id === targetId && Number(status) === 0) {
      return res.status(403).json({ message: "ห้ามระงับบัญชีของตนเอง" });
    }

    // ยืนยันรหัสผ่านผู้ที่ทำรายการ
    const deleter = await prisma.user.findUnique({
      where: { user_id: Number(actor.id) },
      select: { user_pass: true },
    });
    if (
      !deleter?.user_pass ||
      !(await bcrypt.compare(password, deleter.user_pass))
    ) {
      return res.status(401).json({ message: "รหัสผ่านไม่ถูกต้อง" });
    }

    await prisma.user.update({
      where: { user_id: targetId },
      data: { user_status: Number(status) },
    });

    emit(req, "user:status_updated", {
      user_id: targetId,
      user_status: Number(status),
    });

    return res.status(200).json({ message: "อัปเดตสถานะสำเร็จ" });
  },

  update_user_roles: async (req: Request, res: Response) => {
    const actor = (req as any).user;
    const targetId = Number(req.params.userId);
    const { roles, password } = req.body as {
      roles: ("admin" | "staff" | "user")[];
      password: string;
    };

    const ALLOWED = new Set(["admin", "staff", "user"]);
    const nextRoles = Array.from(
      new Set((roles || []).filter((r) => ALLOWED.has(r)))
    );
    if (nextRoles.length === 0)
      return res.status(400).json({ message: "ต้องมีอย่างน้อย 1 สิทธิ์" });
    if (!password) return res.status(400).json({ message: "ต้องกรอกรหัสผ่าน" });

    // ยืนยันรหัสผ่านผู้ที่ทำรายการ
    const actorUser = await prisma.user.findUnique({
      where: { user_id: Number(actor.id) },
      select: { user_pass: true },
    });
    if (
      !actorUser?.user_pass ||
      !(await bcrypt.compare(password, actorUser.user_pass))
    ) {
      return res.status(401).json({ message: "รหัสผ่านไม่ถูกต้อง" });
    }

    // ห้ามถอด admin ของตัวเอง
    if (actor?.id === targetId) {
      const hadAdmin = !!(await prisma.admin.findFirst({
        where: { user_id: targetId },
      }));
      const keepAdmin = nextRoles.includes("admin");
      if (hadAdmin && !keepAdmin) {
        return res
          .status(403)
          .json({ message: "ไม่สามารถถอดสิทธิ์ผู้ดูแลของตนเองได้" });
      }
    }

    await prisma.$transaction(async (tx) => {
      // admin
      if (nextRoles.includes("admin")) {
        await tx.admin.upsert({
          where: { user_id: targetId },
          update: {},
          create: { user_id: targetId, admin_status: 1 },
        });
      } else {
        await tx.admin.deleteMany({ where: { user_id: targetId } });
      }
      // staff
      if (nextRoles.includes("staff")) {
        await tx.staff.upsert({
          where: { user_id: targetId },
          update: {},
          create: { user_id: targetId, staff_status: 1 },
        });
      } else {
        await tx.staff.deleteMany({ where: { user_id: targetId } });
      }
    });

    emit(req, "user:roles_updated", { user_id: targetId, roles: nextRoles });

    return res
      .status(200)
      .json({ message: "อัปเดตสิทธิ์สำเร็จ", roles: nextRoles });
  },

  delete_user: async (req: Request, res: Response) => {
    try {
      const { user_id } = req.params; // คนที่ถูกลบ
      const { password } = req.body;
      const loggedInUser = (req as any).user; // คนที่ลบ (จาก JWT)
      if (Number(loggedInUser.id) === Number(user_id)) {
        return res.status(403).json({ message: "ห้ามลบบัญชีของตนเอง" });
      }

      if (!loggedInUser?.id) {
        return res
          .status(400)
          .json({ message: "ไม่พบข้อมูลผู้ใช้งานที่ล๊อกอิน" });
      }
      if (!password || password.trim() === "") {
        return res
          .status(400)
          .json({ message: "กรุณากรอกรหัสผ่านเพื่อยืนยัน" });
      }

      const deleter = await prisma.user.findUnique({
        where: { user_id: Number(loggedInUser.id) },
        select: { user_pass: true },
      });
      if (
        !deleter?.user_pass ||
        !(await bcrypt.compare(password, deleter.user_pass))
      ) {
        return res.status(401).json({ message: "รหัสผ่านไม่ถูกต้อง" });
      }
      await prisma.$transaction([
        prisma.admin.deleteMany({ where: { user_id: Number(user_id) } }),
        prisma.staff.deleteMany({ where: { user_id: Number(user_id) } }),
      ]);
      // ดึงข้อมูลผู้ใช้ที่ถูกลบเพื่อเช็ครูปภาพ
      const userToDelete = await prisma.user.findUnique({
        where: { user_id: Number(user_id) },
        select: { user_img: true },
      });
      if (!userToDelete) {
        return res.status(404).json({ message: "ไม่พบผู้ใช้ที่ต้องการลบ" });
      }

      // ลบรูปภาพถ้ามี
      if (userToDelete.user_img) {
        const imagePath = path.resolve(
          "uploads/user_images",
          path.basename(userToDelete.user_img)
        );
        try {
          if (fs.existsSync(imagePath)) fs.unlinkSync(imagePath);
        } catch (e) {
          console.error("ไม่สามารถลบรูปโปรไฟล์:", e);
        }
      }

      // ลบผู้ใช้จากฐานข้อมูล (เลือกเฉพาะฟิลด์ปลอดภัยเพื่อส่งกลับ)
      const deleted = await prisma.user.delete({
        where: { user_id: Number(user_id) },
        select: { user_id: true, user_name: true, user_email: true },
      });

      emit(req, "user:deleted", { user_id: deleted.user_id });

      return res.status(200).json({ message: "ลบผู้ใช้สำเร็จ", deleted });
    } catch (error) {
      console.error("Delete user error:", error);
      return res.status(500).json({
        message: "เกิดข้อผิดพลาดในระบบ",
        error: (error as Error).message,
      });
    }
  },

  seats: async (req: Request, res: Response) => {
    try {
      const seatOptions = await prisma.seatOption.findMany({
        orderBy: [{ seats: "asc" }],
      });
      return res.status(200).json(seatOptions);
    } catch (error) {
      console.error("Error fetching seat options:", error);
      return res.status(500).json({
        success: false,
        message: "เกิดข้อผิดพลาดภายในเซิร์ฟเวอร์",
      });
    }
  },
  add_seat: async (req: Request, res: Response) => {
    const { seats } = req.body;

    if (!seats || isNaN(seats) || seats <= 0) {
      return res.status(400).json({
        success: false,
        message: "จำนวนที่นั่งไม่ถูกต้อง",
      });
    }

    try {
      const newSeat = await prisma.seatOption.create({
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
    } catch (error) {
      console.error("Error creating seat option:", error);
      return res.status(500).json({
        success: false,
        message: "เกิดข้อผิดพลาดภายในเซิร์ฟเวอร์",
      });
    }
  },
  delete_seat: async (req: Request, res: Response) => {
    const { id } = req.params;

    try {
      await prisma.seatOption.delete({
        where: { id: parseInt(id) },
      });
      emit(req, "seat:deleted", { id: parseInt(id) });
      res.status(200).json({ message: "ลบสำเร็จ" });
    } catch (err) {
      res.status(500).json({ error: "ไม่สามารถลบได้" });
    }
  },
  table_Types: async (req: Request, res: Response) => {
    try {
      const tableTypes = await prisma.tableType.findMany();
      return res.status(200).json(tableTypes);
    } catch (error) {
      console.error("Error fetching table types:", error);
      return res.status(500).json({
        success: false,
        message: "เกิดข้อผิดพลาดภายในเซิร์ฟเวอร์",
      });
    }
  },
  add_TableType: async (req: Request, res: Response) => {
    const { name } = req.body;

    try {
      const newTable = await prisma.tableType.create({
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
    } catch (error) {
      console.error("Error creating table:", error);
      return res.status(500).json({
        success: false,
        message: "เกิดข้อผิดพลาดภายในเซิร์ฟเวอร์",
      });
    }
  },
  delete_TablType: async (req: Request, res: Response) => {
    const { id } = req.params;
    try {
      await prisma.tableType.delete({
        where: { id: parseInt(id) },
      });
      emit(req, "tableType:deleted", { id: parseInt(id) });
      res.status(200).json({ message: "ลบสำเร็จ" });
    } catch (err) {
      res.status(500).json({ error: "ไม่สามารถลบได้" });
    }
  },
  // API: ดึงข้อมูลโต๊ะทั้งหมด
  tables: async (req: Request, res: Response) => {
    try {
      const gridId = Number(req.query.gridId ?? 1);

      const tables = await prisma.tableMap.findMany({
        where: { gridId }, // ★ filter ตามกริด
        include: { seatOption: true, tableType: true },
        orderBy: { id: "asc" },
      });

      const formatted = tables.map((table) => ({
        id: String(table.id),
        name: table.label,
        seats: table.seatOption?.seats ?? 0,
        tableTypeId: String(table.tableType?.id ?? ""),
        tableTypeName: table.tableType?.name ?? "ไม่ระบุประเภท",
        additionalInfo: table.additionalInfo ?? "",
        x: table.x,
        y: table.y,
        active: table.active,
        // (ถ้าจะส่งกลับด้วยก็ได้)
        gridId: table.gridId,
      }));

      return res.status(200).json(formatted);
    } catch (error: any) {
      console.error("Error fetching tables:", error);
      return res
        .status(500)
        .json({
          message: "เกิดข้อผิดพลาดในการดึงข้อมูลโต๊ะ",
          error: error.message,
        });
    }
  },

  add_table: async (req: Request, res: Response) => {
    try {
      const { name, seats, tableTypeId, additionalInfo, gridId } = req.body;
      const xBody = Number.isFinite(+req.body?.x)
        ? parseInt(req.body.x, 10)
        : NaN;
      const yBody = Number.isFinite(+req.body?.y)
        ? parseInt(req.body.y, 10)
        : NaN;
      const gid = Number(gridId ?? 1);

      if (!name || !seats || !tableTypeId) {
        return res
          .status(400)
          .json({
            message: "ชื่อโต๊ะ, จำนวนที่นั่ง, และประเภทโต๊ะเป็นข้อมูลที่จำเป็น",
          });
      }

      const seatOption = await prisma.seatOption.findFirst({
        where: { seats: parseInt(seats, 10) },
      });
      if (!seatOption)
        return res
          .status(404)
          .json({
            message: `ไม่พบตัวเลือกจำนวนที่นั่งสำหรับ ${seats} ที่นั่ง`,
          });

      const parsedTypeId = parseInt(tableTypeId, 10);
      const type = await prisma.tableType.findUnique({
        where: { id: parsedTypeId },
      });
      if (!type)
        return res
          .status(404)
          .json({ message: `ไม่พบประเภทโต๊ะที่มี ID: ${tableTypeId}` });

      // ✅ ชื่อซ้ำใน "กริดเดียวกัน" เท่านั้น
      const dup = await prisma.tableMap.findUnique({
        where: { gridId_label: { gridId: gid, label: name.trim() } },
      });
      if (dup)
        return res
          .status(409)
          .json({ message: `ชื่อโต๊ะ '${name.trim()}' มีอยู่ในกริดนี้แล้ว` });

      // ✅ ตรวจกริด
      const grid = await prisma.gridSize.findUnique({ where: { id: gid } });
      if (!grid) return res.status(404).json({ message: "ไม่พบกริด" });

      let x = Number.isFinite(xBody) ? xBody : 0;
      let y = Number.isFinite(yBody) ? yBody : 0;

      const inBounds = (xx: number, yy: number) =>
        xx >= 0 && yy >= 0 && xx < grid.cols && yy < grid.rows;
      if (!inBounds(x, y))
        return res.status(400).json({ message: "พิกัดอยู่นอกกริด" });

      // ✅ กันซ้ำตำแหน่งด้วยคีย์ผสม
      const taken = await prisma.tableMap.findUnique({
        where: { gridId_x_y: { gridId: gid, x, y } },
      });
      if (taken) {
        // หา cell ว่าง
        const cells = await prisma.tableMap.findMany({
          where: { gridId: gid },
          select: { x: true, y: true },
        });
        const used = new Set(cells.map((c) => `${c.x},${c.y}`));
        let found: { x: number; y: number } | null = null;
        outer: for (let yy = 0; yy < grid.rows; yy++) {
          for (let xx = 0; xx < grid.cols; xx++) {
            if (!used.has(`${xx},${yy}`)) {
              found = { x: xx, y: yy };
              break outer;
            }
          }
        }
        if (!found) return res.status(409).json({ message: "พื้นที่กริดเต็ม" });
        x = found.x;
        y = found.y;
      }

      const newTable = await prisma.tableMap.create({
        data: {
          label: name.trim(),
          seatOption: { connect: { id: seatOption.id } },
          tableType: { connect: { id: parsedTypeId } },
          additionalInfo: additionalInfo?.trim() || null,
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
    } catch (error: any) {
      // กันเคสชน unique ที่ create (เผื่อ race)
      if (error?.code === "P2002") {
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
  },

  update_table: async (req: Request, res: Response) => {
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
      const existingSeatOption = await prisma.seatOption.findFirst({
        where: { seats: parsedSeats },
      });

      if (!existingSeatOption) {
        return res
          .status(404)
          .json({ message: `Seat option for ${parsedSeats} seats not found.` });
      }

      const existingTableType = await prisma.tableType.findUnique({
        where: { id: parseInt(String(tableTypeId), 10) },
      });

      if (!existingTableType) {
        return res.status(404).json({ message: "Table type not found." });
      }

      const updatedTable = await prisma.tableMap.update({
        where: { id: parseInt(id as string, 10) },
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
        seats: updatedTable.seatOption?.seats || 0,
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
    } catch (error: any) {
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
  },

  // API: บันทึกตำแหน่งโต๊ะ (X, Y)
  save_table_positions: async (req: Request, res: Response) => {
    try {
      const tablePositions: { id: string; x: number; y: number }[] = req.body; // <-- ตรงนี้คาดหวัง array

      if (!Array.isArray(tablePositions)) {
        // <-- ตรวจสอบว่าเป็น array หรือไม่
        return res.status(400).json({
          message:
            "Invalid request body. Expected an array of table positions.",
        });
      }

      const updates = tablePositions.map((pos) => {
        // ตรวจสอบ id, x, y เป็นตัวเลขที่ถูกต้อง
        if (
          !pos.id ||
          isNaN(parseInt(pos.id)) ||
          isNaN(pos.x) ||
          isNaN(pos.y)
        ) {
          throw new Error(`Invalid table position data for ID: ${pos.id}`);
        }
        return prisma.tableMap.update({
          where: { id: parseInt(pos.id, 10) },
          data: { x: pos.x, y: pos.y },
        });
      });

      await prisma.$transaction(updates); // ใช้ transaction เพื่อให้มั่นใจว่าทุกการอัปเดตสำเร็จพร้อมกัน

      emit(req, "table:positions_saved", { positions: tablePositions });
      return res
        .status(200)
        .json({ message: "Table positions updated successfully" });
    } catch (error: any) {
      console.error("Error saving table positions:", error);
      return res.status(500).json({
        message: "Failed to save table positions",
        error: error.message,
      });
    }
  },

  // API: อัปเดตสถานะ active ของโต๊ะ
  update_table_status: async (req: Request, res: Response) => {
    const { id } = req.params; // ดึง id จาก URL parameter
    const { active } = req.body; // ดึง active จาก request body

    if (!id || typeof active === "undefined") {
      return res
        .status(400)
        .json({ message: "Table ID and active status are required." });
    }

    try {
      const updatedTable = await prisma.tableMap.update({
        where: { id: parseInt(id as string, 10) },
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
    } catch (error: any) {
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
  },

  // API: ลบโต๊ะ
  delete_table: async (req: Request, res: Response) => {
    const { id } = req.params; // ดึง id จาก URL parameter

    if (!id) {
      return res.status(400).json({ message: "Table ID is required." });
    }

    try {
      await prisma.tableMap.delete({
        where: { id: parseInt(id as string, 10) },
      });

      emit(req, "table:deleted", { id: parseInt(id as string, 10) });
      return res.status(200).json({ message: "Table deleted successfully" });
    } catch (error: any) {
      console.error("Error deleting table:", error);
      if (error.code === "P2025") {
        // Prisma error code for record not found
        return res.status(404).json({ message: "Table not found." });
      }
      return res
        .status(500)
        .json({ message: "Failed to delete table", error: error.message });
    }
  },

  foodTypes: async (req: Request, res: Response) => {
    try {
      const foodTypes = await prisma.typefood.findMany();
      return res.status(200).json(foodTypes);
    } catch (error: any) {
      console.error("Error fetching food types:", error);
      return res
        .status(500)
        .json({ message: "Failed to fetch food types", error: error.message });
    }
  },
  add_FoodType: async (req: Request, res: Response) => {
    const { name } = req.body;
    try {
      const newFoodType = await prisma.typefood.create({
        data: {
          name: name,
        },
      });
      emit(req, "foodType:created", newFoodType);
      return res.status(200).json(newFoodType);
    } catch (error: any) {
      console.error("Error creating type food:", error);
      return res
        .status(500)
        .json({ message: "Failed to create type food", error: error.message });
    }
  },
  update_FoodType: async (req: Request, res: Response) => {
    const { id } = req.params;
    const { name } = req.body;
    try {
      const updated = await prisma.typefood.update({
        where: { id: parseInt(id) },
        data: { name },
      });
      emit(req, "foodType:updated", updated);
      return res.status(200).json(updated);
    } catch (error: any) {
      console.error("Error updating food type:", error);
      return res.status(500).json({
        message: "Failed to update food type",
        error: error.message,
      });
    }
  },
  delete_FoodType: async (req: Request, res: Response) => {
    const { id } = req.params;
    try {
      const deleted = await prisma.typefood.delete({
        where: { id: parseInt(id) },
      });
      emit(req, "foodType:deleted", { id: parseInt(id) });
      return res.status(200).json({ message: "Deleted", deleted });
    } catch (error: any) {
      console.error("Error deleting food type:", error);
      return res.status(500).json({
        message: "Failed to delete food type",
        error: error.message,
      });
    }
  },
  menus: async (req: Request, res: Response) => {
    try {
      const menus = await prisma.foodMenu.findMany({
        orderBy: { menu_id: "asc" },
        include: {
          MenuImages: true,
          Typefoods: {
            include: {
              typefood: true,
            },
          },
        },
      });
      emit(req, "menu", menus);

      return res.status(200).json(menus);
    } catch (error: any) {
      console.error("Error fetching menus:", error);
      return res
        .status(500)
        .json({ message: "Failed to fetch menus", error: error.message });
    }
  },
  add_menu: async (req: Request, res: Response) => {
    // ดึง mainImageIndex ออกมาจาก req.body ด้วย
    const {
      menu_name,
      menu_price,
      menu_description,
      typefoodIds,
      mainImageIndex,
    } = req.body;

    // Parse inputs (assuming typefoodIds is a JSON array string or array)
    let parsedTypefoodIds: number[] = [];
    if (typeof typefoodIds === "string") {
      try {
        parsedTypefoodIds = JSON.parse(typefoodIds).map((id: any) =>
          parseInt(id)
        );
      } catch (e) {
        return res.status(400).json({ message: "Invalid typefoodIds format" });
      }
    } else if (Array.isArray(typefoodIds)) {
      parsedTypefoodIds = typefoodIds.map((id: any) => parseInt(id));
    }

    // Handle uploaded files (multiple images)
    const files = req.files as Express.Multer.File[] | undefined;
    const imagePaths = files
      ? files.map((file) => `/uploads/menu_images/${file.filename}`)
      : [];

    // แปลง mainImageIndex ให้เป็นตัวเลข (ถ้ามี)
    let parsedMainImageIndex: number | null = null;
    if (mainImageIndex !== undefined && mainImageIndex !== null) {
      parsedMainImageIndex = parseInt(mainImageIndex as string, 10);
      if (isNaN(parsedMainImageIndex)) {
        parsedMainImageIndex = null; // ตั้งเป็น null ถ้าแปลงเป็นตัวเลขไม่ได้
      }
    }

    try {
      const newMenu = await prisma.foodMenu.create({
        data: {
          menu_name,
          menu_price: parseInt(menu_price), // Ensure price is integer
          menu_description: menu_description || null, // ตรวจสอบว่ามีค่า description หรือไม่ ถ้าไม่มีให้เป็น null
          menu_status: 1, // สถานะของเมนูโดยรวม (อาจจะเป็น 1 เสมอเมื่อสร้างใหม่)

          Typefoods: {
            create: parsedTypefoodIds.map((id) => ({
              typefood: {
                connect: { id },
              },
            })),
          },
          MenuImages: {
            create: imagePaths.map((path, index) => ({
              // เพิ่ม index เข้ามาในการ map
              menu_image: path,
              // ตั้งค่า menu_status เป็น 1 ถ้าเป็นรูปหลัก, มิฉะนั้นเป็น 0
              menu_status:
                parsedMainImageIndex !== null && index === parsedMainImageIndex
                  ? 1
                  : 0,
            })),
          },
        },
        include: {
          MenuImages: true,
          Typefoods: {
            include: {
              typefood: true,
            },
          },
        },
      });
      emit(req, "menu:created", newMenu);
      return res.status(200).json(newMenu);
    } catch (error: any) {
      console.error("Error creating menu:", error);
      // เพิ่ม Logic ในการลบไฟล์ที่อัปโหลดไปแล้วหากเกิดข้อผิดพลาด
      if (files && files.length > 0) {
        files.forEach((file) => {
          const filePath = path.join(
            __dirname,
            "../../uploads/menu_images",
            file.filename
          ); // ปรับ path ตามโครงสร้างโปรเจกต์ของคุณ
          if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
            console.log(`Deleted uploaded file: ${filePath}`);
          }
        });
      }
      emit(req, "menu:created", null);
      return res
        .status(500)
        .json({ message: "Failed to create menu", error: error.message });
    }
  },
  update_menu: async (req: Request, res: Response) => {
    const { id } = req.params;
    const menuId = parseInt(id);

    const newFiles = req.files as Express.Multer.File[];

    try {
      const {
        menu_name,
        menu_price,
        menu_description,
        typefoodIds,
        existingImages,
        mainImageIdentifier,
      } = req.body;

      if (isNaN(menuId)) {
        return res.status(400).json({ message: "Invalid Menu ID." });
      }

      if (!menu_name || !menu_price || !typefoodIds) {
        return res.status(400).json({
          message: "Missing required menu fields (name, price, types).",
        });
      }

      const parsedTypefoodIds: number[] = JSON.parse(typefoodIds);
      // parsedExistingImages คือรูปที่ Frontend บอกว่า "ยังคงอยู่"
      const parsedExistingImages: {
        menu_image_id?: number;
        menu_image: string;
        menu_status: number;
      }[] = existingImages ? JSON.parse(existingImages) : [];

      // 1. ดึงข้อมูลเมนูเดิมและรูปภาพปัจจุบันจาก DB
      const currentMenu = await prisma.foodMenu.findUnique({
        where: { menu_id: menuId },
        include: { MenuImages: true },
      });

      if (!currentMenu) {
        return res.status(404).json({ message: "Menu not found." });
      }

      const currentDbImages = currentMenu.MenuImages;
      const imagesToKeepFromFrontendIds = new Set(
        parsedExistingImages
          .map((img) => img.menu_image_id)
          .filter((id) => id !== undefined)
      );

      // 2. จัดการรูปภาพ: ลบ Record รูปภาพที่ Frontend บอกว่าไม่ต้องการแล้วออกจาก DB และ **ลบไฟล์จริง** ออกจาก Server
      for (const dbImage of currentDbImages) {
        if (!imagesToKeepFromFrontendIds.has(dbImage.menu_image_id)) {
          // ลบ Record จาก DB
          await prisma.menuImage.delete({
            where: { menu_image_id: dbImage.menu_image_id },
          });

          // *** เพิ่มส่วนนี้เพื่อลบไฟล์จริงออกจาก Server ***
          const imagePathToDelete = path.join(
            UPLOADS_DIR,
            path.basename(dbImage.menu_image)
          );
          if (fs.existsSync(imagePathToDelete)) {
            try {
              fs.unlinkSync(imagePathToDelete);
              console.log(`Deleted old menu image file: ${imagePathToDelete}`);
            } catch (fileDeleteError: any) {
              console.error(
                `Failed to delete file ${imagePathToDelete}: ${fileDeleteError.message}`
              );
              // ไม่จำเป็นต้อง throw error ตรงนี้ เพราะการลบ DB record สำเร็จแล้ว
            }
          } else {
            console.warn(
              `File not found for deletion: ${imagePathToDelete} (might already be deleted or path is incorrect)`
            );
          }
          // ***********************************************
        }
      }

      // 3. เพิ่มรูปภาพใหม่ที่อัปโหลด (ถ้ามี)
      const newImageRecords: {
        menu_image: string;
        menu_id: number;
        menu_status: number;
      }[] = [];
      for (const file of newFiles) {
        const filePath = `/uploads/menu_images/${file.filename}`;
        newImageRecords.push({
          menu_image: filePath,
          menu_id: menuId,
          menu_status: 0,
        });
      }

      if (newImageRecords.length > 0) {
        await prisma.menuImage.createMany({
          data: newImageRecords,
        });
      }

      // 4. อัปเดตเมนูหลัก
      const updatedMenu = await prisma.foodMenu.update({
        where: { menu_id: menuId },
        data: {
          menu_name: menu_name,
          menu_price: parseInt(menu_price),
          menu_description: menu_description || null,
        },
      });

      // 5. อัปเดตความสัมพันธ์ Many-to-Many สำหรับประเภทอาหาร
      await prisma.foodMenuType.deleteMany({
        where: { foodMenuId: menuId },
      });
      const newTypeFoodRelations = parsedTypefoodIds.map((typeId: number) => ({
        foodMenuId: menuId,
        typefoodId: typeId,
      }));
      if (newTypeFoodRelations.length > 0) {
        await prisma.foodMenuType.createMany({
          data: newTypeFoodRelations,
        });
      }

      // 6. จัดการรูปภาพหลัก (หลังจากเพิ่มและลบ Record รูปภาพแล้ว)
      // ดึงรูปภาพทั้งหมดที่เหลืออยู่ใน DB (เดิมที่ยังอยู่ + ใหม่ที่เพิ่งเพิ่ม)
      const allCurrentImages = await prisma.menuImage.findMany({
        where: { menu_id: menuId },
      });

      // ตั้งค่า menu_status ของรูปภาพทั้งหมดให้เป็น 0 ก่อน
      await prisma.menuImage.updateMany({
        where: { menu_id: menuId },
        data: { menu_status: 0 },
      });

      if (mainImageIdentifier) {
        // กรณีรูปหลักเป็นรูปเดิม (ส่งมาเป็น path)
        if (
          typeof mainImageIdentifier === "string" &&
          mainImageIdentifier.startsWith("/uploads/menu_images")
        ) {
          await prisma.menuImage.updateMany({
            where: {
              menu_id: menuId,
              menu_image: mainImageIdentifier,
            },
            data: { menu_status: 1 },
          });
        } else {
          // กรณีรูปหลักเป็นรูปใหม่ (ส่งมาเป็น index ของ newFiles)
          const mainImageIndexAsNumber = parseInt(
            mainImageIdentifier as string
          );
          if (
            !isNaN(mainImageIndexAsNumber) &&
            newFiles.length > mainImageIndexAsNumber
          ) {
            const mainNewImageFilename =
              newFiles[mainImageIndexAsNumber].filename;
            const mainNewImagePath = `/uploads/menu_images/${mainNewImageFilename}`;

            await prisma.menuImage.updateMany({
              where: {
                menu_id: menuId,
                menu_image: mainNewImagePath,
              },
              data: { menu_status: 1 },
            });
          }
        }
      } else if (allCurrentImages.length === 1) {
        // ถ้าเหลือรูปเดียว ให้ตั้งเป็นรูปหลักโดยอัตโนมัติ
        await prisma.menuImage.update({
          where: { menu_image_id: allCurrentImages[0].menu_image_id },
          data: { menu_status: 1 },
        });
      }

      emit(req, "menu:updated", { menu_id: menuId });
      res
        .status(200)
        .json({ message: "Menu updated successfully.", menu: updatedMenu });
    } catch (error: any) {
      console.error("Error updating menu:", error);
      // ควรมีการ rollback รูปภาพใหม่ที่อัปโหลดไปแล้วหากเกิดข้อผิดพลาดใน DB transaction
      // ส่วนนี้ยังคงต้องลบไฟล์ใหม่ที่อัปโหลดหากเกิด error เพราะมันยังไม่มี Record ใน DB
      if (newFiles && newFiles.length > 0) {
        newFiles.forEach((file) => {
          const filePath = path.join(UPLOADS_DIR, file.filename);
          if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
            console.log(`Cleaned up uploaded file due to error: ${filePath}`);
          }
        });
      }
      res.status(500).json({
        message: "Failed to update menu.",
        error: error.message,
      });
    }
  },
  delete_menu: async (req: Request, res: Response) => {
    const { id } = req.params;
    const menuId = parseInt(id);

    try {
      // 1. ดึงข้อมูลรูปภาพทั้งหมดของเมนูนี้ก่อนทำการลบเมนู
      const menuImagesToDelete = await prisma.menuImage.findMany({
        where: { menu_id: menuId },
        select: { menu_image: true }, // เลือกเฉพาะ field ที่เก็บ path ของรูปภาพ
      });

      // 2. ลบเมนูออกจากฐานข้อมูล
      // การลบ foodMenu จะ trigger onDelete: Cascade ใน MenuImage และ FoodMenuType
      const deletedMenu = await prisma.foodMenu.delete({
        where: { menu_id: menuId },
      });

      // 3. ลบไฟล์รูปภาพจริงออกจากระบบไฟล์
      if (menuImagesToDelete.length > 0) {
        menuImagesToDelete.forEach((image) => {
          // สร้าง absolute path ของไฟล์รูปภาพ
          // ตรวจสอบให้แน่ใจว่า 'uploads/menu_images' คือ path ที่ถูกต้องของ Folder รูปภาพ
          const imagePath = path.resolve(
            "uploads/menu_images",
            path.basename(image.menu_image)
          );

          try {
            if (fs.existsSync(imagePath)) {
              fs.unlinkSync(imagePath); // ลบไฟล์
              console.log(`ลบรูปเมนู: ${imagePath}`);
            } else {
              console.warn(
                `ไม่พบไฟล์รูปเมนูที่ path: ${imagePath} (อาจถูกลบไปแล้วหรือ path ผิด)`
              );
            }
          } catch (fileDeleteError) {
            console.error(
              `ไม่สามารถลบไฟล์รูปเมนู: ${imagePath}, ข้อผิดพลาด: ${fileDeleteError}`
            );
            // คุณอาจต้องการส่ง error กลับไปให้ client ด้วย แต่ไม่ทำให้การลบเมนูล้มเหลว
          }
        });
      }

      emit(req, "menu:deleted", { menu_id: menuId });
      return res.status(200).json({
        message: "ลบเมนูและรูปภาพที่เกี่ยวข้องสำเร็จ",
        deleted: deletedMenu,
      });
    } catch (error: any) {
      console.error("Error deleting menu:", error);
      return res.status(500).json({
        message: "ไม่สามารถลบเมนูได้",
        error: error.message,
      });
    }
  },

  grid_size: async (req: Request, res: Response) => {
    try {
      const gridSize = await prisma.gridSize.findUnique({
        where: { id: 1 },
      });

      if (!gridSize) {
        const defaultGridSize = await prisma.gridSize.create({
          data: {
            id: 1,
            rows: 10,
            cols: 10,
          },
        });
        return res.status(200).json(defaultGridSize);
      }

      return res.status(200).json(gridSize);
    } catch (error: any) {
      console.error("Error fetching grid size:", error);
      return res.status(500).json({
        message: "Failed to fetch grid size",
        error: error.message,
      });
    }
  },

  add_grid_size: async (req: Request, res: Response) => {
    try {
      const { rows, cols } = req.body;

      if (
        !Number.isInteger(rows) ||
        !Number.isInteger(cols) ||
        rows <= 0 ||
        cols <= 0
      ) {
        return res.status(400).json({
          message: "Rows and columns must be positive integers.",
        });
      }

      const updatedGridSize = await prisma.gridSize.upsert({
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
    } catch (error: any) {
      console.error("Error updating grid size:", error);
      return res.status(500).json({
        message: "Failed to update grid size",
        error: error.message,
      });
    }
  },

  // ===== Slides API =====
  slides: async (req: Request, res: Response) => {
    try {
      const items = await prisma.slide.findMany({
        orderBy: { slide_id: "asc" },
      });
      return res.status(200).json(items);
    } catch (error: any) {
      console.error("Error fetching slides:", error);
      return res
        .status(500)
        .json({ message: "ไม่สามารถดึงข้อมูลสไลด์ได้", error: error.message });
    }
  },
  add_slide: async (req: Request, res: Response) => {
    // ต้องมี middleware multer: upload.single('image')
    try {
      const nameRaw =
        (req.body?.name as string) ?? (req.body?.slide_name as string) ?? "";
      const slide_name = nameRaw.trim();

      if (!slide_name) {
        // ถ้าอัปโหลดไฟล์มาแล้วแต่ชื่อไม่ถูกต้อง ให้ลบไฟล์ทิ้ง
        if (req.file) {
          const p = path.join(SLIDE_UPLOADS_DIR, req.file.filename);
          try {
            if (fs.existsSync(p)) fs.unlinkSync(p);
          } catch {}
        }
        return res.status(400).json({ message: "กรุณากรอกชื่อสไลด์" });
      }

      // แปลงสถานะให้เป็น 0/1 รองรับ true/false หรือ "1"/"0"
      const rawStatus = req.body?.status ?? req.body?.slide_status ?? 1;
      const slide_status =
        String(rawStatus).toLowerCase() === "true"
          ? 1
          : String(rawStatus).toLowerCase() === "false"
          ? 0
          : Number(rawStatus)
          ? 1
          : 0;

      // ต้องมีรูปภาพตอนเพิ่ม
      const file = req.file as Express.Multer.File | undefined;
      if (!file) {
        return res.status(400).json({ message: "กรุณาอัปโหลดภาพสไลด์" });
      }

      const slide_img = `/uploads/slide_images/${file.filename}`;

      // กันชื่อซ้ำแบบตรงตัว (ถ้าไม่ต้องการกันซ้ำ ลบบล็อกนี้ได้)
      const dup = await prisma.slide.findFirst({
        where: { slide_name },
      });
      if (dup) {
        // ลบไฟล์ใหม่ทิ้งเพราะไม่ใช้แล้ว
        const p = path.join(SLIDE_UPLOADS_DIR, file.filename);
        try {
          if (fs.existsSync(p)) fs.unlinkSync(p);
        } catch {}
        return res
          .status(409)
          .json({ message: "ชื่อนี้มีอยู่แล้ว กรุณาใช้ชื่ออื่น" });
      }

      const created = await prisma.slide.create({
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
    } catch (error: any) {
      // ถ้าผิดพลาดให้ลบไฟล์ที่อัปโหลดไว้เพื่อไม่ให้ค้างในเครื่อง
      if (req.file) {
        const p = path.join(SLIDE_UPLOADS_DIR, req.file.filename);
        try {
          if (fs.existsSync(p)) fs.unlinkSync(p);
        } catch {}
      }
      console.error("Error adding slide:", error);
      return res
        .status(500)
        .json({ message: "ไม่สามารถเพิ่มสไลด์ได้", error: error.message });
    }
  },

  update_slide: async (req: Request, res: Response) => {
    const idRaw =
      (req.params.id as string) ??
      (req.body?.slide_id as string) ??
      (req.body?.id as string);
    const slide_id = parseInt(idRaw, 10);

    if (!slide_id || Number.isNaN(slide_id)) {
      // ลบไฟล์ใหม่ (ถ้ามี) ทิ้งเพราะ id ไม่ถูกต้อง
      if (req.file) {
        const newFilePath = path.join(SLIDE_UPLOADS_DIR, req.file.filename);
        try {
          if (fs.existsSync(newFilePath)) fs.unlinkSync(newFilePath);
        } catch {}
      }
      return res.status(400).json({ message: "รหัสสไลด์ไม่ถูกต้อง" });
    }

    try {
      const existing = await prisma.slide.findUnique({ where: { slide_id } });
      if (!existing) {
        if (req.file) {
          const newFilePath = path.join(SLIDE_UPLOADS_DIR, req.file.filename);
          try {
            if (fs.existsSync(newFilePath)) fs.unlinkSync(newFilePath);
          } catch {}
        }
        return res.status(404).json({ message: "ไม่พบสไลด์" });
      }

      const nextName = (
        (req.body.name ?? req.body.slide_name ?? existing.slide_name) as string
      ).trim();

      // แปลงสถานะ (ถ้าไม่ส่งมา ใช้ค่าเดิม)
      const rawStatus =
        req.body.status ?? req.body.slide_status ?? existing.slide_status;
      const nextStatus =
        String(rawStatus).toLowerCase() === "true"
          ? 1
          : String(rawStatus).toLowerCase() === "false"
          ? 0
          : Number(rawStatus)
          ? 1
          : 0;

      let newImgPath: string | undefined;
      if (req.file) {
        newImgPath = `/uploads/slide_images/${req.file.filename}`;
      }

      const updated = await prisma.slide.update({
        where: { slide_id },
        data: {
          slide_name: nextName,
          slide_status: nextStatus,
          ...(newImgPath ? { slide_img: newImgPath } : {}),
        },
      });

      // ถ้ามีไฟล์ใหม่ ให้ลบไฟล์เก่า
      if (req.file && existing.slide_img) {
        const oldPath = path.join(
          SLIDE_UPLOADS_DIR,
          path.basename(existing.slide_img)
        );
        try {
          if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
        } catch (err) {
          console.error("Failed to delete old slide image:", err);
          // ไม่ทำให้การอัปเดตล้มเหลว
        }
      }
      emit(req, "slide:updated", updated);
      return res
        .status(200)
        .json({ message: "อัปเดตสไลด์สำเร็จ", slide: updated });
    } catch (error: any) {
      // ลบไฟล์ใหม่ทิ้งหากอัปเดตล้มเหลว
      if (req.file) {
        const newFilePath = path.join(SLIDE_UPLOADS_DIR, req.file.filename);
        try {
          if (fs.existsSync(newFilePath)) fs.unlinkSync(newFilePath);
        } catch {}
      }
      console.error("Error updating slide:", error);
      return res
        .status(500)
        .json({ message: "ไม่สามารถอัปเดตสไลด์ได้", error: error.message });
    }
  },

  delete_slide: async (req: Request, res: Response) => {
    const idRaw =
      (req.params.id as string) ??
      (req.body?.slide_id as string) ??
      (req.body?.id as string);
    const slide_id = parseInt(idRaw, 10);

    if (!slide_id || Number.isNaN(slide_id)) {
      return res.status(400).json({ message: "รหัสสไลด์ไม่ถูกต้อง" });
    }

    try {
      const slide = await prisma.slide.findUnique({ where: { slide_id } });
      if (!slide) {
        return res.status(404).json({ message: "ไม่พบสไลด์" });
      }

      await prisma.slide.delete({ where: { slide_id } });

      // ลบไฟล์ภาพจริง
      if (slide.slide_img) {
        const imgPath = path.join(
          SLIDE_UPLOADS_DIR,
          path.basename(slide.slide_img)
        );
        try {
          if (fs.existsSync(imgPath)) {
            fs.unlinkSync(imgPath);
            console.log(`ลบรูปสไลด์: ${imgPath}`);
          }
        } catch (err) {
          console.error("ไม่สามารถลบไฟล์สไลด์:", err);
          // ไม่ทำให้การลบสไลด์ล้มเหลว
        }
      }

      emit(req, "slide:deleted", { slide_id });
      return res.status(200).json({ message: "ลบสไลด์สำเร็จ" });
    } catch (error: any) {
      console.error("Error deleting slide:", error);
      return res
        .status(500)
        .json({ message: "ไม่สามารถลบสไลด์ได้", error: error.message });
    }
  },
  // ===== End Slides API =====
  // ===== Location & Contacts API =====
  location: async (req: Request, res: Response) => {
    try {
      // มีได้แค่ 1 แถว: ถ้ายังไม่มี ให้สร้างแถวว่างไว้เลย
      let row = await prisma.location.findFirst();
      if (!row) {
        row = await prisma.location.create({
          data: {
            location_name: "",
            location_link: "",
            location_map: "",
          },
        });
      }
      return res.status(200).json(row);
    } catch (error: any) {
      console.error("Error fetching location:", error);
      return res
        .status(500)
        .json({
          message: "ไม่สามารถดึงข้อมูลสถานที่ได้",
          error: error.message,
        });
    }
  },

  update_location: async (req: Request, res: Response) => {
    const idRaw = req.params.id;
    const location_id = parseInt(idRaw, 10);
    if (!location_id || Number.isNaN(location_id)) {
      return res.status(400).json({ message: "รหัสสถานที่ไม่ถูกต้อง" });
    }

    try {
      const { location_name, location_link, location_map } = req.body ?? {};
      if (!location_name || !String(location_name).trim()) {
        return res.status(400).json({ message: "กรุณากรอกชื่อสถานที่" });
      }

      const existing = await prisma.location.findUnique({
        where: { location_id },
      });
      if (!existing) {
        return res.status(404).json({ message: "ไม่พบสถานที่" });
      }

      const updated = await prisma.location.update({
        where: { location_id },
        data: {
          location_name: String(location_name).trim(),
          // ใน schema เป็น String (non-null) ทั้งคู่ → ใส่เป็น "" ถ้า undefined
          location_link: location_link ?? "",
          location_map: location_map ?? "",
        },
      });

      emit(req, "location:updated", updated);
      return res.status(200).json(updated);
    } catch (error: any) {
      console.error("Error updating location:", error);
      return res
        .status(500)
        .json({ message: "ไม่สามารถอัปเดตสถานที่ได้", error: error.message });
    }
  },

  // --- Contacts API (schema ใหม่: contact_name, contact_link) ---
  contacts: async (req: Request, res: Response) => {
    try {
      const items = await prisma.contact.findMany({
        orderBy: { contact_id: "desc" },
      });
      return res.status(200).json(items);
    } catch (error: any) {
      console.error("Error fetching contacts:", error);
      return res
        .status(500)
        .json({
          message: "ไม่สามารถดึงข้อมูลการติดต่อได้",
          error: error.message,
        });
    }
  },

  add_contact: async (req: Request, res: Response) => {
    try {
      const { contact_name, contact_link } = req.body ?? {};

      if (!contact_name || !String(contact_name).trim()) {
        return res.status(400).json({ message: "กรุณากรอกชื่อช่องทาง" });
      }

      const created = await prisma.contact.create({
        data: {
          contact_name: String(contact_name).trim(),
          contact_link: contact_link ? String(contact_link).trim() : null,
        },
      });

      emit(req, "contact:created", created);
      return res.status(201).json(created);
    } catch (error: any) {
      console.error("Error creating contact:", error);
      return res
        .status(500)
        .json({
          message: "ไม่สามารถเพิ่มข้อมูลติดต่อได้",
          error: error.message,
        });
    }
  },

  update_contact: async (req: Request, res: Response) => {
    const idRaw = req.params.id;
    const contact_id = parseInt(idRaw, 10);
    if (!contact_id || Number.isNaN(contact_id)) {
      return res.status(400).json({ message: "รหัสข้อมูลติดต่อไม่ถูกต้อง" });
    }

    try {
      const { contact_name, contact_link } = req.body ?? {};

      if (!contact_name || !String(contact_name).trim()) {
        return res.status(400).json({ message: "กรุณากรอกชื่อช่องทาง" });
      }

      const existing = await prisma.contact.findUnique({
        where: { contact_id },
      });
      if (!existing) {
        return res.status(404).json({ message: "ไม่พบข้อมูลติดต่อ" });
      }

      const updated = await prisma.contact.update({
        where: { contact_id },
        data: {
          contact_name: String(contact_name).trim(),
          contact_link: contact_link ? String(contact_link).trim() : null,
        },
      });

      emit(req, "contact:updated", updated);
      return res.status(200).json(updated);
    } catch (error: any) {
      console.error("Error updating contact:", error);
      return res
        .status(500)
        .json({
          message: "ไม่สามารถอัปเดตข้อมูลติดต่อได้",
          error: error.message,
        });
    }
  },

  delete_contact: async (req: Request, res: Response) => {
    const idRaw = req.params.id;
    const contact_id = parseInt(idRaw, 10);
    if (!contact_id || Number.isNaN(contact_id)) {
      return res.status(400).json({ message: "รหัสข้อมูลติดต่อไม่ถูกต้อง" });
    }

    try {
      await prisma.contact.delete({ where: { contact_id } });
      emit(req, "contact:deleted", { contact_id });
      return res.status(200).json({ message: "ลบข้อมูลติดต่อสำเร็จ" });
    } catch (error: any) {
      console.error("Error deleting contact:", error);
      if (error?.code === "P2025") {
        return res.status(404).json({ message: "ไม่พบข้อมูลติดต่อ" });
      }
      return res
        .status(500)
        .json({ message: "ไม่สามารถลบข้อมูลติดต่อได้", error: error.message });
    }
  },

  reservation: async (req: Request, res: Response) => {
    try {
      const { date, tableId, includeCanceled } = req.query as any;
      const { start, end } = dayRange(date);

      const active = [
        "PENDING_OTP",
        "OTP_VERIFIED",
        "AWAITING_PAYMENT",
        "CONFIRMED",
      ] as const;
      const whereStatus =
        includeCanceled === "1" ? { not: "EXPIRED" } : { in: active };

      const where: any = {
        status: whereStatus,
        dateStart: { lt: end },
        dateEnd: { gt: start },
      };
      if (tableId) where.tableId = Number(tableId);

      const rows = await prisma.reservation.findMany({
        where,
        include: {
          table: { select: { id: true, label: true } },
          user: {
            select: {
              user_id: true,
              user_fname: true,
              user_lname: true,
              user_phone: true,
            },
          },
        },
        orderBy: [{ tableId: "asc" }, { dateStart: "asc" }],
      });

      const data = rows.map((r) => ({
        id: r.id,
        tableId: r.tableId,
        tableLabel: r.table?.label ?? "-",
        start: r.dateStart,
        end: r.dateEnd,
        people: r.people,
        status: r.status,
        user: {
          id: r.userId,
          name:
            [r.user?.user_fname, r.user?.user_lname]
              .filter(Boolean)
              .join(" ") || String(r.userId),
          phone: r.user?.user_phone ?? null,
        },
      }));

      emit?.(req, "reservation:day", { date, data }); // ชื่ออีเวนต์จะตั้งอะไรก็ได้
      return res.json({
        date: date ?? new Date().toISOString().slice(0, 10),
        start,
        end,
        data,
      });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ message: "listByDay error" });
    }
  },
  // --- End Contacts API ---

  // ===== End Location & Contacts API =====
};
