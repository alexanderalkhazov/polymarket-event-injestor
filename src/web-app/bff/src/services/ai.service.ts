import Groq from 'groq-sdk';
import config from '../config';
import mongoose from '../db';

// Initialize Groq client (free tier: 14,400 requests/day)
const groq = new Groq({
  apiKey: config.groq.apiKey,
});

interface PolymarketEvent {
  market_id: string;
  market_slug: string;
  question: string;
  current_price: number;
  volume: number;
  timestamp: Date;
  outcome: string;
  conviction_level?: string;
}

class AIService {
  // Retrieve recent Polymarket events from MongoDB
  async getRecentEvents(limit: number = 100): Promise<PolymarketEvent[]> {
    try {
      const db = mongoose.connection.db;
      
      if (!db) {
        console.log('Database not connected, returning empty events');
        return [];
      }

      // Try to find events in the database
      const collections = await db.listCollections().toArray();
      const collectionNames = collections.map(c => c.name);
      
      console.log('Available collections:', collectionNames);

      // Check for polymarket events in various possible collections
      let events: any[] = [];
      
      if (collectionNames.includes('polymarket_events')) {
        events = await db
          .collection('polymarket_events')
          .find({})
          .sort({ timestamp: -1 })
          .limit(limit)
          .toArray();
      } else if (collectionNames.includes('events')) {
        events = await db
          .collection('events')
          .find({})
          .sort({ timestamp: -1 })
          .limit(limit)
          .toArray();
      }

      console.log(`Retrieved ${events.length} events from database`);
      return events;
    } catch (error) {
      console.error('Error retrieving events:', error);
      return [];
    }
  }

  // Generate trading recommendation using AI
  async generateTradingRecommendation(
    userMessage: string,
    conversationHistory: Array<{ role: string; content: string }> = []
  ): Promise<string> {
    try {
      console.log('🤖 Generating AI response for:', userMessage);
      
      // Check if API key is configured
      if (!config.groq.apiKey || config.groq.apiKey === 'gsk_get_your_free_key_from_groq_console') {
        console.log('⚠️  Groq API key not configured, using fallback response');
        return await this.generateFallbackResponse(userMessage);
      }

      // Get recent market events
      console.log('📊 Fetching Polymarket events from database...');
      const events = await this.getRecentEvents(100);
      console.log(`✅ Retrieved ${events.length} events from database`);

      // Build context from events
      const eventsContext = this.buildEventsContext(events);

      // Construct the system prompt
      const systemPrompt = `You are a Polymarket trading AI assistant with expertise in prediction markets and trading strategies. 

You help users make informed trading decisions based on real market data and analysis.

Current Market Context:
${eventsContext}

Guidelines:
- Analyze the user's question in the context of available market data
- Provide clear, actionable trading recommendations
- Explain your reasoning based on market trends, volume, and price movements
- Consider risk factors and suggest risk management strategies
- Be honest about uncertainty - prediction markets are probabilistic
- Keep responses concise but informative (2-4 paragraphs)
- Use bullet points for key recommendations
- Reference specific market data when making recommendations`;

      // Build messages array with conversation history
      const messages: any[] = [
        {
          role: 'system',
          content: systemPrompt,
        },
      ];

      // Add recent conversation history (last 5 messages)
      const recentHistory = conversationHistory.slice(-5);
      messages.push(...recentHistory);

      // Add current user message
      messages.push({
        role: 'user',
        content: userMessage,
      });

      // Call Groq API (using llama-3.1-8b-instant)
      console.log('🌐 Calling Groq API with LLaMA 3.1 8B...');
      const chatCompletion = await groq.chat.completions.create({
        messages,
        model: 'llama-3.1-8b-instant', // Fast, free, and currently available
        temperature: 0.7,
        max_tokens: 1024,
      });

      const response = chatCompletion.choices[0]?.message?.content || 
        'I apologize, but I was unable to generate a response. Please try again.';
      
      console.log(`✅ Groq API response received (${response.length} chars)`);
      return response;
    } catch (error: any) {
      console.error('❌ Groq API Error:', error.message || error);
      console.error('Error details:', error.response?.data || error.code);
      
      // Provide helpful error messages
      if (error.message?.includes('API key') || error.status === 401 || error.message?.includes('Unauthorized')) {
        console.error('🔑 Invalid or missing Groq API key');
        return '🔑 **Invalid Groq API Key**\n\nThe API key in your `.env` file is either:\n- Missing\n- Invalid\n- Expired\n\n**Fix it:**\n1. Get a FREE key from https://console.groq.com\n2. Update `src/web-app/bff/.env`:\n   ```\n   GROQ_API_KEY=gsk_your_actual_key\n   ```\n3. Restart backend:\n   ```\n   npm run dev\n   ```\n\n**Free tier:** 14,400 requests/day (no credit card!)';
      }
      
      if (error.message?.includes('ENOTFOUND') || error.message?.includes('Network')) {
        return '❌ **Network Error**\n\nCouldn\'t connect to Groq API. Check:\n- Internet connection\n- API key is valid\n- Groq service is up\n\nTry again in a moment.';
      }
      
      if (error.message?.includes('rate')) {
        return '⏱️ **Rate Limited**\n\nYou\'ve hit the API rate limit (14,400/day).\n\nWait a moment and try again. Limits reset every 24 hours.';
      }
      
      // Try fallback response on error
      console.log('Falling back to local response generation...');
      try {
        return await this.generateFallbackResponse(userMessage);
      } catch {
        return '❌ I encountered an error processing your request. Please check the backend logs and try again.';
      }
    }
  }

  // Build context string from events
  private buildEventsContext(events: PolymarketEvent[]): string {
    if (events.length === 0) {
      return 'No recent market data available. Providing general trading guidance based on prediction market principles.';
    }

    // Group events by market
    const marketSummary: Record<string, any> = {};
    
    events.forEach(event => {
      const key = event.market_slug || event.market_id;
      if (!marketSummary[key]) {
        marketSummary[key] = {
          question: event.question,
          prices: [],
          volumes: [],
          latest_price: 0,
          total_volume: 0,
          outcome: event.outcome,
        };
      }
      
      marketSummary[key].prices.push(event.current_price);
      marketSummary[key].volumes.push(event.volume || 0);
      marketSummary[key].latest_price = event.current_price;
      marketSummary[key].total_volume += (event.volume || 0);
    });

    // Create summary text
    const summaries: string[] = [];
    let count = 0;
    
    for (const [slug, data] of Object.entries(marketSummary)) {
      if (count >= 10) break; // Limit to top 10 markets
      
      const avgPrice = data.prices.reduce((a: number, b: number) => a + b, 0) / data.prices.length;
      const priceChange = data.latest_price - data.prices[0];
      const trend = priceChange > 0 ? '↑' : priceChange < 0 ? '↓' : '→';
      
      summaries.push(
        `${count + 1}. ${data.question}\n` +
        `   - Current: ${(data.latest_price * 100).toFixed(1)}% ${trend}\n` +
        `   - Avg: ${(avgPrice * 100).toFixed(1)}%\n` +
        `   - Volume: $${data.total_volume.toFixed(0)}`
      );
      
      count++;
    }

    return `Recent Market Data (${events.length} events analyzed):\n\n` + 
           summaries.join('\n\n');
  }

  // Generate a simple response without AI (fallback)
  private async generateFallbackResponse(userMessage: string): Promise<string> {
    const lower = userMessage.toLowerCase();
    
    // Try to get market data even without AI
    const events = await this.getRecentEvents(100);
    const eventsContext = this.buildEventsContext(events);
    
    let dataSection = '';
    if (events.length > 0) {
      dataSection = `\n\n📈 **Live Polymarket Data** (${events.length} events analyzed):\n\n${eventsContext}\n\n`;
    } else {
      dataSection = '\n\n⚠️  *No Polymarket events found in database. Run your Kafka producer to populate data.*\n\n';
    }
    
    if (lower.includes('buy') || lower.includes('sell') || lower.includes('trade')) {
      return `**Trading Analysis**${dataSection}Based on your question: "${userMessage}"\n\nI can help you analyze trading opportunities, but I need more specific information:\n\n• **Which market** are you interested in? (e.g., political events, sports, crypto)\n• **What timeframe** are you considering?\n• **What's your risk tolerance**? (conservative, moderate, aggressive)\n\n**General Trading Tips for Prediction Markets:**\n\n1. **Do Your Research** - Always verify market conditions and recent events\n2. **Manage Risk** - Never invest more than you can afford to lose\n3. **Diversify** - Spread positions across multiple markets\n4. **Watch Volume** - Higher volume markets tend to be more accurate\n5. **Time Your Entry** - Consider waiting for significant price movements\n\n🤖 *Get full AI-powered analysis by adding your FREE Groq API key!*\n   → Visit https://console.groq.com (no credit card needed)\n   → Add to \`.env\`: \`GROQ_API_KEY=gsk_...\`\n   → Restart backend server`;
    }

    return `**Polymarket AI Assistant**${dataSection}I can help you with:\n\n• Market analysis and trading recommendations\n• Risk assessment and strategy guidance  \n• Historical price trends and volume analysis\n• Specific market questions\n\n**Note:** For full AI-powered analysis, configure your Groq API key:\n→ FREE at https://console.groq.com (14,400 requests/day)\n→ Add to \`.env\`: \`GROQ_API_KEY=gsk_...\`\n→ Restart backend\n\n💡 **Try asking:**\n- "Should I buy or sell [asset]?"\n- "What are the trending markets?"\n- "Analyze [specific market]"\n- "Give me a trading strategy"\n\nWhat would you like to know?`;
  }

  // Generate conversation title from first message
  generateConversationTitle(firstMessage: string): string {
    const words = firstMessage.split(' ').slice(0, 6);
    let title = words.join(' ');
    if (firstMessage.split(' ').length > 6) {
      title += '...';
    }
    return title || 'New Conversation';
  }
}

export default new AIService();
