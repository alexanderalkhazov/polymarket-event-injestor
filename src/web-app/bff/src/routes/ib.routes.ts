import { Router } from 'express';
import ibController from '../controllers/ib.controller';
import { authenticate } from '../middleware/auth.middleware';

const router = Router();

router.get('/status', authenticate, ibController.getStatus);
router.post('/connect', authenticate, ibController.connect);

export default router;
