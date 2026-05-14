import config from '../config';

export interface PlaceOrderInput {
  accountId: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  quantity: number;
  orderType: 'MKT' | 'LMT' | 'STP' | 'STP LMT';
  limitPrice?: number;
  stopPrice?: number;
  tif?: 'DAY' | 'GTC';
  outsideRth?: boolean;
  attachStopLoss?: {
    stopPrice: number;
  };
}

export interface PlaceOrderResult {
  brokerOrderId?: string;
  raw: unknown;
  attachedStopLossOrderId?: string;
}

export interface BrokerHealthSnapshot {
  authenticated: boolean;
  raw: unknown;
}

export interface BrokerTradingSnapshot {
  accounts: unknown;
  summary: unknown;
  ledger: unknown;
  positions: unknown;
  openOrders: unknown;
  health: BrokerHealthSnapshot;
}

class IbkrBrokerService {
  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const url = `${config.ibkr.base_url.replace(/\/$/, '')}/${path.replace(/^\//, '')}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.ibkr.timeout_ms);

    try {
      const response = await fetch(url, {
        ...init,
        headers: {
          'Content-Type': 'application/json',
          ...(init?.headers || {}),
        },
        signal: controller.signal,
      });

      const text = await response.text();
      const parsed = text ? JSON.parse(text) : null;

      if (!response.ok) {
        throw new Error(`IBKR ${response.status}: ${text || 'unknown error'}`);
      }

      return parsed as T;
    } finally {
      clearTimeout(timeout);
    }
  }

  private async resolveConid(symbol: string): Promise<string> {
    const query = new URLSearchParams({ symbol, name: true as unknown as string, secType: 'STK' });
    const results = await this.request<Array<{ conid?: number | string }>>(`iserver/secdef/search?${query}`);

    const first = results?.find((x) => x.conid !== undefined && x.conid !== null);
    if (!first?.conid) {
      throw new Error(`Could not resolve IBKR conid for ${symbol}`);
    }

    return String(first.conid);
  }

  private extractOrderId(result: unknown): string | undefined {
    if (!result) return undefined;
    if (Array.isArray(result) && result.length > 0) {
      const entry = result[0] as Record<string, unknown>;
      const orderId = entry.order_id || entry.id;
      if (orderId) return String(orderId);
    }
    if (typeof result === 'object') {
      const entry = result as Record<string, unknown>;
      const orderId = entry.order_id || entry.id;
      if (orderId) return String(orderId);
    }
    return undefined;
  }

  async placeOrder(input: PlaceOrderInput): Promise<PlaceOrderResult> {
    const conid = await this.resolveConid(input.symbol);
    const tif = input.tif || 'DAY';
    const outsideRth = input.outsideRth ?? false;

    const baseOrder: Record<string, unknown> = {
      conid,
      side: input.side,
      orderType: input.orderType,
      quantity: input.quantity,
      tif,
      outsideRTH: outsideRth,
      cOID: `ord-${Date.now()}-${Math.floor(Math.random() * 100000)}`,
    };

    if (input.orderType === 'LMT' || input.orderType === 'STP LMT') {
      baseOrder.price = input.limitPrice;
    }
    if (input.orderType === 'STP' || input.orderType === 'STP LMT') {
      baseOrder.auxPrice = input.stopPrice;
    }

    const placeResult = await this.request<unknown>(`iserver/account/${input.accountId}/orders`, {
      method: 'POST',
      body: JSON.stringify({ orders: [baseOrder] }),
    });

    const brokerOrderId = this.extractOrderId(placeResult);
    let attachedStopLossOrderId: string | undefined;

    if (input.attachStopLoss?.stopPrice) {
      const stopSide = input.side === 'BUY' ? 'SELL' : 'BUY';
      const stopOrder = {
        conid,
        side: stopSide,
        orderType: 'STP',
        quantity: input.quantity,
        tif,
        outsideRTH: outsideRth,
        auxPrice: input.attachStopLoss.stopPrice,
        cOID: `sl-${Date.now()}-${Math.floor(Math.random() * 100000)}`,
      };

      const stopResult = await this.request<unknown>(`iserver/account/${input.accountId}/orders`, {
        method: 'POST',
        body: JSON.stringify({ orders: [stopOrder] }),
      });

      attachedStopLossOrderId = this.extractOrderId(stopResult);
    }

    return {
      brokerOrderId,
      raw: placeResult,
      attachedStopLossOrderId,
    };
  }

  async cancelOrder(accountId: string, orderId: string): Promise<unknown> {
    return this.request<unknown>(`iserver/account/${accountId}/order/${orderId}`, {
      method: 'DELETE',
    });
  }

  async getAuthStatus(): Promise<BrokerHealthSnapshot> {
    try {
      const raw = await this.request<unknown>('iserver/auth/status');
      const authenticated = Array.isArray(raw)
        ? raw.some((item) => typeof item === 'object' && item !== null && Boolean((item as Record<string, unknown>).authenticated))
        : Boolean((raw as Record<string, unknown> | null)?.authenticated);

      return { authenticated, raw };
    } catch (error) {
      return { authenticated: false, raw: { error: error instanceof Error ? error.message : 'Unknown error' } };
    }
  }

  async getAccounts(): Promise<unknown> {
    return this.request<unknown>('iserver/accounts');
  }

  async getAccountSummary(accountId: string): Promise<unknown> {
    return this.request<unknown>(`portfolio/${accountId}/summary`);
  }

  async getAccountLedger(accountId: string): Promise<unknown> {
    return this.request<unknown>(`portfolio/${accountId}/ledger`);
  }

  async getOpenOrders(): Promise<unknown> {
    return this.request<unknown>('iserver/account/orders');
  }

  async getPositions(accountId: string): Promise<unknown> {
    return this.request<unknown>(`portfolio/${accountId}/positions/0`);
  }

  async getTradingSnapshot(accountId: string): Promise<BrokerTradingSnapshot> {
    const [health, accounts, summary, ledger, positions, openOrders] = await Promise.all([
      this.getAuthStatus(),
      this.getAccounts().catch((error) => ({ error: error instanceof Error ? error.message : 'Failed to load accounts' })),
      this.getAccountSummary(accountId).catch((error) => ({ error: error instanceof Error ? error.message : 'Failed to load summary' })),
      this.getAccountLedger(accountId).catch((error) => ({ error: error instanceof Error ? error.message : 'Failed to load ledger' })),
      this.getPositions(accountId).catch((error) => ({ error: error instanceof Error ? error.message : 'Failed to load positions' })),
      this.getOpenOrders().catch((error) => ({ error: error instanceof Error ? error.message : 'Failed to load orders' })),
    ]);

    return { health, accounts, summary, ledger, positions, openOrders };
  }

  /** Search IBKR security definitions by symbol/name across any security type. */
  async searchSecurities(symbol: string, secType = 'STK'): Promise<IbkrSecDef[]> {
    const params = new URLSearchParams({ symbol, name: 'true', secType });
    return this.request<IbkrSecDef[]>(`iserver/secdef/search?${params}`);
  }
}

export interface IbkrSecDef {
  conid: number;
  symbol: string;
  description: string;
  secType?: string;
  sections?: Array<{ secType: string; exchange?: string }>;
}

export default new IbkrBrokerService();
