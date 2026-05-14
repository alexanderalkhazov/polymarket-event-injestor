import mongoose, { Document, Schema } from 'mongoose';
import bcrypt from 'bcryptjs';

export type RiskTolerance = 'conservative' | 'moderate' | 'aggressive';
export type ExperienceLevel = 'beginner' | 'intermediate' | 'advanced' | 'professional';
export type AssetClass = 'stocks' | 'futures' | 'options' | 'crypto' | 'forex' | 'etfs' | 'prediction_markets';
export type AccountTier = 'free' | 'pro' | 'institutional';

export interface TradingProfile {
  riskTolerance: RiskTolerance;
  experienceLevel: ExperienceLevel;
  preferredAssets: AssetClass[];
  defaultOrderType: 'MKT' | 'LMT';
  maxDailyLossUsd: number;
  maxPositionSizeUsd: number;
  tradingEnabled: boolean;
  paperTrading: boolean;
}

export interface NotificationPreferences {
  emailAlerts: boolean;
  signalAlerts: boolean;
  marketEvents: boolean;
  dailySummary: boolean;
  discordWebhook?: string;
}

export interface IUser extends Document {
  email: string;
  password: string;
  name: string;
  displayName?: string;
  avatarUrl?: string;
  timezone: string;
  country?: string;
  bio?: string;
  tier: AccountTier;
  tradingProfile: TradingProfile;
  notifications: NotificationPreferences;
  onboardingComplete: boolean;
  lastLoginAt?: Date;
  createdAt: Date;
  updatedAt: Date;
  comparePassword(candidatePassword: string): Promise<boolean>;
}

const tradingProfileSchema = new Schema<TradingProfile>(
  {
    riskTolerance: { type: String, enum: ['conservative', 'moderate', 'aggressive'], default: 'moderate' },
    experienceLevel: { type: String, enum: ['beginner', 'intermediate', 'advanced', 'professional'], default: 'beginner' },
    preferredAssets: { type: [String], default: ['stocks'] },
    defaultOrderType: { type: String, enum: ['MKT', 'LMT'], default: 'LMT' },
    maxDailyLossUsd: { type: Number, default: 500 },
    maxPositionSizeUsd: { type: Number, default: 5000 },
    tradingEnabled: { type: Boolean, default: false },
    paperTrading: { type: Boolean, default: true },
  },
  { _id: false }
);

const notificationSchema = new Schema<NotificationPreferences>(
  {
    emailAlerts: { type: Boolean, default: true },
    signalAlerts: { type: Boolean, default: true },
    marketEvents: { type: Boolean, default: true },
    dailySummary: { type: Boolean, default: false },
    discordWebhook: { type: String, default: undefined },
  },
  { _id: false }
);

const userSchema = new Schema<IUser>(
  {
    email: {
      type: String,
      required: [true, 'Email is required'],
      unique: true,
      lowercase: true,
      trim: true,
      match: [/^\S+@\S+\.\S+$/, 'Please provide a valid email address'],
    },
    password: {
      type: String,
      required: [true, 'Password is required'],
      minlength: [6, 'Password must be at least 6 characters long'],
      select: false,
    },
    name: { type: String, required: [true, 'Name is required'], trim: true },
    displayName: { type: String, trim: true },
    avatarUrl: { type: String },
    timezone: { type: String, default: 'UTC' },
    country: { type: String },
    bio: { type: String, maxlength: 300 },
    tier: { type: String, enum: ['free', 'pro', 'institutional'], default: 'free' },
    tradingProfile: { type: tradingProfileSchema, default: () => ({}) },
    notifications: { type: notificationSchema, default: () => ({}) },
    onboardingComplete: { type: Boolean, default: false },
    lastLoginAt: { type: Date },
  },
  { timestamps: true }
);

userSchema.pre('save', async function () {
  if (!this.isModified('password')) return;
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
});

userSchema.methods.comparePassword = async function (
  candidatePassword: string
): Promise<boolean> {
  return bcrypt.compare(candidatePassword, this.password);
};

const User = mongoose.model<IUser>('User', userSchema);

export default User;
