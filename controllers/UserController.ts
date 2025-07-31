// controllers/UserController.ts
import { Request, Response } from "express";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";
import jwt from "jsonwebtoken";
import dotenv from "dotenv";
import axios from "axios";
import path from "path";
import fs from "fs";
import { io } from '../index';
dotenv.config();

const prisma = new PrismaClient();
const secret = process.env.JWT_SECRET;
const UPLOADS_DIR = path.resolve('uploads/menu_images');

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
      const user_img_path = req.file ? `uploads/user_images/${req.file.filename}` : null;

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
      req.app.get("io").emit("new_user", {
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
          if (err) console.error("Error deleting uploaded file on registration error:", err);
        });
      }
      return res
        .status(500)
        .json({ message: "เกิดข้อผิดพลาดในการสมัครสมาชิก: " + (error as Error).message });
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
          { expiresIn: "20s" }
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
      // ตรวจสอบฟิลด์ที่จำเป็น
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
      // เช็ค username ซ้ำเพื่อความปลอดภัย
      const existingUser = await prisma.user.findUnique({
        where: { user_name },
      });
      if (existingUser) {
        return res.status(400).json({ message: "ชื่อผู้ใช้นี้ถูกใช้ไปแล้ว" });
      }
      const hashedPass = await bcrypt.hash(user_pass, 10);
      const newUser = await prisma.user.create({
        data: {
          user_name,
          user_pass: hashedPass,
          user_fname,
          user_lname,
          user_email,
          user_phone,
          user_img: req.file
            ? `uploads/user_images/${req.file.filename}`
            : null, // ใช้ relative path สำหรับ frontend ดึงรูป
        },
      });
      return res.status(200).json({
        message: "สร้างผู้ใช้สำเร็จ",
        data: newUser,
      });
    } catch (error) {
      console.error(error); // Log error ใน server
      return res.status(500).json({
        message: "เกิดข้อผิดพลาดในระบบ: " + (error as Error).message, // แสดงเฉพาะ message เพื่อความปลอดภัย
      });
    }
  },
update_user: async (req: Request, res: Response) => {
    try {
      const { user_id } = req.params;
      if (!user_id) return res.status(400).json({ message: "ไม่พบ user_id" });
      // ใช้ optional chaining เพื่อป้องกัน req.body undefined
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
      // จัดการรหัสผ่าน (ใช้ค่าใหม่ถ้ามี, มิฉะนั้นใช้เดิม)
      let hashedPass = oldUser.user_pass;
      if (user_pass && user_pass.trim() !== "") {
        if (user_pass.length < 6) {
          return res.status(400).json({ message: "รหัสผ่านต้องมีความยาวมากกว่า 6 ตัวอักษร" });
        }
        hashedPass = await bcrypt.hash(user_pass, 10);
      }
      // จัดการรูปภาพ (ใช้รูปใหม่ถ้ามี, มิฉะนั้นใช้เดิม)
      let user_img = oldUser.user_img;
      if (req.file) {
        // ถ้ามีรูปใหม่, ลบรูปเก่าถ้ามี
        if (oldUser.user_img) {
          const oldImagePath = path.resolve('uploads/user_images', path.basename(oldUser.user_img)); // สร้าง absolute path อย่างปลอดภัย
          try {
            if (fs.existsSync(oldImagePath)) {
              fs.unlinkSync(oldImagePath); // ลบไฟล์เก่า
              console.log(`ลบรูปเก่า: ${oldImagePath}`);
            }
          } catch (deleteError) {
            console.error(`ไม่สามารถลบรูปเก่า: ${deleteError}`); // Log error แต่ไม่ทำให้ update ล้มเหลว
          }
        }
        // ตั้งค่ารูปใหม่
        user_img = `uploads/user_images/${req.file.filename}`;
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
      return res.status(200).json(updatedUser);
    } catch (error) {
      console.error(error);
      return res.status(500).json({ message: "เกิดข้อผิดพลาดในระบบ: " + (error as Error).message });
    }
  },
  delete_user: async (req: Request, res: Response) => {
    try {
      const { user_id } = req.params; // คนที่ถูกลบ
      const { password } = req.body;
      const loggedInUser = (req as any).user; // คนที่ลบ (จาก JWT)
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
      if (!deleter || !deleter.user_pass) {
        return res
          .status(404)
          .json({ message: "ไม่พบผู้ใช้ หรือไม่มีรหัสผ่าน" });
      }
      const isMatch = await bcrypt.compare(password, deleter.user_pass);
      if (!isMatch) {
        return res.status(401).json({ message: "รหัสผ่านไม่ถูกต้อง" });
      }
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
        const imagePath = path.resolve('uploads/user_images', path.basename(userToDelete.user_img)); // สร้าง absolute path อย่างปลอดภัย
        try {
          if (fs.existsSync(imagePath)) {
            fs.unlinkSync(imagePath); // ลบไฟล์
            console.log(`ลบรูปโปรไฟล์: ${imagePath}`);
          }
        } catch (deleteError) {
          console.error(`ไม่สามารถลบรูปโปรไฟล์: ${deleteError}`); // Log error แต่ไม่ทำให้การลบผู้ใช้ล้มเหลว
        }
      }
      // ลบผู้ใช้จากฐานข้อมูล
      const deletedUser = await prisma.user.delete({
        where: { user_id: Number(user_id) },
      });
      return res.status(200).json(deletedUser);
    } catch (error) {
      console.error("Delete user error:", error);
      return res.status(500).json({ message: "เกิดข้อผิดพลาดในระบบ", error: (error as Error).message }); // ปรับให้แสดงเฉพาะ message เพื่อความปลอดภัย
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
  seats: async (req: Request, res: Response) => {
    try {
      const seatOptions = await prisma.seatOption.findMany();
      return res.status(200).json(seatOptions);
    } catch (error) {
      console.error("Error fetching seat options:", error);
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
      res.status(200).json({ message: "ลบสำเร็จ" });
    } catch (err) {
      res.status(500).json({ error: "ไม่สามารถลบได้" });
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
  delete_TablType: async (req: Request, res: Response) => {
    const { id } = req.params;
    try {
      await prisma.tableType.delete({
        where: { id: parseInt(id) },
      });
      res.status(200).json({ message: "ลบสำเร็จ" });
    } catch (err) {
      res.status(500).json({ error: "ไม่สามารถลบได้" });
    }
  },
  add_table: async (req: Request, res: Response) => {
    try {
      const { name, seats, tableTypeId, additionalInfo } = req.body;

      // 1. ตรวจสอบข้อมูลเบื้องต้น
      if (!name || !seats || !tableTypeId) {
        return res.status(400).json({
          message: "ชื่อโต๊ะ, จำนวนที่นั่ง, และประเภทโต๊ะเป็นข้อมูลที่จำเป็น",
        });
      }

      // 2. ค้นหา seatOptionId จากจำนวน seats ที่ส่งมา
      const seatOption = await prisma.seatOption.findFirst({
        where: {
          seats: parseInt(seats, 10), // แปลงเป็น Int เนื่องจาก frontend ส่งเป็น string
        },
      });

      if (!seatOption) {
        return res.status(404).json({
          message: `ไม่พบตัวเลือกจำนวนที่นั่งสำหรับ ${seats} ที่นั่ง`,
        });
      }

      // 3. แปลง tableTypeId เป็น Int
      const parsedTableTypeId = parseInt(tableTypeId, 10);

      // 4. ตรวจสอบว่า tableType มีอยู่จริงหรือไม่
      const existingTableType = await prisma.tableType.findUnique({
        where: {
          id: parsedTableTypeId,
        },
      });

      if (!existingTableType) {
        return res
          .status(404)
          .json({ message: `ไม่พบประเภทโต๊ะที่มี ID: ${tableTypeId}` });
      }

      // 5. ตรวจสอบว่ามีชื่อโต๊ะซ้ำกันหรือไม่
      const existingTable = await prisma.tableMap.findUnique({
        where: {
          label: name.trim(),
        },
      });

      if (existingTable) {
        return res
          .status(409)
          .json({ message: `ชื่อโต๊ะ '${name.trim()}' มีอยู่ในระบบแล้ว` });
      }

      // 6. สร้างโต๊ะใหม่ในฐานข้อมูล
      const newTable = await prisma.tableMap.create({
        data: {
          label: name.trim(),
          seatOption: {
            connect: {
              id: seatOption.id, // เชื่อม seatOption โดยใช้ ID
            },
          },
          tableType: {
            connect: {
              id: parsedTableTypeId, // เชื่อม tableType โดยใช้ ID
            },
          },
          additionalInfo: additionalInfo ? additionalInfo.trim() : null, // เพิ่ม additionalInfo
          x: 0, // กำหนดค่าเริ่มต้น
          y: 0, // กำหนดค่าเริ่มต้น
          active: true, // กำหนดค่าเริ่มต้น
        },
      });

      return res
        .status(201)
        .json({ message: "เพิ่มโต๊ะอาหารสำเร็จ", table: newTable });
    } catch (error: any) {
      // เพิ่ม : any เพื่อจัดการ error.message
      console.error("Error adding table:", error);
      return res.status(500).json({
        message: "เกิดข้อผิดพลาดในการเพิ่มโต๊ะอาหาร",
        error: error.message,
      });
    }
  },

  // API: ดึงข้อมูลโต๊ะทั้งหมด
  tables: async (req: Request, res: Response) => {
    try {
      const tables = await prisma.tableMap.findMany({
        include: {
          seatOption: true, // ดึงข้อมูล seatOption ที่เกี่ยวข้อง
          tableType: true, // ดึงข้อมูล tableType ที่เกี่ยวข้อง
        },
        orderBy: {
          id: "asc", // เรียงตาม ID เพื่อความสอดคล้อง
        },
      });

      // ปรับโครงสร้างข้อมูลให้ตรงกับที่ frontend คาดหวัง
      const formattedTables = tables.map((table) => ({
        id: String(table.id), // แปลง id เป็น string ตาม frontend
        name: table.label,
        seats: table.seatOption?.seats || 0, // ใช้ seats จาก seatOption
        tableTypeId: String(table.tableType?.id || ""), // แปลง tableTypeId เป็น string
        tableTypeName: table.tableType?.name || "ไม่ระบุประเภท", // แปลง tableTypeId เป็น string
        additionalInfo: table.additionalInfo || "",
        x: table.x,
        y: table.y,
        active: table.active,
      }));

      return res.status(200).json(formattedTables);
    } catch (error: any) {
      console.error("Error fetching tables:", error);
      return res.status(500).json({
        message: "เกิดข้อผิดพลาดในการดึงข้อมูลโต๊ะ",
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

      return res.status(200).json({
        message: "Table updated successfully",
        table: {
          id: String(updatedTable.id),
          name: updatedTable.label,
          seats: updatedTable.seatOption?.seats || 0,
          tableTypeId: String(updatedTable.tableTypeId),
          additionalInfo: updatedTable.additionalInfo || "",
          x: updatedTable.x,
          y: updatedTable.y,
          active: updatedTable.active,
        },
      });
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
      return res.status(200).json(updated);
    } catch (error: any) {
      console.error("Error updating food type:", error);
      return res.status(500).json({
        message: "Failed to update food type",
        error: error.message,
      });
    }
  },

  // ลบข้อมูล
  delete_FoodType: async (req: Request, res: Response) => {
    const { id } = req.params;
    try {
      const deleted = await prisma.typefood.delete({
        where: { id: parseInt(id) },
      });
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
        include: {
          MenuImages: true,
          Typefoods: {
            include: {
              typefood: true,
            },
          },
        },
      });
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
    const { menu_name, menu_price, menu_description, typefoodIds, mainImageIndex } = req.body;

    // Parse inputs (assuming typefoodIds is a JSON array string or array)
    let parsedTypefoodIds: number[] = [];
    if (typeof typefoodIds === 'string') {
      try {
        parsedTypefoodIds = JSON.parse(typefoodIds).map((id: any) => parseInt(id));
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
            create: imagePaths.map((path, index) => ({ // เพิ่ม index เข้ามาในการ map
              menu_image: path,
              // ตั้งค่า menu_status เป็น 1 ถ้าเป็นรูปหลัก, มิฉะนั้นเป็น 0
              menu_status: (parsedMainImageIndex !== null && index === parsedMainImageIndex) ? 1 : 0,
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
      return res.status(200).json(newMenu);
    } catch (error: any) {
      console.error("Error creating menu:", error);
      // เพิ่ม Logic ในการลบไฟล์ที่อัปโหลดไปแล้วหากเกิดข้อผิดพลาด
      if (files && files.length > 0) {
        files.forEach(file => {
          const filePath = path.join(__dirname, '../../uploads/menu_images', file.filename); // ปรับ path ตามโครงสร้างโปรเจกต์ของคุณ
          if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
            console.log(`Deleted uploaded file: ${filePath}`);
          }
        });
      }
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
      const { menu_name, menu_price, menu_description, typefoodIds, existingImages, mainImageIdentifier } = req.body;

      if (isNaN(menuId)) {
        return res.status(400).json({ message: "Invalid Menu ID." });
      }

      if (!menu_name || !menu_price || !typefoodIds) {
        return res.status(400).json({ message: "Missing required menu fields (name, price, types)." });
      }

      const parsedTypefoodIds: number[] = JSON.parse(typefoodIds);
      // parsedExistingImages คือรูปที่ Frontend บอกว่า "ยังคงอยู่"
      const parsedExistingImages: { menu_image_id?: number; menu_image: string; menu_status: number }[] = existingImages ? JSON.parse(existingImages) : [];

      // 1. ดึงข้อมูลเมนูเดิมและรูปภาพปัจจุบันจาก DB
      const currentMenu = await prisma.foodMenu.findUnique({
        where: { menu_id: menuId },
        include: { MenuImages: true },
      });

      if (!currentMenu) {
        return res.status(404).json({ message: "Menu not found." });
      }

      const currentDbImages = currentMenu.MenuImages;
      const imagesToKeepFromFrontendIds = new Set(parsedExistingImages.map(img => img.menu_image_id).filter(id => id !== undefined));

      // 2. จัดการรูปภาพ: ลบ Record รูปภาพที่ Frontend บอกว่าไม่ต้องการแล้วออกจาก DB และ **ลบไฟล์จริง** ออกจาก Server
      for (const dbImage of currentDbImages) {
        if (!imagesToKeepFromFrontendIds.has(dbImage.menu_image_id)) {
          // ลบ Record จาก DB
          await prisma.menuImage.delete({
            where: { menu_image_id: dbImage.menu_image_id },
          });

          // *** เพิ่มส่วนนี้เพื่อลบไฟล์จริงออกจาก Server ***
          const imagePathToDelete = path.join(UPLOADS_DIR, path.basename(dbImage.menu_image));
          if (fs.existsSync(imagePathToDelete)) {
            try {
              fs.unlinkSync(imagePathToDelete);
              console.log(`Deleted old menu image file: ${imagePathToDelete}`);
            } catch (fileDeleteError: any) {
              console.error(`Failed to delete file ${imagePathToDelete}: ${fileDeleteError.message}`);
              // ไม่จำเป็นต้อง throw error ตรงนี้ เพราะการลบ DB record สำเร็จแล้ว
            }
          } else {
            console.warn(`File not found for deletion: ${imagePathToDelete} (might already be deleted or path is incorrect)`);
          }
          // ***********************************************
        }
      }

      // 3. เพิ่มรูปภาพใหม่ที่อัปโหลด (ถ้ามี)
      const newImageRecords: { menu_image: string; menu_id: number; menu_status: number }[] = [];
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
        if (typeof mainImageIdentifier === 'string' && mainImageIdentifier.startsWith('/uploads/menu_images')) {
          await prisma.menuImage.updateMany({
            where: {
              menu_id: menuId,
              menu_image: mainImageIdentifier,
            },
            data: { menu_status: 1 },
          });
        } else { // กรณีรูปหลักเป็นรูปใหม่ (ส่งมาเป็น index ของ newFiles)
          const mainImageIndexAsNumber = parseInt(mainImageIdentifier as string);
          if (!isNaN(mainImageIndexAsNumber) && newFiles.length > mainImageIndexAsNumber) {
            const mainNewImageFilename = newFiles[mainImageIndexAsNumber].filename;
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

      res.status(200).json({ message: "Menu updated successfully.", menu: updatedMenu });

    } catch (error: any) {
      console.error("Error updating menu:", error);
      // ควรมีการ rollback รูปภาพใหม่ที่อัปโหลดไปแล้วหากเกิดข้อผิดพลาดใน DB transaction
      // ส่วนนี้ยังคงต้องลบไฟล์ใหม่ที่อัปโหลดหากเกิด error เพราะมันยังไม่มี Record ใน DB
      if (newFiles && newFiles.length > 0) {
        newFiles.forEach(file => {
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
          const imagePath = path.resolve('uploads/menu_images', path.basename(image.menu_image));
          
          try {
            if (fs.existsSync(imagePath)) {
              fs.unlinkSync(imagePath); // ลบไฟล์
              console.log(`ลบรูปเมนู: ${imagePath}`);
            } else {
              console.warn(`ไม่พบไฟล์รูปเมนูที่ path: ${imagePath} (อาจถูกลบไปแล้วหรือ path ผิด)`);
            }
          } catch (fileDeleteError) {
            console.error(`ไม่สามารถลบไฟล์รูปเมนู: ${imagePath}, ข้อผิดพลาด: ${fileDeleteError}`);
            // คุณอาจต้องการส่ง error กลับไปให้ client ด้วย แต่ไม่ทำให้การลบเมนูล้มเหลว
          }
        });
      }

      return res.status(200).json({ message: "ลบเมนูและรูปภาพที่เกี่ยวข้องสำเร็จ", deleted: deletedMenu });

    } catch (error: any) {
      console.error("Error deleting menu:", error);
      return res.status(500).json({
        message: "ไม่สามารถลบเมนูได้",
        error: error.message,
      });
    }
  },
};
