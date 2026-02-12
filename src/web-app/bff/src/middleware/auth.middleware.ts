import { Request, Response, NextFunction } from 'express';
import authService from '../services/auth.service';

export const authenticate = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    // Get token from header
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({
        success: false,
        message: 'No token provided. Please authenticate.',
      });
      return;
    }

    // Extract token
    const token = authHeader.substring(7); // Remove 'Bearer ' prefix

    // Verify token
    const decoded = authService.verifyToken(token);

    // Attach userId to request object
    (req as any).userId = decoded.userId;

    next();
  } catch (error: any) {
    res.status(401).json({
      success: false,
      message: error.message || 'Authentication failed',
    });
  }
};
