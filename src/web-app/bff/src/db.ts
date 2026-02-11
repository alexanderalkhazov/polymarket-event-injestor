import mongoose from 'mongoose';
import config from './config';

export const connectDB = async (): Promise<void> => {
  try {
    await mongoose.connect(config.mongodb.uri, {
      dbName: config.mongodb.db,
    });
    console.log('MongoDB connected successfully');
  } catch (error) {
    console.error('MongoDB connection error:', error);
    process.exit(1);
  }
};

export default mongoose;
