import express, { Request, Response, NextFunction  } from 'express';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
import cors from 'cors'; 
import { UserController } from './controllers/UserController';

dotenv.config();

const app = express();
const port = 3001;
const authenticateToken = (req: Request, res: Response, next: NextFunction): void => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    res.status(401).json({ message: 'ไม่ได้รับ token' });
    return; // ✅ แค่ return ป้องกันการทำงานต่อ แต่ไม่ return ค่า
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



app.use(cors());
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

//middleware check token


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
app.listen(port, () => {
  console.log(`app listening on port ${port}`);
});
