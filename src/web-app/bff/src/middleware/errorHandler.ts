import { Request, Response, NextFunction } from 'express';

export interface ApiError extends Error {
  status?: number;
  code?: string;
}

export const errorHandler = (
  err: ApiError,
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  const status = err.status || 500;
  const message = err.message || 'Internal Server Error';
  const code = err.code || 'INTERNAL_ERROR';

  console.error(`[${new Date().toISOString()}] Error:`, {
    status,
    code,
    message,
    path: req.path,
    method: req.method,
  });

  res.status(status).json({
    error: {
      code,
      message,
      status,
    },
  });
};

export const notFoundHandler = (req: Request, res: Response, next: NextFunction): void => {
  const error: ApiError = new Error(`Route not found: ${req.method} ${req.path}`);
  error.status = 404;
  error.code = 'NOT_FOUND';
  next(error);
};
