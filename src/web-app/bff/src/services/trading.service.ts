import config from '../config';
import TradingAccount from '../models/trading-account.model';
import TradingOrder, { ITradingOrder, OrderSide, OrderType } from '../models/trading-order.model';
import ibkrBrokerService from './ibkr-broker.service';

export interface ConnectAccountInput {
  userId: string;
  ibkrAccountId: string;
}

export interface CreateOrderInput {
  userId: string;
  symbol: string;
  side: OrderSide;
  quantity: number;
  orderType: OrderType;
  limitPrice?: number;
  stopPrice?: number;
  tif?: 'DAY' | 'GTC';
  outsideRth?: boolean;
  attachStopLoss?: {
    stopPrice: number;
  };
}

class TradingService {
  async connectAccount(input: ConnectAccountInput) {
    const { userId, ibkrAccountId } = input;

    const account = await TradingAccount.findOneAndUpdate(
      { userId, broker: 'ibkr' },
      {
        userId,
        ibkrAccountId,
        broker: 'ibkr',
        paper: config.ibkr.paper,
        tradingEnabled: true,
      },
      {
        upsert: true,
        new: true,
        setDefaultsOnInsert: true,
      }
    );

    return account;
  }

  async getAccount(userId: string) {
    return TradingAccount.findOne({ userId, broker: 'ibkr' });
  }

  private async validateRisk(userId: string, estimatedNotionalUsd: number): Promise<void> {
    if (estimatedNotionalUsd > config.trading.max_order_notional_usd) {
      throw new Error(
        `Order notional $${estimatedNotionalUsd.toFixed(2)} exceeds max $${config.trading.max_order_notional_usd.toFixed(2)}`
      );
    }

    // Basic v1 daily loss guardrail using locally known rejected/closed losses when recorded.
    // If you later ingest real fills/PnL, replace this with broker-truth PnL.
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const orders = await TradingOrder.find({
      userId,
      createdAt: { $gte: today },
      status: { $in: ['filled'] },
    });

    const realizedLossApprox = orders.reduce((acc, o) => {
      // Placeholder for v1; can be replaced when fill PnL is available.
      return acc;
    }, 0);

    if (Math.abs(realizedLossApprox) > config.trading.max_daily_loss_usd) {
      throw new Error('Daily loss limit reached. Trading is disabled for today.');
    }
  }

  private estimateNotionalUsd(input: CreateOrderInput): number {
    const referencePrice = input.limitPrice || input.stopPrice || 100;
    return Math.abs(input.quantity * referencePrice);
  }

  async createOrder(input: CreateOrderInput): Promise<ITradingOrder> {
    const account = await this.getAccount(input.userId);
    if (!account) {
      throw new Error('No IBKR account connected. Connect account first.');
    }
    if (!account.tradingEnabled) {
      throw new Error('Trading is disabled for this account.');
    }

    const estimatedNotionalUsd = this.estimateNotionalUsd(input);
    await this.validateRisk(input.userId, estimatedNotionalUsd);

    if ((input.orderType === 'LMT' || input.orderType === 'STP LMT') && !input.limitPrice) {
      throw new Error('limitPrice is required for LMT and STP LMT orders');
    }

    if ((input.orderType === 'STP' || input.orderType === 'STP LMT') && !input.stopPrice) {
      throw new Error('stopPrice is required for STP and STP LMT orders');
    }

    const order = await TradingOrder.create({
      userId: input.userId,
      broker: 'ibkr',
      accountId: account.ibkrAccountId,
      symbol: input.symbol.toUpperCase(),
      side: input.side,
      orderType: input.orderType,
      quantity: input.quantity,
      limitPrice: input.limitPrice,
      stopPrice: input.stopPrice,
      status: 'pending',
      estimatedNotionalUsd,
    });

    try {
      const brokerRes = await ibkrBrokerService.placeOrder({
        accountId: account.ibkrAccountId,
        symbol: input.symbol.toUpperCase(),
        side: input.side,
        quantity: input.quantity,
        orderType: input.orderType,
        limitPrice: input.limitPrice,
        stopPrice: input.stopPrice,
        tif: input.tif,
        outsideRth: input.outsideRth,
        attachStopLoss: input.attachStopLoss,
      });

      order.status = 'submitted';
      order.brokerOrderId = brokerRes.brokerOrderId;
      order.brokerPayload = brokerRes.raw;
      order.attachedStopLossOrderId = brokerRes.attachedStopLossOrderId;
      await order.save();
      return order;
    } catch (error: any) {
      order.status = 'rejected';
      order.rejectionReason = error.message || 'Broker submission failed';
      await order.save();
      throw error;
    }
  }

  async cancelOrder(userId: string, localOrderId: string): Promise<ITradingOrder> {
    const order = await TradingOrder.findOne({ _id: localOrderId, userId });
    if (!order) {
      throw new Error('Order not found');
    }

    if (!order.brokerOrderId) {
      throw new Error('Order has no brokerOrderId; cannot cancel');
    }

    await ibkrBrokerService.cancelOrder(order.accountId, order.brokerOrderId);
    order.status = 'cancelled';
    await order.save();
    return order;
  }

  async listOrders(userId: string) {
    return TradingOrder.find({ userId }).sort({ createdAt: -1 }).limit(100);
  }

  async listBrokerOpenOrders(_userId: string) {
    return ibkrBrokerService.getOpenOrders();
  }

  async listPositions(userId: string) {
    const account = await this.getAccount(userId);
    if (!account) {
      throw new Error('No IBKR account connected. Connect account first.');
    }
    return ibkrBrokerService.getPositions(account.ibkrAccountId);
  }

  async getTradingSnapshot(userId: string) {
    const account = await this.getAccount(userId);
    if (!account) {
      throw new Error('No IBKR account connected. Connect account first.');
    }

    const snapshot = await ibkrBrokerService.getTradingSnapshot(account.ibkrAccountId);

    return {
      account,
      snapshot,
    };
  }

  private normalizeAccountIds(accounts: unknown): string[] {
    if (!Array.isArray(accounts)) {
      return [];
    }

    return accounts
      .map((entry) => {
        if (typeof entry === 'string') {
          return entry;
        }

        if (entry && typeof entry === 'object') {
          const record = entry as Record<string, unknown>;
          const candidate = record.accountId || record.account || record.acct || record.id;
          if (typeof candidate === 'string' && candidate.trim()) {
            return candidate.trim();
          }
        }

        return null;
      })
      .filter((value): value is string => Boolean(value));
  }

  private pickNumber(source: unknown, keys: string[]): number | null {
    if (!source || typeof source !== 'object') {
      return null;
    }

    const record = source as Record<string, unknown>;
    for (const key of keys) {
      const value = record[key];
      if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
      }
      if (typeof value === 'string' && value.trim()) {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) {
          return parsed;
        }
      }
    }

    return null;
  }

  private normalizePositions(rawPositions: unknown) {
    if (!Array.isArray(rawPositions)) {
      return [];
    }

    return rawPositions
      .filter((position) => position && typeof position === 'object')
      .map((position) => {
        const record = position as Record<string, unknown>;
        return {
          symbol: String(record.symbol || record.localSymbol || record.ticker || record.description || 'UNKNOWN'),
          quantity: this.pickNumber(record, ['position', 'qty', 'quantity', 'shares']),
          marketPrice: this.pickNumber(record, ['marketPrice', 'markPrice', 'lastPrice', 'avgPrice']),
          marketValue: this.pickNumber(record, ['marketValue', 'market_value', 'value']),
          unrealizedPnl: this.pickNumber(record, ['unrealizedPnl', 'unrealized_pnl', 'upl']),
          realizedPnl: this.pickNumber(record, ['realizedPnl', 'realized_pnl', 'rpl']),
          avgCost: this.pickNumber(record, ['avgCost', 'averageCost', 'costBasisPrice', 'cost_basis']),
          raw: record,
        };
      });
  }

  private normalizeOpenOrders(rawOrders: unknown) {
    if (!Array.isArray(rawOrders)) {
      return [];
    }

    return rawOrders
      .filter((order) => order && typeof order === 'object')
      .map((order) => {
        const record = order as Record<string, unknown>;
        return {
          orderId: String(record.orderId || record.id || record.order_id || ''),
          symbol: String(record.symbol || record.localSymbol || record.ticker || record.description || 'UNKNOWN'),
          side: String(record.side || record.action || ''),
          orderType: String(record.orderType || record.order_type || record.type || ''),
          status: String(record.status || record.orderStatus || ''),
          quantity: this.pickNumber(record, ['quantity', 'remainingQuantity', 'totalQuantity', 'qty']),
          raw: record,
        };
      });
  }

  private normalizeFunds(summary: unknown, ledger: unknown) {
    const summaryRecord = summary && typeof summary === 'object' ? (summary as Record<string, unknown>) : {};
    const ledgerRecord = ledger && typeof ledger === 'object' ? (ledger as Record<string, unknown>) : {};

    const cash = this.pickNumber(summaryRecord, ['cash', 'Cash', 'availableFunds', 'available_funds']);
    const buyingPower = this.pickNumber(summaryRecord, ['buyingPower', 'BuyingPower', 'buying_power']);
    const netLiquidation = this.pickNumber(summaryRecord, ['netLiquidation', 'NetLiquidation', 'net_liquidation']);
    const unrealizedPnl = this.pickNumber(summaryRecord, ['unrealizedPnl', 'UnrealizedPnL', 'upl']);
    const realizedPnl = this.pickNumber(summaryRecord, ['realizedPnl', 'RealizedPnL', 'dpl']);

    return {
      cash,
      buyingPower,
      netLiquidation,
      unrealizedPnl,
      realizedPnl,
      ledgerKeys: Object.keys(ledgerRecord),
      summaryKeys: Object.keys(summaryRecord),
    };
  }

  async getNormalizedDashboard(userId: string) {
    const account = await this.getAccount(userId);
    if (!account) {
      throw new Error('No IBKR account connected. Connect account first.');
    }

    const snapshot = await ibkrBrokerService.getTradingSnapshot(account.ibkrAccountId);
    const accountIds = this.normalizeAccountIds(snapshot.accounts);
    const positions = this.normalizePositions(snapshot.positions);
    const openOrders = this.normalizeOpenOrders(snapshot.openOrders);
    const funds = this.normalizeFunds(snapshot.summary, snapshot.ledger);

    return {
      account,
      broker: {
        authenticated: snapshot.health.authenticated,
        accountIds,
        lastSyncedAt: new Date().toISOString(),
      },
      funds,
      positions,
      openOrders,
      raw: {
        summary: snapshot.summary,
        ledger: snapshot.ledger,
      },
    };
  }

  async getBrokerHealth() {
    return ibkrBrokerService.getAuthStatus();
  }
}

export default new TradingService();
