import StockSubscription, { IStockSubscription } from '../models/stock-subscription.model';

class SubscriptionService {
  async getUserSubscriptions(userId: string): Promise<string[]> {
    const sub = await StockSubscription.findOne({ userId });
    return sub?.tickers || [];
  }

  async setUserSubscriptions(userId: string, tickers: string[]): Promise<IStockSubscription> {
    return StockSubscription.findOneAndUpdate(
      { userId },
      { tickers, updatedAt: new Date() },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    ) as Promise<IStockSubscription>;
  }

  async addUserSubscription(userId: string, ticker: string): Promise<IStockSubscription> {
    return StockSubscription.findOneAndUpdate(
      { userId },
      { $addToSet: { tickers: ticker }, updatedAt: new Date() },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    ) as Promise<IStockSubscription>;
  }

  async removeUserSubscription(userId: string, ticker: string): Promise<IStockSubscription | null> {
    return StockSubscription.findOneAndUpdate(
      { userId },
      { $pull: { tickers: ticker }, updatedAt: new Date() },
      { new: true }
    );
  }
}

export default new SubscriptionService();
