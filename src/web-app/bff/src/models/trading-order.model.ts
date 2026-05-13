import mongoose, { Document, Schema } from 'mongoose';

export type OrderSide = 'BUY' | 'SELL';
export type OrderType = 'MKT' | 'LMT' | 'STP' | 'STP LMT';

export interface ITradingOrder extends Document {
  userId: string;
  broker: 'ibkr';
  accountId: string;
  symbol: string;
  side: OrderSide;
  orderType: OrderType;
  quantity: number;
  limitPrice?: number;
  stopPrice?: number;
  status: 'pending' | 'submitted' | 'partially_filled' | 'filled' | 'cancelled' | 'rejected';
  brokerOrderId?: string;
  brokerPayload?: unknown;
  attachedStopLossOrderId?: string;
  estimatedNotionalUsd: number;
  rejectionReason?: string;
  createdAt: Date;
  updatedAt: Date;
}

const tradingOrderSchema = new Schema<ITradingOrder>(
  {
    userId: { type: String, required: true, index: true },
    broker: { type: String, enum: ['ibkr'], default: 'ibkr', required: true },
    accountId: { type: String, required: true },
    symbol: { type: String, required: true, uppercase: true, trim: true, index: true },
    side: { type: String, enum: ['BUY', 'SELL'], required: true },
    orderType: { type: String, enum: ['MKT', 'LMT', 'STP', 'STP LMT'], required: true },
    quantity: { type: Number, required: true, min: 0.000001 },
    limitPrice: { type: Number },
    stopPrice: { type: Number },
    status: {
      type: String,
      enum: ['pending', 'submitted', 'partially_filled', 'filled', 'cancelled', 'rejected'],
      default: 'pending',
      index: true,
    },
    brokerOrderId: { type: String, index: true },
    brokerPayload: { type: Schema.Types.Mixed },
    attachedStopLossOrderId: { type: String },
    estimatedNotionalUsd: { type: Number, required: true, min: 0 },
    rejectionReason: { type: String },
  },
  {
    timestamps: true,
  }
);

tradingOrderSchema.index({ userId: 1, createdAt: -1 });

const TradingOrder = mongoose.model<ITradingOrder>('TradingOrder', tradingOrderSchema);

export default TradingOrder;
