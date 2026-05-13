import mongoose, { Document, Schema } from 'mongoose';

export interface ITradingAccount extends Document {
  userId: string;
  ibkrAccountId: string;
  broker: 'ibkr';
  paper: boolean;
  tradingEnabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const tradingAccountSchema = new Schema<ITradingAccount>(
  {
    userId: {
      type: String,
      required: true,
      index: true,
    },
    ibkrAccountId: {
      type: String,
      required: true,
      trim: true,
    },
    broker: {
      type: String,
      enum: ['ibkr'],
      default: 'ibkr',
      required: true,
    },
    paper: {
      type: Boolean,
      default: true,
      required: true,
    },
    tradingEnabled: {
      type: Boolean,
      default: true,
      required: true,
    },
  },
  {
    timestamps: true,
  }
);

tradingAccountSchema.index({ userId: 1, broker: 1 }, { unique: true });

const TradingAccount = mongoose.model<ITradingAccount>('TradingAccount', tradingAccountSchema);

export default TradingAccount;
