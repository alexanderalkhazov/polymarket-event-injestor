import { Router } from 'express';
import subscriptionController from '../controllers/subscription.controller';
import { authenticate } from '../middleware/auth.middleware';

const router = Router();

router.get('/universe', authenticate, subscriptionController.getUniverse);
router.get('/quotes', authenticate, subscriptionController.getQuotes);
router.get('/recommendations', authenticate, subscriptionController.getRecommendations);
router.get('/', authenticate, subscriptionController.getUserSubscriptions);
router.put('/', authenticate, subscriptionController.setUserSubscriptions);
router.post('/:ticker', authenticate, subscriptionController.addUserSubscription);
router.delete('/:ticker', authenticate, subscriptionController.removeUserSubscription);

export default router;
