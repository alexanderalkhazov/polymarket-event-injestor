import { useEffect, useState } from 'react';
import { Loader2, Plus, RefreshCcw, Search, X } from 'lucide-react';
import { PageShell } from '@/components/layout/PageShell';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { polymarketSubscriptionAPI, type PolymarketInfo } from '@/services/api';

export function PolymarketSubscriptionsPage() {
  const [universe, setUniverse] = useState<PolymarketInfo[]>([]);
  const [subscribed, setSubscribed] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);

  const load = async () => {
    setIsLoading(true);
    try {
      const [univ, subs] = await Promise.all([
        polymarketSubscriptionAPI.getUniverse(),
        polymarketSubscriptionAPI.getMySubscriptions(),
      ]);
      if (univ.success && univ.data) setUniverse(univ.data);
      if (subs.success && subs.data) setSubscribed(subs.data);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const toggle = async (marketId: string) => {
    setSaving(marketId);
    try {
      if (subscribed.includes(marketId)) {
        const res = await polymarketSubscriptionAPI.removeMarket(marketId);
        if (res.success) setSubscribed(res.data ?? []);
      } else {
        const res = await polymarketSubscriptionAPI.addMarket(marketId);
        if (res.success) setSubscribed(res.data ?? []);
      }
    } finally {
      setSaving(null);
    }
  };

  const q = search.trim().toLowerCase();
  const filtered = universe.filter(
    ({ market_id, slug }) =>
      !q || slug.toLowerCase().includes(q) || market_id.toLowerCase().includes(q)
  );

  const subscribedMarkets = universe.filter((m) => subscribed.includes(m.market_id));
  const unsubscribed = filtered.filter((m) => !subscribed.includes(m.market_id));

  const labelFor = (m: PolymarketInfo) => m.slug || m.market_id;

  return (
    <PageShell
      title="Polymarket Subscriptions"
      description="Choose which prediction markets feed into your AI signals and event stream"
      actions={
        <Button variant="outline" size="sm" onClick={load} disabled={isLoading} className="gap-1.5">
          <RefreshCcw className={`h-3.5 w-3.5 ${isLoading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      }
    >
      {/* Active subscriptions */}
      <div>
        <h2 className="mb-3 text-sm font-medium text-muted-foreground">
          Active subscriptions{' '}
          <Badge variant="secondary" className="ml-1 text-xs">
            {subscribed.length}
          </Badge>
        </h2>
        {subscribedMarkets.length === 0 ? (
          <p className="text-sm text-muted-foreground">No markets subscribed yet. Add them below.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {subscribedMarkets.map((m) => (
              <div
                key={m.market_id}
                className="flex items-center gap-1.5 rounded-md border border-primary/30 bg-primary/10 px-2.5 py-1 text-sm text-primary"
              >
                <span className="max-w-[220px] truncate font-medium" title={m.slug}>
                  {labelFor(m)}
                </span>
                <button
                  className="ml-1 rounded hover:text-destructive disabled:opacity-50"
                  disabled={saving === m.market_id}
                  onClick={() => toggle(m.market_id)}
                >
                  {saving === m.market_id ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <X className="h-3 w-3" />
                  )}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Universe search */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium">Market Universe</CardTitle>
          <div className="relative mt-2">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by slug or market ID…"
              className="pl-8"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : universe.length === 0 ? (
            <div className="px-6 py-8 text-center">
              <p className="text-sm text-muted-foreground">
                No markets found in the seeded universe. Run{' '}
                <code className="rounded bg-muted px-1 text-xs">scripts/seed_subscriptions.py</code>{' '}
                to populate Polymarket markets.
              </p>
            </div>
          ) : unsubscribed.length === 0 ? (
            <p className="px-6 py-6 text-sm text-muted-foreground">
              {q ? 'No results.' : 'All markets subscribed!'}
            </p>
          ) : (
            <div className="divide-y divide-border">
              {unsubscribed.map((m) => (
                <div
                  key={m.market_id}
                  className="flex items-center justify-between px-6 py-3 text-sm transition-colors hover:bg-accent/50"
                >
                  <div className="min-w-0 flex-1 pr-4">
                    <p className="truncate font-medium" title={m.question}>{m.slug || '—'}</p>
                    <p className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">
                      {m.market_id}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 shrink-0 gap-1 text-primary hover:text-primary"
                    disabled={saving === m.market_id}
                    onClick={() => toggle(m.market_id)}
                  >
                    {saving === m.market_id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Plus className="h-3.5 w-3.5" />
                    )}
                    Subscribe
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Counts */}
      {!isLoading && universe.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Showing {unsubscribed.length} of {universe.length - subscribedMarkets.length} unsubscribed markets
          {q && ` matching "${q}"`}
        </p>
      )}
    </PageShell>
  );
}
