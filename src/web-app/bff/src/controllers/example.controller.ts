import { Request, Response, NextFunction } from 'express';
import { exampleService } from '../services/example.service';
import { ApiError } from '../middleware/errorHandler';

export class ExampleController {
  /**
   * GET /api/markets/:marketId
   * Get market data by ID
   */
  async getMarket(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { marketId } = req.params;

      if (!marketId) {
        const error: ApiError = new Error('Market ID is required');
        error.status = 400;
        error.code = 'INVALID_REQUEST';
        throw error;
      }

      const market = await exampleService.getMarketData(marketId);

      res.status(200).json({
        success: true,
        data: market,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/markets/:marketId/conviction-history
   * Get conviction event history for a market
   */
  async getConvictionHistory(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { marketId } = req.params;
      const limit = parseInt(req.query.limit as string, 10) || 10;

      if (!marketId) {
        const error: ApiError = new Error('Market ID is required');
        error.status = 400;
        error.code = 'INVALID_REQUEST';
        throw error;
      }

      const history = await exampleService.getConvictionHistory(marketId, limit);

      res.status(200).json({
        success: true,
        data: history,
        count: history.length,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/markets/search
   * Search markets by keyword
   */
  async searchMarkets(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { keyword } = req.query;

      if (!keyword) {
        const error: ApiError = new Error('Keyword is required');
        error.status = 400;
        error.code = 'INVALID_REQUEST';
        throw error;
      }

      const results = await exampleService.searchMarkets(keyword as string);

      res.status(200).json({
        success: true,
        data: results,
        count: results.length,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /health
   * Health check endpoint
   */
  async healthCheck(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      res.status(200).json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      next(error);
    }
  }
}

export const exampleController = new ExampleController();
