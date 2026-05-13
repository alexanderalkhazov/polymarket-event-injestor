import { Request, Response } from 'express';
import tradingService from '../services/trading.service';

class TradingController {
  async connectAccount(req: Request, res: Response): Promise<void> {
    try {
      const userId = (req as any).userId as string;
      const { ibkrAccountId } = req.body;

      if (!ibkrAccountId) {
        res.status(400).json({ success: false, message: 'ibkrAccountId is required' });
        return;
      }

      const account = await tradingService.connectAccount({ userId, ibkrAccountId });
      res.status(200).json({ success: true, data: account });
    } catch (error: any) {
      res.status(400).json({ success: false, message: error.message || 'Failed to connect account' });
    }
  }

  async getAccount(req: Request, res: Response): Promise<void> {
    try {
      const userId = (req as any).userId as string;
      const account = await tradingService.getAccount(userId);
      res.status(200).json({ success: true, data: account });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message || 'Failed to get account' });
    }
  }

  async createOrder(req: Request, res: Response): Promise<void> {
    try {
      const userId = (req as any).userId as string;
      const { symbol, side, quantity, orderType, limitPrice, stopPrice, tif, outsideRth, attachStopLoss } = req.body;

      if (!symbol || !side || !quantity || !orderType) {
        res.status(400).json({
          success: false,
          message: 'symbol, side, quantity, and orderType are required',
        });
        return;
      }

      const order = await tradingService.createOrder({
        userId,
        symbol,
        side,
        quantity: Number(quantity),
        orderType,
        limitPrice: limitPrice !== undefined ? Number(limitPrice) : undefined,
        stopPrice: stopPrice !== undefined ? Number(stopPrice) : undefined,
        tif,
        outsideRth,
        attachStopLoss,
      });

      res.status(201).json({ success: true, data: order });
    } catch (error: any) {
      res.status(400).json({ success: false, message: error.message || 'Failed to place order' });
    }
  }

  async cancelOrder(req: Request, res: Response): Promise<void> {
    try {
      const userId = (req as any).userId as string;
      const { orderId } = req.params;

      const order = await tradingService.cancelOrder(userId, orderId);
      res.status(200).json({ success: true, data: order });
    } catch (error: any) {
      res.status(400).json({ success: false, message: error.message || 'Failed to cancel order' });
    }
  }

  async listOrders(req: Request, res: Response): Promise<void> {
    try {
      const userId = (req as any).userId as string;
      const orders = await tradingService.listOrders(userId);
      res.status(200).json({ success: true, data: orders });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message || 'Failed to list orders' });
    }
  }

  async listBrokerOpenOrders(req: Request, res: Response): Promise<void> {
    try {
      const userId = (req as any).userId as string;
      const orders = await tradingService.listBrokerOpenOrders(userId);
      res.status(200).json({ success: true, data: orders });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message || 'Failed to list broker orders' });
    }
  }

  async listPositions(req: Request, res: Response): Promise<void> {
    try {
      const userId = (req as any).userId as string;
      const positions = await tradingService.listPositions(userId);
      res.status(200).json({ success: true, data: positions });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message || 'Failed to list positions' });
    }
  }

  async getSnapshot(req: Request, res: Response): Promise<void> {
    try {
      const userId = (req as any).userId as string;
      const data = await tradingService.getTradingSnapshot(userId);
      res.status(200).json({ success: true, data });
    } catch (error: any) {
      res.status(400).json({ success: false, message: error.message || 'Failed to load trading snapshot' });
    }
  }

  async getDashboard(req: Request, res: Response): Promise<void> {
    try {
      const userId = (req as any).userId as string;
      const data = await tradingService.getNormalizedDashboard(userId);
      res.status(200).json({ success: true, data });
    } catch (error: any) {
      res.status(400).json({ success: false, message: error.message || 'Failed to load trading dashboard' });
    }
  }

  async getBrokerHealth(req: Request, res: Response): Promise<void> {
    try {
      const data = await tradingService.getBrokerHealth();
      res.status(200).json({ success: true, data });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message || 'Failed to load broker health' });
    }
  }
}

export default new TradingController();
