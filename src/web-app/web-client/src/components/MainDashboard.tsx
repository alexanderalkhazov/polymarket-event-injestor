import { useEffect, useMemo, useState } from 'react';
import { BarChart3, Bot, CalendarClock, LogOut, RefreshCcw, ShieldCheck, TrendingUp, User2 } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { chatAPI, tradingAPI, type TradingOrderRequest } from '../services/api';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';

type TabKey = 'overview' | 'trading' | 'chat' | 'events';

type Message = {
  id: number;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
};

type Conversation = {
  id: string;
  title: string;
  updatedAt: string;
  messageCount: number;
  lastMessage: string;
};

type MarketEvent = {
  market_id: string;
  market_slug: string;
  question: string;
  current_price: number;
  volume: number;
  timestamp: string;
  outcome: string;
};

type TradingOrderRow = {
  _id: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  orderType: 'MKT' | 'LMT' | 'STP' | 'STP LMT';
  quantity: number;
  status: string;
};

type TradingAccount = {
  ibkrAccountId?: string;
  broker?: string;
  paper?: boolean;
  tradingEnabled?: boolean;
};

type BrokerHealth = {
  authenticated?: boolean;
};

interface MainDashboardProps {
  initialTab?: TabKey;
}

const formatMoney = (value: unknown) => {
  const amount = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(amount)) return '—';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
};

const extractRecordList = (payload: unknown): Record<string, unknown>[] => {
  if (!payload) return [];
  if (Array.isArray(payload)) {
    return payload.filter((item) => item && typeof item === 'object') as Record<string, unknown>[];
  }
  if (typeof payload === 'object') {
    const nested = (payload as Record<string, unknown>).positions || (payload as Record<string, unknown>).accounts;
    if (Array.isArray(nested)) {
      return nested.filter((item) => item && typeof item === 'object') as Record<string, unknown>[];
    }
  }
  return [];
};

const friendlyTime = (value?: string | null) => {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString();
};

export const MainDashboard = ({ initialTab = 'overview' }: MainDashboardProps) => {
  const { user, logout } = useAuth();
  const [activeTab, setActiveTab] = useState<TabKey>(initialTab);

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
  const [tradingStatus, setTradingStatus] = useState('');
  const [account, setAccount] = useState<TradingAccount | null>(null);
  const [brokerHealth, setBrokerHealth] = useState<BrokerHealth | null>(null);
  const [funds, setFunds] = useState<Record<string, unknown>>({});
  const [positions, setPositions] = useState<Record<string, unknown>[]>([]);
  const [brokerOpenOrders, setBrokerOpenOrders] = useState<Record<string, unknown>[]>([]);
  const [orders, setOrders] = useState<TradingOrderRow[]>([]);
  const [isTradingLoading, setIsTradingLoading] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [currentConversationId, setCurrentConversationId] = useState<string | null>(null);
  const [chatInput, setChatInput] = useState('');
  const [isSendingChat, setIsSendingChat] = useState(false);

  const [events, setEvents] = useState<MarketEvent[]>([]);
  const [selectedCount, setSelectedCount] = useState<number | 'All'>('All');
  const [searchText, setSearchText] = useState('');
  const [minVolume, setMinVolume] = useState('');
  const [selectedIndication, setSelectedIndication] = useState<'all' | 'yes' | 'no' | 'neutral'>('all');
  const [selectedTime, setSelectedTime] = useState<'all' | '1h' | '24h' | '7d'>('all');
  const [eventsError, setEventsError] = useState('');
  const [isEventsLoading, setIsEventsLoading] = useState(false);

  const loadTrading = async () => {
    setIsTradingLoading(true);
    try {
      const dashboardRes = await tradingAPI.getDashboard();
      if (dashboardRes.success && dashboardRes.data) {
        const dashboard = dashboardRes.data as Record<string, any>;
        setAccount((dashboard.account as TradingAccount) || null);
        setBrokerHealth((dashboard.health as BrokerHealth) || null);
        setFunds((dashboard.funds as Record<string, unknown>) || {});
        setPositions(extractRecordList(dashboard.positions));
        setBrokerOpenOrders(extractRecordList(dashboard.openOrders));
        setOrders((dashboard.localOrders || []) as TradingOrderRow[]);
      } else {
        const [accountRes, snapshotRes, healthRes, ordersRes] = await Promise.allSettled([
          tradingAPI.getAccount(),
          tradingAPI.getSnapshot(),
          tradingAPI.getBrokerHealth(),
          tradingAPI.listOrders(),
        ]);

        if (accountRes.status === 'fulfilled' && accountRes.value.success) {
          setAccount((accountRes.value.data as TradingAccount) || null);
        }
        if (healthRes.status === 'fulfilled' && healthRes.value.success) {
          setBrokerHealth((healthRes.value.data as BrokerHealth) || null);
        }
        if (ordersRes.status === 'fulfilled' && ordersRes.value.success) {
          setOrders((ordersRes.value.data || []) as TradingOrderRow[]);
        }
        if (snapshotRes.status === 'fulfilled' && snapshotRes.value.success) {
          const snapshot = (snapshotRes.value.data || {}) as Record<string, any>;
          const rawFunds = (snapshot.summary || snapshot.snapshot?.summary || {}) as Record<string, unknown>;
          setFunds(rawFunds);
          setPositions(extractRecordList(snapshot.positions || snapshot.snapshot?.positions));
          setBrokerOpenOrders(extractRecordList(snapshot.openOrders || snapshot.snapshot?.openOrders));
        }
      }
      setLastSyncedAt(new Date().toISOString());
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Could not load trading data';
      setTradingStatus(message);
    } finally {
      setIsTradingLoading(false);
    }
  };

  const loadConversations = async () => {
    try {
      const response = await chatAPI.getConversations();
      if (response.success && response.data) {
        setConversations(response.data);
      }
    } catch {
      // Keep chat available even if list loading fails.
    }
  };

  const loadConversation = async (conversationId: string) => {
    try {
      const response = await chatAPI.getConversation(conversationId);
      if (response.success && response.data) {
        const restored = response.data.messages.map((msg, index) => ({
          id: index + 1,
          role: msg.role as 'user' | 'assistant',
          content: msg.content,
          timestamp: new Date(msg.timestamp).toLocaleTimeString(),
        }));
        setMessages(restored);
        setCurrentConversationId(conversationId);
        setActiveTab('chat');
      }
    } catch {
      // Preserve current state when conversation loading fails.
    }
  };

  const sendChatMessage = async () => {
    const content = chatInput.trim();
    if (!content || isSendingChat) return;

    const userMessageId = Date.now();
    const assistantMessageId = userMessageId + 1;

    setMessages((prev) => [
      ...prev,
      { id: userMessageId, role: 'user', content, timestamp: new Date().toLocaleTimeString() },
      { id: assistantMessageId, role: 'assistant', content: '', timestamp: new Date().toLocaleTimeString() },
    ]);
    setChatInput('');
    setIsSendingChat(true);

    try {
      await chatAPI.sendMessageStream(content, currentConversationId || undefined, {
        onMeta: (meta) => {
          if (!currentConversationId && meta.conversationId) {
            setCurrentConversationId(meta.conversationId);
          }
        },
        onToken: (token) => {
          setMessages((prev) =>
            prev.map((message) =>
              message.id === assistantMessageId ? { ...message, content: message.content + token } : message
            )
          );
        },
        onDone: async (done) => {
          if (!currentConversationId && done.conversationId) {
            setCurrentConversationId(done.conversationId);
          }
          await loadConversations();
        },
        onError: (message) => {
          throw new Error(message);
        },
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to send message';
      setMessages((prev) =>
        prev.map((entry) =>
          entry.id === assistantMessageId
            ? { ...entry, content: `Unable to respond right now. ${message}` }
            : entry
        )
      );
    } finally {
      setIsSendingChat(false);
    }
  };

  const loadEvents = async (limit: number | 'All' = selectedCount, showLoading = true) => {
    if (showLoading) setIsEventsLoading(true);
    setEventsError('');
    try {
      const apiLimit = limit === 'All' ? 'all' : limit;
      const response = await chatAPI.getMarketEvents(apiLimit);
      if (!response.success || !response.data) {
        throw new Error('Unable to load events');
      }
      setEvents(response.data.events as MarketEvent[]);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unable to load events';
      setEventsError(message);
    } finally {
      if (showLoading) setIsEventsLoading(false);
    }
  };

  useEffect(() => {
    loadTrading();
    loadConversations();
    loadEvents(selectedCount);
  }, []);

  useEffect(() => {
    const tradingTimer = window.setInterval(() => {
      loadTrading();
    }, 15000);
    return () => {
      window.clearInterval(tradingTimer);
    };
  }, []);

  useEffect(() => {
    const eventsTimer = window.setInterval(() => {
      loadEvents(selectedCount, false);
    }, 5000);
    return () => {
      window.clearInterval(eventsTimer);
    };
  }, [selectedCount]);

  useEffect(() => {
    loadEvents(selectedCount);
  }, [selectedCount]);

  const filteredEvents = useMemo(() => {
    const now = Date.now();
    const search = searchText.trim().toLowerCase();
    const minVolumeNumber = minVolume.trim() ? Number(minVolume) : 0;

    return events.filter((event) => {
      const eventQuestion = (event.question || '').toLowerCase();
      const eventSlug = (event.market_slug || '').toLowerCase();
      const eventId = (event.market_id || '').toLowerCase();
      const eventOutcome = (event.outcome || '').toLowerCase();
      const eventVolume = Number(event.volume || 0);
      const eventTime = new Date(event.timestamp).getTime();

      if (search && !eventQuestion.includes(search) && !eventSlug.includes(search) && !eventId.includes(search)) {
        return false;
      }
      if (!Number.isNaN(minVolumeNumber) && eventVolume < minVolumeNumber) {
        return false;
      }
      if (selectedIndication === 'yes' && eventOutcome !== 'yes') {
        return false;
      }
      if (selectedIndication === 'no' && eventOutcome !== 'no') {
        return false;
      }
      if (selectedIndication === 'neutral' && (eventOutcome === 'yes' || eventOutcome === 'no')) {
        return false;
      }

      if (selectedTime !== 'all') {
        const msWindow =
          selectedTime === '1h'
            ? 60 * 60 * 1000
            : selectedTime === '24h'
              ? 24 * 60 * 60 * 1000
              : 7 * 24 * 60 * 60 * 1000;
        if (!eventTime || Number.isNaN(eventTime) || now - eventTime > msWindow) {
          return false;
        }
      }

      return true;
    });
  }, [events, minVolume, searchText, selectedIndication, selectedTime]);

  const hotEvents = useMemo(() => {
    const sorted = [...filteredEvents].sort((a, b) => (b.volume || 0) - (a.volume || 0));
    return selectedCount === 'All' ? sorted : sorted.slice(0, selectedCount);
  }, [filteredEvents, selectedCount]);

  const handleConnectAccount = async () => {
    try {
      const response = await tradingAPI.connectAccount(ibkrAccountId);
      setTradingStatus(response.success ? 'Broker account connected.' : response.message || 'Connection failed');
      await loadTrading();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Connection failed';
      setTradingStatus(message);
    }
  };

  const handlePlaceOrder = async () => {
    try {
      const payload: TradingOrderRequest = {
        ...form,
        symbol: form.symbol.toUpperCase(),
      };
      if (attachStopLoss && typeof stopLossPrice === 'number') {
        payload.attachStopLoss = { stopPrice: stopLossPrice };
      }

      const response = await tradingAPI.placeOrder(payload);
      setTradingStatus(response.success ? 'Order submitted.' : response.message || 'Order submission failed');
      await loadTrading();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Order submission failed';
      setTradingStatus(message);
    }
  };

  const handleCancelOrder = async (orderId: string) => {
    try {
      const response = await tradingAPI.cancelOrder(orderId);
      setTradingStatus(response.success ? 'Order cancelled.' : response.message || 'Cancel failed');
      await loadTrading();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Cancel failed';
      setTradingStatus(message);
    }
  };

  const displayMessages =
    messages.length > 0
      ? messages
      : [
          {
            id: 1,
            role: 'assistant' as const,
            content:
              'Welcome to your operator console. Ask for market analysis, risk ideas, or strategy comparisons with live event context attached.',
            timestamp: 'Now',
          },
        ];

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-[1600px] flex-col px-4 py-4 md:px-6 lg:px-8">
      <header className="mb-5 rounded-xl border border-border/80 bg-card/80 p-4 backdrop-blur md:p-5">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.22em] text-muted-foreground">polymarket control room</p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight md:text-3xl">Dark Operations Dashboard</h1>
            <p className="mt-1 text-sm text-muted-foreground">One place for account health, orders, positions, AI chat, and event flow.</p>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant={brokerHealth?.authenticated ? 'default' : 'destructive'}>
              {brokerHealth?.authenticated ? 'Gateway Authenticated' : 'Gateway Disconnected'}
            </Badge>
            <Button variant="outline" size="sm" onClick={loadTrading}>
              <RefreshCcw className="mr-2 h-4 w-4" />
              Sync
            </Button>
            <Button variant="ghost" size="sm" onClick={logout}>
              <LogOut className="mr-2 h-4 w-4" />
              Logout
            </Button>
          </div>
        </div>
      </header>

      <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as TabKey)} className="w-full">
        <TabsList className="mb-4 grid h-auto grid-cols-2 gap-2 bg-transparent p-0 md:grid-cols-4">
          <TabsTrigger value="overview" className="rounded-md border border-border bg-card/70 py-2">
            Overview
          </TabsTrigger>
          <TabsTrigger value="trading" className="rounded-md border border-border bg-card/70 py-2">
            Trading
          </TabsTrigger>
          <TabsTrigger value="chat" className="rounded-md border border-border bg-card/70 py-2">
            Chatbot
          </TabsTrigger>
          <TabsTrigger value="events" className="rounded-md border border-border bg-card/70 py-2">
            Events
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <Card>
              <CardHeader>
                <CardDescription>Logged In User</CardDescription>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <User2 className="h-5 w-5 text-primary" />
                  {user?.name || 'Unknown User'}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">{user?.email}</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardDescription>Trading Account</CardDescription>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <ShieldCheck className="h-5 w-5 text-primary" />
                  {account?.ibkrAccountId || 'Not Connected'}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">
                  Mode: {account?.paper ? 'Paper' : 'Live'} | Enabled: {account?.tradingEnabled ? 'Yes' : 'No'}
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardDescription>Open Positions</CardDescription>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <TrendingUp className="h-5 w-5 text-primary" />
                  {positions.length}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">Broker open orders: {brokerOpenOrders.length}</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardDescription>Signal Flow</CardDescription>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <BarChart3 className="h-5 w-5 text-primary" />
                  {events.length} events
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">Conversations: {conversations.length}</p>
              </CardContent>
            </Card>
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Funds Snapshot</CardTitle>
                <CardDescription>Normalized broker funds from the dashboard endpoint.</CardDescription>
              </CardHeader>
              <CardContent className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <p className="text-muted-foreground">Cash</p>
                  <p className="font-semibold">{formatMoney(funds.cash)}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Buying Power</p>
                  <p className="font-semibold">{formatMoney(funds.buyingPower)}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Net Liquidation</p>
                  <p className="font-semibold">{formatMoney(funds.netLiquidation)}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Last Sync</p>
                  <p className="font-semibold">{friendlyTime(lastSyncedAt)}</p>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Recent Conversations</CardTitle>
                <CardDescription>Quick jump into saved assistant sessions.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                {conversations.slice(0, 5).map((conversation) => (
                  <button
                    key={conversation.id}
                    className="w-full rounded-md border border-border/80 bg-background/70 px-3 py-2 text-left hover:bg-accent/30"
                    onClick={() => loadConversation(conversation.id)}
                  >
                    <p className="line-clamp-1 text-sm font-medium">{conversation.title}</p>
                    <p className="text-xs text-muted-foreground">{friendlyTime(conversation.updatedAt)}</p>
                  </button>
                ))}
                {conversations.length === 0 && <p className="text-sm text-muted-foreground">No conversations yet.</p>}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="trading">
          <div className="grid gap-4 xl:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Account Connection</CardTitle>
                <CardDescription>Connect your IBKR paper account and verify status.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid gap-2">
                  <Label htmlFor="ibkr-id">IBKR Account ID</Label>
                  <Input
                    id="ibkr-id"
                    value={ibkrAccountId}
                    placeholder="DU123456"
                    onChange={(event) => setIbkrAccountId(event.target.value)}
                  />
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button onClick={handleConnectAccount}>Connect</Button>
                  <Button variant="outline" onClick={loadTrading}>
                    {isTradingLoading ? 'Refreshing...' : 'Refresh'}
                  </Button>
                </div>
                {!!tradingStatus && <p className="text-sm text-muted-foreground">{tradingStatus}</p>}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Place Order</CardTitle>
                <CardDescription>Submit market, limit, stop, and stop-limit orders.</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-3 sm:grid-cols-2">
                <div className="grid gap-2">
                  <Label>Symbol</Label>
                  <Input value={form.symbol} onChange={(event) => setForm({ ...form, symbol: event.target.value })} />
                </div>
                <div className="grid gap-2">
                  <Label>Side</Label>
                  <select
                    className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                    value={form.side}
                    onChange={(event) => setForm({ ...form, side: event.target.value as 'BUY' | 'SELL' })}
                  >
                    <option value="BUY">BUY</option>
                    <option value="SELL">SELL</option>
                  </select>
                </div>
                <div className="grid gap-2">
                  <Label>Quantity</Label>
                  <Input
                    type="number"
                    step="0.0001"
                    value={form.quantity}
                    onChange={(event) => setForm({ ...form, quantity: Number(event.target.value) })}
                  />
                </div>
                <div className="grid gap-2">
                  <Label>Order Type</Label>
                  <select
                    className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                    value={form.orderType}
                    onChange={(event) =>
                      setForm({ ...form, orderType: event.target.value as TradingOrderRequest['orderType'] })
                    }
                  >
                    <option value="MKT">MKT</option>
                    <option value="LMT">LMT</option>
                    <option value="STP">STP</option>
                    <option value="STP LMT">STP LMT</option>
                  </select>
                </div>
                {(form.orderType === 'LMT' || form.orderType === 'STP LMT') && (
                  <div className="grid gap-2">
                    <Label>Limit Price</Label>
                    <Input
                      type="number"
                      step="0.01"
                      value={form.limitPrice ?? ''}
                      onChange={(event) => setForm({ ...form, limitPrice: Number(event.target.value) })}
                    />
                  </div>
                )}
                {(form.orderType === 'STP' || form.orderType === 'STP LMT') && (
                  <div className="grid gap-2">
                    <Label>Stop Price</Label>
                    <Input
                      type="number"
                      step="0.01"
                      value={form.stopPrice ?? ''}
                      onChange={(event) => setForm({ ...form, stopPrice: Number(event.target.value) })}
                    />
                  </div>
                )}
                <div className="grid gap-2">
                  <Label>Time In Force</Label>
                  <select
                    className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                    value={form.tif || 'DAY'}
                    onChange={(event) => setForm({ ...form, tif: event.target.value as 'DAY' | 'GTC' })}
                  >
                    <option value="DAY">DAY</option>
                    <option value="GTC">GTC</option>
                  </select>
                </div>
                <div className="grid gap-2">
                  <Label>Attach Stop-Loss</Label>
                  <select
                    className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                    value={attachStopLoss ? 'yes' : 'no'}
                    onChange={(event) => setAttachStopLoss(event.target.value === 'yes')}
                  >
                    <option value="no">No</option>
                    <option value="yes">Yes</option>
                  </select>
                </div>
                {attachStopLoss && (
                  <div className="grid gap-2 sm:col-span-2">
                    <Label>Stop-Loss Price</Label>
                    <Input
                      type="number"
                      step="0.01"
                      value={stopLossPrice}
                      onChange={(event) => setStopLossPrice(Number(event.target.value))}
                    />
                  </div>
                )}
                <div className="sm:col-span-2">
                  <Button onClick={handlePlaceOrder}>Place Order</Button>
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="mt-4 grid gap-4 xl:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Open Positions</CardTitle>
                <CardDescription>Live broker positions including P/L context.</CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Symbol</TableHead>
                      <TableHead>Qty</TableHead>
                      <TableHead>Market Value</TableHead>
                      <TableHead>Unrealized P/L</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {positions.map((position, index) => (
                      <TableRow key={`${String(position.symbol || index)}-${index}`}>
                        <TableCell>{String(position.symbol || position.localSymbol || '—')}</TableCell>
                        <TableCell>{String(position.position || position.quantity || '—')}</TableCell>
                        <TableCell>{formatMoney(position.marketValue || position.market_value)}</TableCell>
                        <TableCell>{formatMoney(position.unrealizedPnl || position.unrealized_pnl)}</TableCell>
                      </TableRow>
                    ))}
                    {positions.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={4}>No open positions.</TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Orders</CardTitle>
                <CardDescription>Manage local order records and cancellation actions.</CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Symbol</TableHead>
                      <TableHead>Side</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {orders.map((order) => (
                      <TableRow key={order._id}>
                        <TableCell>{order.symbol}</TableCell>
                        <TableCell>{order.side}</TableCell>
                        <TableCell>{order.orderType}</TableCell>
                        <TableCell>{order.status}</TableCell>
                        <TableCell>
                          {(order.status === 'pending' || order.status === 'submitted') && (
                            <Button size="sm" variant="secondary" onClick={() => handleCancelOrder(order._id)}>
                              Cancel
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                    {orders.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={5}>No local orders.</TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="chat">
          <div className="grid gap-4 lg:grid-cols-[320px,1fr]">
            <Card>
              <CardHeader>
                <CardTitle>Conversations</CardTitle>
                <CardDescription>Resume any saved strategy thread.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                <Button
                  variant="secondary"
                  className="w-full"
                  onClick={() => {
                    setMessages([]);
                    setCurrentConversationId(null);
                  }}
                >
                  New Conversation
                </Button>
                {conversations.map((conversation) => (
                  <button
                    key={conversation.id}
                    onClick={() => loadConversation(conversation.id)}
                    className="w-full rounded-md border border-border/80 bg-background/70 px-3 py-2 text-left hover:bg-accent/30"
                  >
                    <p className="line-clamp-1 text-sm font-medium">{conversation.title}</p>
                    <p className="line-clamp-1 text-xs text-muted-foreground">{conversation.lastMessage || 'No message yet'}</p>
                  </button>
                ))}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Bot className="h-5 w-5 text-primary" />
                  AI Chatbot
                </CardTitle>
                <CardDescription>Streaming responses from your assistant grounded in market context.</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="mb-4 max-h-[460px] space-y-3 overflow-y-auto rounded-md border border-border/80 bg-background/50 p-3">
                  {displayMessages.map((message) => (
                    <div
                      key={message.id}
                      className={`rounded-md border px-3 py-2 text-sm ${
                        message.role === 'assistant'
                          ? 'border-primary/30 bg-primary/10'
                          : 'border-border bg-background'
                      }`}
                    >
                      <p className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">
                        {message.role} • {message.timestamp}
                      </p>
                      <p className="whitespace-pre-wrap">{message.content}</p>
                    </div>
                  ))}
                </div>
                <div className="space-y-2">
                  <Textarea
                    value={chatInput}
                    onChange={(event) => setChatInput(event.target.value)}
                    rows={4}
                    placeholder="Ask about market trend, risk posture, or execution strategy..."
                  />
                  <Button onClick={sendChatMessage} disabled={isSendingChat || !chatInput.trim()}>
                    {isSendingChat ? 'Streaming...' : 'Send Message'}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="events">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <CalendarClock className="h-5 w-5 text-primary" />
                Polymarket Events Feed
              </CardTitle>
              <CardDescription>
                Showing {hotEvents.length} of {filteredEvents.length} filtered events ({events.length} total).
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="mb-3 grid gap-2 md:grid-cols-5">
                <Input
                  value={searchText}
                  onChange={(event) => setSearchText(event.target.value)}
                  placeholder="Search question/slug/id"
                />
                <Input
                  type="number"
                  min="0"
                  value={minVolume}
                  onChange={(event) => setMinVolume(event.target.value)}
                  placeholder="Min volume"
                />
                <select
                  className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                  value={selectedIndication}
                  onChange={(event) =>
                    setSelectedIndication(event.target.value as 'all' | 'yes' | 'no' | 'neutral')
                  }
                >
                  <option value="all">All Indications</option>
                  <option value="yes">Bullish</option>
                  <option value="no">Bearish</option>
                  <option value="neutral">Neutral</option>
                </select>
                <select
                  className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                  value={selectedTime}
                  onChange={(event) => setSelectedTime(event.target.value as 'all' | '1h' | '24h' | '7d')}
                >
                  <option value="all">All Time</option>
                  <option value="1h">Last 1h</option>
                  <option value="24h">Last 24h</option>
                  <option value="7d">Last 7d</option>
                </select>
                <select
                  className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                  value={selectedCount}
                  onChange={(event) => {
                    const value = event.target.value;
                    setSelectedCount(value === 'All' ? 'All' : Number(value));
                  }}
                >
                  <option value="25">Top 25</option>
                  <option value="50">Top 50</option>
                  <option value="100">Top 100</option>
                  <option value="200">Top 200</option>
                  <option value="All">All Events</option>
                </select>
              </div>

              <div className="mb-3 flex gap-2">
                <Button variant="outline" onClick={() => loadEvents(selectedCount)}>
                  Refresh Events
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => {
                    setSearchText('');
                    setMinVolume('');
                    setSelectedIndication('all');
                    setSelectedTime('all');
                  }}
                >
                  Reset Filters
                </Button>
              </div>

              {isEventsLoading ? (
                <p className="text-sm text-muted-foreground">Loading events...</p>
              ) : eventsError ? (
                <p className="text-sm text-destructive">{eventsError}</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Market</TableHead>
                      <TableHead>Signal</TableHead>
                      <TableHead>Price</TableHead>
                      <TableHead>Volume</TableHead>
                      <TableHead>Timestamp</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {hotEvents.map((event, index) => {
                      const outcome = (event.outcome || '').toLowerCase();
                      const signal = outcome === 'yes' ? 'Bullish' : outcome === 'no' ? 'Bearish' : 'Neutral';
                      const signalClass =
                        outcome === 'yes'
                          ? 'text-emerald-300'
                          : outcome === 'no'
                            ? 'text-rose-300'
                            : 'text-slate-300';

                      return (
                        <TableRow key={`${event.market_id}-${index}`}>
                          <TableCell>
                            <p className="line-clamp-1 font-medium">{event.question || event.market_slug || event.market_id}</p>
                            <p className="text-xs text-muted-foreground">{event.market_slug || event.market_id}</p>
                          </TableCell>
                          <TableCell className={signalClass}>{signal}</TableCell>
                          <TableCell>{(Number(event.current_price || 0) * 100).toFixed(1)}%</TableCell>
                          <TableCell>{formatMoney(event.volume)}</TableCell>
                          <TableCell>{friendlyTime(event.timestamp)}</TableCell>
                        </TableRow>
                      );
                    })}
                    {hotEvents.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={5}>No events matched your filters.</TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
};
