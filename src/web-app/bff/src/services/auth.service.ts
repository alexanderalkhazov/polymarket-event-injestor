import jwt from 'jsonwebtoken';
import User, { IUser } from '../models/user.model';
import config from '../config';

export interface RegisterInput {
  email: string;
  password: string;
  name: string;
}

export interface LoginInput {
  email: string;
  password: string;
}

export interface UpdateProfileInput {
  displayName?: string;
  avatarUrl?: string;
  timezone?: string;
  country?: string;
  bio?: string;
  tradingProfile?: Partial<IUser['tradingProfile']>;
  notifications?: Partial<IUser['notifications']>;
  onboardingComplete?: boolean;
}

function serializeUser(user: IUser) {
  return {
    id: user._id.toString(),
    email: user.email,
    name: user.name,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl,
    timezone: user.timezone,
    country: user.country,
    bio: user.bio,
    tier: user.tier,
    tradingProfile: user.tradingProfile,
    notifications: user.notifications,
    onboardingComplete: user.onboardingComplete,
    lastLoginAt: user.lastLoginAt,
    createdAt: user.createdAt,
  };
}

export interface AuthResponse {
  user: ReturnType<typeof serializeUser>;
  token: string;
}

class AuthService {
  private generateToken(userId: string): string {
    return jwt.sign({ userId }, config.jwt.secret, {
      expiresIn: config.jwt.expiresIn,
    } as any);
  }

  async register(input: RegisterInput): Promise<AuthResponse> {
    const { email, password, name } = input;

    const existingUser = await User.findOne({ email });
    if (existingUser) throw new Error('User with this email already exists');

    const user = await User.create({ email, password, name });
    const token = this.generateToken(user._id.toString());

    return { user: serializeUser(user), token };
  }

  async login(input: LoginInput): Promise<AuthResponse> {
    const { email, password } = input;

    const user = await User.findOne({ email }).select('+password');
    if (!user) throw new Error('Invalid email or password');

    const isPasswordValid = await user.comparePassword(password);
    if (!isPasswordValid) throw new Error('Invalid email or password');

    user.lastLoginAt = new Date();
    await user.save();

    const token = this.generateToken(user._id.toString());
    return { user: serializeUser(user), token };
  }

  verifyToken(token: string): { userId: string } {
    try {
      const decoded = jwt.verify(token, config.jwt.secret) as { userId: string };
      return decoded;
    } catch {
      throw new Error('Invalid or expired token');
    }
  }

  async getUserById(userId: string): Promise<IUser | null> {
    return User.findById(userId);
  }

  async updateProfile(userId: string, input: UpdateProfileInput): Promise<IUser> {
    const update: Record<string, unknown> = {};

    if (input.displayName !== undefined) update['displayName'] = input.displayName;
    if (input.avatarUrl !== undefined) update['avatarUrl'] = input.avatarUrl;
    if (input.timezone !== undefined) update['timezone'] = input.timezone;
    if (input.country !== undefined) update['country'] = input.country;
    if (input.bio !== undefined) update['bio'] = input.bio;
    if (input.onboardingComplete !== undefined) update['onboardingComplete'] = input.onboardingComplete;

    if (input.tradingProfile) {
      for (const [k, v] of Object.entries(input.tradingProfile)) {
        update[`tradingProfile.${k}`] = v;
      }
    }

    if (input.notifications) {
      for (const [k, v] of Object.entries(input.notifications)) {
        update[`notifications.${k}`] = v;
      }
    }

    const user = await User.findByIdAndUpdate(userId, { $set: update }, { new: true, runValidators: true });
    if (!user) throw new Error('User not found');
    return user;
  }

  serializeUser = serializeUser;
}

export default new AuthService();

