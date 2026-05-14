import PolymarketSubscription, { IPolymarketSubscription } from '../models/polymarket-subscription.model';

const POLYMARKET_API = 'https://gamma-api.polymarket.com';

export interface MarketDoc {
  market_id: string;
  slug: string;
  question?: string;
  volume?: string;
  endDate?: string;
  active?: boolean;
  outcomePrices?: number[];
}

function safeParseNumberArray(val: unknown): number[] {
  try {
    const arr = JSON.parse(String(val ?? '[]'));
    if (Array.isArray(arr)) return arr.map(Number).filter((n) => !isNaN(n));
  } catch { /* ignore */ }
  return [];
}

/** Fetch the live Polymarket market universe from the public Gamma API. */
async function fetchLiveUniverse(limit = 100): Promise<MarketDoc[]> {
  const url = `${POLYMARKET_API}/markets?active=true&limit=${limit}&order=volume&ascending=false`;
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`Polymarket API error: ${res.status}`);
  const data = await res.json() as Array<Record<string, unknown>>;
  return data.map((m) => ({
    market_id: String(m.conditionId || m.id || ''),
    slug: String(m.slug || ''),
    question: String(m.question || ''),
    volume: String(m.volume || ''),
    endDate: String(m.endDateIso || m.endDate || ''),
    active: Boolean(m.active ?? true),
    outcomePrices: safeParseNumberArray(m.outcomePrices),
  }));
}

class PolymarketSubscriptionService {
  async getUniverse(limit = 100): Promise<MarketDoc[]> {
    return fetchLiveUniverse(limit);
  }

  async getUserSubscriptions(userId: string): Promise<string[]> {
    const sub = await PolymarketSubscription.findOne({ userId });
    return sub?.marketIds || [];
  }

  async setUserSubscriptions(userId: string, marketIds: string[]): Promise<IPolymarketSubscription> {
    return PolymarketSubscription.findOneAndUpdate(
      { userId },
      { marketIds, updatedAt: new Date() },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    ) as Promise<IPolymarketSubscription>;
  }

  async addUserSubscription(userId: string, marketId: string): Promise<IPolymarketSubscription> {
    return PolymarketSubscription.findOneAndUpdate(
      { userId },
      { $addToSet: { marketIds: marketId }, updatedAt: new Date() },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    ) as Promise<IPolymarketSubscription>;
  }

  async removeUserSubscription(userId: string, marketId: string): Promise<IPolymarketSubscription | null> {
    return PolymarketSubscription.findOneAndUpdate(
      { userId },
      { $pull: { marketIds: marketId }, updatedAt: new Date() },
      { new: true }
    );
  }
}

export default new PolymarketSubscriptionService();
