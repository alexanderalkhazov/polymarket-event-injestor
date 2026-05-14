import { Request, Response } from 'express';
import TradingAccount from '../models/trading-account.model';
import ibkrBrokerService from '../services/ibkr-broker.service';

const ibController = {
  async getStatus(req: Request, res: Response) {
    try {
      const userId = (req as any).userId as string;
      const account = await TradingAccount.findOne({ userId, broker: 'ibkr' });
      const ibkrStatus = await ibkrBrokerService.getAuthStatus();
      res.json({
        connected: Boolean(account && ibkrStatus.authenticated),
        accountId: account?.ibkrAccountId || null,
        ibkrStatus,
      });
    } catch (error: any) {
      res.status(500).json({ connected: false, error: error.message || 'Failed to get IB status' });
    }
  },

  async connect(_req: Request, res: Response) {
    try {
      // Trigger IBKR re-authentication via the broker health check as a connectivity probe
      const result = await ibkrBrokerService.getAuthStatus();
      res.json({ success: true, result });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message || 'Failed to connect to IBKR' });
    }
  },
};

export default ibController;
