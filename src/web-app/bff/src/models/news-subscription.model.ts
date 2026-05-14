import mongoose, { Document, Schema } from 'mongoose';

export interface INewsSubscription extends Document {
  userId: string;
  topics: string[];
  updatedAt: Date;
}

const NewsSubscriptionSchema = new Schema<INewsSubscription>(
  {
    userId: { type: String, required: true, index: true, unique: true },
    topics: { type: [String], default: [] },
  },
  { timestamps: true, collection: 'news_subscriptions' },
);

export default mongoose.model<INewsSubscription>('NewsSubscription', NewsSubscriptionSchema);
