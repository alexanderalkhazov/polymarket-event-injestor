import { useEffect, useMemo, useState } from 'react';
import { Loader2, RefreshCcw, Search } from 'lucide-react';
import { PageShell } from '@/components/layout/PageShell';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { chatAPI } from '@/services/api';

type MarketEvent = {
  market_id: string;
  market_slug: string;
  question: string;
  current_price: number;
  volume: number;
  timestamp: string;
  outcome: string;
};

const pctColor = (price: number) =>
  price >= 0.7 ? 'text-primary' : price <= 0.3 ? 'text-destructive' : 'text-muted-foreground';

export function MarketsPage() {
  const [events, setEvents] = useState<MarketEvent[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [timeFilter, setTimeFilter] = useState<'all' | '1h' | '24h' | '7d'>('all');

  const load = async (showLoading = true) => {
    if (showLoading) setIsLoading(true);
    setError('');
    try {
      const res = await chatAPI.getMarketEvents('all');
      if (!res.success || !res.data) throw new Error('Unable to load markets');
      setEvents(res.data.events as MarketEvent[]);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unable to load markets');
    } finally {
      if (showLoading) setIsLoading(false);
    }
  };

  useEffect(() => {
    load();
    const timer = setInterval(() => load(false), 10_000);
    return () => clearInterval(timer);
  }, []);

  const filtered = useMemo(() => {
    const now = Date.now();
    const q = search.toLowerCase();
    return events.filter((e) => {
      if (q && !e.question.toLowerCase().includes(q) && !e.market_slug.toLowerCase().includes(q)) return false;
      if (timeFilter !== 'all') {
        const ms = timeFilter === '1h' ? 3_600_000 : timeFilter === '24h' ? 86_400_000 : 604_800_000;
        if (now - new Date(e.timestamp).getTime() > ms) return false;
      }
      return true;
    });
  }, [events, search, timeFilter]);

  return (
    <PageShell
      title="Markets"
      description="Live Polymarket events and probabilities"
      actions={
        <Button variant="outline" size="sm" onClick={() => load()} disabled={isLoading} className="gap-1.5">
          <RefreshCcw className={`h-3.5 w-3.5 ${isLoading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      }
    >
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px] max-w-xs">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search markets…"
            className="pl-8"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="flex gap-1">
          {(['all', '1h', '24h', '7d'] as const).map((t) => (
            <Button
              key={t}
              variant={timeFilter === t ? 'default' : 'outline'}
              size="sm"
              className="h-9"
              onClick={() => setTimeFilter(t)}
            >
              {t === 'all' ? 'All time' : t}
            </Button>
          ))}
        </div>
      </div>

      {/* Summary badges */}
      <div className="flex items-center gap-3 text-sm text-muted-foreground">
        <span>
          <strong className="text-foreground">{filtered.length}</strong> markets
        </span>
        {events.length !== filtered.length && <span>({events.length} total)</span>}
      </div>

      {/* Table */}
      {error ? (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">{error}</div>
      ) : isLoading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[44%]">Question</TableHead>
                  <TableHead>Outcome</TableHead>
                  <TableHead className="text-right">Probability</TableHead>
                  <TableHead className="text-right">Volume</TableHead>
                  <TableHead className="text-right">Time</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="py-8 text-center text-muted-foreground text-sm">
                      No markets match your filters
                    </TableCell>
                  </TableRow>
                ) : (
                  filtered.map((e) => (
                    <TableRow key={e.market_id} className="text-sm">
                      <TableCell className="max-w-xs">
                        <p className="line-clamp-2 font-medium leading-snug">{e.question}</p>
                        <p className="mt-0.5 text-xs text-muted-foreground">{e.market_slug}</p>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            e.outcome === 'yes'
                              ? 'default'
                              : e.outcome === 'no'
                              ? 'destructive'
                              : 'secondary'
                          }
                        >
                          {e.outcome || '—'}
                        </Badge>
                      </TableCell>
                      <TableCell className={`text-right font-mono font-medium ${pctColor(e.current_price)}`}>
                        {(e.current_price * 100).toFixed(1)}%
                      </TableCell>
                      <TableCell className="text-right text-muted-foreground">
                        ${Number(e.volume || 0).toLocaleString()}
                      </TableCell>
                      <TableCell className="text-right text-xs text-muted-foreground">
                        {new Date(e.timestamp).toLocaleTimeString()}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </PageShell>
  );
}
