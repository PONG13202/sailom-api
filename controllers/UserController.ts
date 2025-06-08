// controllers/UserController.ts
import { Request, Response } from "express";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";
import jwt from "jsonwebtoken";
import dotenv from "dotenv";
import axios from "axios";

dotenv.config();

const prisma = new PrismaClient();
const secret = process.env.JWT_SECRET;

export const UserController = {
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
      const {
        user_name,
        user_pass,
        user_fname,
        user_lname,
        user_email,
        user_phone,
        user_img,
        user_status,
        google_id,
      } = req.body;

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
            user_name && !google_id ? { user_name } : undefined, // ไม่ตรวจสอบ user_name ถ้าเป็น Google
            { user_email },
            google_id ? { google_id } : undefined,
          ].filter(Boolean) as any,
        },
      });

      if (existingUser) {
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
          user_name: google_id ? null : user_name, // ไม่ใช้ user_name สำหรับ Google
          user_pass: hashedPassword,
          user_fname: user_fname || null,
          user_lname: user_lname || null,
          user_email,
          user_phone: user_phone || null,
          user_img: user_img || null,
          user_status: user_status ?? 1,
          google_id: google_id || null,
        },
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
    } catch (error) {
      console.error("Error during registration:", error);
      return res
        .status(500)
        .json({ message: "เกิดข้อผิดพลาดในการสมัครสมาชิก" });
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

      const existingUser = await prisma.user.findUnique({
        where: { user_email: email },
      });

      if (existingUser) {
        if (existingUser.google_id !== googleId) {
          return res.status(400).json({
            message: "อีเมลนี้ถูกใช้โดยบัญชี Google อื่นแล้ว",
          });
        }

        // เข้าระบบปกติ
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
          },
          process.env.JWT_SECRET!,
          { expiresIn: "1d" }
        );

        return res.status(200).json({
          message: "เข้าสู่ระบบด้วย Google สำเร็จ",
          token: jwtToken,
          user: existingUser,
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
        { expiresIn: "10m" }
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
        return res
          .status(400)
          .json({ message: "ชื่อผู้ใช้นี้ถูกใช้ไปแล้ว" });
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
        },
      });
    } catch (error) {
      console.error(error);
      return res.status(500).json({ message: "เกิดข้อผิดพลาดในระบบ" });
    }
  },
  all_user: async (req: Request, res: Response) => {
    try {
      // ดึงผู้ใช้ทั้งหมด
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

      // ดึง admin user_id ทั้งหมด
      const admins = await prisma.admin.findMany({
        select: {
          user_id: true,
        },
      });

      // สร้างเซต user_id ของ admin
      const adminUserIds = new Set(admins.map((a) => a.user_id));

      // map users เพิ่ม isAdmin
      const usersWithRole = users.map((user) => ({
        ...user,
        isAdmin: adminUserIds.has(user.user_id),
      }));

      return res.status(200).json(usersWithRole);
    } catch (error) {
      console.error(error);
      return res.status(500).json({ message: "เกิดข้อผิดพลาดในระบบ" });
    }
  },

  info: async (req: Request, res: Response) => {
    try {
      const userData = (req as any).user; // fallback แบบไม่มี type
      const id = userData?.id;

      console.log("User ID from token:", id);

      if (!id) {
        return res.status(401).json({ message: "ไม่พบ userId จาก token" });
      }

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

      console.log("User from database:", user);

      if (!user) {
        return res.status(404).json({ message: "ไม่พบผู้ใช้ในระบบ" });
      }
      const role = await prisma.admin.findFirst({
        where: { user_id: id }, // ต้องแน่ใจว่า admin table มี field `user_id`
        select: {
          admin_id: true, // หรือข้อมูลอื่น ๆ ที่ต้องการจาก admin
          user_id: true,
          admin_status: true,
        },
      });
      const isAdmin = role ? true : false;
      console.log("User from database:", user, "Is Admin:", isAdmin);

      return res.status(200).json({
        ...user,
        isAdmin,
      });
    } catch (error: any) {
      console.error("เกิดข้อผิดพลาด:", error.message, error.stack);
      return res
        .status(500)
        .json({ message: "เกิดข้อผิดพลาดในระบบ", error: error.message });
    }
  },
};
