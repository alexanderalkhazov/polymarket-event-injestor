import { Request, Response } from 'express';
import subscriptionService from '../services/subscription.service';
import ibkrBrokerService from '../services/ibkr-broker.service';
import marketDataService from '../services/market-data.service';
import User from '../models/user.model';
import stockUniverse from '../models/stock-universe.json';

const subscriptionController = {
  async getUniverse(req: Request, res: Response) {
    const { query = '', secType = 'STK' } = req.query as Record<string, string>;

    if (query.trim().length >= 1) {
      // 1. Yahoo Finance symbol search (primary), filtered to secType
      try {
        const results = await marketDataService.search(query.trim(), 20, secType);
        if (results.length) return res.json({ success: true, data: results, source: 'yahoo-finance' });
      } catch { /* fall through */ }

      // 2. IBKR secdef search (fallback when YF fails)
      try {
        const ibkrResults = await ibkrBrokerService.searchSecurities(query.trim(), secType || 'STK');
        const data = ibkrResults.map((r) => ({
          symbol: r.symbol,
          name: r.description,
          conid: r.conid,
          secType: r.sections?.[0]?.secType || secType || 'STK',
          exchange: r.sections?.[0]?.exchange || '',
        }));
        return res.json({ success: true, data, source: 'ibkr' });
      } catch { /* fall through */ }

      // 3. Static JSON filter (last resort)
      const q = query.toLowerCase();
      const filtered = (stockUniverse as Array<{ symbol: string; name: string }>).filter(
        (s) => s.symbol.toLowerCase().includes(q) || s.name.toLowerCase().includes(q)
      );
      return res.json({ success: true, data: filtered, source: 'static' });
    }

    // No query — return live defaults per secType
    try {
      const data = await marketDataService.getDefaultsForSecType(secType);
      if (data.length) return res.json({ success: true, data, source: 'yahoo-finance' });
    } catch { /* fall through */ }

    // Static fallback for stocks
    const data = ['STK', 'ALL', ''].includes(secType) ? stockUniverse : [];
    return res.json({ success: true, data, source: 'static' });
  },

  /** Batch real-time quotes for a comma-separated list of symbols */
  async getQuotes(req: Request, res: Response) {
    const { symbols } = req.query as { symbols?: string };
    if (!symbols?.trim()) {
      res.json({ success: true, data: [] });
      return;
    }
    const list = symbols.split(',').map((s) => s.trim()).filter(Boolean).slice(0, 50);
    try {
      const data = await marketDataService.getQuotes(list);
      res.json({ success: true, data });
    } catch (error: any) {
      res.status(502).json({ success: false, message: `Market data unavailable: ${error.message}` });
    }
  },

  /** Screener recommendations tailored to the authenticated user's trading profile */
  async getRecommendations(req: Request, res: Response) {
    try {
      const userId = (req as any).userId as string;
      const user = await User.findById(userId);
      const riskTolerance = user?.tradingProfile?.riskTolerance ?? 'moderate';
      const preferredAssets = (user?.tradingProfile?.preferredAssets as string[]) ?? ['stocks'];

      const sections = await marketDataService.getRecommendationsForProfile(riskTolerance, preferredAssets);
      res.json({ success: true, data: sections, profile: { riskTolerance, preferredAssets } });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message || 'Failed to load recommendations' });
    }
  },

  async getUserSubscriptions(req: Request, res: Response) {
    try {
      const userId = (req as any).userId as string;
      const tickers = await subscriptionService.getUserSubscriptions(userId);
      res.json({ success: true, data: tickers });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message || 'Failed to fetch subscriptions' });
    }
  },

  async setUserSubscriptions(req: Request, res: Response) {
    try {
      const userId = (req as any).userId as string;
      const { tickers } = req.body;
      if (!Array.isArray(tickers)) {
        res.status(400).json({ success: false, message: 'tickers must be an array' });
        return;
      }
      const sub = await subscriptionService.setUserSubscriptions(userId, tickers);
      res.json({ success: true, data: sub.tickers });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message || 'Failed to update subscriptions' });
    }
  },

  async addUserSubscription(req: Request, res: Response) {
    try {
      const userId = (req as any).userId as string;
      const { ticker } = req.params;
      const sub = await subscriptionService.addUserSubscription(userId, ticker);
      res.json({ success: true, data: sub.tickers });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message || 'Failed to add subscription' });
    }
  },

  async removeUserSubscription(req: Request, res: Response) {
    try {
      const userId = (req as any).userId as string;
      const { ticker } = req.params;
      const sub = await subscriptionService.removeUserSubscription(userId, ticker);
      res.json({ success: true, data: sub?.tickers || [] });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message || 'Failed to remove subscription' });
    }
  },
};

export default subscriptionController;

