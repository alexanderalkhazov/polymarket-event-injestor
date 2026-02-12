import { useState, useEffect, useRef } from 'react';
import { Sidebar } from './Sidebar';
import { ChatMessage } from './ChatMessage';
import { ChatInput } from './ChatInput';
import { useAuth } from '../context/AuthContext';
import { chatAPI } from '../services/api';
import './Dashboard.css';

interface Message {
  id: number;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
}

interface Conversation {
  id: string;
  title: string;
  updatedAt: string;
  messageCount: number;
  lastMessage: string;
}

export const Dashboard = () => {
  const { user } = useAuth();
  const [messages, setMessages] = useState<Message[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [currentConversationId, setCurrentConversationId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingConversations, setIsLoadingConversations] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // Load conversations on mount
  useEffect(() => {
    loadConversations();
  }, []);

  const loadConversations = async () => {
    try {
      setIsLoadingConversations(true);
      const response = await chatAPI.getConversations();
      if (response.success && response.data) {
        setConversations(response.data);
      }
    } catch (error) {
      console.error('Failed to load conversations:', error);
    } finally {
      setIsLoadingConversations(false);
    }
  };

  const loadConversation = async (conversationId: string) => {
    try {
      setIsLoading(true);
      const response = await chatAPI.getConversation(conversationId);
      if (response.success && response.data) {
        const loadedMessages: Message[] = response.data.messages.map((msg, idx) => ({
          id: idx + 1,
          role: msg.role as 'user' | 'assistant',
          content: msg.content,
          timestamp: new Date(msg.timestamp).toLocaleTimeString(),
        }));
        setMessages(loadedMessages);
        setCurrentConversationId(conversationId);
      }
    } catch (error) {
      console.error('Failed to load conversation:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSendMessage = async (content: string) => {
    const newMessage: Message = {
      id: messages.length + 1,
      role: 'user',
      content,
      timestamp: new Date().toLocaleTimeString(),
    };

    setMessages([...messages, newMessage]);
    setIsLoading(true);

    try {
      console.log('Sending message:', { content, conversationId: currentConversationId });
      
      const response = await chatAPI.sendMessage(content, currentConversationId || undefined);
      
      console.log('Received response:', response);
      
      if (response.success && response.data) {
        const aiResponse: Message = {
          id: messages.length + 2,
          role: 'assistant',
          content: response.data.message,
          timestamp: new Date(response.data.timestamp).toLocaleTimeString(),
        };
        setMessages((prev) => [...prev, aiResponse]);
        
        // Update conversation ID if this was a new conversation
        if (!currentConversationId && response.data.conversationId) {
          setCurrentConversationId(response.data.conversationId);
          console.log('New conversation created:', response.data.conversationId);
        }
        
        // Reload conversations to update sidebar
        await loadConversations();
      } else {
        throw new Error('Invalid response from server');
      }
    } catch (error: any) {
      console.error('❌ Chat error:', error);
      console.error('Error details:', error.response?.data);
      
      const errorMessage = error.response?.data?.message || error.message || 'Failed to send message';
      const errorResponse: Message = {
        id: messages.length + 2,
        role: 'assistant',
        content: `❌ **Error:** ${errorMessage}\n\n**Troubleshooting:**\n1. ✅ Backend server running on port 5000\n2. ✅ You are logged in\n3. ⚠️  Check Groq API key in \`.env\` (free at https://console.groq.com)\n4. ⚠️  Check MongoDB has Polymarket events\n\n*Tip: Even without API key, you should get fallback responses!*`,
        timestamp: new Date().toLocaleTimeString(),
      };
      setMessages((prev) => [...prev, errorResponse]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleNewChat = () => {
    setMessages([]);
    setCurrentConversationId(null);
  };

  const handleSelectConversation = (conversationId: string) => {
    loadConversation(conversationId);
  };

  const handleDeleteConversation = async (conversationId: string) => {
    try {
      await chatAPI.deleteConversation(conversationId);
      
      // If deleted conversation was active, clear it
      if (currentConversationId === conversationId) {
        handleNewChat();
      }
      
      // Reload conversations
      await loadConversations();
    } catch (error) {
      console.error('Failed to delete conversation:', error);
    }
  };

  // Show welcome message when no conversation is active
  const displayMessages = messages.length > 0 ? messages : [
    {
      id: 1,
      role: 'assistant' as const,
      content: `Hello ${user?.name?.split(' ')[0] || 'there'}! 👋\n\nI'm your **Polymarket AI Assistant** powered by real-time market data and AI analysis.\n\n**I can help you with:**\n\n• 📊 **Market Analysis** - AI-powered insights on prediction markets\n• 💹 **Trading Strategies** - Recommendations based on latest 100 market events\n• ⚠️ **Risk Assessment** - Understand market trends and volatility\n• 📈 **Real-time Data** - Analysis of current market conditions\n\n**Try asking:**\n- "Should I buy or sell gold futures?"\n- "What are the trending markets?"\n- "Analyze political prediction markets"\n- "Give me a trading strategy for crypto"\n\n**Setup Status:**\n${conversations.length > 0 ? '✅ Conversations loaded from database' : '⚠️  No previous conversations'}\n✅ Backend connected\n⚠️  Get free Groq API key for full AI features\n\n${conversations.length > 0 ? 'Select a conversation from the sidebar or start a new one!' : 'Start chatting below!'}`,
      timestamp: 'Just now',
    },
  ];

  return (
    <div className="dashboard-container">
      <Sidebar 
        conversations={conversations}
        currentConversationId={currentConversationId}
        onNewChat={handleNewChat}
        onSelectConversation={handleSelectConversation}
        onDeleteConversation={handleDeleteConversation}
        isLoading={isLoadingConversations}
      />
      <div className="chat-main">
        <div className="chat-header">
          <h1>Polymarket AI Assistant</h1>
          <div className="chat-status">
            <span className="status-indicator"></span>
            <span>AI Powered</span>
          </div>
        </div>
        <div className="chat-messages">
          {displayMessages.map((message) => (
            <ChatMessage
              key={message.id}
              role={message.role}
              content={message.content}
              timestamp={message.timestamp}
            />
          ))}
          {isLoading && (
            <div className="loading-indicator">
              <div className="loading-dots">
                <span></span>
                <span></span>
                <span></span>
              </div>
              <div className="loading-text">
                <div className="loading-step">📊 Fetching Polymarket data...</div>
                <div className="loading-step">🤖 AI analyzing market trends...</div>
                <div className="loading-step">📈 Generating recommendation...</div>
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>
        <ChatInput onSend={handleSendMessage} disabled={isLoading} />
      </div>
    </div>
  );
};
