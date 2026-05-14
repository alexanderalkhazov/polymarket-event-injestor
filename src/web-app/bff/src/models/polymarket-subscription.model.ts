import mongoose, { Document, Schema } from 'mongoose';

export interface IPolymarketSubscription extends Document {
  userId: string;
  marketIds: string[];
  updatedAt: Date;
}

const polymarketSubscriptionSchema = new Schema<IPolymarketSubscription>({
  userId: { type: String, required: true, index: true },
  marketIds: { type: [String], required: true, default: [] },
  updatedAt: { type: Date, default: Date.now },
});

// Explicit collection name with underscore — single collection for per-user subscriptions.
// The seeded global universe collection is no longer needed; the universe is fetched live
// from the Polymarket Gamma API.
export default mongoose.model<IPolymarketSubscription>(
  'PolymarketSubscription',
  polymarketSubscriptionSchema,
  'polymarket_subscriptions'
);
