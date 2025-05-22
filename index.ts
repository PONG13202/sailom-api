import express, { Request, Response } from 'express';
import dotenv from 'dotenv';
import cors from 'cors'; // ใช้ import แทน require
import { UserController } from './controllers/UserController';

dotenv.config();

const app = express();
const port = 3001;

app.use(cors()); // เพิ่ม middleware cors
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

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

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});
