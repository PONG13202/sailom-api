// C:\Users\pong1\OneDrive\เอกสาร\End-Pro\api\index.ts
import express, { Request, Response, NextFunction  } from 'express';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
import cors from 'cors'; 
import { UserController} from './controllers/UserController'; 
import multer from 'multer';
import path from 'path';

dotenv.config();

const app = express();
const port = 3001;
app.use(cors());
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/user_images');
  },
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}-${file.originalname}`);
  },
});
const upload = multer({ storage });

const menuStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    // กำหนดโฟลเดอร์ปลายทางสำหรับไฟล์รูปภาพเมนู
    // ตรวจสอบให้แน่ใจว่า 'uploads/menu_images' directory มีอยู่จริงใน root ของโปรเจกต์ API
    cb(null, 'uploads/menu_images');
  },
  filename: (req, file, cb) => {
    // ตั้งชื่อไฟล์ให้ไม่ซ้ำกันโดยใช้ timestamp, random number และนามสกุลไฟล์เดิม
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const fileExtension = path.extname(file.originalname);
    cb(null, `menu-${uniqueSuffix}${fileExtension}`); // ตัวอย่าง: menu-1700000000-123456789.png
  },
});
const uploadMenuImage = multer({ storage: menuStorage });

const authenticateToken = (req: Request, res: Response, next: NextFunction): void => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    res.status(401).json({ message: 'ไม่ได้รับ token' });
    return; 
  }

  jwt.verify(token, process.env.JWT_SECRET!, (err, user) => {
    if (err) {
      res.status(403).json({ message: 'token ไม่ถูกต้อง' });
      return;
    }

    (req as any).user = user;
    next();
  });
};
app.get('/menus', (req: Request, res: Response) => {
  try {
    UserController.menus(req, res);
  } catch (error) {
    res.status(500).json({ message: 'Internal Server Error' });
  }
})
app.post('/add_menu', uploadMenuImage.array('images', 10), async (req: Request, res: Response) => {
  try {
    await UserController.add_menu(req, res);
  } catch (error) {
    console.error("Error in /add_menu route:", error);
    res.status(500).json({ message: 'Internal Server Error' });
  }
});
app.put('/update_menu/:id', uploadMenuImage.array('newImages', 10), async (req: Request, res: Response) => {
  try {
    await UserController.update_menu(req, res); // ใช้ UserController ที่ import มา
  } catch (error) {
    console.error("Error in /update_menu route:", error);
    res.status(500).json({ message: 'Internal Server Error' });
  }
}); 

app.delete('/delete_menu/:id', async (req: Request, res: Response) => {
  try {
    await UserController.delete_menu(req, res);
  } catch (error) {
    res.status(500).json({ message: 'Internal Server Error' });
  }
});

app.post('/register', async (req: Request, res: Response) => {
  try {
    await UserController.register(req, res);
  } catch (error) {
    res.status(500).json({ message: 'Internal Server Error' });
  }
});
app.post('/google_login', async (req: Request, res: Response) => {
  try {
    await UserController.google_login(req, res);
  } catch (error) {
    res.status(500).json({ message: 'Internal Server Error' });
  }
});
app.post('/complete_profile', authenticateToken, async (req: Request, res: Response) => {
  try {
    await UserController.complete_profile(req, res);
  } catch (error) {
    res.status(500).json({ message: 'Internal Server Error' });
  }
});
app.post('/login', async (req: Request, res: Response) => {
  try {
    await UserController.login(req, res);
  } catch (error) {
    res.status(500).json({ message: 'Internal Server Error' });
  }
});
app.get('/check_username', async (req: Request, res: Response) => {
  try {
    await UserController.check_username(req, res);
  } catch (error) {
    res.status(500).json({ message: 'Internal Server Error' });
  }
});
app.get('/check_email', async (req: Request, res: Response) => {
  try {
    await UserController.check_email(req, res);
  } catch (error) {
    res.status(500).json({ message: 'Internal Server Error' });
  }
});
app.post('/add_user', upload.single('user_img'), authenticateToken, async (req: Request, res: Response) => { // เปลี่ยนเป็น 'user_img' เพื่อตรงกับ frontend
  try {
    await UserController.add_user(req, res);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Internal Server Error' });
  }
});
app.get('/all_user', async (req: Request, res: Response) => {
  try {
    await UserController.all_user(req, res);
  } catch (error) {
    res.status(500).json({ message: 'Internal Server Error' });
  }
});
app.get('/info',authenticateToken, async (req: Request, res: Response) => {
  try {
    await UserController.info(req, res);
  } catch (error) {
    res.status(500).json({ message: 'Internal Server Error' });
  }
});
app.put('/update_user/:user_id',upload.single('user_img'),authenticateToken, async ( req: Request, res: Response) => {
  try {
    await UserController.update_user(req, res);
  } catch (error) {
    res.status(500).json({ message: 'Internal Server Error' });
  }
});
app.delete('/delete_user/:user_id',authenticateToken, async (req: Request, res: Response) => {
  try {
    await UserController.delete_user(req, res);
  } catch (error) {
    res.status(500).json({ message: 'Internal Server Error' });
  }
})
app.post('/add_seat', async (req: Request, res: Response) => {
  try {
    await UserController.add_seat(req, res);
  } catch (error) {
    res.status(500).json({ message: 'Internal Server Error' });
  }
})
app.get('/seats', async (req: Request, res: Response) => {
  try {
    await UserController.seats(req, res);
  } catch (error) {
    res.status(500).json({ message: 'Internal Server Error' });
  }
})
app.delete('/delete_seat/:id', async (req: Request, res: Response) => {
  try {
    await UserController.delete_seat(req, res);
  } catch (error) {
    res.status(500).json({ message: 'Internal Server Error' });
  }
})
app.post('/add_TableType', async (req: Request, res: Response) => {
  try {
    await UserController.add_TableType(req, res);
  } catch (error) {
    res.status(500).json({ message: 'Internal Server Error' });
  }
})
app.get('/table_Types', async (req: Request, res: Response) => {
  try {
    await UserController.table_Types(req, res);
  } catch (error) {
    res.status(500).json({ message: 'Internal Server Error' });
  }
})
app.delete('/delete_TablType/:id', async (req: Request, res: Response) => {
  try {
    await UserController.delete_TablType(req, res);
  } catch (error) {
    res.status(500).json({ message: 'Internal Server Error' });
  }
})
app.post('/add_table', async (req: Request, res: Response) => {
  try {
    await UserController.add_table(req, res);
  } catch (error) {
    res.status(500).json({ message: 'Internal Server Error' });
  }
})
app.get('/tables', async (req: Request, res: Response) => {
  try {
    await UserController.tables(req, res);
  } catch (error) {
    res.status(500).json({ message: 'Internal Server Error' });
  }
})
app.put('/update_table/:id', async (req: Request, res: Response) => {
  try {
    await UserController.update_table(req, res);
  } catch (error) {
    res.status(500).json({ message: 'Internal Server Error' });
  }
})
app.post('/save_table_positions', async (req: Request, res: Response) => {
  try {
    await UserController.save_table_positions(req, res);
  } catch (error) {
    res.status(500).json({ message: 'Internal Server Error' });
  }
})
app.put('/update_table_status/:id', async (req: Request, res: Response) => {
  try {
    await UserController.update_table_status(req, res);
  } catch (error) {
    res.status(500).json({ message: 'Internal Server Error' });
  }
});
app.delete('/delete_table/:id', async (req: Request, res: Response) => {
  try {
    await UserController.delete_table(req, res);
  } catch (error) {
    res.status(500).json({ message: 'Internal Server Error' });
  }
})
app.get('/foodTypes', async (req: Request, res: Response) => {
  try {
    await UserController.foodTypes(req, res);
  } catch (error) {
    res.status(500).json({ message: 'Internal Server Error' });
  }
})
app.post('/add_FoodType', async (req: Request, res: Response) => {
  try {
    await UserController.add_FoodType(req, res);
  } catch (error) {
    res.status(500).json({ message: 'Internal Server Error' });
  }
})
app.put('/update_FoodType/:id', async (req: Request, res: Response) => {
  try {
    await UserController.update_FoodType(req, res);
  } catch (error) {
    res.status(500).json({ message: 'Internal Server Error' });
  }
})
app.delete('/delete_FoodType/:id', async (req: Request, res: Response) => {
  try {
    await UserController.delete_FoodType(req, res);
  } catch (error) {
    res.status(500).json({ message: 'Internal Server Error' });
  }
})


app.listen(port, () => {
  console.log(`app listening on port ${port}`);
});
