import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  BarChart3, Cpu, Globe, Landmark, Loader2, Newspaper, Plus,
  RefreshCcw, Search, Shield, TrendingDown, TrendingUp, X, Zap,
} from 'lucide-react';
import { PageShell } from '@/components/layout/PageShell';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  subscriptionAPI, polymarketSubscriptionAPI, newsSubscriptionAPI,
  type MarketQuote, type PolymarketInfo, type NewsTopicCategory,
} from '@/services/api';

const SEC_TYPES = [
  { value: 'STK',    label: 'Stocks'  },
  { value: 'FUT',    label: 'Futures' },
  { value: 'ETF',    label: 'ETFs'    },
  { value: 'IND',    label: 'Indices' },
  { value: 'CRYPTO', label: 'Crypto'  },
  { value: 'FOREX',  label: 'Forex'   },
] as const;
type SecType = (typeof SEC_TYPES)[number]['value'];
type Domain  = 'stocks' | 'polymarket' | 'news';

const CAT_ICONS: Record<string, React.ElementType> = {
  'Geopolitics':                         Globe,
  'Trade & Economics':                   BarChart3,
  'Central Banks & Monetary Policy':     Landmark,
  'Defense & Weapons':                   Shield,
  'Energy & Commodities':                Zap,
  'Financial Markets':                   BarChart3,
  'Technology & AI':                     Cpu,
};

function fmtPrice(p?: number): string {
  if (p == null) return '—';
  if (p >= 10_000) return `$${(p / 1000).toFixed(1)}k`;
  if (p >= 1_000)  return `$${p.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return `$${p.toFixed(p < 1 ? 4 : 2)}`;
}
function fmtPct(p?: number): string {
  if (p == null) return '—';
  return `${p >= 0 ? '+' : ''}${p.toFixed(2)}%`;
}
function fmtVol(v?: number): string {
  if (v == null) return '—';
  if (v >= 1_000_000_000) return `${(v / 1_000_000_000).toFixed(1)}B`;
  if (v >= 1_000_000)     return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000)         return `${(v / 1_000).toFixed(0)}K`;
  return String(v);
}
function fmtPolyVol(v?: string): string {
  const n = parseFloat(v ?? '');
  if (isNaN(n) || n === 0) return '—';
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000)     return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)         return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}

// ---------------------------------------------------------------------------
// Stock watchlist card
// ---------------------------------------------------------------------------
function StockCard({ symbol, quote, loadingPrice, saving, onRemove }: {
  symbol: string;
  quote?: MarketQuote;
  loadingPrice: boolean;
  saving: string | null;
  onRemove: (sym: string) => void;
}) {
  const up = (quote?.changePct ?? 0) >= 0;
  return (
    <div className="relative flex flex-col rounded-xl border bg-card p-3 shadow-sm hover:border-primary/30 transition-colors">
      <button
        className="absolute right-2 top-2 rounded text-muted-foreground transition-colors hover:text-destructive disabled:opacity-40"
        disabled={saving === symbol}
        onClick={() => onRemove(symbol)}
      >
        {saving === symbol
          ? <Loader2 className="h-3 w-3 animate-spin" />
          : <X className="h-3 w-3" />}
      </button>
      <div className="pr-5">
        <p className="text-sm font-bold tracking-tight">{symbol}</p>
        {quote?.name && <p className="mt-0.5 truncate text-[10px] text-muted-foreground">{quote.name}</p>}
      </div>
      {loadingPrice ? (
        <div className="mt-3 space-y-1.5">
          <div className="h-4 w-16 rounded bg-muted animate-pulse" />
          <div className="h-3 w-10 rounded bg-muted animate-pulse" />
        </div>
      ) : (
        <div className="mt-3">
          <p className="text-lg font-semibold tabular-nums leading-tight">{fmtPrice(quote?.price)}</p>
          <div className={`mt-0.5 flex items-center gap-0.5 text-xs font-medium ${
            quote?.changePct == null ? 'text-muted-foreground' : up ? 'text-emerald-400' : 'text-red-400'
          }`}>
            {quote?.changePct != null && (up ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />)}
            {fmtPct(quote?.changePct)}
          </div>
          {quote?.volume != null && (
            <p className="mt-1 text-[10px] text-muted-foreground">Vol: {fmtVol(quote.volume)}</p>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Stock browse row — always renders all columns ("—" for missing data)
// ---------------------------------------------------------------------------
function StockBrowseRow({ stock, saving, onToggle, isSubscribed }: {
  stock: MarketQuote;
  saving: string | null;
  onToggle: (sym: string) => void;
  isSubscribed: boolean;
}) {
  const up = (stock.changePct ?? 0) >= 0;
  const isSaving = saving === stock.symbol;
  return (
    <tr className="border-b border-border last:border-0 hover:bg-accent/30 transition-colors">
      <td className="px-4 py-2.5 min-w-[160px]">
        <div className="flex items-center gap-1.5">
          <span className="text-sm font-semibold">{stock.symbol}</span>
          {stock.type && !['EQUITY', 'Equity'].includes(stock.type) && (
            <Badge variant="outline" className="px-1 py-0 text-[10px]">{stock.type}</Badge>
          )}
        </div>
        {stock.name && <p className="text-xs text-muted-foreground truncate max-w-[200px]">{stock.name}</p>}
      </td>
      <td className="px-4 py-2.5 text-right tabular-nums w-28">
        <p className="text-sm font-medium">{fmtPrice(stock.price)}</p>
      </td>
      <td className={`px-4 py-2.5 text-right tabular-nums text-xs font-medium w-24 ${
        stock.changePct == null ? 'text-muted-foreground' : up ? 'text-emerald-400' : 'text-red-400'
      }`}>
        <div className="flex items-center justify-end gap-0.5">
          {stock.changePct != null && (up
            ? <TrendingUp className="h-3 w-3" />
            : <TrendingDown className="h-3 w-3" />)}
          {fmtPct(stock.changePct)}
        </div>
      </td>
      <td className="px-4 py-2.5 text-right text-xs text-muted-foreground tabular-nums w-24">
        {fmtVol(stock.volume)}
      </td>
      <td className="px-4 py-2.5 text-right w-24">
        <Button
          variant={isSubscribed ? 'secondary' : 'ghost'}
          size="sm"
          className="h-7 gap-1 text-xs"
          disabled={isSaving}
          onClick={() => onToggle(stock.symbol)}
        >
          {isSaving
            ? <Loader2 className="h-3 w-3 animate-spin" />
            : isSubscribed ? <X className="h-3 w-3" /> : <Plus className="h-3 w-3" />}
          {isSubscribed ? 'Remove' : 'Add'}
        </Button>
      </td>
    </tr>
  );
}



// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------
export function SubscriptionsPage() {
  const [domain, setDomain] = useState<Domain>('stocks');

  // ── Stocks state ──────────────────────────────────────────────────────────
  const [stockSubs,     setStockSubs]     = useState<string[]>([]);
  const [stockQuotes,   setStockQuotes]   = useState<Map<string, MarketQuote>>(new Map());
  const [browseResults, setBrowseResults] = useState<MarketQuote[]>([]);
  const [browseSource,  setBrowseSource]  = useState('');
  const [secType,       setSecType]       = useState<SecType>('STK');
  const [search,        setSearch]        = useState('');
  const [loadingStocks, setLoadingStocks] = useState(true);
  const [loadingPrices, setLoadingPrices] = useState(false);
  const [loadingBrowse, setLoadingBrowse] = useState(false);
  const [savingStock,   setSavingStock]   = useState<string | null>(null);

  // ── Polymarket state ──────────────────────────────────────────────────────
  const [polyUniverse, setPolyUniverse] = useState<PolymarketInfo[]>([]);
  const [polySubIds,   setPolySubIds]   = useState<string[]>([]);
  const [polySearch,   setPolySearch]   = useState('');
  const [loadingPoly,  setLoadingPoly]  = useState(true);
  const [savingPoly,   setSavingPoly]   = useState<string | null>(null);

  // ── News state ────────────────────────────────────────────────────────────
  const [catalog,     setCatalog]     = useState<NewsTopicCategory[]>([]);
  const [newsTopics,  setNewsTopics]  = useState<string[]>([]);
  const [loadingNews, setLoadingNews] = useState(true);
  const [savingNews,  setSavingNews]  = useState<string | null>(null);

  // ── Refresh watchlist prices ──────────────────────────────────────────────
  const refreshPrices = useCallback(async (syms: string[]) => {
    if (!syms.length) { setStockQuotes(new Map()); return; }
    setLoadingPrices(true);
    try {
      const quotesMap = new Map<string, MarketQuote>();

      // 1. Batch fetch
      const batchRes = await subscriptionAPI.getQuotes(syms).catch(() => ({ success: false, data: [] as MarketQuote[] }));
      if (batchRes.success && batchRes.data) {
        for (const q of batchRes.data) quotesMap.set(q.symbol, q);
      }

      // 2. Per-symbol fallback for anything missing or without a price
      const missing = syms.filter((s) => {
        const q = quotesMap.get(s);
        return !q || q.price == null;
      });
      if (missing.length) {
        // Call getQuotes individually — getUniverse only returns name/type (no price)
        const retries = await Promise.allSettled(
          missing.map((sym) => subscriptionAPI.getQuotes([sym]))
        );
        retries.forEach((r, i) => {
          if (r.status === 'fulfilled' && r.value.success && r.value.data?.length) {
            const sym = missing[i];
            const match =
              r.value.data.find((q) => q.symbol.toUpperCase() === sym.toUpperCase()) ??
              r.value.data[0];
            if (match) quotesMap.set(sym, { ...match, symbol: sym });
          }
        });
      }

      setStockQuotes(quotesMap);
    } finally {
      setLoadingPrices(false);
    }
  }, []);

  // ── Load all 3 domains on mount ───────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    Promise.allSettled([
      subscriptionAPI.getMySubscriptions().then((res) => {
        if (cancelled) return;
        const syms = res.success ? (res.data ?? []) : [];
        setStockSubs(syms);
        setLoadingStocks(false);
        if (syms.length) refreshPrices(syms);
      }),
      Promise.all([
        polymarketSubscriptionAPI.getUniverse(),
        polymarketSubscriptionAPI.getMySubscriptions(),
      ]).then(([univ, subs]) => {
        if (cancelled) return;
        if (univ.success && univ.data) setPolyUniverse(univ.data);
        if (subs.success && subs.data) setPolySubIds(subs.data);
        setLoadingPoly(false);
      }).catch(() => { if (!cancelled) setLoadingPoly(false); }),
      Promise.all([
        newsSubscriptionAPI.getCatalog(),
        newsSubscriptionAPI.getMyTopics(),
      ]).then(([cat, topics]) => {
        if (cancelled) return;
        if (cat.success && cat.data) setCatalog(cat.data);
        if (topics.success && topics.data) setNewsTopics(topics.data);
        setLoadingNews(false);
      }).catch(() => { if (!cancelled) setLoadingNews(false); }),
    ]);
    return () => { cancelled = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Browse stocks (debounced) ─────────────────────────────────────────────
  const fetchBrowse = useCallback(async (q: string, st: SecType) => {
    setLoadingBrowse(true);
    try {
      const res = await subscriptionAPI.getUniverse(q, st);
      if (res.success) { setBrowseResults(res.data ?? []); setBrowseSource(res.source ?? ''); }
    } finally {
      setLoadingBrowse(false);
    }
  }, []);

  useEffect(() => {
    if (domain !== 'stocks') return;
    // Immediate fetch for empty search (initial load / secType change), debounce typed searches
    const delay = search.trim() ? 350 : 0;
    const id = setTimeout(() => fetchBrowse(search, secType), delay);
    return () => clearTimeout(id);
  }, [search, secType, domain, fetchBrowse]);

  // ── Toggle stocks ─────────────────────────────────────────────────────────
  const toggleStock = useCallback(async (symbol: string) => {
    setSavingStock(symbol);
    try {
      let newSubs: string[];
      if (stockSubs.includes(symbol)) {
        const res = await subscriptionAPI.removeTicker(symbol);
        newSubs = res.data ?? stockSubs.filter((s) => s !== symbol);
      } else {
        const res = await subscriptionAPI.addTicker(symbol);
        newSubs = res.data ?? [...stockSubs, symbol];
      }
      setStockSubs(newSubs);
      refreshPrices(newSubs);
    } finally {
      setSavingStock(null);
    }
  }, [stockSubs, refreshPrices]);

  // ── Toggle polymarket ─────────────────────────────────────────────────────
  const togglePoly = async (marketId: string) => {
    setSavingPoly(marketId);
    try {
      if (polySubIds.includes(marketId)) {
        const res = await polymarketSubscriptionAPI.removeMarket(marketId);
        if (res.success) setPolySubIds(res.data ?? polySubIds.filter((id) => id !== marketId));
      } else {
        const res = await polymarketSubscriptionAPI.addMarket(marketId);
        if (res.success) setPolySubIds(res.data ?? [...polySubIds, marketId]);
      }
    } finally {
      setSavingPoly(null);
    }
  };

  // ── Toggle news ───────────────────────────────────────────────────────────
  const toggleNews = async (topic: string) => {
    setSavingNews(topic);
    try {
      if (newsTopics.includes(topic)) {
        const res = await newsSubscriptionAPI.removeTopic(topic);
        if (res.success) setNewsTopics(res.data ?? newsTopics.filter((t) => t !== topic));
      } else {
        const res = await newsSubscriptionAPI.addTopic(topic);
        if (res.success) setNewsTopics(res.data ?? [...newsTopics, topic]);
      }
    } finally {
      setSavingNews(null);
    }
  };

  const polyFiltered = polyUniverse.filter((m) => {
    const q = polySearch.trim().toLowerCase();
    return !q ||
      (m.question ?? '').toLowerCase().includes(q) ||
      m.slug.toLowerCase().includes(q) ||
      m.market_id.toLowerCase().includes(q);
  });

  // Fallback name/price data for watchlist cards (memoized to avoid recreation on every render)
  const browseMap = useMemo(
    () => new Map(browseResults.map((q) => [q.symbol, q])),
    [browseResults]
  );

  // =========================================================================
  return (
    <PageShell
      title="Subscriptions"
      description="Manage your signals across stocks, prediction markets and news topics."
    >
      {/* ── Domain tabs ─────────────────────────────────────────────────── */}
      <div className="flex gap-0 border-b border-border -mx-6 px-6">
        {([
          { id: 'stocks'    as Domain, label: 'Stocks & Markets', count: stockSubs.length  },
          { id: 'polymarket'as Domain, label: 'Polymarket',       count: polySubIds.length },
          { id: 'news'      as Domain, label: 'News Topics',      count: newsTopics.length },
        ]).map(({ id, label, count }) => (
          <button
            key={id}
            onClick={() => setDomain(id)}
            className={`flex items-center gap-2 px-5 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              domain === id
                ? 'border-primary text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {label}
            {count > 0 && (
              <Badge variant="secondary" className="text-[10px] px-1.5 py-0 leading-4">{count}</Badge>
            )}
          </button>
        ))}
      </div>

      {/* ══════════════════════════════════════════════════════════════════ */}
      {/* STOCKS & MARKETS                                                   */}
      {/* ══════════════════════════════════════════════════════════════════ */}
      {domain === 'stocks' && (
        <div className="space-y-6">
          {/* Watchlist */}
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold">
                My Watchlist
                <Badge variant="secondary" className="ml-2 text-xs">{stockSubs.length}</Badge>
              </h2>
              {stockSubs.length > 0 && (
                <Button
                  variant="ghost" size="sm"
                  className="h-7 gap-1.5 text-xs"
                  disabled={loadingPrices}
                  onClick={() => refreshPrices(stockSubs)}
                >
                  <RefreshCcw className={`h-3 w-3 ${loadingPrices ? 'animate-spin' : ''}`} />
                  Refresh prices
                </Button>
              )}
            </div>
            {loadingStocks ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
                {[...Array(4)].map((_, i) => (
                  <div key={i} className="h-24 rounded-xl border bg-card animate-pulse" />
                ))}
              </div>
            ) : stockSubs.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border p-6 text-center">
                <p className="text-sm text-muted-foreground">Your watchlist is empty — add instruments below.</p>
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
                {stockSubs.map((sym) => (
                  <StockCard
                    key={sym}
                    symbol={sym}
                    quote={stockQuotes.get(sym) ?? browseMap.get(sym)}
                    loadingPrice={loadingPrices}
                    saving={savingStock}
                    onRemove={toggleStock}
                  />
                ))}
              </div>
            )}
          </section>

          {/* Browse & Add */}
          <section className="space-y-3">
            <h2 className="text-sm font-semibold">Browse & Add</h2>
            <Card>
              <CardHeader className="space-y-3 pb-3 pt-4 px-4">
                <div className="flex flex-wrap gap-1.5">
                  {SEC_TYPES.map((st) => (
                    <button
                      key={st.value}
                      onClick={() => { setSecType(st.value); setSearch(''); }}
                      className={`rounded-lg px-3 py-1 text-xs font-medium transition-colors ${
                        secType === st.value
                          ? 'bg-primary text-primary-foreground'
                          : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                      }`}
                    >
                      {st.label}
                    </button>
                  ))}
                </div>
                <div className="relative">
                  <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                  {loadingBrowse && (
                    <Loader2 className="absolute right-2.5 top-2.5 h-4 w-4 animate-spin text-muted-foreground" />
                  )}
                  <Input
                    placeholder={`Search ${SEC_TYPES.find((s) => s.value === secType)?.label ?? secType}…`}
                    className="pl-8 pr-8"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </div>
                {browseSource === 'yahoo-finance' && (
                  <div className="flex items-center gap-1.5 text-[11px] text-emerald-400">
                    <Zap className="h-3 w-3" /> Live data · Yahoo Finance
                  </div>
                )}
              </CardHeader>
              <CardContent className="p-0">
                {loadingBrowse ? (
                  <div className="flex items-center justify-center py-10">
                    <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                  </div>
                ) : browseResults.length === 0 ? (
                  <p className="px-6 py-8 text-sm text-muted-foreground">
                    {search ? 'No results found.' : 'No instruments found.'}
                  </p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-border">
                          <th className="px-4 py-2 text-left text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Symbol / Name</th>
                          <th className="px-4 py-2 text-right text-[10px] font-medium uppercase tracking-wide text-muted-foreground w-28">Price</th>
                          <th className="px-4 py-2 text-right text-[10px] font-medium uppercase tracking-wide text-muted-foreground w-24">Change</th>
                          <th className="px-4 py-2 text-right text-[10px] font-medium uppercase tracking-wide text-muted-foreground w-24">Volume</th>
                          <th className="px-4 py-2 w-24"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {browseResults.map((stock) => (
                          <StockBrowseRow
                            key={stock.symbol}
                            stock={stock}
                            saving={savingStock}
                            onToggle={toggleStock}
                            isSubscribed={stockSubs.includes(stock.symbol)}
                          />
                        ))}
                      </tbody>
                    </table>
                    <p className="px-4 py-2 text-[11px] text-muted-foreground">
                      {browseResults.length} result{browseResults.length !== 1 ? 's' : ''}
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          </section>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════ */}
      {/* POLYMARKET                                                         */}
      {/* ══════════════════════════════════════════════════════════════════ */}
      {domain === 'polymarket' && (
        <div className="space-y-6">
          {/* My markets */}
          <section className="space-y-3">
            <h2 className="text-sm font-semibold">
              My Markets
              <Badge variant="secondary" className="ml-2 text-xs">{polySubIds.length}</Badge>
            </h2>
            {loadingPoly ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : polySubIds.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border p-6 text-center">
                <p className="text-sm text-muted-foreground">No Polymarket subscriptions yet — browse and add markets below.</p>
              </div>
            ) : (
              <Card>
                <CardContent className="p-0">
                  {polyUniverse
                    .filter((m) => polySubIds.includes(m.market_id))
                    .map((m) => (
                      <div key={m.market_id} className="flex items-start gap-3 border-b border-border px-4 py-3 last:border-0">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium leading-snug">
                            {m.question || (m.slug || m.market_id).replace(/-/g, ' ')}
                          </p>
                          <div className="mt-1 flex flex-wrap items-center gap-2">
                            {(m.outcomePrices?.length ?? 0) >= 2 && (
                              <>
                                <span className="text-[11px] font-semibold text-emerald-400">Yes {Math.round(m.outcomePrices![0] * 100)}%</span>
                                <span className="text-[11px] text-muted-foreground">·</span>
                                <span className="text-[11px] font-semibold text-red-400">No {Math.round(m.outcomePrices![1] * 100)}%</span>
                              </>
                            )}
                            {m.volume && m.volume !== '0' && (
                              <span className="text-[11px] text-muted-foreground">Vol: {fmtPolyVol(m.volume)}</span>
                            )}
                          </div>
                        </div>
                        <button
                          className="shrink-0 rounded p-1 text-muted-foreground transition-colors hover:text-destructive disabled:opacity-40"
                          disabled={savingPoly === m.market_id}
                          onClick={() => togglePoly(m.market_id)}
                        >
                          {savingPoly === m.market_id
                            ? <Loader2 className="h-4 w-4 animate-spin" />
                            : <X className="h-4 w-4" />}
                        </button>
                      </div>
                    ))}
                </CardContent>
              </Card>
            )}
          </section>

          {/* Browse markets */}
          <section className="space-y-3">
            <h2 className="text-sm font-semibold">Browse Markets</h2>
            <Card>
              <CardHeader className="pb-3 pt-4 px-4">
                <div className="relative">
                  <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search by question or market name…"
                    className="pl-8"
                    value={polySearch}
                    onChange={(e) => setPolySearch(e.target.value)}
                  />
                </div>
              </CardHeader>
              <CardContent className="p-0">
                {loadingPoly ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                  </div>
                ) : polyFiltered.length === 0 ? (
                  <p className="px-6 py-6 text-sm text-muted-foreground">No markets found.</p>
                ) : (
                  <div className="divide-y divide-border">
                    {polyFiltered.slice(0, 100).map((m) => {
                      const isSub    = polySubIds.includes(m.market_id);
                      const isSaving = savingPoly === m.market_id;
                      return (
                        <div key={m.market_id} className="flex items-start gap-3 px-4 py-3 hover:bg-accent/30 transition-colors">
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium leading-snug">
                              {m.question || (m.slug || m.market_id).replace(/-/g, ' ')}
                            </p>
                            <div className="mt-1 flex flex-wrap items-center gap-2">
                              {(m.outcomePrices?.length ?? 0) >= 2 && (
                                <>
                                  <span className="text-[11px] font-semibold text-emerald-400">Yes {Math.round(m.outcomePrices![0] * 100)}%</span>
                                  <span className="text-[11px] text-muted-foreground">·</span>
                                  <span className="text-[11px] font-semibold text-red-400">No {Math.round(m.outcomePrices![1] * 100)}%</span>
                                </>
                              )}
                              {m.volume && m.volume !== '0' && (
                                <span className="text-[11px] text-muted-foreground">Vol: {fmtPolyVol(m.volume)}</span>
                              )}
                            </div>
                          </div>
                          <Button
                            variant={isSub ? 'secondary' : 'ghost'}
                            size="sm"
                            className="mt-0.5 h-7 shrink-0 gap-1 text-xs"
                            disabled={isSaving}
                            onClick={() => togglePoly(m.market_id)}
                          >
                            {isSaving
                              ? <Loader2 className="h-3 w-3 animate-spin" />
                              : isSub ? <X className="h-3 w-3" /> : <Plus className="h-3 w-3" />}
                            {isSub ? 'Remove' : 'Add'}
                          </Button>
                        </div>
                      );
                    })}
                    <p className="px-4 py-2 text-[11px] text-muted-foreground">
                      {polyFiltered.length} market{polyFiltered.length !== 1 ? 's' : ''}
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          </section>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════ */}
      {/* NEWS TOPICS                                                        */}
      {/* ══════════════════════════════════════════════════════════════════ */}
      {domain === 'news' && (
        <div className="space-y-6">
          {/* My topics */}
          <section className="space-y-3">
            <h2 className="text-sm font-semibold">
              My Topics
              <Badge variant="secondary" className="ml-2 text-xs">{newsTopics.length}</Badge>
            </h2>
            {newsTopics.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border p-6 text-center">
                <p className="text-sm text-muted-foreground">No news topics yet — browse and add topics below.</p>
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                {newsTopics.map((t) => (
                  <button
                    key={t}
                    onClick={() => toggleNews(t)}
                    disabled={savingNews === t}
                    className="flex items-center gap-1.5 rounded-full border border-primary bg-primary/10 px-3 py-1 text-xs font-medium text-primary transition-colors hover:bg-primary/20 disabled:opacity-60"
                  >
                    {savingNews === t
                      ? <Loader2 className="h-3 w-3 animate-spin" />
                      : <X className="h-3 w-3" />}
                    {t}
                  </button>
                ))}
              </div>
            )}
          </section>

          {/* Browse catalog */}
          <section className="space-y-3">
            <h2 className="text-sm font-semibold">Browse Topics</h2>
            {loadingNews ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <div className="space-y-4">
                {catalog.map((cat) => {
                  const Icon = CAT_ICONS[cat.category] ?? Newspaper;
                  return (
                    <Card key={cat.category}>
                      <CardHeader className="pb-2 pt-4 px-4">
                        <div className="flex items-center gap-2">
                          <Icon className="h-4 w-4 text-muted-foreground" />
                          <span className="text-sm font-semibold">{cat.category}</span>
                        </div>
                        {cat.description && (
                          <p className="text-xs text-muted-foreground">{cat.description}</p>
                        )}
                      </CardHeader>
                      <CardContent className="px-4 pb-4">
                        <div className="flex flex-wrap gap-2">
                          {cat.topics.map((topic) => {
                            const isSub    = newsTopics.includes(topic);
                            const isSaving = savingNews === topic;
                            return (
                              <button
                                key={topic}
                                onClick={() => toggleNews(topic)}
                                disabled={isSaving}
                                className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-all disabled:opacity-60 ${
                                  isSub
                                    ? 'border-primary bg-primary/10 text-primary hover:bg-primary/20'
                                    : 'border-border bg-card text-foreground hover:border-primary/40 hover:bg-accent'
                                }`}
                              >
                                {isSaving
                                  ? <Loader2 className="h-3 w-3 animate-spin" />
                                  : isSub ? <X className="h-3 w-3" /> : <Plus className="h-3 w-3" />}
                                {topic}
                              </button>
                            );
                          })}
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      )}
    </PageShell>
  );
}
