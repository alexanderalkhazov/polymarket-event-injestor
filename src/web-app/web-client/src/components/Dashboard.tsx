import { useState, useEffect, useRef } from 'react';
import { Sidebar } from './Sidebar';
import { ChatMessage } from './ChatMessage';
import { ChatInput } from './ChatInput';
import { useAuth } from '../context/AuthContext';
import './Dashboard.css';

interface Message {
  id: number;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
}

export const Dashboard = () => {
  const { user } = useAuth();
  const [messages, setMessages] = useState<Message[]>([
    {
      id: 1,
      role: 'assistant',
      content: `Hello ${user?.name?.split(' ')[0] || 'there'}! 👋\n\nI'm your Polymarket AI assistant. I can help you with:\n\n• Market analysis and insights\n• Trading strategies and recommendations\n• Real-time market data and trends\n• Portfolio tracking and optimization\n\nWhat would you like to know about today?`,
      timestamp: 'Just now',
    },
  ]);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleSendMessage = (content: string) => {
    const newMessage: Message = {
      id: messages.length + 1,
      role: 'user',
      content,
      timestamp: 'Just now',
    };

    setMessages([...messages, newMessage]);

    // Simulate AI response
    setTimeout(() => {
      const aiResponse: Message = {
        id: messages.length + 2,
        role: 'assistant',
        content: getAIResponse(content),
        timestamp: 'Just now',
      };
      setMessages((prev) => [...prev, aiResponse]);
    }, 1000);
  };

  const getAIResponse = (userMessage: string): string => {
    const lower = userMessage.toLowerCase();
    
    if (lower.includes('market') || lower.includes('price')) {
      return "Based on current market data, I can provide you with real-time analysis. Which specific market are you interested in? I can analyze trends, volume, and sentiment for any Polymarket prediction market.";
    } else if (lower.includes('strategy') || lower.includes('trade')) {
      return "For trading strategies, I recommend considering:\n\n1. Market liquidity analysis\n2. Historical price patterns\n3. Event probability assessment\n4. Diversification across multiple markets\n\nWould you like me to elaborate on any of these strategies?";
    } else if (lower.includes('help')) {
      return "I can assist you with:\n\n• Current market trends and analysis\n• Portfolio recommendations\n• Risk assessment\n• Market predictions and insights\n• Trading volume analysis\n\nWhat specific area would you like to explore?";
    } else {
      return "That's an interesting question! I can help you explore Polymarket data and provide insights. Could you provide more details about what you'd like to know?\n\nYou can ask me about specific markets, trading strategies, or market analysis.";
    }
  };

  const handleNewChat = () => {
    setMessages([
      {
        id: 1,
        role: 'assistant',
        content: `Starting a new conversation! How can I help you with Polymarket today?`,
        timestamp: 'Just now',
      },
    ]);
  };

  return (
    <div className="dashboard-container">
      <Sidebar onNewChat={handleNewChat} />
      <div className="chat-main">
        <div className="chat-header">
          <h1>Polymarket AI Assistant</h1>
          <div className="chat-status">
            <span className="status-indicator"></span>
            <span>Online</span>
          </div>
        </div>
        <div className="chat-messages">
          {messages.map((message) => (
            <ChatMessage
              key={message.id}
              role={message.role}
              content={message.content}
              timestamp={message.timestamp}
            />
          ))}
          <div ref={messagesEndRef} />
        </div>
        <ChatInput onSend={handleSendMessage} />
      </div>
    </div>
  );
};
