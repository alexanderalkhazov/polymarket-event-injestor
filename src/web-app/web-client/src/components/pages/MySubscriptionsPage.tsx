import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight, Loader2, Newspaper, TrendingUp, X,
} from 'lucide-react';
import { PageShell } from '@/components/layout/PageShell';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  subscriptionAPI,
  polymarketSubscriptionAPI,
  newsSubscriptionAPI,
  type MarketQuote,
  type PolymarketInfo,
} from '@/services/api';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function fmtPrice(p?: number) {
  if (p == null) return '—';
  if (p >= 1_000) return `$${p.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return `$${p.toFixed(p < 1 ? 4 : 2)}`;
}
function fmtPct(p?: number) {
  if (p == null) return null;
  return `${p >= 0 ? '+' : ''}${p.toFixed(2)}%`;
}

// ---------------------------------------------------------------------------
// Section wrapper
// ---------------------------------------------------------------------------
function Section({
  title,
  count,
  browseTo,
  browseLabel,
  children,
  empty,
  loading,
}: {
  title: string;
  count: number;
  browseTo: string;
  browseLabel: string;
  children: React.ReactNode;
  empty: React.ReactNode;
  loading: boolean;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h2 className="text-base font-semibold">{title}</h2>
          <Badge variant="secondary" className="text-xs">{count}</Badge>
        </div>
        <Link
          to={browseTo}
          className="flex items-center gap-1 text-xs text-primary hover:underline"
        >
          {browseLabel} <ArrowRight className="h-3 w-3" />
        </Link>
      </div>
      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          ) : count === 0 ? (
            <div className="px-5 py-6 text-sm text-muted-foreground">{empty}</div>
          ) : (
            children
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Stocks row
// ---------------------------------------------------------------------------
function StockRow({
  quote,
  onRemove,
  removing,
}: {
  quote: MarketQuote;
  onRemove: (sym: string) => void;
  removing: string | null;
}) {
  const up = (quote.changePct ?? 0) >= 0;
  const pct = fmtPct(quote.changePct);
  return (
    <div className="flex items-center gap-3 border-b border-border px-4 py-2.5 last:border-0 text-sm">
      <div className="min-w-0 flex-1">
        <span className="font-semibold">{quote.symbol}</span>
        {quote.name && (
          <span className="ml-2 truncate text-xs text-muted-foreground">{quote.name}</span>
        )}
      </div>
      {quote.price != null && (
        <div className="shrink-0 text-right tabular-nums">
          <span className="text-sm font-medium">{fmtPrice(quote.price)}</span>
          {pct && (
            <span className={`ml-2 text-xs font-medium ${up ? 'text-emerald-400' : 'text-red-400'}`}>
              {pct}
            </span>
          )}
        </div>
      )}
      <button
        className="ml-2 shrink-0 text-muted-foreground hover:text-destructive disabled:opacity-40"
        disabled={removing === quote.symbol}
        onClick={() => onRemove(quote.symbol)}
      >
        {removing === quote.symbol ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" />}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Polymarket row
// ---------------------------------------------------------------------------
function PolyRow({
  market,
  onRemove,
  removing,
}: {
  market: PolymarketInfo;
  onRemove: (id: string) => void;
  removing: string | null;
}) {
  const label = market.slug || market.market_id;
  return (
    <div className="flex items-center gap-3 border-b border-border px-4 py-2.5 last:border-0 text-sm">
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-medium capitalize">{label.replace(/-/g, ' ')}</p>
        {market.market_id && (
          <p className="mt-0.5 truncate text-[10px] text-muted-foreground">{market.market_id}</p>
        )}
      </div>
      <button
        className="shrink-0 text-muted-foreground hover:text-destructive disabled:opacity-40"
        disabled={removing === market.market_id}
        onClick={() => onRemove(market.market_id)}
      >
        {removing === market.market_id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" />}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------
export function MySubscriptionsPage() {
  // Stocks
  const [stockSymbols, setStockSymbols]     = useState<string[]>([]);
  const [stockQuotes,  setStockQuotes]       = useState<Map<string, MarketQuote>>(new Map());
  const [loadingStocks, setLoadingStocks]    = useState(true);
  const [loadingPrices, setLoadingPrices]    = useState(false);
  const [removingStock, setRemovingStock]    = useState<string | null>(null);

  // Polymarket
  const [polyUniverse,  setPolyUniverse]     = useState<PolymarketInfo[]>([]);
  const [polySubIds,    setPolySubIds]        = useState<string[]>([]);
  const [loadingPoly,   setLoadingPoly]       = useState(true);
  const [removingPoly,  setRemovingPoly]      = useState<string | null>(null);

  // News
  const [newsTopics,    setNewsTopics]        = useState<string[]>([]);
  const [loadingNews,   setLoadingNews]       = useState(true);
  const [removingNews,  setRemovingNews]      = useState<string | null>(null);

  // Load prices for current stock symbols
  const loadPrices = useCallback(async (symbols: string[]) => {
    if (!symbols.length) return;
    setLoadingPrices(true);
    try {
      const res = await subscriptionAPI.getQuotes(symbols);
      if (res.success && res.data) {
        setStockQuotes(new Map(res.data.map((q) => [q.symbol, q])));
      }
    } finally {
      setLoadingPrices(false);
    }
  }, []);

  // Initial parallel load
  useEffect(() => {
    Promise.allSettled([
      // Stocks
      subscriptionAPI.getMySubscriptions().then((res) => {
        const syms = res.success ? (res.data ?? []) : [];
        setStockSymbols(syms);
        setLoadingStocks(false);
        if (syms.length) loadPrices(syms);
      }),
      // Polymarket
      Promise.all([
        polymarketSubscriptionAPI.getUniverse(),
        polymarketSubscriptionAPI.getMySubscriptions(),
      ]).then(([univ, subs]) => {
        if (univ.success && univ.data) setPolyUniverse(univ.data);
        if (subs.success && subs.data) setPolySubIds(subs.data);
        setLoadingPoly(false);
      }),
      // News
      newsSubscriptionAPI.getMyTopics().then((res) => {
        if (res.success && res.data) setNewsTopics(res.data);
        setLoadingNews(false);
      }),
    ]);
  }, [loadPrices]);

  // --- Handlers ---
  const removeStock = async (symbol: string) => {
    setRemovingStock(symbol);
    try {
      const res = await subscriptionAPI.removeTicker(symbol);
      const newSyms = res.data ?? stockSymbols.filter((s) => s !== symbol);
      setStockSymbols(newSyms);
      loadPrices(newSyms);
    } finally {
      setRemovingStock(null);
    }
  };

  const removePoly = async (marketId: string) => {
    setRemovingPoly(marketId);
    try {
      const res = await polymarketSubscriptionAPI.removeMarket(marketId);
      if (res.success) setPolySubIds(res.data ?? polySubIds.filter((id) => id !== marketId));
    } finally {
      setRemovingPoly(null);
    }
  };

  const removeNews = async (topic: string) => {
    setRemovingNews(topic);
    try {
      const res = await newsSubscriptionAPI.removeTopic(topic);
      if (res.success) setNewsTopics(res.data ?? newsTopics.filter((t) => t !== topic));
    } finally {
      setRemovingNews(null);
    }
  };

  // Subscribed polymarket markets as PolymarketInfo objects
  const polySubscribed = polyUniverse.filter((m) => polySubIds.includes(m.market_id));

  // Stocks as MarketQuote (merge symbol list with price data)
  const stockRows: MarketQuote[] = stockSymbols.map(
    (sym) => stockQuotes.get(sym) ?? { symbol: sym, name: '' },
  );

  const totalSubscriptions = stockSymbols.length + polySubIds.length + newsTopics.length;

  return (
    <PageShell
      title="My Subscriptions"
      description={`${totalSubscriptions} active subscription${totalSubscriptions !== 1 ? 's' : ''} across all data sources`}
    >
      {/* ---- Stocks & Instruments ---- */}
      <Section
        title="Stocks & Instruments"
        count={stockSymbols.length}
        browseTo="/stocks"
        browseLabel="Browse all instruments"
        loading={loadingStocks}
        empty="No stock subscriptions yet. Browse stocks, futures, crypto and more."
      >
        <div>
          {stockRows.map((q) => (
            <StockRow
              key={q.symbol}
              quote={q}
              onRemove={removeStock}
              removing={loadingPrices ? null : removingStock}
            />
          ))}
        </div>
        {loadingPrices && (
          <div className="flex items-center gap-1.5 border-t border-border px-4 py-2 text-[11px] text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" /> Refreshing prices…
          </div>
        )}
      </Section>

      {/* ---- Polymarket Markets ---- */}
      <Section
        title="Polymarket Markets"
        count={polySubIds.length}
        browseTo="/polymarket"
        browseLabel="Browse markets"
        loading={loadingPoly}
        empty="No Polymarket subscriptions yet. Browse prediction markets that influence trading."
      >
        <div>
          {polySubscribed.map((m) => (
            <PolyRow
              key={m.market_id}
              market={m}
              onRemove={removePoly}
              removing={removingPoly}
            />
          ))}
          {/* Show IDs for subscribed markets not found in universe */}
          {polySubIds
            .filter((id) => !polyUniverse.some((m) => m.market_id === id))
            .map((id) => (
              <PolyRow
                key={id}
                market={{ market_id: id, slug: id }}
                onRemove={removePoly}
                removing={removingPoly}
              />
            ))}
        </div>
      </Section>

      {/* ---- News Topics ---- */}
      <Section
        title="News Topics"
        count={newsTopics.length}
        browseTo="/news"
        browseLabel="Browse topics"
        loading={loadingNews}
        empty="No news topics yet. Subscribe to geopolitics, trade, energy and more."
      >
        <CardHeader className="pb-2 pt-3">
          <div className="flex flex-wrap gap-2">
            {newsTopics.map((topic) => (
              <Badge
                key={topic}
                variant="secondary"
                className="flex items-center gap-1.5 py-1 pl-2.5 pr-1.5 text-xs"
              >
                <Newspaper className="h-3 w-3 text-muted-foreground" />
                {topic}
                <button
                  className="ml-0.5 rounded text-muted-foreground hover:text-destructive disabled:opacity-40"
                  disabled={removingNews === topic}
                  onClick={() => removeNews(topic)}
                >
                  {removingNews === topic ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <X className="h-3 w-3" />
                  )}
                </button>
              </Badge>
            ))}
          </div>
        </CardHeader>
      </Section>

      {/* Empty state */}
      {!loadingStocks && !loadingPoly && !loadingNews && totalSubscriptions === 0 && (
        <div className="rounded-xl border border-dashed border-border py-12 text-center">
          <TrendingUp className="mx-auto mb-3 h-8 w-8 text-muted-foreground/50" />
          <p className="text-sm font-medium">Nothing subscribed yet</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Browse{' '}
            <Link to="/stocks" className="text-primary underline">Stocks</Link>,{' '}
            <Link to="/polymarket" className="text-primary underline">Polymarket</Link>, or{' '}
            <Link to="/news" className="text-primary underline">News Topics</Link> to get started.
          </p>
        </div>
      )}
    </PageShell>
  );
}
