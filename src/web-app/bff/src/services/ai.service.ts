import config from '../config';
import { queryCouchbase } from '../couchbase';

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

interface CouchbasePolymarketEvent {
  market_id?: string;
  market_slug?: string;
  question?: string;
  yes_price?: number;
  current_price?: number;
  volume?: number;
  timestamp?: string;
  outcome?: string;
  conviction_direction?: string;
  conviction_magnitude_pct?: number;
}

class AIService {
  // Retrieve recent Polymarket events from Couchbase
  async getRecentEvents(limit: number = 100): Promise<PolymarketEvent[]> {
    try {
      const bucketName = config.couchbase.bucket;

      let rows = await queryCouchbase<CouchbasePolymarketEvent>(
        `SELECT d.*
         FROM \`${bucketName}\` AS d
         WHERE d.type IN ["conviction_event", "market_latest"]
         ORDER BY STR_TO_MILLIS(d.timestamp) DESC
         LIMIT $limit`,
        { limit }
      );

      const events: PolymarketEvent[] = rows.map((row) => {
        const marketId = row.market_id || 'unknown';
        const currentPrice =
          typeof row.yes_price === 'number'
            ? row.yes_price
            : typeof row.current_price === 'number'
              ? row.current_price
              : 0;
        const convictionLevel =
          typeof row.conviction_magnitude_pct === 'number'
            ? `${row.conviction_magnitude_pct.toFixed(2)}%`
            : undefined;

        return {
          market_id: marketId,
          market_slug: row.market_slug || marketId,
          question: row.question || marketId,
          current_price: currentPrice,
          volume: typeof row.volume === 'number' ? row.volume : 0,
          timestamp: row.timestamp ? new Date(row.timestamp) : new Date(),
          outcome: row.conviction_direction || row.outcome || 'yes',
          conviction_level: convictionLevel,
        };
      });

      console.log(`Retrieved ${events.length} events from Couchbase`);
      return events;
    } catch (error) {
      console.error('Error retrieving events from Couchbase:', error);
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
      const messages: Array<{ role: string; content: string }> = [
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

      console.log(`🌐 Calling Ollama at ${config.ollama.baseUrl} using model ${config.ollama.model}...`);
      const ollamaResponse = await fetch(`${config.ollama.baseUrl}/api/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: config.ollama.model,
          messages,
          stream: false,
          options: {
            temperature: 0.7,
            num_predict: 1024,
          },
        }),
      });

      if (!ollamaResponse.ok) {
        const errorText = await ollamaResponse.text();
        throw new Error(`Ollama request failed (${ollamaResponse.status}): ${errorText}`);
      }

      const chatCompletion: any = await ollamaResponse.json();

      const response = chatCompletion?.message?.content || 
        'I apologize, but I was unable to generate a response. Please try again.';
      
      console.log(`✅ Ollama response received (${response.length} chars)`);
      return response;
    } catch (error: any) {
      console.error('❌ Ollama Error:', error.message || error);
      console.error('Error details:', error.response?.data || error.code);
      
      // Provide helpful error messages
      if (error.message?.includes('404') && error.message?.includes('model')) {
        return `🤖 **Ollama Model Not Found**\n\nModel \`${config.ollama.model}\` is not available locally.\n\n**Fix it:**\n1. Pull model:\n   \`ollama pull ${config.ollama.model}\`\n2. Ensure Ollama is running\n3. Restart backend:\n   \`npm run dev\``;
      }
      
      if (
        error.message?.includes('ECONNREFUSED') ||
        error.message?.includes('fetch failed') ||
        error.message?.includes('ENOTFOUND') ||
        error.message?.includes('Network')
      ) {
        return `❌ **Ollama Connection Error**\n\nCouldn't connect to Ollama at ${config.ollama.baseUrl}.\n\n**Check:**\n- Ollama app/service is running\n- URL is correct in .env (OLLAMA_BASE_URL)\n- Model exists locally (ollama list)`;
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

  async streamTradingRecommendation(
    userMessage: string,
    conversationHistory: Array<{ role: string; content: string }> = [],
    onToken?: (token: string) => void
  ): Promise<string> {
    try {
      console.log('🤖 Streaming AI response for:', userMessage);

      console.log('📊 Fetching Polymarket events from database...');
      const events = await this.getRecentEvents(100);
      console.log(`✅ Retrieved ${events.length} events from database`);

      const eventsContext = this.buildEventsContext(events);

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

      const messages: Array<{ role: string; content: string }> = [
        {
          role: 'system',
          content: systemPrompt,
        },
      ];

      const recentHistory = conversationHistory.slice(-5);
      messages.push(...recentHistory);
      messages.push({
        role: 'user',
        content: userMessage,
      });

      console.log(`🌐 Streaming from Ollama at ${config.ollama.baseUrl} using model ${config.ollama.model}...`);
      const ollamaResponse = await fetch(`${config.ollama.baseUrl}/api/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: config.ollama.model,
          messages,
          stream: true,
          options: {
            temperature: 0.7,
            num_predict: 1024,
          },
        }),
      });

      if (!ollamaResponse.ok) {
        const errorText = await ollamaResponse.text();
        throw new Error(`Ollama request failed (${ollamaResponse.status}): ${errorText}`);
      }

      if (!ollamaResponse.body) {
        throw new Error('Ollama response stream is empty');
      }

      const decoder = new TextDecoder();
      let buffer = '';
      let fullText = '';

      for await (const chunk of ollamaResponse.body) {
        buffer += decoder.decode(chunk, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.trim()) continue;
          const data = JSON.parse(line);
          const token = data?.message?.content || '';
          if (token) {
            fullText += token;
            if (onToken) onToken(token);
          }
        }
      }

      if (buffer.trim()) {
        const data = JSON.parse(buffer);
        const token = data?.message?.content || '';
        if (token) {
          fullText += token;
          if (onToken) onToken(token);
        }
      }

      if (!fullText) {
        return 'I apologize, but I was unable to generate a response. Please try again.';
      }

      console.log(`✅ Ollama streaming response complete (${fullText.length} chars)`);
      return fullText;
    } catch (error: any) {
      console.error('❌ Ollama Streaming Error:', error.message || error);

      if (error.message?.includes('404') && error.message?.includes('model')) {
        return `🤖 **Ollama Model Not Found**\n\nModel \`${config.ollama.model}\` is not available locally.\n\n**Fix it:**\n1. Pull model:\n   \`ollama pull ${config.ollama.model}\`\n2. Ensure Ollama is running\n3. Restart backend:\n   \`npm run dev\``;
      }

      if (
        error.message?.includes('ECONNREFUSED') ||
        error.message?.includes('fetch failed') ||
        error.message?.includes('ENOTFOUND') ||
        error.message?.includes('Network')
      ) {
        return `❌ **Ollama Connection Error**\n\nCouldn't connect to Ollama at ${config.ollama.baseUrl}.\n\n**Check:**\n- Ollama app/service is running\n- URL is correct in .env (OLLAMA_BASE_URL)\n- Model exists locally (ollama list)`;
      }

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
      return `**Trading Analysis**${dataSection}Based on your question: "${userMessage}"\n\nI can help you analyze trading opportunities, but I need more specific information:\n\n• **Which market** are you interested in? (e.g., political events, sports, crypto)\n• **What timeframe** are you considering?\n• **What's your risk tolerance**? (conservative, moderate, aggressive)\n\n**General Trading Tips for Prediction Markets:**\n\n1. **Do Your Research** - Always verify market conditions and recent events\n2. **Manage Risk** - Never invest more than you can afford to lose\n3. **Diversify** - Spread positions across multiple markets\n4. **Watch Volume** - Higher volume markets tend to be more accurate\n5. **Time Your Entry** - Consider waiting for significant price movements\n\n🤖 *Get full AI-powered analysis by running Ollama locally!*\n   → Install Ollama: https://ollama.com\n   → Pull model: \`ollama pull ${config.ollama.model}\`\n   → Set \`.env\`: \`OLLAMA_BASE_URL=http://localhost:11434\`\n   → Restart backend server`;
    }

    return `**Polymarket AI Assistant**${dataSection}I can help you with:\n\n• Market analysis and trading recommendations\n• Risk assessment and strategy guidance  \n• Historical price trends and volume analysis\n• Specific market questions\n\n**Note:** For full AI-powered analysis, run Ollama locally:\n→ Install: https://ollama.com\n→ Pull model: \`ollama pull ${config.ollama.model}\`\n→ Add to \`.env\`: \`OLLAMA_BASE_URL=http://localhost:11434\`\n→ Restart backend\n\n💡 **Try asking:**\n- "Should I buy or sell [asset]?"\n- "What are the trending markets?"\n- "Analyze [specific market]"\n- "Give me a trading strategy"\n\nWhat would you like to know?`;
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
