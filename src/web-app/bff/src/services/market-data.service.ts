/**
 * Market data service — wraps Yahoo Finance public APIs.
 * No API key required. Results are cached in-memory with a short TTL.
 */

const YF1 = 'https://query1.finance.yahoo.com';
const YF2 = 'https://query2.finance.yahoo.com';
const CG_BASE = 'https://api.coingecko.com/api/v3';
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

// Yahoo Finance session crumb (required for ^-prefix index quotes since ~2024)
let _crumbCache: { crumb: string; cookie: string; exp: number } | null = null;

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
  crypto:  [
    'BTC-USD', 'ETH-USD', 'SOL-USD', 'BNB-USD', 'XRP-USD', 'DOGE-USD',
    'ADA-USD', 'AVAX-USD', 'TRX-USD', 'LINK-USD', 'TON-USD', 'SHIB-USD',
    'DOT-USD', 'MATIC-USD', 'LTC-USD', 'UNI-USD', 'ATOM-USD', 'XLM-USD',
    'BCH-USD', 'NEAR-USD', 'APT-USD', 'OP-USD', 'ARB-USD', 'FIL-USD', 'SUI-USD',
  ],
  futures: [
    'ES=F', 'NQ=F', 'YM=F', 'RTY=F', 'CL=F', 'GC=F', 'SI=F',
    'ZB=F', 'ZN=F', 'NG=F', 'HG=F', 'PL=F', 'ZC=F', 'ZW=F', 'ZS=F',
    'LE=F', 'HE=F', 'GF=F', 'CC=F', 'KC=F', 'CT=F', 'SB=F', 'PA=F',
  ],
  etfs:    [
    'SPY', 'QQQ', 'IWM', 'EFA', 'AGG', 'GLD', 'VTI', 'ARKK',
    'XLF', 'XLK', 'XLE', 'XLV', 'XLI', 'XLB', 'XLP', 'XLU',
    'VNQ', 'LQD', 'HYG', 'TLT', 'BND', 'VWO', 'DIA', 'IAU', 'SLV',
  ],
  forex:   [
    'EURUSD=X', 'GBPUSD=X', 'USDJPY=X', 'USDCHF=X', 'AUDUSD=X',
    'USDCAD=X', 'NZDUSD=X', 'USDCNH=X', 'USDSEK=X', 'USDHKD=X',
    'USDSGD=X', 'USDMXN=X', 'USDINR=X', 'USDBRL=X', 'USDKRW=X',
    'EURGBP=X', 'EURJPY=X', 'GBPJPY=X', 'AUDJPY=X', 'CADJPY=X',
  ],
  indices: [
    '^GSPC', '^NDX', '^DJI', '^RUT', '^VIX', '^FTSE', '^N225', '^HSI',
    '^GDAXI', '^FCHI', '^STOXX50E', '^AXJO', '^BSESN', '^NSEI',
    '^KS11', '^TWII', '^STI', '^MXX', '^BOVESPA', '^TA125.TA',
    '^NYA', '^XAX', '^BUK100P', '^N100', '^IBEX',
  ],
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

  private async genericFetch<T>(url: string): Promise<T> {
    const res = await fetch(url, {
      headers: { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0 (compatible; TradingDashboard/1.0)' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json() as Promise<T>;
  }

  /**
   * Obtain a Yahoo Finance session crumb (needed for index quotes).
   * Result cached for 50 minutes; re-fetched automatically when expired.
   */
  private async ensureCrumb(): Promise<{ crumb: string; cookie: string }> {
    if (_crumbCache && _crumbCache.exp > Date.now()) {
      return { crumb: _crumbCache.crumb, cookie: _crumbCache.cookie };
    }
    const baseHeaders = { ...YF_HEADERS };
    // 1. Hit fc.yahoo.com to obtain a session cookie
    const cookieRes = await fetch('https://fc.yahoo.com', {
      headers: baseHeaders,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const rawCookie = (cookieRes.headers.get('set-cookie') ?? '').split(';')[0];
    // 2. Exchange cookie for crumb
    const crumbRes = await fetch('https://query1.finance.yahoo.com/v1/test/getcrumb', {
      headers: { ...baseHeaders, Cookie: rawCookie },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!crumbRes.ok) throw new Error(`Crumb fetch HTTP ${crumbRes.status}`);
    const crumb = await crumbRes.text();
    _crumbCache = { crumb, cookie: rawCookie, exp: Date.now() + 50 * 60 * 1000 };
    return { crumb, cookie: rawCookie };
  }

  /** Quotes for index symbols (^ prefix) that require Yahoo Finance crumb auth */
  private async getIndexQuotes(symbols: string[]): Promise<MarketQuote[]> {
    if (!symbols.length) return [];
    const { crumb, cookie } = await this.ensureCrumb();
    // Batch in groups of 10 to stay well within URL limits, run in parallel
    const chunks: string[][] = [];
    for (let i = 0; i < symbols.length; i += 10) chunks.push(symbols.slice(i, i + 10));
    const settled = await Promise.allSettled(
      chunks.map(async (chunk) => {
        const url = `${YF1}/v7/finance/quote?symbols=${encodeURIComponent(chunk.join(','))}&crumb=${encodeURIComponent(crumb)}`;
        const res = await fetch(url, {
          headers: { ...YF_HEADERS, Cookie: cookie },
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        if (!res.ok) throw new Error(`YF HTTP ${res.status}`);
        const data = await res.json() as { quoteResponse?: { result?: Record<string, unknown>[] } };
        return (data.quoteResponse?.result ?? []).map(mapQuote);
      }),
    );
    return settled.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));
  }

  /**
   * CoinGecko — top-N cryptocurrencies by market cap with live prices.
   * Free public endpoint, no API key required. Cached 60 s to respect rate limits.
   */
  private async getCryptoMarkets(count = 50): Promise<MarketQuote[]> {
    return cached(`cg:markets:${count}`, 60_000, async () => {
      const url = `${CG_BASE}/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=${count}&page=1&sparkline=false`;
      const coins = await this.genericFetch<Array<{
        symbol: string;
        name: string;
        current_price: number | null;
        price_change_24h: number | null;
        price_change_percentage_24h: number | null;
        total_volume: number | null;
        market_cap: number | null;
      }>>(url);
      return (coins ?? []).map((c) => ({
        symbol:    `${c.symbol.toUpperCase()}-USD`,
        name:      c.name,
        price:     c.current_price     ?? undefined,
        change:    c.price_change_24h  ?? undefined,
        changePct: c.price_change_percentage_24h ?? undefined,
        volume:    c.total_volume      ?? undefined,
        marketCap: c.market_cap        ?? undefined,
        exchange:  'Crypto',
        type:      'CRYPTOCURRENCY',
      }));
    });
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

  /** Batch real-time quotes — max 50 symbols.
   *  Tries crumb-authenticated requests first (required by Yahoo Finance in
   *  server/Docker environments), then falls back to unauthenticated. */
  async getQuotes(symbols: string[]): Promise<MarketQuote[]> {
    if (!symbols.length) return [];
    const uniq = [...new Set(symbols)].slice(0, 50);
    return cached(`quotes:${uniq.sort().join(',')}`, 15_000, async () => {
      // ── Strategy 1: crumb-authenticated (works from Docker / server envs) ──
      try {
        const { crumb, cookie } = await this.ensureCrumb();
        // Split into chunks of 20 to stay within safe URL limits
        const chunks: string[][] = [];
        for (let i = 0; i < uniq.length; i += 20) chunks.push(uniq.slice(i, i + 20));
        const settled = await Promise.allSettled(
          chunks.map(async (chunk) => {
            const syms = encodeURIComponent(chunk.join(','));
            const url = `${YF1}/v7/finance/quote?symbols=${syms}&crumb=${encodeURIComponent(crumb)}`;
            const res = await fetch(url, {
              headers: { ...YF_HEADERS, Cookie: cookie },
              signal: AbortSignal.timeout(TIMEOUT_MS),
            });
            if (!res.ok) throw new Error(`YF HTTP ${res.status}`);
            const data = await res.json() as { quoteResponse?: { result?: Record<string, unknown>[] } };
            return (data.quoteResponse?.result ?? []).map(mapQuote);
          }),
        );
        const results = settled.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));
        if (results.length) return results;
      } catch { /* crumb unavailable — fall through */ }

      // ── Strategy 2: unauthenticated (works locally / some cloud envs) ──────
      const syms = encodeURIComponent(uniq.join(','));
      const tryFetch = async (base: string) => {
        const data = await this.yfFetch<{
          quoteResponse?: { result?: Record<string, unknown>[] };
        }>(`${base}/v7/finance/quote?symbols=${syms}`);
        return (data.quoteResponse?.result ?? []).map(mapQuote);
      };
      try {
        const results = await tryFetch(YF2);
        if (results.length) return results;
      } catch { /* fall through */ }
      return tryFetch(YF1);
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
    const key = secType.toUpperCase();

    // Search-based fallback terms when getQuotes returns nothing
    const SEARCH_FALLBACK: Record<string, string> = {
      FUT:    'E-mini futures',
      CRYPTO: 'bitcoin',
      ETF:    'S&P ETF',
      FOREX:  'currency exchange',
      IND:    'market index',
    };

    const withSearchFallback = async (quotes: () => Promise<MarketQuote[]>): Promise<MarketQuote[]> => {
      const results = await quotes().catch(() => []);
      if (results.length) return results;
      const term = SEARCH_FALLBACK[key];
      return term ? this.search(term, 20, key).catch(() => []) : [];
    };

    switch (key) {
      case 'FUT':    return withSearchFallback(() => this.getQuotes(ASSET_DEFAULTS.futures));
      case 'CRYPTO': {
        const coins = await this.getCryptoMarkets(50).catch(() => []);
        if (coins.length) return coins;
        return withSearchFallback(() => this.getQuotes(ASSET_DEFAULTS.crypto));
      }
      case 'ETF':    return withSearchFallback(() => this.getQuotes(ASSET_DEFAULTS.etfs));
      case 'FOREX':  return withSearchFallback(() => this.getQuotes(ASSET_DEFAULTS.forex));
      case 'IND': {
        // Indices require Yahoo Finance crumb auth (^ prefix symbols)
        const coins = await this.getIndexQuotes(ASSET_DEFAULTS.indices).catch(() => []);
        if (coins.length) return coins;
        return withSearchFallback(() => Promise.resolve([]));
      }
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

    // ---- Crypto (live from CoinGecko — top by market cap) ------------------
    if (assets.includes('crypto') || assets.includes('prediction_markets')) {
      const items = await this.getCryptoMarkets(25)
        .catch(() => this.getQuotes(ASSET_DEFAULTS.crypto).catch(() => []));
      if (items.length) out.push({ section: 'Top Crypto by Market Cap', items });
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
