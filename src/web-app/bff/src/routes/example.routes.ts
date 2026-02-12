import { Router, Request, Response, NextFunction } from 'express';
import { exampleController } from '../controllers/example.controller';

const router = Router();

/**
 * Market Routes
 */
router.get('/markets/search', (req: Request, res: Response, next: NextFunction) =>
  exampleController.searchMarkets(req, res, next)
);

router.get('/markets/:marketId', (req: Request, res: Response, next: NextFunction) =>
  exampleController.getMarket(req, res, next)
);

router.get('/markets/:marketId/conviction-history', (req: Request, res: Response, next: NextFunction) =>
  exampleController.getConvictionHistory(req, res, next)
);

/**
 * Health Check
 */
router.get('/health', (req: Request, res: Response, next: NextFunction) =>
  exampleController.healthCheck(req, res, next)
);

export default router;
