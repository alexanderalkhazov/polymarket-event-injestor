import { Router } from 'express';
import chatController from '../controllers/chat.controller';
import { authenticate } from '../middleware/auth.middleware';

const router = Router();

// All chat routes require authentication
router.post('/conversations', authenticate, chatController.createConversation);
router.get('/conversations', authenticate, chatController.getConversations);
router.get('/conversations/:conversationId', authenticate, chatController.getConversation);
router.post('/message', authenticate, chatController.sendMessage);
router.post('/message/stream', authenticate, chatController.streamMessage);
router.delete('/conversations/:conversationId', authenticate, chatController.deleteConversation);
router.get('/events', authenticate, chatController.getMarketEvents);

export default router;
