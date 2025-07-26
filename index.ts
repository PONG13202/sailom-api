import express, { Request, Response, NextFunction  } from 'express';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
import cors from 'cors'; 
import { UserController } from './controllers/UserController';

dotenv.config();

const app = express();
const port = 3001;
app.use(cors());
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

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
app.post('/add_user',authenticateToken, async (req: Request, res: Response) => {
  try {
    await UserController.add_user(req, res);
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
app.put('/update_user/:user_id',authenticateToken, async ( req: Request, res: Response) => {
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


app.listen(port, () => {
  console.log(`app listening on port ${port}`);
});
