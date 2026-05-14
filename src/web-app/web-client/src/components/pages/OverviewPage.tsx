import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Activity, BookMarked, RefreshCcw, TrendingUp, Wifi, WifiOff } from 'lucide-react';
import { PageShell } from '@/components/layout/PageShell';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { tradingAPI, subscriptionAPI } from '@/services/api';

interface StatCardProps {
  title: string;
  value: string | number;
  description?: string;
  icon: React.ElementType;
  accent?: 'default' | 'success' | 'destructive';
}

function StatCard({ title, value, description, icon: Icon, accent = 'default' }: StatCardProps) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
        <Icon
          className={`h-4 w-4 ${
            accent === 'success'
              ? 'text-primary'
              : accent === 'destructive'
              ? 'text-destructive'
              : 'text-muted-foreground'
          }`}
        />
      </CardHeader>
      <CardContent>
        <p className="text-2xl font-semibold tabular-nums">{value}</p>
        {description && <p className="mt-1 text-xs text-muted-foreground">{description}</p>}
      </CardContent>
    </Card>
  );
}

export function OverviewPage() {
  const [brokerHealth, setBrokerHealth] = useState<{ authenticated?: boolean } | null>(null);
  const [positions, setPositions] = useState<unknown[]>([]);
  const [openOrders, setOpenOrders] = useState<unknown[]>([]);
  const [subscribedCount, setSubscribedCount] = useState<number>(0);
  const [isLoading, setIsLoading] = useState(true);
  const [lastSynced, setLastSynced] = useState<Date | null>(null);

  const load = async () => {
    setIsLoading(true);
    try {
      const [healthRes, dashRes, subRes] = await Promise.allSettled([
        tradingAPI.getBrokerHealth(),
        tradingAPI.getDashboard(),
        subscriptionAPI.getMySubscriptions(),
      ]);

      if (healthRes.status === 'fulfilled' && healthRes.value.success) {
        setBrokerHealth(healthRes.value.data as { authenticated?: boolean });
      }
      if (dashRes.status === 'fulfilled' && dashRes.value.success) {
        const d = dashRes.value.data as Record<string, unknown>;
        const pos = Array.isArray(d.positions) ? d.positions : [];
        const ord = Array.isArray(d.openOrders) ? d.openOrders : [];
        setPositions(pos);
        setOpenOrders(ord);
      }
      if (subRes.status === 'fulfilled' && subRes.value.success) {
        setSubscribedCount((subRes.value.data as string[]).length);
      }
      setLastSynced(new Date());
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const isConnected = brokerHealth?.authenticated === true;

  return (
    <PageShell
      title="Overview"
      description="Your trading dashboard at a glance"
      actions={
        <Button variant="outline" size="sm" onClick={load} disabled={isLoading} className="gap-1.5">
          <RefreshCcw className={`h-3.5 w-3.5 ${isLoading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      }
    >
      {/* Broker status banner */}
      <div
        className={`flex items-center gap-3 rounded-lg border px-4 py-3 text-sm ${
          isConnected
            ? 'border-primary/30 bg-primary/5 text-primary'
            : 'border-destructive/30 bg-destructive/5 text-destructive'
        }`}
      >
        {isConnected ? <Wifi className="h-4 w-4" /> : <WifiOff className="h-4 w-4" />}
        <span>
          Interactive Brokers is <strong>{isConnected ? 'connected' : 'disconnected'}</strong>.
        </span>
        {!isConnected && (
          <Link to="/trading" className="ml-auto text-xs underline underline-offset-2">
            Connect →
          </Link>
        )}
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          title="Broker Status"
          value={isConnected ? 'Connected' : 'Disconnected'}
          icon={isConnected ? Wifi : WifiOff}
          accent={isConnected ? 'success' : 'destructive'}
        />
        <StatCard
          title="Subscribed Tickers"
          value={subscribedCount}
          description="Active stock subscriptions"
          icon={BookMarked}
          accent="success"
        />
        <StatCard
          title="Open Positions"
          value={positions.length}
          description="Live positions via IBKR"
          icon={TrendingUp}
        />
        <StatCard
          title="Open Orders"
          value={openOrders.length}
          description="Pending broker orders"
          icon={Activity}
        />
      </div>

      {/* Quick links */}
      <div>
        <h2 className="mb-3 text-sm font-medium text-muted-foreground">Quick actions</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {[
            { to: '/subscriptions', label: 'Manage Subscriptions', icon: BookMarked },
            { to: '/markets', label: 'Browse Markets', icon: TrendingUp },
            { to: '/trading', label: 'Place Trade', icon: Activity },
            { to: '/chat', label: 'Ask AI', icon: Activity },
          ].map(({ to, label, icon: Icon }) => (
            <Link
              key={to}
              to={to}
              className="flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2.5 text-sm text-foreground transition-colors hover:bg-accent"
            >
              <Icon className="h-4 w-4 text-muted-foreground" />
              {label}
            </Link>
          ))}
        </div>
      </div>

      {lastSynced && (
        <p className="text-xs text-muted-foreground">
          Last synced: {lastSynced.toLocaleTimeString()}
        </p>
      )}
    </PageShell>
  );
}
