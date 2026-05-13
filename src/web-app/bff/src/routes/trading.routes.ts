import { Router } from 'express';
import tradingController from '../controllers/trading.controller';
import { authenticate } from '../middleware/auth.middleware';

const router = Router();

router.post('/connect', authenticate, tradingController.connectAccount);
router.get('/account', authenticate, tradingController.getAccount);
router.post('/orders', authenticate, tradingController.createOrder);
router.get('/orders', authenticate, tradingController.listOrders);
router.get('/orders/open', authenticate, tradingController.listBrokerOpenOrders);
router.post('/orders/:orderId/cancel', authenticate, tradingController.cancelOrder);
router.get('/positions', authenticate, tradingController.listPositions);
router.get('/snapshot', authenticate, tradingController.getSnapshot);
router.get('/dashboard', authenticate, tradingController.getDashboard);
router.get('/health', tradingController.getBrokerHealth);

export default router;
