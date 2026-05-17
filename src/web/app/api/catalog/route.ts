import { NextResponse } from "next/server"

export const revalidate = 3600 // cache 1 hour

export interface CatalogSymbol {
  ticker: string
  name: string
  imageUrl?: string
}

export interface Subcategory {
  id: string        // e.g. "crypto_large_cap"
  label: string
  description: string
  symbols: CatalogSymbol[]
}

export interface Category {
  id: string
  label: string
  icon: string
  description: string
  subcategories: Subcategory[]
}

// ── Static categories (equities / commodities / macro) ─────────────────────

const STATIC_CATEGORIES: Category[] = [
  {
    id: "us_equities",
    label: "US Equities",
    icon: "📈",
    description: "US stock market — sectors from tech to healthcare",
    subcategories: [
      {
        id: "equities_tech",
        label: "Technology",
        description: "Mega-cap tech & semiconductors",
        symbols: [
          { ticker: "AAPL", name: "Apple" },
          { ticker: "MSFT", name: "Microsoft" },
          { ticker: "NVDA", name: "NVIDIA" },
          { ticker: "GOOGL", name: "Alphabet" },
          { ticker: "META", name: "Meta" },
          { ticker: "AMZN", name: "Amazon" },
          { ticker: "TSLA", name: "Tesla" },
          { ticker: "AMD", name: "AMD" },
          { ticker: "INTC", name: "Intel" },
          { ticker: "CRM", name: "Salesforce" },
        ],
      },
      {
        id: "equities_finance",
        label: "Financials",
        description: "Banks, asset managers & payment networks",
        symbols: [
          { ticker: "JPM", name: "JPMorgan Chase" },
          { ticker: "BAC", name: "Bank of America" },
          { ticker: "GS", name: "Goldman Sachs" },
          { ticker: "MS", name: "Morgan Stanley" },
          { ticker: "WFC", name: "Wells Fargo" },
          { ticker: "BLK", name: "BlackRock" },
          { ticker: "V", name: "Visa" },
          { ticker: "MA", name: "Mastercard" },
        ],
      },
      {
        id: "equities_healthcare",
        label: "Healthcare",
        description: "Pharma, biotech & medical devices",
        symbols: [
          { ticker: "JNJ", name: "Johnson & Johnson" },
          { ticker: "UNH", name: "UnitedHealth" },
          { ticker: "LLY", name: "Eli Lilly" },
          { ticker: "PFE", name: "Pfizer" },
          { ticker: "MRNA", name: "Moderna" },
          { ticker: "ABBV", name: "AbbVie" },
          { ticker: "AMGN", name: "Amgen" },
          { ticker: "BMY", name: "Bristol-Myers Squibb" },
        ],
      },
      {
        id: "equities_indices",
        label: "Index ETFs",
        description: "Broad market & factor ETFs",
        symbols: [
          { ticker: "SPY", name: "S&P 500 ETF" },
          { ticker: "QQQ", name: "Nasdaq-100 ETF" },
          { ticker: "DIA", name: "Dow Jones ETF" },
          { ticker: "IWM", name: "Russell 2000 ETF" },
          { ticker: "VTI", name: "Total Market ETF" },
          { ticker: "EEM", name: "Emerging Markets ETF" },
          { ticker: "ARKK", name: "ARK Innovation ETF" },
        ],
      },
    ],
  },
  {
    id: "commodities",
    label: "Commodities",
    icon: "🏗",
    description: "Metals, energy and agricultural commodities",
    subcategories: [
      {
        id: "commodities_metals",
        label: "Precious Metals",
        description: "Gold, silver & mining equities",
        symbols: [
          { ticker: "GLD", name: "Gold ETF" },
          { ticker: "SLV", name: "Silver ETF" },
          { ticker: "GOLD", name: "Barrick Gold" },
          { ticker: "NEM", name: "Newmont" },
          { ticker: "RGLD", name: "Royal Gold" },
        ],
      },
      {
        id: "commodities_energy",
        label: "Energy",
        description: "Oil, natural gas & energy ETFs",
        symbols: [
          { ticker: "USO", name: "Oil ETF" },
          { ticker: "UNG", name: "Natural Gas ETF" },
          { ticker: "BNO", name: "Brent Oil ETF" },
          { ticker: "XLE", name: "Energy Sector ETF" },
          { ticker: "XOM", name: "ExxonMobil" },
          { ticker: "CVX", name: "Chevron" },
          { ticker: "LNG", name: "Cheniere Energy" },
        ],
      },
      {
        id: "commodities_agriculture",
        label: "Agriculture",
        description: "Wheat, corn, soybeans & soft commodities",
        symbols: [
          { ticker: "WEAT", name: "Wheat ETF" },
          { ticker: "CORN", name: "Corn ETF" },
          { ticker: "SOYB", name: "Soybean ETF" },
          { ticker: "DBA", name: "Agriculture ETF" },
          { ticker: "MOO", name: "Agribusiness ETF" },
        ],
      },
    ],
  },
  {
    id: "macro",
    label: "Macro & Rates",
    icon: "🏦",
    description: "Bonds, inflation and global macro instruments",
    subcategories: [
      {
        id: "macro_bonds",
        label: "Bonds",
        description: "Treasuries & corporate credit",
        symbols: [
          { ticker: "TLT", name: "20+ Year Treasury ETF" },
          { ticker: "IEF", name: "7-10 Year Treasury ETF" },
          { ticker: "SHY", name: "1-3 Year Treasury ETF" },
          { ticker: "HYG", name: "High Yield Corporate ETF" },
          { ticker: "JNK", name: "Junk Bond ETF" },
          { ticker: "AGG", name: "Aggregate Bond ETF" },
        ],
      },
      {
        id: "macro_inflation",
        label: "Inflation Hedges",
        description: "TIPS, commodities & real assets",
        symbols: [
          { ticker: "TIP", name: "TIPS ETF" },
          { ticker: "PDBC", name: "Commodity ETF" },
          { ticker: "IAU", name: "Gold Trust" },
          { ticker: "INFL", name: "Inflation ETF" },
        ],
      },
    ],
  },
]

// ── CoinGecko category IDs → our subcategory ids ────────────────────────────

const COINGECKO_CATEGORIES = [
  { id: "crypto_large_cap",  label: "Large Cap",      description: "Top coins by market cap",      geckoCategory: null,                       limit: 15 },
  { id: "crypto_defi",       label: "DeFi",           description: "Decentralised finance tokens",  geckoCategory: "decentralized-finance-defi", limit: 12 },
  { id: "crypto_layer1",     label: "Layer 1",        description: "Proof-of-stake & PoW chains",   geckoCategory: "layer-1",                   limit: 12 },
  { id: "crypto_layer2",     label: "Layer 2",        description: "Scaling solutions & rollups",   geckoCategory: "layer-2",                   limit: 10 },
  { id: "crypto_meme",       label: "Memecoins",      description: "High-volatility community coins", geckoCategory: "meme-token",               limit: 10 },
  { id: "crypto_ai",         label: "AI & Data",      description: "AI-adjacent web3 tokens",       geckoCategory: "artificial-intelligence",   limit: 10 },
]

async function fetchCryptoSubcategory(cat: typeof COINGECKO_CATEGORIES[0]): Promise<Subcategory> {
  const params = new URLSearchParams({
    vs_currency: "usd",
    order: "market_cap_desc",
    per_page: String(cat.limit),
    page: "1",
    sparkline: "false",
  })
  if (cat.geckoCategory) params.set("category", cat.geckoCategory)

  try {
    const res = await fetch(`https://api.coingecko.com/api/v3/coins/markets?${params}`, {
      headers: { Accept: "application/json" },
      next: { revalidate: 3600 },
    })
    if (!res.ok) throw new Error(`CoinGecko ${res.status}`)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const coins: any[] = await res.json()
    const symbols: CatalogSymbol[] = coins.map((c) => ({
      ticker: `${(c.symbol as string).toUpperCase()}-USD`,
      name: c.name,
      imageUrl: c.image,
    }))
    return { id: cat.id, label: cat.label, description: cat.description, symbols }
  } catch {
    // CoinGecko rate-limited or down — return a minimal fallback
    const FALLBACK: Record<string, CatalogSymbol[]> = {
      crypto_large_cap: [
        { ticker: "BTC-USD", name: "Bitcoin" },
        { ticker: "ETH-USD", name: "Ethereum" },
        { ticker: "BNB-USD", name: "BNB" },
        { ticker: "SOL-USD", name: "Solana" },
        { ticker: "XRP-USD", name: "XRP" },
        { ticker: "ADA-USD", name: "Cardano" },
        { ticker: "DOGE-USD", name: "Dogecoin" },
        { ticker: "AVAX-USD", name: "Avalanche" },
      ],
      crypto_defi: [
        { ticker: "UNI-USD", name: "Uniswap" },
        { ticker: "AAVE-USD", name: "Aave" },
        { ticker: "MKR-USD", name: "Maker" },
        { ticker: "CRV-USD", name: "Curve" },
        { ticker: "SNX-USD", name: "Synthetix" },
      ],
      crypto_layer1: [
        { ticker: "SOL-USD", name: "Solana" },
        { ticker: "ADA-USD", name: "Cardano" },
        { ticker: "AVAX-USD", name: "Avalanche" },
        { ticker: "DOT-USD", name: "Polkadot" },
        { ticker: "ATOM-USD", name: "Cosmos" },
      ],
      crypto_layer2: [
        { ticker: "MATIC-USD", name: "Polygon" },
        { ticker: "ARB-USD", name: "Arbitrum" },
        { ticker: "OP-USD", name: "Optimism" },
        { ticker: "IMX-USD", name: "Immutable" },
      ],
      crypto_meme: [
        { ticker: "DOGE-USD", name: "Dogecoin" },
        { ticker: "SHIB-USD", name: "Shiba Inu" },
        { ticker: "PEPE-USD", name: "Pepe" },
        { ticker: "WIF-USD", name: "Dogwifhat" },
      ],
      crypto_ai: [
        { ticker: "FET-USD", name: "Fetch.ai" },
        { ticker: "RNDR-USD", name: "Render" },
        { ticker: "TAO-USD", name: "Bittensor" },
        { ticker: "AGIX-USD", name: "SingularityNET" },
      ],
    }
    return { id: cat.id, label: cat.label, description: cat.description, symbols: FALLBACK[cat.id] ?? [] }
  }
}

export async function GET() {
  const cryptoSubcategories = await Promise.all(
    COINGECKO_CATEGORIES.map(fetchCryptoSubcategory)
  )

  const catalog: Category[] = [
    {
      id: "crypto",
      label: "Crypto",
      icon: "₿",
      description: "Digital assets — live data from CoinGecko",
      subcategories: cryptoSubcategories,
    },
    ...STATIC_CATEGORIES,
  ]

  return NextResponse.json({ catalog, updatedAt: new Date().toISOString() })
}
