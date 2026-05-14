import { Request, Response } from 'express';
import newsSubscriptionService from '../services/news-subscription.service';

/** All available curated news topics returned to clients */
export const NEWS_TOPIC_CATALOG = [
  {
    category: 'Geopolitics',
    description: 'Wars, diplomacy, international relations, alliances',
    topics: [
      'Russia-Ukraine War', 'Middle East Conflict', 'China-Taiwan Tensions',
      'NATO', 'Sanctions', 'Nuclear Threats', 'US-China Relations', 'Iran',
      'North Korea', 'Israel-Gaza',
    ],
  },
  {
    category: 'Trade & Economics',
    description: 'Trade policy, tariffs, economic indicators, supply chains',
    topics: [
      'Trade War', 'Tariffs', 'WTO', 'Supply Chain', 'Inflation',
      'Recession', 'GDP Growth', 'Employment Data', 'Consumer Confidence',
    ],
  },
  {
    category: 'Central Banks & Monetary Policy',
    description: 'Fed, ECB, rate decisions, quantitative easing',
    topics: [
      'Fed Rate Decision', 'ECB Policy', 'Interest Rates', 'Quantitative Easing',
      'Dollar Index', 'Currency Wars', 'BRICS Currency', 'Debt Crisis',
    ],
  },
  {
    category: 'Defense & Weapons',
    description: 'Military spending, arms trade, defense contracts, cyber',
    topics: [
      'Arms Trade', 'Defense Spending', 'Military Technology', 'Weapons Exports',
      'Cybersecurity', 'Drone Warfare', 'Nuclear Proliferation', 'Space Race',
    ],
  },
  {
    category: 'Energy & Commodities',
    description: 'Oil, gas, metals, agricultural commodities, OPEC',
    topics: [
      'Oil Prices', 'OPEC', 'Natural Gas', 'Gold', 'Silver', 'Wheat',
      'Energy Crisis', 'Renewable Energy', 'LNG', 'Copper',
    ],
  },
  {
    category: 'Financial Markets',
    description: 'Market events, earnings, M&A, regulation, crises',
    topics: [
      'Earnings Reports', 'IPO', 'Mergers & Acquisitions', 'Market Crash',
      'Banking Crisis', 'Crypto Regulation', 'SEC Enforcement', 'Short Squeeze',
      'Hedge Funds', 'Private Equity',
    ],
  },
  {
    category: 'Technology & AI',
    description: 'Tech disruption, AI policy, semiconductor wars',
    topics: [
      'AI Regulation', 'Semiconductor War', 'Big Tech Antitrust', 'Chip Sanctions',
      'Quantum Computing', 'Data Privacy', 'Tech Layoffs', 'Deepfakes',
    ],
  },
];

const newsSubscriptionController = {
  async getCatalog(_req: Request, res: Response) {
    res.json({ success: true, data: NEWS_TOPIC_CATALOG });
  },

  async getUserTopics(req: Request, res: Response) {
    try {
      const userId = (req as any).userId as string;
      const topics = await newsSubscriptionService.getUserTopics(userId);
      res.json({ success: true, data: topics });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message });
    }
  },

  async setUserTopics(req: Request, res: Response) {
    try {
      const userId = (req as any).userId as string;
      const { topics } = req.body;
      if (!Array.isArray(topics)) {
        res.status(400).json({ success: false, message: 'topics must be an array' });
        return;
      }
      const updated = await newsSubscriptionService.setUserTopics(userId, topics);
      res.json({ success: true, data: updated });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message });
    }
  },

  async addTopic(req: Request, res: Response) {
    try {
      const userId = (req as any).userId as string;
      const topic = decodeURIComponent(req.params.topic);
      const updated = await newsSubscriptionService.addTopic(userId, topic);
      res.json({ success: true, data: updated });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message });
    }
  },

  async removeTopic(req: Request, res: Response) {
    try {
      const userId = (req as any).userId as string;
      const topic = decodeURIComponent(req.params.topic);
      const updated = await newsSubscriptionService.removeTopic(userId, topic);
      res.json({ success: true, data: updated });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message });
    }
  },
};

export default newsSubscriptionController;
