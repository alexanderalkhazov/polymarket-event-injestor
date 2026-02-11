export interface MarketData {
  market_id: string;
  slug: string;
  question: string;
  yes_price: number;
  no_price: number;
  timestamp: Date;
}

export class ExampleService {
  /**
   * Get mock market data
   * In a real scenario, this would fetch from Couchbase
   */
  async getMarketData(marketId: string): Promise<MarketData> {
    // Simulate async operation
    return new Promise((resolve) => {
      setTimeout(() => {
        resolve({
          market_id: marketId,
          slug: 'example-market',
          question: 'Will Bitcoin reach $50k by end of 2024?',
          yes_price: 0.65,
          no_price: 0.35,
          timestamp: new Date(),
        });
      }, 100);
    });
  }

  /**
   * Get conviction history for a market
   */
  async getConvictionHistory(marketId: string, limit: number = 10): Promise<any[]> {
    // Mock implementation - would query Couchbase in real scenario
    return [
      {
        event_id: 'event-1',
        market_id: marketId,
        conviction_direction: 'yes',
        magnitude: 0.15,
        previous_yes_price: 0.60,
        yes_price: 0.65,
        timestamp: new Date(),
      },
    ];
  }

  /**
   * Search markets by keyword
   */
  async searchMarkets(keyword: string): Promise<MarketData[]> {
    // Mock implementation - would query MongoDB in real scenario
    return [
      {
        market_id: 'market-1',
        slug: `${keyword}-market`,
        question: `Question about ${keyword}`,
        yes_price: 0.55,
        no_price: 0.45,
        timestamp: new Date(),
      },
    ];
  }
}

export const exampleService = new ExampleService();
