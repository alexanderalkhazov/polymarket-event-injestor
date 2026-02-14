import { Request, Response } from 'express';
import aiService from '../services/ai.service';
import Conversation from '../models/conversation.model';
import mongoose from 'mongoose';

class ChatController {
  // Create a new conversation
  async createConversation(req: Request, res: Response): Promise<void> {
    try {
      const userId = (req as any).userId;
      const { title } = req.body;

      const conversation = await Conversation.create({
        userId: new mongoose.Types.ObjectId(userId),
        title: title || 'New Conversation',
        messages: [],
      });

      res.status(201).json({
        success: true,
        data: conversation,
      });
    } catch (error: any) {
      console.error('Create conversation error:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Failed to create conversation',
      });
    }
  }

  // Get all conversations for a user
  async getConversations(req: Request, res: Response): Promise<void> {
    try {
      const userId = (req as any).userId;

      const conversations = await Conversation.find({ 
        userId: new mongoose.Types.ObjectId(userId) 
      })
        .sort({ updatedAt: -1 })
        .select('_id title updatedAt messages')
        .lean();

      // Add metadata
      const conversationsWithMeta = conversations.map(conv => ({
        id: conv._id,
        title: conv.title,
        updatedAt: conv.updatedAt,
        messageCount: conv.messages?.length || 0,
        lastMessage: conv.messages && conv.messages.length > 0 
          ? conv.messages[conv.messages.length - 1].content.substring(0, 100)
          : '',
      }));

      res.status(200).json({
        success: true,
        data: conversationsWithMeta,
      });
    } catch (error: any) {
      console.error('Get conversations error:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Failed to fetch conversations',
      });
    }
  }

  // Get a specific conversation
  async getConversation(req: Request, res: Response): Promise<void> {
    try {
      const userId = (req as any).userId;
      const { conversationId } = req.params;

      const conversation = await Conversation.findOne({
        _id: new mongoose.Types.ObjectId(conversationId),
        userId: new mongoose.Types.ObjectId(userId),
      });

      if (!conversation) {
        res.status(404).json({
          success: false,
          message: 'Conversation not found',
        });
        return;
      }

      res.status(200).json({
        success: true,
        data: conversation,
      });
    } catch (error: any) {
      console.error('Get conversation error:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Failed to fetch conversation',
      });
    }
  }

  // Send a message in a conversation
  async sendMessage(req: Request, res: Response): Promise<void> {
    try {
      const userId = (req as any).userId;
      const { conversationId, message } = req.body;

      if (!message || typeof message !== 'string') {
        res.status(400).json({
          success: false,
          message: 'Please provide a message',
        });
        return;
      }

      let conversation;

      // If conversationId is provided, use existing conversation
      if (conversationId) {
        conversation = await Conversation.findOne({
          _id: new mongoose.Types.ObjectId(conversationId),
          userId: new mongoose.Types.ObjectId(userId),
        });

        if (!conversation) {
          res.status(404).json({
            success: false,
            message: 'Conversation not found',
          });
          return;
        }
      } else {
        // Create a new conversation
        const title = aiService.generateConversationTitle(message);
        conversation = await Conversation.create({
          userId: new mongoose.Types.ObjectId(userId),
          title,
          messages: [],
        });
      }

      // Add user message
      conversation.messages.push({
        role: 'user',
        content: message,
        timestamp: new Date(),
      });

      await conversation.save();

      // Prepare conversation history for AI
      const conversationHistory = conversation.messages.map(msg => ({
        role: msg.role,
        content: msg.content,
      }));

      // Generate AI response
      console.log('🤖 Generating AI response...');
      const aiResponse = await aiService.generateTradingRecommendation(
        message,
        conversationHistory
      );
      console.log(`✅ AI response generated (${aiResponse.length} chars)`);

      // Add AI response to conversation
      conversation.messages.push({
        role: 'assistant',
        content: aiResponse,
        timestamp: new Date(),
      });

      await conversation.save();

      res.status(200).json({
        success: true,
        data: {
          conversationId: conversation._id,
          message: aiResponse,
          timestamp: new Date().toISOString(),
          conversation: {
            id: conversation._id,
            title: conversation.title,
            messageCount: conversation.messages.length,
          },
        },
      });
    } catch (error: any) {
      console.error('Send message error:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Failed to process message',
      });
    }
  }

  async streamMessage(req: Request, res: Response): Promise<void> {
    try {
      const userId = (req as any).userId;
      const { conversationId, message } = req.body;

      if (!message || typeof message !== 'string') {
        res.status(400).json({
          success: false,
          message: 'Please provide a message',
        });
        return;
      }

      let conversation;

      if (conversationId) {
        conversation = await Conversation.findOne({
          _id: new mongoose.Types.ObjectId(conversationId),
          userId: new mongoose.Types.ObjectId(userId),
        });

        if (!conversation) {
          res.status(404).json({
            success: false,
            message: 'Conversation not found',
          });
          return;
        }
      } else {
        const title = aiService.generateConversationTitle(message);
        conversation = await Conversation.create({
          userId: new mongoose.Types.ObjectId(userId),
          title,
          messages: [],
        });
      }

      conversation.messages.push({
        role: 'user',
        content: message,
        timestamp: new Date(),
      });

      await conversation.save();

      const conversationHistory = conversation.messages.map(msg => ({
        role: msg.role,
        content: msg.content,
      }));

      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');

      res.write(`data: ${JSON.stringify({
        type: 'meta',
        conversationId: String(conversation._id),
      })}\n\n`);

      let aiResponse = '';
      aiResponse = await aiService.streamTradingRecommendation(
        message,
        conversationHistory,
        (token: string) => {
          res.write(`data: ${JSON.stringify({ type: 'token', token })}\n\n`);
        }
      );

      conversation.messages.push({
        role: 'assistant',
        content: aiResponse,
        timestamp: new Date(),
      });

      await conversation.save();

      res.write(`data: ${JSON.stringify({
        type: 'done',
        conversationId: String(conversation._id),
        timestamp: new Date().toISOString(),
      })}\n\n`);

      res.end();
    } catch (error: any) {
      console.error('Stream message error:', error);

      if (!res.headersSent) {
        res.status(500).json({
          success: false,
          message: error.message || 'Failed to process streamed message',
        });
        return;
      }

      res.write(`data: ${JSON.stringify({
        type: 'error',
        message: error.message || 'Failed to process streamed message',
      })}\n\n`);
      res.end();
    }
  }

  // Delete a conversation
  async deleteConversation(req: Request, res: Response): Promise<void> {
    try {
      const userId = (req as any).userId;
      const { conversationId } = req.params;

      const result = await Conversation.deleteOne({
        _id: new mongoose.Types.ObjectId(conversationId),
        userId: new mongoose.Types.ObjectId(userId),
      });

      if (result.deletedCount === 0) {
        res.status(404).json({
          success: false,
          message: 'Conversation not found',
        });
        return;
      }

      res.status(200).json({
        success: true,
        message: 'Conversation deleted successfully',
      });
    } catch (error: any) {
      console.error('Delete conversation error:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Failed to delete conversation',
      });
    }
  }

  // Get recent market events (debugging endpoint)
  async getMarketEvents(req: Request, res: Response): Promise<void> {
    try {
      // If limit is 0 or 'all', fetch all events without limit
      const limitParam = req.query.limit as string;
      const limit = limitParam === 'all' ? 0 : parseInt(limitParam) || 100;
      const events = await aiService.getRecentEvents(limit);

      res.status(200).json({
        success: true,
        data: {
          events,
          count: events.length,
        },
      });
    } catch (error: any) {
      console.error('Error fetching events:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Failed to fetch market events',
      });
    }
  }
}

export default new ChatController();
