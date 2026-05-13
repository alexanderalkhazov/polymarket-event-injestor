import { useEffect, useMemo, useState } from 'react';
import { MainNav } from './MainNav';
import { tradingAPI, TradingOrderRequest } from '../services/api';
import './TradingPanel.css';

type TradingAccount = {
  userId: string;
  ibkrAccountId: string;
  broker: 'ibkr';
  paper: boolean;
  tradingEnabled: boolean;
  createdAt: string;
  updatedAt: string;
};

type TradingOrderRow = {
  _id: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  orderType: 'MKT' | 'LMT' | 'STP' | 'STP LMT';
  quantity: number;
  limitPrice?: number;
  stopPrice?: number;
  status: string;
  brokerOrderId?: string;
  createdAt: string;
};

type BrokerHealth = {
  authenticated: boolean;
  raw?: any;
};

const formatMoney = (value: unknown): string => {
  const num = typeof value === 'number' ? value : Number(value);
  if (Number.isFinite(num)) {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(num);
  }
  return '—';
};

const renderPrimitive = (value: unknown): string => {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
};

const extractRecordList = (payload: any): Record<string, unknown>[] => {
  if (!payload) return [];
  if (Array.isArray(payload)) return payload.filter((item) => item && typeof item === 'object') as Record<string, unknown>[];
  if (typeof payload === 'object') {
    const nested = (payload as Record<string, unknown>).positions || (payload as Record<string, unknown>).accounts;
    if (Array.isArray(nested)) return nested.filter((item) => item && typeof item === 'object') as Record<string, unknown>[];
  }
  return [];
};

export const TradingPanel = () => {
  const [ibkrAccountId, setIbkrAccountId] = useState('');
  const [form, setForm] = useState<TradingOrderRequest>({
    symbol: 'AAPL',
    side: 'BUY',
    quantity: 1,
    orderType: 'MKT',
    tif: 'DAY',
    outsideRth: false,
  });
  const [attachStopLoss, setAttachStopLoss] = useState(false);
  const [stopLossPrice, setStopLossPrice] = useState<number | ''>('');
  const [status, setStatus] = useState('');
  const [account, setAccount] = useState<TradingAccount | null>(null);
  const [brokerHealth, setBrokerHealth] = useState<BrokerHealth | null>(null);
  const [snapshot, setSnapshot] = useState<any>(null);
  const [orders, setOrders] = useState<TradingOrderRow[]>([]);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const loadAll = async () => {
    setIsRefreshing(true);
    try {
      const [accountRes, snapshotRes, healthRes, ordersRes] = await Promise.allSettled([
        tradingAPI.getAccount(),
        tradingAPI.getSnapshot(),
        tradingAPI.getBrokerHealth(),
        tradingAPI.listOrders(),
      ]);

      if (accountRes.status === 'fulfilled' && accountRes.value.success) {
        setAccount((accountRes.value.data as TradingAccount) || null);
      }
      if (snapshotRes.status === 'fulfilled' && snapshotRes.value.success) {
        setSnapshot(snapshotRes.value.data);
      }
      if (healthRes.status === 'fulfilled' && healthRes.value.success) {
        setBrokerHealth(healthRes.value.data as BrokerHealth);
      }
      if (ordersRes.status === 'fulfilled' && ordersRes.value.success) {
        setOrders((ordersRes.value.data || []) as TradingOrderRow[]);
      }
    } catch {
      // Keep dashboard resilient if one request fails.
    } finally {
      setIsRefreshing(false);
      setLastSyncedAt(new Date().toLocaleTimeString());
    }
  };

  useEffect(() => {
    const refreshIntervalMs = 15000;
    loadAll();
    const refreshTimer = window.setInterval(() => {
      loadAll();
    }, refreshIntervalMs);

    return () => {
      window.clearInterval(refreshTimer);
    };
  }, []);

  const connectAccount = async () => {
    try {
      const res = await tradingAPI.connectAccount(ibkrAccountId);
      setStatus(res.success ? 'IBKR account connected' : res.message || 'Connection failed');
      await loadAll();
    } catch (error: any) {
      setStatus(error?.response?.data?.message || error.message || 'Connection failed');
    }
  };

  const placeOrder = async () => {
    try {
      const payload: TradingOrderRequest = {
        ...form,
        symbol: form.symbol.toUpperCase(),
      };

      if (attachStopLoss && typeof stopLossPrice === 'number') {
        payload.attachStopLoss = { stopPrice: stopLossPrice };
      }

      const res = await tradingAPI.placeOrder(payload);
      setStatus(res.success ? 'Order submitted' : res.message || 'Order failed');
      await loadAll();
    } catch (error: any) {
      setStatus(error?.response?.data?.message || error.message || 'Order failed');
    }
  };

  const cancelOrder = async (orderId: string) => {
    try {
      const res = await tradingAPI.cancelOrder(orderId);
      setStatus(res.success ? 'Order cancelled' : res.message || 'Cancel failed');
      await loadAll();
    } catch (error: any) {
      setStatus(error?.response?.data?.message || error.message || 'Cancel failed');
    }
  };

  const brokerAccounts = useMemo(() => extractRecordList(snapshot?.snapshot?.accounts || snapshot?.accounts), [snapshot]);
  const brokerSummary = snapshot?.snapshot?.summary || snapshot?.summary;
  const brokerLedger = snapshot?.snapshot?.ledger || snapshot?.ledger;
  const brokerPositions = extractRecordList(snapshot?.snapshot?.positions || snapshot?.positions);
  const brokerOpenOrders = extractRecordList(snapshot?.snapshot?.openOrders || snapshot?.openOrders);
  const health = brokerHealth || snapshot?.snapshot?.health;

  return (
    <div className="trading-panel-layout">
      <MainNav />
      <div className="trading-panel-content">
        <div className="trading-panel-grid">
          <section className="trading-panel-card hero-card">
            <div className="hero-topline">Interactive Brokers Paper Trading</div>
            <h1>Broker dashboard and order control</h1>
            <p>
              View account profile, funds, positions, open orders, and recent activity. Place market, limit,
              stop, and stop-limit orders with optional stop-loss protection.
            </p>
            <div className="hero-badges">
              <span className={`hero-badge ${health?.authenticated ? 'ok' : 'warn'}`}>
                {health?.authenticated ? 'Gateway authenticated' : 'Gateway not authenticated'}
              </span>
              <span className={`hero-badge ${account?.paper ? 'ok' : 'warn'}`}>
                {account?.paper ? 'Paper trading' : 'Live trading'}
              </span>
              <span className="hero-badge">IBKR Account: {account?.ibkrAccountId || 'Not connected'}</span>
              <span className="hero-badge">
                {isRefreshing ? 'Refreshing live broker data' : `Last synced ${lastSyncedAt || 'just now'}`}
              </span>
            </div>
          </section>

          <section className="trading-panel-card">
            <h2>Connect Broker Account</h2>
            <div className="trading-inline-form">
              <label>
                IBKR Account ID
                <input value={ibkrAccountId} onChange={(e) => setIbkrAccountId(e.target.value)} placeholder="DU123456" />
              </label>
              <button className="trading-btn secondary" onClick={connectAccount}>
                Connect Account
              </button>
            </div>
            <div className="trading-status">{status}</div>
          </section>

          <section className="trading-panel-card stats-grid-card">
            <h2>Account Profile</h2>
            <div className="stats-grid">
              <div className="stat-card">
                <span>Broker</span>
                <strong>{account?.broker || '—'}</strong>
              </div>
              <div className="stat-card">
                <span>Mode</span>
                <strong>{account?.paper ? 'Paper' : 'Live'}</strong>
              </div>
              <div className="stat-card">
                <span>Trading Enabled</span>
                <strong>{account?.tradingEnabled ? 'Yes' : 'No'}</strong>
              </div>
              <div className="stat-card">
                <span>Health</span>
                <strong>{health?.authenticated ? 'Authenticated' : 'Disconnected'}</strong>
              </div>
            </div>
          </section>

          <section className="trading-panel-card stats-grid-card">
            <h2>Funds / Broker Summary</h2>
            <div className="stats-grid">
              <div className="stat-card">
                <span>Cash</span>
                <strong>{formatMoney(brokerSummary?.cash ?? brokerSummary?.Cash ?? brokerSummary?.availableFunds)}</strong>
              </div>
              <div className="stat-card">
                <span>Net Liquidation</span>
                <strong>{formatMoney(brokerSummary?.netLiquidation ?? brokerSummary?.NetLiquidation)}</strong>
              </div>
              <div className="stat-card">
                <span>Buying Power</span>
                <strong>{formatMoney(brokerSummary?.buyingPower ?? brokerSummary?.BuyingPower)}</strong>
              </div>
              <div className="stat-card">
                <span>Ledger Keys</span>
                <strong>{brokerLedger ? Object.keys(brokerLedger).length : 0}</strong>
              </div>
            </div>
          </section>

          <section className="trading-panel-card">
            <h2>Place Order</h2>
            <div className="trading-grid">
              <label>
                Symbol
                <input value={form.symbol} onChange={(e) => setForm({ ...form, symbol: e.target.value })} />
              </label>
              <label>
                Side
                <select value={form.side} onChange={(e) => setForm({ ...form, side: e.target.value as 'BUY' | 'SELL' })}>
                  <option value="BUY">BUY</option>
                  <option value="SELL">SELL</option>
                </select>
              </label>
              <label>
                Quantity
                <input
                  type="number"
                  step="0.0001"
                  value={form.quantity}
                  onChange={(e) => setForm({ ...form, quantity: Number(e.target.value) })}
                />
              </label>
              <label>
                Order Type
                <select
                  value={form.orderType}
                  onChange={(e) => setForm({ ...form, orderType: e.target.value as TradingOrderRequest['orderType'] })}
                >
                  <option value="MKT">MKT</option>
                  <option value="LMT">LMT</option>
                  <option value="STP">STP</option>
                  <option value="STP LMT">STP LMT</option>
                </select>
              </label>
              {(form.orderType === 'LMT' || form.orderType === 'STP LMT') && (
                <label>
                  Limit Price
                  <input
                    type="number"
                    step="0.01"
                    value={form.limitPrice ?? ''}
                    onChange={(e) => setForm({ ...form, limitPrice: Number(e.target.value) })}
                  />
                </label>
              )}
              {(form.orderType === 'STP' || form.orderType === 'STP LMT') && (
                <label>
                  Stop Price
                  <input
                    type="number"
                    step="0.01"
                    value={form.stopPrice ?? ''}
                    onChange={(e) => setForm({ ...form, stopPrice: Number(e.target.value) })}
                  />
                </label>
              )}
              <label>
                Time in Force
                <select value={form.tif || 'DAY'} onChange={(e) => setForm({ ...form, tif: e.target.value as 'DAY' | 'GTC' })}>
                  <option value="DAY">DAY</option>
                  <option value="GTC">GTC</option>
                </select>
              </label>
              <label>
                Outside RTH
                <select value={form.outsideRth ? 'yes' : 'no'} onChange={(e) => setForm({ ...form, outsideRth: e.target.value === 'yes' })}>
                  <option value="no">No</option>
                  <option value="yes">Yes</option>
                </select>
              </label>
              <label>
                Attach Stop-Loss
                <select value={attachStopLoss ? 'yes' : 'no'} onChange={(e) => setAttachStopLoss(e.target.value === 'yes')}>
                  <option value="no">No</option>
                  <option value="yes">Yes</option>
                </select>
              </label>
              {attachStopLoss && (
                <label>
                  Stop-Loss Price
                  <input
                    type="number"
                    step="0.01"
                    value={stopLossPrice}
                    onChange={(e) => setStopLossPrice(Number(e.target.value))}
                  />
                </label>
              )}
            </div>

            <div className="trading-actions">
              <button className="trading-btn primary" onClick={placeOrder}>
                Place Order
              </button>
              <button className="trading-btn secondary" onClick={loadAll}>
                Refresh All
              </button>
            </div>
          </section>

          <section className="trading-panel-card table-card">
            <h2>Positions</h2>
            <table>
              <thead>
                <tr>
                  <th>Symbol</th>
                  <th>Qty</th>
                  <th>Price</th>
                  <th>Market Value</th>
                  <th>P/L</th>
                </tr>
              </thead>
              <tbody>
                {brokerPositions.length > 0 ? (
                  brokerPositions.map((position, index) => (
                    <tr key={`${position.symbol || 'pos'}-${index}`}>
                      <td>{renderPrimitive(position.symbol ?? position.localSymbol ?? position.ticker)}</td>
                      <td>{renderPrimitive(position.position ?? position.qty ?? position.quantity)}</td>
                      <td>{formatMoney(position.marketPrice ?? position.avgCost ?? position.costBasisPrice)}</td>
                      <td>{formatMoney(position.marketValue ?? position.market_value)}</td>
                      <td>{formatMoney(position.unrealizedPnl ?? position.unrealized_pnl)}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={5}>No positions returned yet.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </section>

          <section className="trading-panel-card table-card">
            <h2>Open Orders</h2>
            <table>
              <thead>
                <tr>
                  <th>Symbol</th>
                  <th>Side</th>
                  <th>Type</th>
                  <th>Qty</th>
                  <th>Status</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((order) => (
                  <tr key={order._id}>
                    <td>{order.symbol}</td>
                    <td>{order.side}</td>
                    <td>{order.orderType}</td>
                    <td>{order.quantity}</td>
                    <td>{order.status}</td>
                    <td>
                      {(order.status === 'pending' || order.status === 'submitted') && (
                        <button className="trading-btn secondary" onClick={() => cancelOrder(order._id)}>
                          Cancel
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
                {orders.length === 0 && (
                  <tr>
                    <td colSpan={6}>No local orders yet.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </section>

          <section className="trading-panel-card table-card">
            <h2>Broker Open Orders</h2>
            <table>
              <thead>
                <tr>
                  <th>Symbol</th>
                  <th>Side</th>
                  <th>Type</th>
                  <th>Broker Order</th>
                </tr>
              </thead>
              <tbody>
                {brokerOpenOrders.length > 0 ? (
                  brokerOpenOrders.map((order, index) => (
                    <tr key={`${order.orderId || order.id || index}`}>
                      <td>{renderPrimitive(order.symbol ?? order.localSymbol ?? (order as any).contract?.symbol)}</td>
                      <td>{renderPrimitive(order.side)}</td>
                      <td>{renderPrimitive(order.orderType ?? order.order_type)}</td>
                      <td>{renderPrimitive(order.orderId ?? order.id ?? order.order_id)}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={4}>No open broker orders returned yet.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </section>

          <section className="trading-panel-card table-card">
            <h2>Account Details</h2>
            <table>
              <thead>
                <tr>
                  <th>Field</th>
                  <th>Value</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>IBKR Account ID</td>
                  <td>{account?.ibkrAccountId || 'Not connected'}</td>
                </tr>
                <tr>
                  <td>Broker Accounts</td>
                  <td>{brokerAccounts.length > 0 ? brokerAccounts.map((a) => renderPrimitive(a.accountId ?? a.account).toString()).join(', ') : '—'}</td>
                </tr>
                <tr>
                  <td>Summary Raw Keys</td>
                  <td>{brokerSummary ? Object.keys(brokerSummary).join(', ') : '—'}</td>
                </tr>
                <tr>
                  <td>Ledger Raw Keys</td>
                  <td>{brokerLedger ? Object.keys(brokerLedger).join(', ') : '—'}</td>
                </tr>
              </tbody>
            </table>
          </section>
        </div>
      </div>
    </div>
  );
};
