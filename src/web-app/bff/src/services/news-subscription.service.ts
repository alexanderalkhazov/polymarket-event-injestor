import NewsSubscription from '../models/news-subscription.model';

class NewsSubscriptionService {
  async getUserTopics(userId: string): Promise<string[]> {
    const doc = await NewsSubscription.findOne({ userId });
    return doc?.topics ?? [];
  }

  async setUserTopics(userId: string, topics: string[]): Promise<string[]> {
    const doc = await NewsSubscription.findOneAndUpdate(
      { userId },
      { $set: { topics } },
      { upsert: true, new: true },
    );
    return doc.topics;
  }

  async addTopic(userId: string, topic: string): Promise<string[]> {
    const doc = await NewsSubscription.findOneAndUpdate(
      { userId },
      { $addToSet: { topics: topic } },
      { upsert: true, new: true },
    );
    return doc.topics;
  }

  async removeTopic(userId: string, topic: string): Promise<string[]> {
    const doc = await NewsSubscription.findOneAndUpdate(
      { userId },
      { $pull: { topics: topic } },
      { new: true },
    );
    return doc?.topics ?? [];
  }
}

export default new NewsSubscriptionService();
