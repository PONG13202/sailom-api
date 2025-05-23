// controllers/UserController.ts
import { Request, Response } from "express";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";
import jwt from "jsonwebtoken";
import dotenv from "dotenv";
import axios from "axios";

dotenv.config();

const port = 3001;
const prisma = new PrismaClient();

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
        return res.status(400).json({ message: "กรุณาระบุชื่อผู้ใช้และรหัสผ่าน" });
      }
      if (!user_fname || !user_lname) {
        return res.status(400).json({ message: "กรุณาระบุชื่อจริงและนามสกุล" });
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
        return res.status(400).json({ message: "บัญชี Google นี้ถูกใช้ไปแล้ว" });
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
        user_status: newUser.user_status,
        user_img: newUser.user_img,
      },
    });
  } catch (error) {
    console.error("Error during registration:", error);
    return res.status(500).json({ message: "เกิดข้อผิดพลาดในการสมัครสมาชิก" });
  }
},
google_login: async (req: Request, res: Response) => {
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
      return res.status(400).json({ message: "อีเมล Google ยังไม่ได้รับการยืนยัน" });
    }

    // หาผู้ใช้ด้วย google_id
    let user = await prisma.user.findUnique({
      where: { google_id: googleId },
    });

    if (!user) {
      // ตรวจสอบว่ามีผู้ใช้ที่มีอีเมลนี้อยู่แล้วหรือไม่
      const existingUser = await prisma.user.findUnique({
        where: { user_email: email },
      });

      if (existingUser) {
        // ถ้ามีผู้ใช้ที่มีอีเมลนี้ แต่ไม่มี google_id
        if (!existingUser.google_id) {
          // อัปเดตผู้ใช้เดิมโดยเพิ่ม google_id
          user = await prisma.user.update({
            where: { user_email: email },
            data: { google_id: googleId, user_img: profile_image },
          });
        } else {
          return res.status(400).json({ message: "อีเมลนี้ถูกใช้โดยบัญชี Google อื่นแล้ว" });
        }
      } else {
        // สร้างผู้ใช้ใหม่ ถ้าไม่มีผู้ใช้ที่มีอีเมลนี้
        user = await prisma.user.create({
          data: {
            user_name: null, // ไม่ใช้ user_name สำหรับ Google
            user_fname: first_name,
            user_lname: last_name,
            user_email: email,
            user_img: profile_image,
            user_status: 1,
            google_id: googleId,
          },
        });
      }
    }

    // สร้าง JWT token
    const jwtToken = jwt.sign(
      {
        id: user.user_id,
        user_name: user.user_name,
        user_status: user.user_status,
      },
      process.env.JWT_SECRET || "mysecret",
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
    console.error("Google login error:", error.response?.data || error.message);
    return res.status(500).json({ message: "ไม่สามารถเข้าสู่ระบบด้วย Google ได้" });
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
        user_status: user.user_status,
      },
      process.env.JWT_SECRET || "mysecret",
      { expiresIn: "1d" }
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
  try{
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
      }
    });
    if (!users) {
      return res.status(404).json({ message: "ไม่พบผู้ใช้ในระบบ" });
    }
    return res.status(200).json(users);

  }catch (error) {
    console.error(error);
    return res.status(500).json({ message: "เกิดข้อผิดพลาดในระบบ" });
  }
},

};
