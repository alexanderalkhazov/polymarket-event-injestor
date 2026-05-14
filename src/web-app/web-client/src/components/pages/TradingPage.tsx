import { useEffect, useState } from 'react';
import { RefreshCcw, Wifi, WifiOff } from 'lucide-react';
import { PageShell } from '@/components/layout/PageShell';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { tradingAPI, type TradingOrderRequest } from '@/services/api';

type TradingAccount = { ibkrAccountId?: string; broker?: string; paper?: boolean; tradingEnabled?: boolean };
type BrokerHealth = { authenticated?: boolean };
type OrderRow = { _id: string; symbol: string; side: 'BUY' | 'SELL'; orderType: string; quantity: number; status: string };

const fmt = (v: unknown) => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n) : '—';
};

const SIDES = ['BUY', 'SELL'] as const;
const ORDER_TYPES = ['MKT', 'LMT', 'STP', 'STP LMT'] as const;
const TIFS = ['DAY', 'GTC'] as const;

export function TradingPage() {
  const [account, setAccount] = useState<TradingAccount | null>(null);
  const [health, setHealth] = useState<BrokerHealth | null>(null);
  const [funds, setFunds] = useState<Record<string, unknown>>({});
  const [positions, setPositions] = useState<Record<string, unknown>[]>([]);
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [status, setStatus] = useState('');
  const [lastSynced, setLastSynced] = useState<Date | null>(null);

  // Account connect form
  const [ibkrAccountId, setIbkrAccountId] = useState('');

  // Order form
  const [form, setForm] = useState<TradingOrderRequest>({
    symbol: 'AAPL', side: 'BUY', quantity: 1, orderType: 'MKT', tif: 'DAY', outsideRth: false,
  });

  const load = async () => {
    setIsLoading(true);
    try {
      const res = await tradingAPI.getDashboard();
      if (res.success && res.data) {
        const d = res.data as Record<string, unknown>;
        setAccount((d.account as TradingAccount) ?? null);
        setHealth((d.health as BrokerHealth) ?? null);
        setFunds((d.funds as Record<string, unknown>) ?? {});
        setPositions(Array.isArray(d.positions) ? (d.positions as Record<string, unknown>[]) : []);
        setOrders((d.localOrders as OrderRow[]) ?? []);
      }
    } catch (err: unknown) {
      setStatus(err instanceof Error ? err.message : 'Failed to load trading data');
    } finally {
      setIsLoading(false);
      setLastSynced(new Date());
    }
  };

  const connectAccount = async () => {
    try {
      const res = await tradingAPI.connectAccount(ibkrAccountId);
      setStatus(res.success ? 'Account connected.' : (res as any).message || 'Failed to connect');
      await load();
    } catch (err: unknown) {
      setStatus(err instanceof Error ? err.message : 'Connection failed');
    }
  };

  const placeOrder = async () => {
    try {
      const res = await tradingAPI.placeOrder({ ...form, symbol: form.symbol.toUpperCase() });
      setStatus(res.success ? 'Order submitted.' : (res as any).message || 'Order failed');
      await load();
    } catch (err: unknown) {
      setStatus(err instanceof Error ? err.message : 'Order failed');
    }
  };

  const cancelOrder = async (id: string) => {
    try {
      const res = await tradingAPI.cancelOrder(id);
      setStatus(res.success ? 'Cancelled.' : 'Cancel failed');
      await load();
    } catch {
      setStatus('Cancel failed');
    }
  };

  useEffect(() => {
    load();
    const t = setInterval(load, 15_000);
    return () => clearInterval(t);
  }, []);

  const isConnected = health?.authenticated === true;

  return (
    <PageShell
      title="Trading"
      description="Manage your IBKR account, orders, and positions"
      actions={
        <div className="flex items-center gap-2">
          <Badge variant={isConnected ? 'default' : 'destructive'}>
            {isConnected ? <><Wifi className="mr-1 h-3 w-3" />Connected</> : <><WifiOff className="mr-1 h-3 w-3" />Disconnected</>}
          </Badge>
          <Button variant="outline" size="sm" onClick={load} disabled={isLoading} className="gap-1.5">
            <RefreshCcw className={`h-3.5 w-3.5 ${isLoading ? 'animate-spin' : ''}`} />
            Sync
          </Button>
        </div>
      }
    >
      {status && (
        <div className="rounded-lg border border-border bg-card px-4 py-2.5 text-sm text-muted-foreground">
          {status}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Account connect */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Broker Connection</CardTitle>
            <CardDescription>
              Account: <span className="font-mono text-foreground">{account?.ibkrAccountId || '—'}</span>{' '}
              · Mode: {account?.paper ? 'Paper' : 'Live'}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-1.5">
              <Label htmlFor="account-id">IBKR Account ID</Label>
              <Input
                id="account-id"
                placeholder="DU123456"
                value={ibkrAccountId}
                onChange={(e) => setIbkrAccountId(e.target.value)}
              />
            </div>
            <Button onClick={connectAccount} disabled={!ibkrAccountId}>Connect</Button>
          </CardContent>
        </Card>

        {/* Funds */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Account Funds</CardTitle>
            <CardDescription>{lastSynced ? `Last synced ${lastSynced.toLocaleTimeString()}` : 'Not loaded'}</CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-3 text-sm">
            {[
              (['Cash', funds.cash] as [string, unknown]),
              (['Buying Power', funds.buyingPower] as [string, unknown]),
              (['Net Liquidation', funds.netLiquidation] as [string, unknown]),
              (['Margin', funds.maintenanceMargin] as [string, unknown]),
            ].map(([label, value]) => (
              <div key={label}>
                <p className="text-xs text-muted-foreground">{label}</p>
                <p className="font-semibold tabular-nums">{fmt(value as number)}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      {/* Place order */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Place Order</CardTitle>
          <CardDescription>Submit a paper trade via Interactive Brokers</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <div className="grid gap-1.5">
              <Label>Symbol</Label>
              <Input value={form.symbol} onChange={(e) => setForm({ ...form, symbol: e.target.value })} />
            </div>
            <div className="grid gap-1.5">
              <Label>Side</Label>
              <select className="h-10 rounded-md border border-input bg-background px-3 text-sm" value={form.side} onChange={(e) => setForm({ ...form, side: e.target.value as typeof SIDES[number] })}>
                {SIDES.map((s) => <option key={s}>{s}</option>)}
              </select>
            </div>
            <div className="grid gap-1.5">
              <Label>Type</Label>
              <select className="h-10 rounded-md border border-input bg-background px-3 text-sm" value={form.orderType} onChange={(e) => setForm({ ...form, orderType: e.target.value as typeof ORDER_TYPES[number] })}>
                {ORDER_TYPES.map((t) => <option key={t}>{t}</option>)}
              </select>
            </div>
            <div className="grid gap-1.5">
              <Label>Qty</Label>
              <Input type="number" min={1} value={form.quantity} onChange={(e) => setForm({ ...form, quantity: Number(e.target.value) })} />
            </div>
            {(form.orderType === 'LMT' || form.orderType === 'STP LMT') && (
              <div className="grid gap-1.5">
                <Label>Limit $</Label>
                <Input type="number" value={form.limitPrice ?? ''} onChange={(e) => setForm({ ...form, limitPrice: Number(e.target.value) })} />
              </div>
            )}
            {(form.orderType === 'STP' || form.orderType === 'STP LMT') && (
              <div className="grid gap-1.5">
                <Label>Stop $</Label>
                <Input type="number" value={form.stopPrice ?? ''} onChange={(e) => setForm({ ...form, stopPrice: Number(e.target.value) })} />
              </div>
            )}
            <div className="grid gap-1.5">
              <Label>TIF</Label>
              <select className="h-10 rounded-md border border-input bg-background px-3 text-sm" value={form.tif} onChange={(e) => setForm({ ...form, tif: e.target.value as typeof TIFS[number] })}>
                {TIFS.map((t) => <option key={t}>{t}</option>)}
              </select>
            </div>
          </div>
          <Button className="mt-4" onClick={placeOrder} disabled={!account?.ibkrAccountId}>
            Submit Order
          </Button>
        </CardContent>
      </Card>

      {/* Positions */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Open Positions ({positions.length})</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Symbol</TableHead>
                <TableHead className="text-right">Position</TableHead>
                <TableHead className="text-right">Mkt Price</TableHead>
                <TableHead className="text-right">Mkt Value</TableHead>
                <TableHead className="text-right">Unrealized P&L</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {positions.length === 0 ? (
                <TableRow><TableCell colSpan={5} className="py-6 text-center text-sm text-muted-foreground">No positions</TableCell></TableRow>
              ) : positions.map((p, i) => (
                <TableRow key={i} className="text-sm">
                  <TableCell className="font-medium">{String(p.symbol ?? p.contractDesc ?? '—')}</TableCell>
                  <TableCell className="text-right tabular-nums">{String(p.position ?? '—')}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmt(p.mktPrice)}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmt(p.mktValue)}</TableCell>
                  <TableCell className={`text-right tabular-nums ${Number(p.unrealizedPnl ?? 0) >= 0 ? 'text-primary' : 'text-destructive'}`}>
                    {fmt(p.unrealizedPnl as number)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Local orders */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Order History ({orders.length})</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Symbol</TableHead>
                <TableHead>Side</TableHead>
                <TableHead>Type</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                <TableHead>Status</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {orders.length === 0 ? (
                <TableRow><TableCell colSpan={6} className="py-6 text-center text-sm text-muted-foreground">No orders</TableCell></TableRow>
              ) : orders.map((o) => (
                <TableRow key={o._id} className="text-sm">
                  <TableCell className="font-medium">{o.symbol}</TableCell>
                  <TableCell><Badge variant={o.side === 'BUY' ? 'default' : 'destructive'}>{o.side}</Badge></TableCell>
                  <TableCell className="text-muted-foreground">{o.orderType}</TableCell>
                  <TableCell className="text-right tabular-nums">{o.quantity}</TableCell>
                  <TableCell><Badge variant="secondary">{o.status}</Badge></TableCell>
                  <TableCell className="text-right">
                    {o.status === 'pending' && (
                      <Button variant="ghost" size="sm" className="h-7 text-xs text-destructive hover:text-destructive" onClick={() => cancelOrder(o._id)}>
                        Cancel
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </PageShell>
  );
}
