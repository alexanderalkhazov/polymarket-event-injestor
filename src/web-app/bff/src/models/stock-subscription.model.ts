import mongoose, { Document, Schema } from 'mongoose';

export interface IStockSubscription extends Document {
  userId: string;
  tickers: string[];
  updatedAt: Date;
}

const stockSubscriptionSchema = new Schema<IStockSubscription>({
  userId: { type: String, required: true, index: true },
  tickers: { type: [String], required: true },
  updatedAt: { type: Date, default: Date.now },
});

export default mongoose.model<IStockSubscription>('StockSubscription', stockSubscriptionSchema);
