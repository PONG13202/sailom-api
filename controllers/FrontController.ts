// controllers/FrontController.ts
import { Request, Response } from "express";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";
import jwt from "jsonwebtoken";
import dotenv from "dotenv";
import axios from "axios";
import path from "path";
import fs from "fs";
import type { Server as SocketIOServer } from "socket.io";
import { get } from "http";
import { emit } from "process";

dotenv.config();

const prisma = new PrismaClient();
const secret = process.env.JWT_SECRET;
const getIO = (req: Request) => req.app.get("io") as SocketIOServer | undefined;
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

// Ensure JWT_SECRET is defined
if (!secret) {
  console.error("JWT_SECRET is not defined in environment variables.");
  process.exit(1); // Exit the process if critical environment variable is missing
}

// Ensure UPLOADS_DIR exists and is correctly set for user images
const USER_UPLOADS_DIR = path.resolve("uploads/user_images");
if (!fs.existsSync(USER_UPLOADS_DIR)) {
  fs.mkdirSync(USER_UPLOADS_DIR, { recursive: true });
}
const isLocalUserImage = (p?: string | null) =>
  !!p &&
  !p.startsWith("http") &&
  (p.startsWith("uploads/user_images/") || p.startsWith("/uploads/user_images/"));

// --- Type Augmentation for Express Request ---
// This tells TypeScript that the Request object might have a 'file' property
// when multer middleware is used.
declare module "express" {
  interface Request {
    file?: Express.Multer.File; // For single file uploads
    files?:
      | { [fieldname: string]: Express.Multer.File[] }
      | Express.Multer.File[]; // For multiple file uploads (if needed)
  }
}
// --- End Type Augmentation ---


export async function emitMyReservations(req: Request, userId: number) {
  const reservations = await prisma.reservation.findMany({
    where: { userId },
    orderBy: { updatedAt: "desc" },
    include: {
      table: true,
      order: { include: { items: true } },
      payment: true,
    },
  });

  getIO(req)?.to(`user:${userId}`).emit("my_reservations:update", {
    data: reservations,
    now: new Date().toISOString(),
  });
}

export const FrontController = {

  signup: async (req: Request, res: Response) => {
    try {
      const {
        user_name,
        user_pass,
        user_fname,
        user_lname,
        user_email,
        user_phone,
        user_status,
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
          fs.unlink(req.file.path, (err) => {
            if (err) console.error("Error deleting uploaded file:", err);
          });
        }
        return res.status(400).json({ message: "กรุณาระบุอีเมล" });
      }
      if (!user_name || !user_pass) {
        if (req.file) {
          fs.unlink(req.file.path, (err) => {
            if (err) console.error("Error deleting uploaded file:", err);
          });
        }
        return res
          .status(400)
          .json({ message: "กรุณาระบุชื่อผู้ใช้และรหัสผ่าน" });
      }
      if (user_pass.length < 6) {
        if (req.file) {
          fs.unlink(req.file.path, (err) => {
            if (err) console.error("Error deleting uploaded file:", err);
          });
        }
        return res
          .status(400)
          .json({ message: "รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร" });
      }
      if (!user_fname || !user_lname) {
        if (req.file) {
          fs.unlink(req.file.path, (err) => {
            if (err) console.error("Error deleting uploaded file:", err);
          });
        }
        return res.status(400).json({ message: "กรุณาระบุชื่อจริงและนามสกุล" });
      }

      // ตรวจสอบการสมัครซ้ำ (user_name หรือ user_email)
      const existingUser = await prisma.user.findFirst({
        where: {
          OR: [{ user_name: user_name }, { user_email: user_email }],
        },
      });

      if (existingUser) {
        // หากมีการอัปโหลดไฟล์แต่ผู้ใช้มีอยู่แล้ว ให้ลบไฟล์ออก
        if (req.file) {
          fs.unlink(req.file.path, (err) => {
            if (err) console.error("Error deleting uploaded file:", err);
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
      const hashedPassword = await bcrypt.hash(user_pass, 10);

      // สร้างผู้ใช้ใหม่
      const newUser = await prisma.user.create({
        data: {
          user_name: user_name,
          user_pass: hashedPassword,
          user_fname: user_fname,
          user_lname: user_lname,
          user_email: user_email,
          user_phone: user_phone || null,
          user_img: user_img_path, // บันทึกพาธรูปภาพ
          user_status: user_status ?? 1,
          google_id: null, // การลงทะเบียนทั่วไป ไม่มี google_id
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
          user_img: newUser.user_img,
        },
      });
    } catch (error) {
      console.error("Error during signup:", error);
      // หากเกิดข้อผิดพลาดหลังจากอัปโหลดไฟล์แต่ก่อนบันทึกลง DB ให้ลบไฟล์ออก
      if (req.file) {
        fs.unlink(req.file.path, (err) => {
          if (err)
            console.error("Error deleting uploaded file on signup error:", err);
        });
      }
      return res.status(500).json({
        message: "เกิดข้อผิดพลาดในการสมัครสมาชิก: " + (error as Error).message,
      });
    }
  },

  google_signin: async (req: Request, res: Response) => {
    try {
      const { token } = req.body;

      if (!token) {
        return res.status(400).json({ message: "Token ไม่ถูกส่งมา" });
      }

      // ตรวจสอบ token กับ Google API
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

      // ค้นหาผู้ใช้ด้วย google_id
      let user = await prisma.user.findUnique({
        where: { google_id: googleId },
      });

      if (!user) {
        // ถ้าไม่พบผู้ใช้ด้วย google_id ให้ลองค้นหาด้วย email
        const existingUserByEmail = await prisma.user.findUnique({
          where: { user_email: email },
        });
        

        if (existingUserByEmail) {
          // ถ้ามีผู้ใช้ที่มีอีเมลนี้อยู่แล้ว แต่ยังไม่มี google_id
          if (!existingUserByEmail.google_id) {
            // อัปเดตผู้ใช้เดิมโดยเพิ่ม google_id และรูปโปรไฟล์
                    if (existingUserByEmail.user_status !== 1) {
          return res.status(403).json({ message: "บัญชีนี้ถูกระงับการใช้งาน" });
        }
            user = await prisma.user.update({
              where: { user_email: email },
              data: { google_id: googleId, user_img: profile_image },
            });
          } else {
            // ถ้าอีเมลถูกใช้โดยบัญชี Google อื่นแล้ว (มี google_id แต่ไม่ตรงกัน)
            return res.status(400).json({
              message: "อีเมลนี้ถูกใช้โดยบัญชี Google อื่นแล้ว",
            });
          }
        } else {
          // ถ้ายังไม่มีบัญชีที่เชื่อมโยงกับ Google ID หรือ Email นี้เลย
          // สร้างผู้ใช้ใหม่ แต่ยังไม่สมบูรณ์ (incompleteProfile)
          const tempToken = jwt.sign(
            {
              google_id: googleId,
              email,
              first_name,
              last_name,
              profile_image,
              incompleteProfile: true, // ตั้งค่าสถานะว่าโปรไฟล์ยังไม่สมบูรณ์
            },
            secret,
            { expiresIn: "10m" } // Token ชั่วคราว มีอายุ 10 นาที
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
      const jwtToken = jwt.sign(
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
        secret,
        { expiresIn: "1d" }
      );

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
    } catch (error: any) {
      console.error(
        "Google signin error:",
        error.response?.data || error.message
      );
      return res
        .status(500)
        .json({ message: "ไม่สามารถเข้าสู่ระบบด้วย Google ได้" });
    }
  },

  signin: async (req: Request, res: Response) => {
    try {
      const { user_name, user_pass } = req.body; // user_name สามารถเป็น username หรือ email ก็ได้

      if (!user_name || !user_pass) {
        return res
          .status(400)
          .json({ message: "กรุณากรอกชื่อผู้ใช้/อีเมลและรหัสผ่าน" });
      }

      // ค้นหาผู้ใช้ด้วย user_name หรือ user_email
      const user = await prisma.user.findFirst({
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
      const isMatch = await bcrypt.compare(user_pass, user.user_pass);
      if (!isMatch) {
        return res.status(401).json({ message: "รหัสผ่านไม่ถูกต้อง" });
      }
      if (user.user_status !== 1) {
  return res.status(403).json({ message: "บัญชีนี้ถูกระงับการใช้งาน" });
}

      // สร้าง JWT token
      const jwtToken = jwt.sign(
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
        secret,
        { expiresIn: "1d" } // Token มีอายุ 1 วัน
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
    } catch (error) {
      console.error("Signin error:", error);
      return res
        .status(500)
        .json({ message: "เกิดข้อผิดพลาดในการเข้าสู่ระบบ" });
    }
  },

  add_profile: async (req: Request, res: Response) => {
    try {
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return res.status(401).json({ message: "ไม่ได้รับ token" });
      }

      const tempToken = authHeader.split(" ")[1];
      let decoded: any;

      try {
        decoded = jwt.verify(tempToken, secret);
      } catch (err) {
        return res.status(401).json({ message: "Token หมดอายุหรือไม่ถูกต้อง" });
      }

      // ตรวจสอบว่า token เป็น tempToken สำหรับ incompleteProfile
      if (!decoded.incompleteProfile || !decoded.email || !decoded.google_id) {
        return res
          .status(400)
          .json({ message: "Token ไม่ถูกต้องสำหรับการกรอกข้อมูลโปรไฟล์" });
      }

      const { user_fname, user_lname, user_phone, user_name, user_pass } =
        req.body;
      const user_img_path = req.file
        ? `uploads/user_images/${req.file.filename}`
        : decoded.profile_image || null;

      // ตรวจสอบข้อมูลที่จำเป็น
      if (
        !user_fname ||
        !user_lname ||
        !user_phone ||
        !user_name ||
        !user_pass
      ) {
        if (req.file) {
          // Clean up uploaded file if validation fails
          fs.unlink(req.file.path, (err) => {
            if (err) console.error("Error deleting uploaded file:", err);
          });
        }
        return res.status(400).json({ message: "กรุณากรอกข้อมูลให้ครบถ้วน" });
      }
      if (user_pass.length < 6) {
        if (req.file) {
          // Clean up uploaded file if validation fails
          fs.unlink(req.file.path, (err) => {
            if (err) console.error("Error deleting uploaded file:", err);
          });
        }
        return res
          .status(400)
          .json({ message: "รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร" });
      }

      // ตรวจสอบ user_name ซ้ำก่อนสร้างผู้ใช้
      const existingUserName = await prisma.user.findUnique({
        where: { user_name: user_name },
      });
      if (existingUserName) {
        if (req.file) {
          // Clean up uploaded file if validation fails
          fs.unlink(req.file.path, (err) => {
            if (err) console.error("Error deleting uploaded file:", err);
          });
        }
        return res.status(400).json({ message: "ชื่อผู้ใช้นี้ถูกใช้ไปแล้ว" });
      }

      // เข้ารหัสรหัสผ่าน
      const hashedPassword = await bcrypt.hash(user_pass, 10);

      // สร้างผู้ใช้ใหม่จากข้อมูล Google และข้อมูลที่ผู้ใช้กรอกเพิ่มเติม
      const newUser = await prisma.user.create({
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
      const jwtToken = jwt.sign(
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
        secret,
        { expiresIn: "1d" }
      );

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
    } catch (error: any) {
      console.error(
        "Complete profile error:",
        error.response?.data || error.message
      );
      // Clean up uploaded file if an error occurs during DB operation
      if (req.file) {
        fs.unlink(req.file.path, (err) => {
          if (err)
            console.error(
              "Error deleting uploaded file on complete profile error:",
              err
            );
        });
      }
      return res.status(500).json({
        message: "ไม่สามารถบันทึกข้อมูลโปรไฟล์ได้: " + (error as Error).message,
      });
    }
  },

  user_info: async (req: Request, res: Response) => {
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

  check_user: async (req: Request, res: Response) => {
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

  check_mail: async (req: Request, res: Response) => {
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
  slides_show: async (req: Request, res: Response) => {
    try {
      const slides = await prisma.slide.findMany({
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
    } catch (error) {
      console.error("Error fetching slides:", error);
      return res
        .status(500)
        .json({ message: "เกิดข้อผิดพลาดในการดึงข้อมูลสไลด์" });
    }
  },
  seat: async (req: Request, res: Response) => {
    try {
      const seatOptions = await prisma.seatOption.findMany({
        orderBy: [{ seats: "asc" }],
      });
      getIO(req)?.emit("seat:list", seatOptions);
      return res.status(200).json(seatOptions);
    } catch (error) {
      console.error("Error fetching seat options:", error);
      return res.status(500).json({
        success: false,
        message: "เกิดข้อผิดพลาดภายในเซิร์ฟเวอร์",
      });
    }
  },
  locations: async (req: Request, res: Response) => {
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
      getIO(req)?.emit("location", row);
      return res.status(200).json(row);
    } catch (error: any) {
      console.error("Error fetching location:", error);
      return res.status(500).json({
        message: "ไม่สามารถดึงข้อมูลสถานที่ได้",
        error: error.message,
      });
    }
  },
  grid: async (req: Request, res: Response) => {
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
      getIO(req)?.emit("gridSize", gridSize);
      return res.status(200).json(gridSize);
    } catch (error: any) {
      console.error("Error fetching grid size:", error);
      return res.status(500).json({
        message: "Failed to fetch grid size",
        error: error.message,
      });
    }
  },
  table: async (req: Request, res: Response) => {
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
      getIO(req)?.emit("table:list", formatted);
      return res.status(200).json(formatted);
    } catch (error: any) {
      console.error("Error fetching tables:", error);
      return res.status(500).json({
        message: "เกิดข้อผิดพลาดในการดึงข้อมูลโต๊ะ",
        error: error.message,
      });
    }
  },
// GET /menus_show  (public)
menu: async (req: Request, res: Response) => {
  try {
    const menus = await prisma.foodMenu.findMany({
      where: { menu_status: 1 },          // โชว์เฉพาะเมนู Active
      orderBy: { menu_name: "asc" },
      include: {
        MenuImages: true,                 // ยัง include เพื่อให้ FE เลือกรูปหลักได้
        Typefoods: { include: { typefood: true } },
      },
    });
    // อย่า emit ที่นี่
    return res.status(200).json(menus);
  } catch (error: any) {
    console.error("Error fetching menus:", error);
    return res.status(500).json({ message: "Failed to fetch menus", error: error.message });
  }
},


  foodType: async (req: Request, res: Response) => {
    try {
      const foodTypes = await prisma.typefood.findMany({
        orderBy: { name: "asc" },
      });
      getIO(req)?.emit("foodType", foodTypes);
      return res.status(200).json(foodTypes);
    } catch (error: any) {
      console.error("Error fetching food types:", error);
      return res
        .status(500)
        .json({ message: "Failed to fetch food types", error: error.message });
    }
  },
my_reservations: async (req: Request, res: Response) => {
  try {
    const userId =
      (req as any).userId ||
      (req as any).user?.id ||
      (req as any).user?.user_id;
    if (!userId) return res.status(401).json({ message: "ไม่พบผู้ใช้" });

    const reservations = await prisma.reservation.findMany({
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
    const menuIds = Array.from(
      new Set(
        reservations.flatMap((r) =>
          r.order?.items?.map((it) => it.menuId).filter(Boolean) || []
        )
      )
    );
    const menus = await prisma.foodMenu.findMany({
      where: { menu_id: { in: menuIds } },
      include: { MenuImages: true },
    });
    const imgByMenuId = new Map(
      menus.map((m) => [m.menu_id, m.MenuImages[0]?.menu_image ?? null])
    );

    // build response
    const data = reservations.map((r) => {
      const pay = r.order?.payment || r.payment || null;
      return {
        id: r.id,
        tableLabel: r.table?.label ?? null,
        dateStart: r.dateStart?.toISOString(),
        dateEnd: r.dateEnd?.toISOString(),
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
      confirmedAt: pay.confirmedAt ? pay.confirmedAt.toISOString() : null,  // ✅ เพิ่มบรรทัดนี้
      slipImage: pay.slipImage || null,
      // ❌ ไม่ส่ง qrDataUrl ออกไป
    }
  : null,

      };
    });

    // ✅ emit แบบเดียวกับ frontend รอฟัง
    const io = getIO(req);
    io?.to(`user:${userId}`).emit("my_reservations:list", { data, now: new Date().toISOString() });
    io?.to(`user:${userId}`).emit("my_reservations:update", { data, now: new Date().toISOString() });

    return res.status(200).json({ data, now: new Date().toISOString() });
  } catch (error) {
    console.error("my_reservations error:", error);
    return res.status(500).json({ message: "โหลดรายการไม่สำเร็จ" });
  }
},
// อัปโหลดรูปโปรไฟล์
upload_avatar: async (req: Request, res: Response) => {
  try {
    if (!req.file) return res.status(400).json({ message: "ไม่พบไฟล์อัปโหลด" });
    const relPath = `uploads/user_images/${req.file.filename}`; // เก็บเป็นพาธสัมพัทธ์
    return res.status(200).json({ url: relPath, path: relPath });
  } catch (e: any) {
    console.error("upload_avatar error:", e);
    if (req.file) fs.unlink(req.file.path, () => {});
    return res.status(500).json({ message: "อัปโหลดรูปไม่สำเร็จ" });
  }
},

// อัปเดตข้อมูลโปรไฟล์
// อัปเดตข้อมูลโปรไฟล์
// อัปเดตข้อมูลโปรไฟล์
update_profile: async (req: Request, res: Response) => {
  try {
    const userData = (req as any).user;
    const id = Number(userData?.id);
    if (!id) return res.status(401).json({ message: "ไม่พบ userId จาก token" });

    const { user_name, user_fname, user_lname, user_phone, user_img } = req.body;

    // path ใหม่จากการอัปโหลดไฟล์ (ถ้ามีไฟล์แนบมาที่ฟิลด์ user_img)
    const filePath = req.file ? `uploads/user_images/${req.file.filename}` : undefined;
    // เลือกใช้ไฟล์ที่เพิ่งอัปโหลดก่อน ถ้าไม่มีค่อยใช้ user_img ที่ส่งมาใน body
    const nextImg = filePath ?? (user_img || undefined);

    // ตรวจชื่อผู้ใช้ซ้ำ (ยกเว้นของตัวเอง)
    if (user_name) {
      const exist = await prisma.user.findFirst({
        where: { user_name, NOT: { user_id: id } },
      });
      if (exist) {
        // ถ้า validate ไม่ผ่านและมีอัปโหลดไฟล์มา ให้ลบทิ้ง
        if (req.file) fs.unlink(req.file.path, () => {});
        return res.status(400).json({ message: "ชื่อผู้ใช้นี้ถูกใช้ไปแล้ว" });
      }
    }

    // อ่านค่ารูปเดิมไว้ก่อน
    const current = await prisma.user.findUnique({
      where: { user_id: id },
      select: { user_img: true },
    });

    const updated = await prisma.user.update({
      where: { user_id: id },
      data: {
        user_name: user_name ?? undefined,
        user_fname: user_fname ?? undefined,
        user_lname: user_lname ?? undefined,
        user_phone: user_phone ?? undefined,
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
      if (
        current?.user_img &&
        current.user_img !== nextImg &&
        isLocalUserImage(current.user_img)
      ) {
        const rel = current.user_img.startsWith("/") ? `.${current.user_img}` : current.user_img;
        const abs = path.resolve(rel);
        if (abs.startsWith(path.resolve("uploads"))) fs.unlink(abs, () => {});
      }
    } catch (e) {
      console.warn("unlink old avatar failed:", (e as Error).message);
    }

    getIO(req)?.to(`user:${id}`).emit("user:updated", updated);
    return res.status(200).json(updated);
  } catch (error: any) {
    console.error("update_profile error:", error);
    // ถ้ามีไฟล์ใหม่อัปโหลดมา แล้วพังกลางทาง ให้ลบไฟล์นั้นทิ้ง
    if (req.file) fs.unlink(req.file.path, () => {});
    return res.status(500).json({ message: "บันทึกไม่สำเร็จ", error: error.message });
  }
},



// เปลี่ยนรหัสผ่าน
change_password: async (req: Request, res: Response) => {
  try {
    const userData = (req as any).user;
    const id = Number(userData?.id);
    if (!id) return res.status(401).json({ message: "ไม่พบ userId จาก token" });

    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ message: "กรุณากรอกข้อมูลให้ครบ" });
    }
    if (newPassword.length < 6) {
      return res.status(400).json({ message: "รหัสผ่านใหม่ต้องมีอย่างน้อย 6 ตัว" });
    }

    const user = await prisma.user.findUnique({ where: { user_id: id } });
    if (!user || !user.user_pass) {
      return res.status(400).json({ message: "บัญชีนี้ไม่มีรหัสผ่านเดิม" });
    }

    const ok = await bcrypt.compare(currentPassword, user.user_pass);
    if (!ok) return res.status(401).json({ message: "รหัสผ่านปัจจุบันไม่ถูกต้อง" });

    const hashed = await bcrypt.hash(newPassword, 10);
    await prisma.user.update({ where: { user_id: id }, data: { user_pass: hashed } });

    return res.status(200).json({ message: "เปลี่ยนรหัสผ่านแล้ว" });
  } catch (error: any) {
    console.error("change_password error:", error);
    return res.status(500).json({ message: "ไม่สามารถเปลี่ยนรหัสผ่านได้" });
  }
},


};
