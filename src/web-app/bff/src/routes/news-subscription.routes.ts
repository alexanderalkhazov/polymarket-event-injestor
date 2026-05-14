import { Router } from 'express';
import newsSubscriptionController from '../controllers/news-subscription.controller';
import { authenticate } from '../middleware/auth.middleware';

const router = Router();

router.get('/catalog', newsSubscriptionController.getCatalog);
router.get('/', authenticate, newsSubscriptionController.getUserTopics);
router.put('/', authenticate, newsSubscriptionController.setUserTopics);
router.post('/:topic', authenticate, newsSubscriptionController.addTopic);
router.delete('/:topic', authenticate, newsSubscriptionController.removeTopic);

export default router;
