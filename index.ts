// C:\Users\pong1\OneDrive\เอกสาร\End-Pro\api\index.ts
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

dotenv.config();

const app = express();
const port = 5000;

// CORS (รองรับหลายพอร์ตและส่งคุกกี้/credential ได้)
app.use(
  cors({
    origin: ["http://localhost:3000", "http://localhost:3001"],
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    credentials: true,
  })
);

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// ให้แน่ใจว่าโฟลเดอร์อัปโหลดมีอยู่จริง
[
  "uploads",
  "uploads/user_images",
  "uploads/menu_images",
  "uploads/slide_images",
].forEach((dir) => {
  const abs = path.resolve(dir);
  if (!fs.existsSync(abs)) fs.mkdirSync(abs, { recursive: true });
});

// เสิร์ฟไฟล์จาก /uploads
app.use("/uploads", express.static(path.resolve("uploads")));

// สร้าง HTTP server + Socket.IO
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: ["http://localhost:3000", "http://localhost:3001"],
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    credentials: true,
  },
});

// ให้ controllers เข้าถึง io ได้ผ่าน req.app.get("io")
app.set("io", io);

// ตัวอย่างการจัดการเชื่อมต่อ + join/leave room
io.on("connection", (socket) => {
  console.log("Client connected:", socket.id);

  socket.on("join", (room: string) => socket.join(room));
  socket.on("leave", (room: string) => socket.leave(room));

  socket.on("disconnect", () => {
    // console.log("Client disconnected:", socket.id);
  });
});

// ===================== Multer storages =====================
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

// ===================== Auth middleware =====================
const authenticateToken = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];

  if (!token) {
    res.status(401).json({ message: "ไม่ได้รับ token" });
    return;
  }

  jwt.verify(token, process.env.JWT_SECRET as string, (err, user) => {
    if (err) {
      res.status(403).json({ message: "token ไม่ถูกต้อง" });
      return;
    }
    (req as any).user = user;
    next();
  });
};

// ===================== Routes =====================
// password verify
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

// slides (หลังบ้าน)
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

// slides_show (หน้าบ้าน แสดงเฉพาะ slide_status = 1)
app.get("/slides_show", async (req: Request, res: Response) => {
  try {
    await FrontController.slides_show(req, res);
  } catch {
    res.status(500).json({ message: "Internal Server Error" });
  }
});

// (ทางเลือก) health check
app.get("/health", (_req: Request, res: Response) => {
  res.status(200).json({ ok: true });
});

// เริ่มเซิร์ฟเวอร์
server.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
