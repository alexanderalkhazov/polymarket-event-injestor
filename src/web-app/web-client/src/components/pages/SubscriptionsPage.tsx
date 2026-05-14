import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, Plus, RefreshCcw, Search, TrendingDown, TrendingUp, X, Zap } from 'lucide-react';
import { PageShell } from '@/components/layout/PageShell';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useAuth } from '@/context/AuthContext';
import {
  subscriptionAPI,
  type MarketQuote,
  type RecommendationSection,
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

const RISK_LABEL: Record<string, string> = {
  conservative: 'Conservative',
  moderate:     'Moderate',
  aggressive:   'Aggressive',
};

function fmtPrice(p?: number): string {
  if (p == null) return '—';
  if (p >= 10_000) return `$${(p / 1000).toFixed(1)}k`;
  if (p >= 1_000)  return `$${p.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return `$${p.toFixed(p < 1 ? 4 : 2)}`;
}
function fmtPct(p?: number): string {
  if (p == null) return '';
  return `${p >= 0 ? '+' : ''}${p.toFixed(2)}%`;
}
function fmtVol(v?: number): string {
  if (v == null) return '';
  if (v >= 1_000_000_000) return `${(v / 1_000_000_000).toFixed(1)}B`;
  if (v >= 1_000_000)     return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000)         return `${(v / 1_000).toFixed(0)}K`;
  return String(v);
}

// ---------------------------------------------------------------------------
// Shared instrument row
// ---------------------------------------------------------------------------
function InstrumentRow({ stock, saving, onToggle }: {
  stock: MarketQuote;
  saving: string | null;
  onToggle: (sym: string) => void;
}) {
  const up = (stock.changePct ?? 0) >= 0;
  return (
    <div className="flex items-center justify-between px-4 py-3 text-sm transition-colors hover:bg-accent/40">
      <div className="min-w-0 flex-1 pr-4">
        <div className="flex items-center gap-2">
          <span className="font-semibold tracking-tight">{stock.symbol}</span>
          {stock.type && !['EQUITY', 'Equity'].includes(stock.type) && (
            <Badge variant="outline" className="px-1.5 py-0 text-[10px]">{stock.type}</Badge>
          )}
          {stock.exchange && (
            <span className="text-[10px] text-muted-foreground">{stock.exchange}</span>
          )}
        </div>
        {stock.name && <p className="mt-0.5 truncate text-xs text-muted-foreground">{stock.name}</p>}
      </div>

      {stock.price != null && (
        <div className="mr-4 shrink-0 min-w-[80px] text-right">
          <p className="text-sm font-medium tabular-nums">{fmtPrice(stock.price)}</p>
          {stock.changePct != null && (
            <div className={`flex items-center justify-end gap-0.5 text-xs font-medium ${up ? 'text-emerald-400' : 'text-red-400'}`}>
              {up ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
              {fmtPct(stock.changePct)}
            </div>
          )}
        </div>
      )}

      {stock.volume != null && (
        <span className="mr-4 shrink-0 text-[11px] text-muted-foreground tabular-nums hidden sm:block">
          {fmtVol(stock.volume)}
        </span>
      )}

      <Button
        variant="ghost" size="sm"
        className="h-7 shrink-0 gap-1 text-primary hover:bg-primary/10 hover:text-primary"
        disabled={saving === stock.symbol}
        onClick={() => onToggle(stock.symbol)}
      >
        {saving === stock.symbol ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
        Add
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Watchlist price card
// ---------------------------------------------------------------------------
function WatchlistCard({ symbol, quote, loadingPrice, saving, onRemove }: {
  symbol: string;
  quote?: MarketQuote;
  loadingPrice: boolean;
  saving: string | null;
  onRemove: (sym: string) => void;
}) {
  const up = (quote?.changePct ?? 0) >= 0;
  return (
    <div className="relative flex w-36 shrink-0 flex-col rounded-xl border bg-card p-3 shadow-sm">
      <button
        className="absolute right-2 top-2 rounded text-muted-foreground transition-colors hover:text-destructive disabled:opacity-40"
        disabled={saving === symbol}
        onClick={() => onRemove(symbol)}
      >
        {saving === symbol ? <Loader2 className="h-3 w-3 animate-spin" /> : <X className="h-3 w-3" />}
      </button>
      <p className="pr-5 text-sm font-bold tracking-tight">{symbol}</p>
      {quote?.name && <p className="mt-0.5 truncate text-[10px] text-muted-foreground">{quote.name}</p>}
      {loadingPrice ? (
        <Loader2 className="mt-2 h-4 w-4 animate-spin text-muted-foreground" />
      ) : (
        <div className="mt-2">
          <p className="text-base font-semibold tabular-nums">{fmtPrice(quote?.price)}</p>
          {quote?.changePct != null && (
            <div className={`mt-0.5 flex items-center gap-0.5 text-xs font-medium ${up ? 'text-emerald-400' : 'text-red-400'}`}>
              {up ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
              {fmtPct(quote.changePct)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Column header
// ---------------------------------------------------------------------------
function TableHeader() {
  return (
    <div className="flex items-center px-4 py-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground border-b border-border">
      <span className="flex-1">Symbol / Name</span>
      <span className="mr-[88px] hidden sm:block">Volume</span>
      <span className="mr-[60px] w-20 text-right">Price</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------
export function SubscriptionsPage() {
  const { user } = useAuth();

  const [subscribed,       setSubscribed]       = useState<string[]>([]);
  const [watchlistMap,     setWatchlistMap]      = useState<Map<string, MarketQuote>>(new Map());
  const [recommendations,  setRecommendations]  = useState<RecommendationSection[]>([]);
  const [recProfile,       setRecProfile]        = useState<{ riskTolerance: string; preferredAssets: string[] } | null>(null);
  const [browseResults,    setBrowseResults]     = useState<MarketQuote[]>([]);
  const [browseSource,     setBrowseSource]      = useState('');

  const [activeTab,     setActiveTab]     = useState<'foryou' | 'browse'>('foryou');
  const [secType,       setSecType]       = useState<SecType>('STK');
  const [search,        setSearch]        = useState('');
  const [loadingInit,   setLoadingInit]   = useState(true);
  const [loadingRecs,   setLoadingRecs]   = useState(false);
  const [loadingBrowse, setLoadingBrowse] = useState(false);
  const [loadingPrices, setLoadingPrices] = useState(false);
  const [saving,        setSaving]        = useState<string | null>(null);

  const debounceRef    = useRef<ReturnType<typeof setTimeout> | null>(null);
  const browseTouched  = useRef(false);

  // --- Refresh watchlist prices ---
  const refreshPrices = useCallback(async (syms: string[]) => {
    if (!syms.length) { setWatchlistMap(new Map()); return; }
    setLoadingPrices(true);
    try {
      const res = await subscriptionAPI.getQuotes(syms);
      if (res.success && res.data) setWatchlistMap(new Map(res.data.map((q) => [q.symbol, q])));
    } finally {
      setLoadingPrices(false);
    }
  }, []);

  // --- Initial load ---
  useEffect(() => {
    (async () => {
      setLoadingInit(true);
      setLoadingRecs(true);
      const [subsRes, recsRes] = await Promise.allSettled([
        subscriptionAPI.getMySubscriptions(),
        subscriptionAPI.getRecommendations(),
      ]);
      let syms: string[] = [];
      if (subsRes.status === 'fulfilled' && subsRes.value.success) {
        syms = subsRes.value.data ?? [];
        setSubscribed(syms);
      }
      if (recsRes.status === 'fulfilled' && recsRes.value.success) {
        setRecommendations(recsRes.value.data ?? []);
        if (recsRes.value.profile) setRecProfile(recsRes.value.profile);
      }
      setLoadingInit(false);
      setLoadingRecs(false);
      if (syms.length) refreshPrices(syms);
    })();
  }, [refreshPrices]);

  // --- Browse fetch (debounced) ---
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
    if (activeTab !== 'browse') return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchBrowse(search, secType), 350);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [search, secType, activeTab, fetchBrowse]);

  useEffect(() => {
    if (activeTab === 'browse' && !browseTouched.current) {
      browseTouched.current = true;
      fetchBrowse('', secType);
    }
  }, [activeTab, secType, fetchBrowse]);

  // --- Toggle subscribe / unsubscribe ---
  const toggle = useCallback(async (symbol: string) => {
    setSaving(symbol);
    try {
      let newSubs: string[];
      if (subscribed.includes(symbol)) {
        const res = await subscriptionAPI.removeTicker(symbol);
        newSubs = res.data ?? subscribed.filter((s) => s !== symbol);
      } else {
        const res = await subscriptionAPI.addTicker(symbol);
        newSubs = res.data ?? [...subscribed, symbol];
      }
      setSubscribed(newSubs);
      refreshPrices(newSubs);
    } finally {
      setSaving(null);
    }
  }, [subscribed, refreshPrices]);

  // --- Derived ---
  const profile = user?.tradingProfile;
  const riskLabel = RISK_LABEL[recProfile?.riskTolerance ?? profile?.riskTolerance ?? 'moderate'] ?? 'Moderate';
  const recsFiltered = recommendations
    .map((sec) => ({ ...sec, items: sec.items.filter((s) => !subscribed.includes(s.symbol)) }))
    .filter((sec) => sec.items.length > 0);
  const browsedUnsubscribed = browseResults.filter((s) => !subscribed.includes(s.symbol));

  // =========================================================================
  return (
    <PageShell
      title="Subscriptions"
      description="Track live instruments tailored to your profile. Real-time data from Yahoo Finance."
    >
      {/* ---- Watchlist ---- */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium">
            Watchlist
            <Badge variant="secondary" className="ml-2 text-xs">{subscribed.length}</Badge>
          </h2>
          {subscribed.length > 0 && (
            <Button variant="ghost" size="sm" className="h-7 gap-1.5 text-xs" disabled={loadingPrices} onClick={() => refreshPrices(subscribed)}>
              <RefreshCcw className={`h-3 w-3 ${loadingPrices ? 'animate-spin' : ''}`} />
              Refresh prices
            </Button>
          )}
        </div>
        {subscribed.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border p-6 text-center">
            <p className="text-sm text-muted-foreground">Your watchlist is empty — add instruments below.</p>
          </div>
        ) : (
          <div className="flex gap-3 overflow-x-auto pb-1">
            {subscribed.map((sym) => (
              <WatchlistCard
                key={sym}
                symbol={sym}
                quote={watchlistMap.get(sym)}
                loadingPrice={loadingPrices}
                saving={saving}
                onRemove={toggle}
              />
            ))}
          </div>
        )}
      </section>

      {/* ---- Tab bar ---- */}
      <div className="flex border-b border-border">
        {(['foryou', 'browse'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              activeTab === tab
                ? 'border-primary text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {tab === 'foryou' ? 'For You' : 'Browse'}
          </button>
        ))}
      </div>

      {/* ---- For You tab ---- */}
      {activeTab === 'foryou' && (
        <div className="space-y-6">
          {/* Profile context */}
          {(recProfile || profile) && (
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span>Tailored for:</span>
              <Badge variant="outline" className="text-[10px]">{riskLabel} Risk</Badge>
              {(recProfile?.preferredAssets ?? (profile?.preferredAssets as string[]) ?? []).map((a) => (
                <Badge key={a} variant="outline" className="text-[10px] capitalize">{a.replace('_', ' ')}</Badge>
              ))}
              {!user?.onboardingComplete && (
                <span className="text-amber-400">
                  · <a href="/settings" className="underline">Update your profile</a> for better picks
                </span>
              )}
            </div>
          )}

          {loadingRecs ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : recsFiltered.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border p-10 text-center">
              <p className="text-sm text-muted-foreground">
                {loadingInit ? 'Loading…' : 'All recommended instruments are in your watchlist, or market data is temporarily unavailable.'}
              </p>
            </div>
          ) : (
            recsFiltered.map(({ section, items }) => (
              <div key={section}>
                <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{section}</h3>
                <Card>
                  <CardContent className="p-0">
                    <TableHeader />
                    <div className="divide-y divide-border">
                      {items.slice(0, 20).map((stock) => (
                        <InstrumentRow key={stock.symbol} stock={stock} saving={saving} onToggle={toggle} />
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </div>
            ))
          )}
        </div>
      )}

      {/* ---- Browse tab ---- */}
      {activeTab === 'browse' && (
        <Card>
          <CardHeader className="space-y-3 pb-3">
            {/* SecType pills */}
            <div className="flex flex-wrap gap-1">
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
            {/* Search */}
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              {loadingBrowse && <Loader2 className="absolute right-2.5 top-2.5 h-4 w-4 animate-spin text-muted-foreground" />}
              <Input
                placeholder={`Search ${SEC_TYPES.find((s) => s.value === secType)?.label ?? secType} by symbol or name…`}
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
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : browsedUnsubscribed.length === 0 ? (
              <p className="px-6 py-8 text-sm text-muted-foreground">
                {search ? 'No results found.' : 'Start typing to search instruments.'}
              </p>
            ) : (
              <>
                <TableHeader />
                <div className="divide-y divide-border">
                  {browsedUnsubscribed.map((stock) => (
                    <InstrumentRow key={stock.symbol} stock={stock} saving={saving} onToggle={toggle} />
                  ))}
                </div>
                <p className="px-4 py-2 text-[11px] text-muted-foreground">
                  {browsedUnsubscribed.length} result{browsedUnsubscribed.length !== 1 ? 's' : ''}
                </p>
              </>
            )}
          </CardContent>
        </Card>
      )}
    </PageShell>
  );
}
