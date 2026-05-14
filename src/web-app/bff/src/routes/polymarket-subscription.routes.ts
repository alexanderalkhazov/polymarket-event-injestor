import { Router } from 'express';
import polymarketSubscriptionController from '../controllers/polymarket-subscription.controller';
import { authenticate } from '../middleware/auth.middleware';

const router = Router();

// Market universe (seeded from polymarket_subscriptions collection)
router.get('/universe', authenticate, polymarketSubscriptionController.getUniverse);

// Per-user subscriptions
router.get('/', authenticate, polymarketSubscriptionController.getUserSubscriptions);
router.put('/', authenticate, polymarketSubscriptionController.setUserSubscriptions);
router.post('/:marketId', authenticate, polymarketSubscriptionController.addUserSubscription);
router.delete('/:marketId', authenticate, polymarketSubscriptionController.removeUserSubscription);

export default router;
