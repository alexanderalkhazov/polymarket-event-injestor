import { useEffect, useState } from 'react';
import {
  BarChart3, Cpu, Globe, Landmark, Loader2, Newspaper,
  Plus, Shield, X, Zap,
} from 'lucide-react';
import { PageShell } from '@/components/layout/PageShell';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { newsSubscriptionAPI, type NewsTopicCategory } from '@/services/api';

// ---------------------------------------------------------------------------
// Icon mapping per category
// ---------------------------------------------------------------------------
const CATEGORY_ICONS: Record<string, React.ElementType> = {
  'Geopolitics':                      Globe,
  'Trade & Economics':                BarChart3,
  'Central Banks & Monetary Policy':  Landmark,
  'Defense & Weapons':                Shield,
  'Energy & Commodities':             Zap,
  'Financial Markets':                BarChart3,
  'Technology & AI':                  Cpu,
};

const CATEGORY_COLORS: Record<string, string> = {
  'Geopolitics':                      'text-red-400',
  'Trade & Economics':                'text-blue-400',
  'Central Banks & Monetary Policy':  'text-yellow-400',
  'Defense & Weapons':                'text-orange-400',
  'Energy & Commodities':             'text-amber-400',
  'Financial Markets':                'text-emerald-400',
  'Technology & AI':                  'text-purple-400',
};

// ---------------------------------------------------------------------------
// Topic chip
// ---------------------------------------------------------------------------
function TopicChip({
  topic,
  subscribed,
  saving,
  onToggle,
}: {
  topic: string;
  subscribed: boolean;
  saving: string | null;
  onToggle: (t: string) => void;
}) {
  const isSaving = saving === topic;
  return (
    <button
      onClick={() => onToggle(topic)}
      disabled={isSaving}
      className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-all ${
        subscribed
          ? 'border-primary bg-primary/10 text-primary'
          : 'border-border bg-card text-foreground hover:border-primary/50 hover:bg-accent'
      } disabled:opacity-60`}
    >
      {isSaving ? (
        <Loader2 className="h-3 w-3 animate-spin" />
      ) : subscribed ? (
        <X className="h-3 w-3" />
      ) : (
        <Plus className="h-3 w-3" />
      )}
      {topic}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Category card
// ---------------------------------------------------------------------------
function CategoryCard({
  cat,
  subscribedTopics,
  saving,
  onToggle,
}: {
  cat: NewsTopicCategory;
  subscribedTopics: string[];
  saving: string | null;
  onToggle: (t: string) => void;
}) {
  const Icon = CATEGORY_ICONS[cat.category] ?? Newspaper;
  const colorClass = CATEGORY_COLORS[cat.category] ?? 'text-muted-foreground';
  const subCount = cat.topics.filter((t) => subscribedTopics.includes(t)).length;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2">
            <Icon className={`h-4 w-4 shrink-0 ${colorClass}`} />
            <div>
              <p className="text-sm font-semibold">{cat.category}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">{cat.description}</p>
            </div>
          </div>
          {subCount > 0 && (
            <Badge variant="secondary" className="shrink-0 text-[10px]">
              {subCount}/{cat.topics.length}
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="pb-4">
        <div className="flex flex-wrap gap-2">
          {cat.topics.map((topic) => (
            <TopicChip
              key={topic}
              topic={topic}
              subscribed={subscribedTopics.includes(topic)}
              saving={saving}
              onToggle={onToggle}
            />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------
export function NewsBrowsePage() {
  const [catalog,    setCatalog]    = useState<NewsTopicCategory[]>([]);
  const [subscribed, setSubscribed] = useState<string[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [saving,     setSaving]     = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const [catRes, subRes] = await Promise.allSettled([
        newsSubscriptionAPI.getCatalog(),
        newsSubscriptionAPI.getMyTopics(),
      ]);
      if (catRes.status === 'fulfilled' && catRes.value.success) setCatalog(catRes.value.data ?? []);
      if (subRes.status === 'fulfilled' && subRes.value.success) setSubscribed(subRes.value.data ?? []);
      setLoading(false);
    })();
  }, []);

  const toggle = async (topic: string) => {
    setSaving(topic);
    try {
      if (subscribed.includes(topic)) {
        const res = await newsSubscriptionAPI.removeTopic(topic);
        if (res.success) setSubscribed(res.data ?? subscribed.filter((t) => t !== topic));
      } else {
        const res = await newsSubscriptionAPI.addTopic(topic);
        if (res.success) setSubscribed(res.data ?? [...subscribed, topic]);
      }
    } finally {
      setSaving(null);
    }
  };

  return (
    <PageShell
      title="News Topics"
      description="Subscribe to topics that matter for your trading. AI uses these to surface relevant intelligence."
    >
      {/* Subscribed summary */}
      {subscribed.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card px-4 py-3">
          <Newspaper className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="text-xs text-muted-foreground">Subscribed:</span>
          {subscribed.map((t) => (
            <Badge key={t} variant="secondary" className="text-[10px]">{t}</Badge>
          ))}
          <span className="ml-auto text-[10px] text-muted-foreground">{subscribed.length} topic{subscribed.length !== 1 ? 's' : ''}</span>
        </div>
      )}

      {/* Topic categories */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {catalog.map((cat) => (
            <CategoryCard
              key={cat.category}
              cat={cat}
              subscribedTopics={subscribed}
              saving={saving}
              onToggle={toggle}
            />
          ))}
        </div>
      )}

      {/* Help text */}
      <p className="text-xs text-muted-foreground">
        News is filtered by your selected topics in real time. The AI assistant uses these to contextualise market events and trading signals.
      </p>
    </PageShell>
  );
}
