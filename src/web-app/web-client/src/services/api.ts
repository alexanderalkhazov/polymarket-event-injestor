import axios from 'axios';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';

const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request interceptor to add auth token
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Response interceptor for error handling
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      // Token expired or invalid
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

export interface User {
  id: string;
  email: string;
  name: string;
}

export interface AuthResponse {
  success: boolean;
  data?: {
    user: User;
    token: string;
  };
  message?: string;
}

export interface RegisterData {
  email: string;
  password: string;
  name: string;
}

export interface LoginData {
  email: string;
  password: string;
}

// Auth API calls
export const authAPI = {
  register: async (data: RegisterData): Promise<AuthResponse> => {
    const response = await api.post('/api/auth/register', data);
    return response.data;
  },

  login: async (data: LoginData): Promise<AuthResponse> => {
    const response = await api.post('/api/auth/login', data);
    return response.data;
  },

  getCurrentUser: async (): Promise<{ success: boolean; data?: User }> => {
    const response = await api.get('/api/auth/me');
    return response.data;
  },

  logout: async (): Promise<{ success: boolean }> => {
    const response = await api.post('/api/auth/logout');
    return response.data;
  },
};

// Chat API calls
export const chatAPI = {
  // Send a message (creates new conversation if conversationId is null)
  sendMessage: async (message: string, conversationId?: string): Promise<{ 
    success: boolean; 
    data?: { 
      conversationId: string;
      message: string; 
      timestamp: string;
      conversation: {
        id: string;
        title: string;
        messageCount: number;
      };
    } 
  }> => {
    const response = await api.post('/api/chat/message', { message, conversationId });
    return response.data;
  },

  sendMessageStream: async (
    message: string,
    conversationId: string | undefined,
    handlers: {
      onMeta?: (meta: { conversationId?: string }) => void;
      onToken?: (token: string) => void;
      onDone?: (done: { conversationId?: string; timestamp?: string }) => void;
      onError?: (message: string) => void;
    }
  ): Promise<void> => {
    const token = localStorage.getItem('token');

    const response = await fetch(`${API_BASE_URL}/api/chat/message/stream`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ message, conversationId }),
    });

    if (!response.ok || !response.body) {
      const text = await response.text();
      throw new Error(text || `Streaming request failed (${response.status})`);
    }

    const decoder = new TextDecoder();
    let buffer = '';
    const reader = response.body.getReader();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;

      buffer += decoder.decode(value, { stream: true });

      while (buffer.includes('\n\n')) {
        const eventEnd = buffer.indexOf('\n\n');
        const rawEvent = buffer.slice(0, eventEnd);
        buffer = buffer.slice(eventEnd + 2);

        const dataLine = rawEvent
          .split('\n')
          .find(line => line.startsWith('data: '));

        if (!dataLine) continue;

        const payload = JSON.parse(dataLine.replace('data: ', ''));

        if (payload.type === 'meta' && handlers.onMeta) {
          handlers.onMeta(payload);
        } else if (payload.type === 'token' && handlers.onToken) {
          handlers.onToken(payload.token || '');
        } else if (payload.type === 'done' && handlers.onDone) {
          handlers.onDone(payload);
        } else if (payload.type === 'error') {
          if (handlers.onError) handlers.onError(payload.message || 'Streaming error');
          throw new Error(payload.message || 'Streaming error');
        }
      }
    }
  },

  // Get all conversations for current user
  getConversations: async (): Promise<{ 
    success: boolean; 
    data?: Array<{
      id: string;
      title: string;
      updatedAt: string;
      messageCount: number;
      lastMessage: string;
    }> 
  }> => {
    const response = await api.get('/api/chat/conversations');
    return response.data;
  },

  // Get a specific conversation
  getConversation: async (conversationId: string): Promise<{
    success: boolean;
    data?: {
      _id: string;
      title: string;
      messages: Array<{ role: string; content: string; timestamp: string }>;
      createdAt: string;
      updatedAt: string;
    };
  }> => {
    const response = await api.get(`/api/chat/conversations/${conversationId}`);
    return response.data;
  },

  // Create a new conversation
  createConversation: async (title?: string): Promise<{
    success: boolean;
    data?: any;
  }> => {
    const response = await api.post('/api/chat/conversations', { title });
    return response.data;
  },

  // Delete a conversation
  deleteConversation: async (conversationId: string): Promise<{
    success: boolean;
  }> => {
    const response = await api.delete(`/api/chat/conversations/${conversationId}`);
    return response.data;
  },

  // Get market events (debugging)
  getMarketEvents: async (limit: number | 'all' = 100): Promise<{ 
    success: boolean; 
    data?: { events: any[]; count: number } 
  }> => {
    const response = await api.get(`/api/chat/events?limit=${limit}`);
    return response.data;
  },
};

export default api;
