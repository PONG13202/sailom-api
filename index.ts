
import express, { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import dotenv from "dotenv";
import cors from "cors";
import { UserController } from "./controllers/UserController";
import { FrontController } from "./controllers/FrontController";
import multer from "multer";
import path from "path";
import fs from "fs";
import http from "http";
import { Server } from "socket.io";
import { ReservationController } from "./controllers/Reservation";
import { PaymentController } from "./controllers/Payment";
import { OrdersController } from "./controllers/Orders";
import type { RequestHandler } from "express";
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

dotenv.config();

const app = express();
app.use(
  cors({
    origin: [
      "https://sailom-fe.vercel.app",
      "https://sailom-be.vercel.app"
    ],
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    credentials: true,
  })
);


app.use(express.urlencoded({ extended: true }));
app.use(express.json());
const extraUploadDir = process.env.UPLOAD_DIR || "uploads";

[
  "uploads",
  "uploads/user_images",
  "uploads/menu_images",
  "uploads/slide_images",
  "uploads/slips_images",
   extraUploadDir,
].forEach((dir) => {
  const abs = path.resolve(dir);
  if (!fs.existsSync(abs)) fs.mkdirSync(abs, { recursive: true });
});

app.use("/uploads", express.static(path.resolve("uploads")));

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: ["https://sailom-fe.vercel.app","https://sailom-be.vercel.app"],
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    credentials: true,
  },
});

app.set("io", io);
async function expireSweep() {
  const now = new Date();

  // 1) หมดเวลา Payment -> EXPIRED เฉพาะที่ "ยังไม่มีสลิป"
  const expiredPayments = await prisma.payment.updateMany({
    where: {
      status: { in: ["PENDING", "SUBMITTED"] },
      expiresAt: { lt: now },
      slipImage: null, // ✅ มีสลิปแล้ว "อย่า" expire
    },
    data: { status: "EXPIRED" },
  });

  // 2) ใบจองที่ยังไม่คอนเฟิร์ม -> EXPIRED
  const expiredResv = await prisma.reservation.updateMany({
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
  await prisma.order.updateMany({
    where: { status: "PENDING", payment: { status: "EXPIRED" } },
    data: { status: "CANCELED" },
  });

  // 4) ลบ OTP ที่หมดอายุ
  await prisma.otpCode.deleteMany({ where: { expiresAt: { lt: now } } });

  if (expiredPayments || expiredResv) {
    io.emit("reservation:expired", { at: now.toISOString() });
  }
}


io.on("connection", (socket) => {
  console.log("Client connected:", socket.id);

  socket.on("join", (room: string) => socket.join(room));
  socket.on("leave", (room: string) => socket.leave(room));
  socket.on("disconnect", () => {
  });
});

// user images
const userStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, "uploads/user_images"),
  filename: (_req, file, cb) =>
    cb(null, `${Date.now()}-${file.originalname}`),
});
const upload = multer({ storage: userStorage });

// menu images
const menuStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, "uploads/menu_images"),
  filename: (_req, file, cb) => {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    const ext = path.extname(file.originalname);
    cb(null, `menu-${uniqueSuffix}${ext}`);
  },
});
const uploadMenuImage = multer({ storage: menuStorage });

// slide images
const slideStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, "uploads/slide_images"),
  filename: (_req, file, cb) => {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    const ext = path.extname(file.originalname);
    cb(null, `slide-${uniqueSuffix}${ext}`);
  },
});
const uploadSlide = multer({ storage: slideStorage });
// payment slip images
const slipStorage = multer.diskStorage({
  destination: (_req, _file, cb) =>
    cb(null,"uploads/slips_images"), // อยู่ใต้ /uploads ก็พอ
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `slip-${Date.now()}-${Math.round(Math.random()*1e9)}${ext}`);
  },
});
const uploadSlip = multer({ storage: slipStorage });

// ===================== Auth middleware =====================
const authenticateToken: RequestHandler = (req, res, next) => {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];
  if (!token) {
    res.status(401).json({ message: "ไม่ได้รับ token" });
    return;
  }
  jwt.verify(token, process.env.JWT_SECRET as string, (err, decoded: any) => {
    if (err) {
      res.status(403).json({ message: "token ไม่ถูกต้อง" });
      return;
    }
    (req as any).user = decoded;
    // ✅ ยุบชื่อ field ให้เป็น userId มาตรฐานเดียว
    (req as any).userId = Number(
      decoded?.user_id ?? decoded?.id ?? decoded?.userId
    ) || undefined;
    
    next();
  });
};
// 

const requireAdmin: RequestHandler = (req, res, next) => {
  if (!(req as any).user?.isAdmin) {
    res.status(403).json({ message: "Only admin" });
    return; // ✅ จบด้วย void (ไม่ return Response)
  }
  next();
};

// Orders 
app.get("/orders", authenticateToken, async (req, res) => {
  try { await OrdersController.list(req, res); }
  catch (e) { console.error(e); res.status(500).json({ message: "Internal Server Error" }); }
});
app.get("/orders/:id", authenticateToken, async (req, res) => {
  try { await OrdersController.get(req, res); }
  catch (e) { console.error(e); res.status(500).json({ message: "Internal Server Error" }); }
});
app.patch("/orders/:id", authenticateToken, async (req, res) => {
  try { await OrdersController.update(req, res); }
  catch (e) { console.error(e); res.status(500).json({ message: "Internal Server Error" }); }
});

// ---------------- Payment  ----------------
app.get("/payment/:id", authenticateToken, async (req, res) => {
  try { await PaymentController.get(req, res); }
  catch (e) { console.error(e); res.status(500).json({ message: "Internal Server Error" }); }
});
app.post("/payment/:id/confirm", authenticateToken, async (req, res) => {
  try { await PaymentController.confirm(req, res); }
  catch (e) { console.error(e); res.status(500).json({ message: "Internal Server Error" }); }
});
app.post("/payment/:id/cancel", authenticateToken, async (req, res) => {
  try { await PaymentController.cancel(req, res); }
  catch (e) { console.error(e); res.status(500).json({ message: "Internal Server Error" }); }
});


app.post("/reservations", authenticateToken, async (req, res) => {
  try { await ReservationController.create(req, res); }
  catch { res.status(500).json({ message: "Internal Server Error" }); }
});
app.get("/reservation/:id", authenticateToken, async (req, res) => {
  try { await ReservationController.get(req, res); }
  catch (e) { console.error(e); res.status(500).json({ message: "Internal Server Error" }); }
  
});
app.post("/reservations/:id/confirm", authenticateToken, async (req, res) => {
  try { await ReservationController.confirm(req, res); }
  catch { res.status(500).json({ message: "Internal Server Error" }); }
});
app.patch("/reservations/:id",
  authenticateToken,

  async (req, res) => {
    try { await ReservationController.update(req, res); }
    catch (e) {
      console.error(e);
      res.status(500).json({ message: "Internal Server Error" });
    }
  }
);

app.post("/reservations/:id/request-otp", authenticateToken, async (req, res) => {
  try { await ReservationController.requestOtp(req, res); }
  catch { res.status(500).json({ message: "Internal Server Error" }); }
});
app.post("/reservations/:id/verify-otp", authenticateToken, async (req, res) => {
  try { await ReservationController.verifyOtp(req, res); }
  catch { res.status(500).json({ message: "Internal Server Error" }); }
});
app.post("/reservations/:id/cancel", authenticateToken, async (req, res) => {
  try { await ReservationController.cancel(req, res); }
  catch { res.status(500).json({ message: "Internal Server Error" }); }
});

// ====== Payment ======
app.get("/payment/:id", authenticateToken, async (req, res) => {
  try { await PaymentController.get(req, res); }
  catch { res.status(500).json({ message: "Internal Server Error" }); }
});

app.post("/payment/:id/slip",
  authenticateToken,
  uploadSlip.single("slip"),
  async (req, res) => {
    try { await PaymentController.uploadSlip(req, res); }
    catch { res.status(500).json({ message: "Internal Server Error" }); }
  }
);

// app.post("/payment/:id/confirm",
//   authenticateToken,async (req, res) => {
//     try { await PaymentController.confirm(req, res); }
//     catch { res.status(500).json({ message: "Internal Server Error" }); }
//   }
// );



// ===================== Routes =====================
// password verify
app.get("/reservation",authenticateToken, async (req: Request, res: Response) => {
  try {
    await UserController.reservation(req, res);
  } catch {
    res.status(500).json({ message: "Internal Server Error" });
  }
})
app.post(
  "/verify_password",
  authenticateToken,
  async (req: Request, res: Response) => {
    try {
      await UserController.verify_password(req, res);
    } catch {
      res.status(500).json({ message: "Internal Server Error" });
    }
  }
);

// front checks
app.get("/check_user", async (req: Request, res: Response) => {
  try {
    await FrontController.check_user(req, res);
  } catch {
    res.status(500).json({ message: "Internal Server Error" });
  }
});
app.get("/check_mail", async (req: Request, res: Response) => {
  try {
    await FrontController.check_mail(req, res);
  } catch {
    res.status(500).json({ message: "Internal Server Error" });
  }
});

// front sign in/up
app.post("/signin", async (req: Request, res: Response) => {
  try {
    await FrontController.signin(req, res);
  } catch {
    res.status(500).json({ message: "Internal Server Error" });
  }
});
app.post(
  "/signup",
  upload.single("user_img"),
  async (req: Request, res: Response) => {
    try {
      await FrontController.signup(req, res);
    } catch {
      res.status(500).json({ message: "Internal Server Error" });
    }
  }
);
app.post("/google_signin", async (req: Request, res: Response) => {
  try {
    await FrontController.google_signin(req, res);
  } catch {
    res.status(500).json({ message: "Internal Server Error" });
  }
});
app.post(
  "/add_profile",
  authenticateToken,
  upload.single("user_img"),
  async (req: Request, res: Response) => {
    try {
      await FrontController.add_profile(req, res);
    } catch {
      res.status(500).json({ message: "Internal Server Error" });
    }
  }
);
app.get("/user_info", authenticateToken, async (req: Request, res: Response) => {
  try {
    await FrontController.user_info(req, res);
  } catch {
    res.status(500).json({ message: "Internal Server Error" });
  }
})



// grid size
app.get("/grid_size", async (req: Request, res: Response) => {
  try {
    await UserController.grid_size(req, res);
  } catch {
    res.status(500).json({ message: "Internal Server Error" });
  }
});
app.post("/add_grid_size", async (req: Request, res: Response) => {
  try {
    await UserController.add_grid_size(req, res);
  } catch {
    res.status(500).json({ message: "Internal Server Error" });
  }
});

// menus
app.get("/menus", async (req: Request, res: Response) => {
  try {
    await UserController.menus(req, res);
  } catch {
    res.status(500).json({ message: "Internal Server Error" });
  }
});
app.post(
  "/add_menu",
  uploadMenuImage.array("images", 10),
  async (req: Request, res: Response) => {
    try {
      await UserController.add_menu(req, res);
    } catch (error) {
      console.error("Error in /add_menu route:", error);
      res.status(500).json({ message: "Internal Server Error" });
    }
  }
);
app.put(
  "/update_menu/:id",
  uploadMenuImage.array("newImages", 10),
  async (req: Request, res: Response) => {
    try {
      await UserController.update_menu(req, res);
    } catch (error) {
      console.error("Error in /update_menu route:", error);
      res.status(500).json({ message: "Internal Server Error" });
    }
  }
);
app.delete("/delete_menu/:id", async (req: Request, res: Response) => {
  try {
    await UserController.delete_menu(req, res);
  } catch {
    res.status(500).json({ message: "Internal Server Error" });
  }
});

// admin/auth
app.post(
  "/register",
  upload.single("user_img"),
  async (req: Request, res: Response) => {
    try {
      await UserController.register(req, res);
    } catch {
      res.status(500).json({ message: "Internal Server Error" });
    }
  }
);
app.post("/google_login", async (req: Request, res: Response) => {
  try {
    await UserController.google_login(req, res);
  } catch {
    res.status(500).json({ message: "Internal Server Error" });
  }
});
app.post(
  "/complete_profile",
  authenticateToken,
  async (req: Request, res: Response) => {
    try {
      await UserController.complete_profile(req, res);
    } catch {
      res.status(500).json({ message: "Internal Server Error" });
    }
  }
);
app.post("/login", async (req: Request, res: Response) => {
  try {
    await UserController.login(req, res);
  } catch {
    res.status(500).json({ message: "Internal Server Error" });
  }
});
app.get("/check_username", async (req: Request, res: Response) => {
  try {
    await UserController.check_username(req, res);
  } catch {
    res.status(500).json({ message: "Internal Server Error" });
  }
});
app.get("/check_email", async (req: Request, res: Response) => {
  try {
    await UserController.check_email(req, res);
  } catch {
    res.status(500).json({ message: "Internal Server Error" });
  }
});
app.post(
  "/add_user",
  upload.single("user_img"),
  authenticateToken,
  async (req: Request, res: Response) => {
    try {
      await UserController.add_user(req, res);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Internal Server Error" });
    }
  }
);
app.get("/all_user", async (req: Request, res: Response) => {
  try {
    await UserController.all_user(req, res);
  } catch {
    res.status(500).json({ message: "Internal Server Error" });
  }
});
app.get("/info", authenticateToken, async (req: Request, res: Response) => {
  try {
    await UserController.info(req, res);
  } catch {
    res.status(500).json({ message: "Internal Server Error" });
  }
});
app.put(
  "/update_user/:user_id",
  upload.single("user_img"),
  authenticateToken,
  async (req: Request, res: Response) => {
    try {
      await UserController.update_user(req, res);
    } catch {
      res.status(500).json({ message: "Internal Server Error" });
    }
  }
);
app.put(
  "/users/:userId/status",
  authenticateToken,
  async (req: Request, res: Response) => {
    try {
      await UserController.update_user_status(req, res);
    } catch {
      res.status(500).json({ message: "Internal Server Error" });
    }
  }
);
app.put(
  "/users/:userId/roles",
  authenticateToken,
  async (req: Request, res: Response) => {
    try {
      await UserController.update_user_roles(req, res);
    } catch {
      res.status(500).json({ message: "Internal Server Error" });
    }
  }
);
app.delete(
  "/delete_user/:user_id",
  authenticateToken,
  async (req: Request, res: Response) => {
    try {
      await UserController.delete_user(req, res);
    } catch {
      res.status(500).json({ message: "Internal Server Error" });
    }
  }
);

// seats / tables / types
app.post("/add_seat", async (req: Request, res: Response) => {
  try {
    await UserController.add_seat(req, res);
  } catch {
    res.status(500).json({ message: "Internal Server Error" });
  }
});
app.get("/seats", async (req: Request, res: Response) => {
  try {
    await UserController.seats(req, res);
  } catch {
    res.status(500).json({ message: "Internal Server Error" });
  }
});
app.delete("/delete_seat/:id", async (req: Request, res: Response) => {
  try {
    await UserController.delete_seat(req, res);
  } catch {
    res.status(500).json({ message: "Internal Server Error" });
  }
});

app.post("/add_TableType", async (req: Request, res: Response) => {
  try {
    await UserController.add_TableType(req, res);
  } catch {
    res.status(500).json({ message: "Internal Server Error" });
  }
});
app.get("/table_Types", async (req: Request, res: Response) => {
  try {
    await UserController.table_Types(req, res);
  } catch {
    res.status(500).json({ message: "Internal Server Error" });
  }
});
app.delete("/delete_TablType/:id", async (req: Request, res: Response) => {
  try {
    await UserController.delete_TablType(req, res);
  } catch {
    res.status(500).json({ message: "Internal Server Error" });
  }
});

app.post("/add_table", async (req: Request, res: Response) => {
  try {
    await UserController.add_table(req, res);
  } catch {
    res.status(500).json({ message: "Internal Server Error" });
  }
});
app.get("/tables", async (req: Request, res: Response) => {
  try {
    await UserController.tables(req, res);
  } catch {
    res.status(500).json({ message: "Internal Server Error" });
  }
});
app.put("/update_table/:id", async (req: Request, res: Response) => {
  try {
    await UserController.update_table(req, res);
  } catch {
    res.status(500).json({ message: "Internal Server Error" });
  }
});
app.post("/save_table_positions", async (req: Request, res: Response) => {
  try {
    await UserController.save_table_positions(req, res);
  } catch {
    res.status(500).json({ message: "Internal Server Error" });
  }
});
app.put("/update_table_status/:id", async (req: Request, res: Response) => {
  try {
    await UserController.update_table_status(req, res);
  } catch {
    res.status(500).json({ message: "Internal Server Error" });
  }
});
app.delete("/delete_table/:id", async (req: Request, res: Response) => {
  try {
    await UserController.delete_table(req, res);
  } catch {
    res.status(500).json({ message: "Internal Server Error" });
  }
});

// food types
app.get("/foodTypes", async (req: Request, res: Response) => {
  try {
    await UserController.foodTypes(req, res);
  } catch {
    res.status(500).json({ message: "Internal Server Error" });
  }
});
app.post("/add_FoodType", async (req: Request, res: Response) => {
  try {
    await UserController.add_FoodType(req, res);
  } catch {
    res.status(500).json({ message: "Internal Server Error" });
  }
});
app.put("/update_FoodType/:id", async (req: Request, res: Response) => {
  try {
    await UserController.update_FoodType(req, res);
  } catch {
    res.status(500).json({ message: "Internal Server Error" });
  }
});
app.delete("/delete_FoodType/:id", async (req: Request, res: Response) => {
  try {
    await UserController.delete_FoodType(req, res);
  } catch {
    res.status(500).json({ message: "Internal Server Error" });
  }
});

app.get("/slides", async (req: Request, res: Response) => {
  try {
    await UserController.slides(req, res);
  } catch {
    res.status(500).json({ message: "Internal Server Error" });
  }
});
app.post(
  "/add_slide",
  uploadSlide.single("image"),
  async (req: Request, res: Response) => {
    try {
      await UserController.add_slide(req, res);
    } catch {
      res.status(500).json({ message: "Internal Server Error" });
    }
  }
);
app.put(
  "/update_slide/:id",
  uploadSlide.single("image"),
  async (req: Request, res: Response) => {
    try {
      await UserController.update_slide(req, res);
    } catch {
      res.status(500).json({ message: "Internal Server Error" });
    }
  }
);
app.delete("/delete_slide/:id", async (req: Request, res: Response) => {
  try {
    await UserController.delete_slide(req, res);
  } catch {
    res.status(500).json({ message: "Internal Server Error" });
  }
});
app.get("/location", async (req: Request, res: Response) => {
  try {
    await UserController.location(req, res);
  } catch {
    res.status(500).json({ message: "Internal Server Error" });
  }
});
app.put("/update_location/:id", async (req: Request, res: Response) => {
  try {
    await UserController.update_location(req, res);
  } catch {
    res.status(500).json({ message: "Internal Server Error" });
  }
})
app.get("/contacts", async (req: Request, res: Response) => {
  try {
    await UserController.contacts(req, res);
  } catch {
    res.status(500).json({ message: "Internal Server Error" });
  }
});
app.post("/add_contact", async (req: Request, res: Response) => {
  try {
    await UserController.add_contact(req, res);
  } catch {
    res.status(500).json({ message: "Internal Server Error" });
  }
})
app.put("/update_contact/:id", async (req: Request, res: Response) => {
  try {
    await UserController.update_contact(req, res);
  } catch {
    res.status(500).json({ message: "Internal Server Error" });
  }
})
app.delete("/delete_contact/:id", async (req: Request, res: Response) => {
  try {
    await UserController.delete_contact(req, res);
  } catch {
    res.status(500).json({ message: "Internal Server Error" });
  }
})

app.get("/slides_show", async (req: Request, res: Response) => {
  try {
    await FrontController.slides_show(req, res);
  } catch {
    res.status(500).json({ message: "Internal Server Error" });
  }
});
app.get("/seat",async (req: Request, res: Response) => {
  try {
    await FrontController.seat(req, res);
  } catch {
    res.status(500).json({ message: "Internal Server Error" });
  }
})
app.get("/locations", async (req: Request, res: Response) => {
  try {
    await FrontController.locations(req, res);
  } catch {
    res.status(500).json({ message: "Internal Server Error" });
  }
});
app.get("/table", async (req: Request, res: Response) => {
  try {
    await FrontController.table(req, res);
  } catch {
    res.status(500).json({ message: "Internal Server Error" });
  }
})
app.get("/grid", async (req: Request, res: Response) => {
  try {
    await FrontController.grid(req, res);
  } catch {
    res.status(500).json({ message: "Internal Server Error" });
  }
})
app.get("/menu", async (req: Request, res: Response) => {
  try {
    await FrontController.menu(req, res);
  } catch {
    res.status(500).json({ message: "Internal Server Error" });
  }
})
app.get("/foodType", async (req: Request, res: Response) => {
  try {
    await FrontController.foodType(req, res);
  } catch {
    res.status(500).json({ message: "Internal Server Error" });
  }
})
// ประวัติการจองของฉัน (ลูกค้าฝั่งหน้าบ้าน)
app.get("/my_reservations", authenticateToken, async (req, res) => {
  try {
    await FrontController.my_reservations(req, res);
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: "Internal Server Error" });
  }
});
// อัปโหลดรูปโปรไฟล์ (อย่าลืมใช้ storage user_images ที่ประกาศไว้)
app.post(
  "/upload_avatar",
  authenticateToken,
  upload.single("file"),
  async (req, res) => {
    try { await FrontController.upload_avatar(req, res); }
    catch { res.status(500).json({ message: "Internal Server Error" }); }
  }
);

// อัปเดตข้อมูลโปรไฟล์
// เดิม: app.put("/update_profile", authenticateToken, async (req,res)=>{...})
app.put(
  "/update_profile",
  authenticateToken,
  upload.single("user_img"),   // << เพิ่ม multer ตรงนี้ ฟิลด์ชื่อ user_img
  async (req, res) => { await FrontController.update_profile(req, res); }
);


// เปลี่ยนรหัสผ่าน
app.post("/change_password", authenticateToken, async (req, res) => {
  try { await FrontController.change_password(req, res); }
  catch { res.status(500).json({ message: "Internal Server Error" }); }
});

app.get("/", (_req: Request, res: Response) => {
  res.status(200).json({ ok: true });
});

// (ทางเลือก) health check
app.get("/health", (_req: Request, res: Response) => {
  res.status(200).json({ ok: true });
});

// เริ่มเซิร์ฟเวอร์
// server.listen(port, () => {
//   console.log(`Server is running on port ${port}`);
// });
export default app;