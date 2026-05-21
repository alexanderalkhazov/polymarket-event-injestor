import { NextResponse } from "next/server"

export const revalidate = 3600

export interface CatalogSymbol {
  ticker: string
  name: string
}

export interface Subcategory {
  id: string
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

// Static catalog — only symbols with full backend support (OHLCV + features + analytics).
// Kept in sync with src/config/market_categories.py ALL_SYMBOLS.
// CoinGecko live fetch removed: it injected unsupported tokens into subscriptions.
const CATALOG: Category[] = [
  {
    id: "crypto",
    label: "Crypto",
    icon: "₿",
    description: "Digital assets — 13 tokens with full historical data",
    subcategories: [
      {
        id: "crypto_large_cap",
        label: "Large Cap",
        description: "Top coins by market cap",
        symbols: [
          { ticker: "BTC-USD",  name: "Bitcoin" },
          { ticker: "ETH-USD",  name: "Ethereum" },
          { ticker: "BNB-USD",  name: "BNB" },
          { ticker: "SOL-USD",  name: "Solana" },
          { ticker: "XRP-USD",  name: "XRP" },
          { ticker: "ADA-USD",  name: "Cardano" },
          { ticker: "DOGE-USD", name: "Dogecoin" },
          { ticker: "AVAX-USD", name: "Avalanche" },
        ],
      },
      {
        id: "crypto_defi",
        label: "DeFi",
        description: "Decentralised finance tokens",
        symbols: [
          { ticker: "UNI-USD",  name: "Uniswap" },
          { ticker: "LINK-USD", name: "Chainlink" },
        ],
      },
      {
        id: "crypto_layer1",
        label: "Layer 1",
        description: "Proof-of-stake chains",
        symbols: [
          { ticker: "SOL-USD",  name: "Solana" },
          { ticker: "ADA-USD",  name: "Cardano" },
          { ticker: "AVAX-USD", name: "Avalanche" },
          { ticker: "DOT-USD",  name: "Polkadot" },
          { ticker: "ATOM-USD", name: "Cosmos" },
        ],
      },
      {
        id: "crypto_layer2",
        label: "Layer 2",
        description: "Scaling & rollup solutions",
        symbols: [
          { ticker: "MATIC-USD", name: "Polygon" },
        ],
      },
    ],
  },
  {
    id: "us_equities",
    label: "US Equities",
    icon: "📈",
    description: "US stock market — sectors from tech to healthcare",
    subcategories: [
      {
        id: "equities_tech",
        label: "Technology",
        description: "Mega-cap tech, semis & high-growth",
        symbols: [
          { ticker: "AAPL", name: "Apple" },
          { ticker: "MSFT", name: "Microsoft" },
          { ticker: "NVDA", name: "NVIDIA" },
          { ticker: "GOOGL", name: "Alphabet" },
          { ticker: "META", name: "Meta" },
          { ticker: "AMZN", name: "Amazon" },
          { ticker: "TSLA", name: "Tesla" },
          { ticker: "AMD",  name: "AMD" },
          { ticker: "INTC", name: "Intel" },
          { ticker: "CRM",  name: "Salesforce" },
          { ticker: "NFLX", name: "Netflix" },
          { ticker: "PLTR", name: "Palantir" },
          { ticker: "COIN", name: "Coinbase" },
        ],
      },
      {
        id: "equities_finance",
        label: "Financials",
        description: "Banks & payment networks",
        symbols: [
          { ticker: "JPM", name: "JPMorgan Chase" },
          { ticker: "BAC", name: "Bank of America" },
          { ticker: "GS",  name: "Goldman Sachs" },
          { ticker: "MS",  name: "Morgan Stanley" },
          { ticker: "WFC", name: "Wells Fargo" },
          { ticker: "V",   name: "Visa" },
          { ticker: "MA",  name: "Mastercard" },
        ],
      },
      {
        id: "equities_healthcare",
        label: "Healthcare",
        description: "Pharma & biotech",
        symbols: [
          { ticker: "JNJ",  name: "Johnson & Johnson" },
          { ticker: "UNH",  name: "UnitedHealth" },
          { ticker: "LLY",  name: "Eli Lilly" },
          { ticker: "PFE",  name: "Pfizer" },
          { ticker: "ABBV", name: "AbbVie" },
          { ticker: "AMGN", name: "Amgen" },
        ],
      },
      {
        id: "equities_indices",
        label: "Index ETFs",
        description: "Broad market & factor ETFs",
        symbols: [
          { ticker: "SPY",  name: "S&P 500 ETF" },
          { ticker: "QQQ",  name: "Nasdaq-100 ETF" },
          { ticker: "DIA",  name: "Dow Jones ETF" },
          { ticker: "IWM",  name: "Russell 2000 ETF" },
          { ticker: "VTI",  name: "Total Market ETF" },
          { ticker: "EEM",  name: "Emerging Markets ETF" },
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
        description: "Gold, silver & miners",
        symbols: [
          { ticker: "GLD", name: "Gold ETF" },
          { ticker: "SLV", name: "Silver ETF" },
          { ticker: "IAU", name: "iShares Gold Trust" },
          { ticker: "GDX", name: "Gold Miners ETF" },
        ],
      },
      {
        id: "commodities_energy",
        label: "Energy",
        description: "Oil, gas & energy equities",
        symbols: [
          { ticker: "XOM", name: "ExxonMobil" },
          { ticker: "CVX", name: "Chevron" },
          { ticker: "XLE", name: "Energy Sector ETF" },
          { ticker: "USO", name: "Oil ETF" },
          { ticker: "UNG", name: "Natural Gas ETF" },
          { ticker: "LNG", name: "Cheniere Energy" },
        ],
      },
      {
        id: "commodities_agriculture",
        label: "Agriculture",
        description: "Wheat, corn & soft commodities",
        symbols: [
          { ticker: "WEAT", name: "Wheat ETF" },
          { ticker: "CORN", name: "Corn ETF" },
          { ticker: "DBA",  name: "Agriculture ETF" },
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
          { ticker: "AGG", name: "Aggregate Bond ETF" },
          { ticker: "TIP", name: "TIPS ETF" },
        ],
      },
      {
        id: "macro_inflation",
        label: "Inflation Hedges",
        description: "TIPS & real assets",
        symbols: [
          { ticker: "TIP", name: "TIPS ETF" },
          { ticker: "IAU", name: "Gold Trust" },
        ],
      },
    ],
  },
]

export async function GET() {
  return NextResponse.json({ catalog: CATALOG, updatedAt: new Date().toISOString() })
}
