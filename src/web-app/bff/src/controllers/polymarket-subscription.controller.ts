import { Request, Response } from 'express';
import polymarketSubscriptionService from '../services/polymarket-subscription.service';

const polymarketSubscriptionController = {
  async getUniverse(req: Request, res: Response) {
    try {
      const limit = Math.min(parseInt((req.query.limit as string) || '100', 10), 500);
      const markets = await polymarketSubscriptionService.getUniverse(limit);
      res.json({ success: true, data: markets, source: 'polymarket-api' });
    } catch (error: any) {
      res.status(502).json({ success: false, message: `Polymarket API unavailable: ${error.message}` });
    }
  },

  async getUserSubscriptions(req: Request, res: Response) {
    try {
      const userId = (req as any).userId as string;
      const marketIds = await polymarketSubscriptionService.getUserSubscriptions(userId);
      res.json({ success: true, data: marketIds });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message || 'Failed to fetch subscriptions' });
    }
  },

  async setUserSubscriptions(req: Request, res: Response) {
    try {
      const userId = (req as any).userId as string;
      const { marketIds } = req.body;
      if (!Array.isArray(marketIds)) {
        res.status(400).json({ success: false, message: 'marketIds must be an array' });
        return;
      }
      const sub = await polymarketSubscriptionService.setUserSubscriptions(userId, marketIds);
      res.json({ success: true, data: sub.marketIds });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message || 'Failed to update subscriptions' });
    }
  },

  async addUserSubscription(req: Request, res: Response) {
    try {
      const userId = (req as any).userId as string;
      const { marketId } = req.params;
      const sub = await polymarketSubscriptionService.addUserSubscription(userId, marketId);
      res.json({ success: true, data: sub.marketIds });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message || 'Failed to add subscription' });
    }
  },

  async removeUserSubscription(req: Request, res: Response) {
    try {
      const userId = (req as any).userId as string;
      const { marketId } = req.params;
      const sub = await polymarketSubscriptionService.removeUserSubscription(userId, marketId);
      res.json({ success: true, data: sub?.marketIds || [] });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message || 'Failed to remove subscription' });
    }
  },
};

export default polymarketSubscriptionController;
