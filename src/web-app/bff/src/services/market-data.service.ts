/**
 * Market data service — wraps Yahoo Finance public APIs.
 * No API key required. Results are cached in-memory with a short TTL.
 */

const YF1 = 'https://query1.finance.yahoo.com';
const YF2 = 'https://query2.finance.yahoo.com';
const TIMEOUT_MS = 8_000;

const YF_HEADERS: Record<string, string> = {
  Accept: 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  'User-Agent': 'Mozilla/5.0 (compatible; TradingDashboard/1.0)',
  Origin: 'https://finance.yahoo.com',
  Referer: 'https://finance.yahoo.com/',
};

// ---------------------------------------------------------------------------
// Simple TTL cache
// ---------------------------------------------------------------------------
interface CacheEntry { data: unknown; exp: number }
const _cache = new Map<string, CacheEntry>();

async function cached<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const hit = _cache.get(key);
  if (hit && hit.exp > Date.now()) return hit.data as T;
  const data = await fn();
  _cache.set(key, { data, exp: Date.now() + ttlMs });
  return data;
}

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------
export interface MarketQuote {
  symbol: string;
  name: string;
  price?: number;
  change?: number;
  changePct?: number;
  volume?: number;
  marketCap?: number;
  exchange?: string;
  type?: string;
}

export interface RecommendationSection {
  section: string;
  items: MarketQuote[];
}

// ---------------------------------------------------------------------------
// secType → Yahoo Finance quoteType/typeDisp regex filter
// ---------------------------------------------------------------------------
const SEC_TYPE_FILTER: Record<string, RegExp> = {
  STK:    /equity/i,
  ETF:    /^etf$/i,
  FUT:    /future/i,
  IND:    /index/i,
  CRYPTO: /crypto/i,
  FOREX:  /currency/i,
};

// ---------------------------------------------------------------------------
// Screener presets per risk profile
// ---------------------------------------------------------------------------
const RISK_SCREENERS: Record<string, [string, string]> = {
  conservative: ['portfolio_anchors', 'undervalued_large_caps'],
  moderate:     ['most_actives', 'undervalued_growth_stocks'],
  aggressive:   ['aggressive_small_caps', 'growth_technology_stocks'],
};

// Default symbols by asset class when no search query
const ASSET_DEFAULTS: Record<string, string[]> = {
  crypto:  ['BTC-USD', 'ETH-USD', 'SOL-USD', 'BNB-USD', 'XRP-USD', 'DOGE-USD', 'ADA-USD', 'AVAX-USD'],
  futures: ['ES=F', 'NQ=F', 'YM=F', 'RTY=F', 'CL=F', 'GC=F', 'SI=F', 'ZB=F', 'ZN=F', 'NG=F'],
  etfs:    ['SPY', 'QQQ', 'IWM', 'EFA', 'AGG', 'GLD', 'VTI', 'ARKK', 'XLF', 'XLK'],
  forex:   ['EURUSD=X', 'GBPUSD=X', 'USDJPY=X', 'USDCHF=X', 'AUDUSD=X', 'USDCAD=X', 'NZDUSD=X'],
};

// ---------------------------------------------------------------------------
// Quote mapper
// ---------------------------------------------------------------------------
function mapQuote(q: Record<string, unknown>): MarketQuote {
  return {
    symbol:    String(q.symbol ?? ''),
    name:      String(q.shortName ?? q.longName ?? q.displayName ?? ''),
    price:     typeof q.regularMarketPrice === 'number' ? q.regularMarketPrice : undefined,
    change:    typeof q.regularMarketChange === 'number' ? q.regularMarketChange : undefined,
    changePct: typeof q.regularMarketChangePercent === 'number' ? q.regularMarketChangePercent : undefined,
    volume:    typeof q.regularMarketVolume === 'number' ? q.regularMarketVolume : undefined,
    marketCap: typeof q.marketCap === 'number' ? q.marketCap : undefined,
    exchange:  String(q.fullExchangeName ?? q.exchange ?? ''),
    type:      String(q.quoteType ?? ''),
  };
}

// ---------------------------------------------------------------------------
// Service class
// ---------------------------------------------------------------------------
class MarketDataService {
  private async yfFetch<T>(url: string): Promise<T> {
    const res = await fetch(url, {
      headers: YF_HEADERS,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`Yahoo Finance HTTP ${res.status}`);
    return res.json() as Promise<T>;
  }

  /** Symbol search — returns names + exchange (no prices), optionally filtered by secType */
  async search(query: string, limit = 12, secType?: string): Promise<MarketQuote[]> {
    const cacheKey = `search:${query}:${limit}:${secType ?? ''}`;
    return cached(cacheKey, 30_000, async () => {
      const url = `${YF1}/v1/finance/search?q=${encodeURIComponent(query)}&quotesCount=${limit}&newsCount=0&listsCount=0`;
      const data = await this.yfFetch<{ quotes?: Record<string, unknown>[] }>(url);
      const all = (data.quotes ?? []).map((q) => ({
        symbol:   String(q.symbol ?? ''),
        name:     String(q.shortname ?? q.longname ?? ''),
        exchange: String(q.exchDisp ?? ''),
        type:     String(q.typeDisp ?? q.quoteType ?? ''),
      }));

      // Filter by secType when specified
      const regex = secType ? SEC_TYPE_FILTER[secType.toUpperCase()] : undefined;
      const filtered = regex ? all.filter((q) => regex.test(q.type)) : all;

      // If filtering eliminated all results, try direct symbol quote lookup as fallback
      // (e.g. user types "^GSPC" on Indices tab, or "ES=F" on Futures tab)
      if (regex && filtered.length === 0 && query.length <= 20) {
        try {
          const directQuotes = await this.getQuotes([query]);
          const match = directQuotes.filter((q) => q.symbol);
          if (match.length) return match;
        } catch { /* ignore */ }
      }

      return filtered;
    });
  }

  /** Batch real-time quotes — max 50 symbols */
  async getQuotes(symbols: string[]): Promise<MarketQuote[]> {
    if (!symbols.length) return [];
    const uniq = [...new Set(symbols)].slice(0, 50);
    return cached(`quotes:${uniq.sort().join(',')}`, 15_000, async () => {
      const url = `${YF2}/v7/finance/quote?symbols=${encodeURIComponent(uniq.join(','))}`;
      const data = await this.yfFetch<{
        quoteResponse?: { result?: Record<string, unknown>[] };
      }>(url);
      return (data.quoteResponse?.result ?? []).map(mapQuote);
    });
  }

  /** Predefined Yahoo Finance screener */
  async getScreener(scrId: string, count = 25): Promise<MarketQuote[]> {
    return cached(`screener:${scrId}`, 120_000, async () => {
      const url = `${YF1}/v1/finance/screener/predefined/saved?scrIds=${scrId}&count=${count}&formatted=false`;
      const data = await this.yfFetch<{
        finance?: { result?: Array<{ quotes?: Record<string, unknown>[] }> };
      }>(url);
      return (data.finance?.result?.[0]?.quotes ?? []).map(mapQuote);
    });
  }

  /** Default live symbols to display for a given instrument type with no search query */
  async getDefaultsForSecType(secType: string): Promise<MarketQuote[]> {
    switch (secType.toUpperCase()) {
      case 'FUT':    return this.getQuotes(ASSET_DEFAULTS.futures).catch(() => []);
      case 'CRYPTO': return this.getQuotes(ASSET_DEFAULTS.crypto).catch(() => []);
      case 'ETF':    return this.getQuotes(ASSET_DEFAULTS.etfs).catch(() => []);
      case 'FOREX':  return this.getQuotes(ASSET_DEFAULTS.forex).catch(() => []);
      case 'IND':    return this.getQuotes(['^GSPC', '^NDX', '^DJI', '^RUT', '^VIX', '^FTSE', '^N225', '^HSI']).catch(() => []);
      case 'STK':    return this.getScreener('most_actives', 30).catch(() => []);
      default:       return [];
    }
  }

  /** Build recommendation sections tailored to the user's trading profile */
  async getRecommendationsForProfile(
    riskTolerance: string,
    preferredAssets: string[],
  ): Promise<RecommendationSection[]> {
    const out: RecommendationSection[] = [];
    const assets = preferredAssets.length ? preferredAssets : ['stocks'];

    // ---- Stocks via screener ------------------------------------------------
    if (assets.includes('stocks')) {
      const [primary, secondary] = RISK_SCREENERS[riskTolerance] ?? RISK_SCREENERS.moderate;
      const [a, b] = await Promise.allSettled([
        this.getScreener(primary, 20),
        this.getScreener(secondary, 15),
      ]);
      if (a.status === 'fulfilled' && a.value.length) {
        const label = {
          conservative: 'Stable Large-Caps',
          moderate:     'Most Active Stocks',
          aggressive:   'High-Growth Opportunities',
        }[riskTolerance] ?? 'Recommended Stocks';
        out.push({ section: label, items: a.value });
      }
      if (b.status === 'fulfilled' && b.value.length) {
        out.push({ section: 'Also Interesting', items: b.value });
      }
    }

    // ---- ETFs ---------------------------------------------------------------
    if (assets.includes('etfs')) {
      const items = await this.getQuotes(ASSET_DEFAULTS.etfs).catch(() => []);
      if (items.length) out.push({ section: 'Popular ETFs', items });
    }

    // ---- Crypto -------------------------------------------------------------
    if (assets.includes('crypto') || assets.includes('prediction_markets')) {
      const items = await this.getQuotes(ASSET_DEFAULTS.crypto).catch(() => []);
      if (items.length) out.push({ section: 'Crypto', items });
    }

    // ---- Futures ------------------------------------------------------------
    if (assets.includes('futures')) {
      const items = await this.getQuotes(ASSET_DEFAULTS.futures).catch(() => []);
      if (items.length) out.push({ section: 'Futures', items });
    }

    // ---- Forex --------------------------------------------------------------
    if (assets.includes('forex')) {
      const items = await this.getQuotes(ASSET_DEFAULTS.forex).catch(() => []);
      if (items.length) out.push({ section: 'Forex', items });
    }

    return out;
  }
}

export default new MarketDataService();
