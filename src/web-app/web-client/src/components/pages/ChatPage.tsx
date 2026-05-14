import { useEffect, useRef, useState } from 'react';
import { Loader2, Send, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { chatAPI } from '@/services/api';

type Message = { id: number; role: 'user' | 'assistant'; content: string; timestamp: string };
type Conversation = { id: string; title: string; updatedAt: string; messageCount: number; lastMessage: string };

const WELCOME: Message = {
  id: 0,
  role: 'assistant',
  content: 'Welcome! Ask me about market analysis, risk management, or strategy comparisons. I have access to live event context.',
  timestamp: 'Now',
};

export function ChatPage() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [messages, setMessages] = useState<Message[]>([WELCOME]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [isLoadingConvos, setIsLoadingConvos] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const loadConversations = async () => {
    setIsLoadingConvos(true);
    try {
      const res = await chatAPI.getConversations();
      if (res.success && res.data) setConversations(res.data);
    } finally {
      setIsLoadingConvos(false);
    }
  };

  const loadConversation = async (id: string) => {
    try {
      const res = await chatAPI.getConversation(id);
      if (res.success && res.data) {
        setMessages(
          res.data.messages.map((m, i) => ({
            id: i + 1,
            role: m.role as 'user' | 'assistant',
            content: m.content,
            timestamp: new Date(m.timestamp).toLocaleTimeString(),
          }))
        );
        setCurrentId(id);
      }
    } catch {
      // ignore
    }
  };

  const newChat = () => {
    setMessages([WELCOME]);
    setCurrentId(null);
  };

  const sendMessage = async () => {
    const content = input.trim();
    if (!content || isSending) return;
    const uid = Date.now();
    const aid = uid + 1;
    setMessages((prev) => [
      ...prev,
      { id: uid, role: 'user', content, timestamp: new Date().toLocaleTimeString() },
      { id: aid, role: 'assistant', content: '', timestamp: new Date().toLocaleTimeString() },
    ]);
    setInput('');
    setIsSending(true);
    try {
      await chatAPI.sendMessageStream(content, currentId || undefined, {
        onMeta: (meta) => { if (!currentId && meta.conversationId) setCurrentId(meta.conversationId); },
        onToken: (token) =>
          setMessages((prev) =>
            prev.map((m) => (m.id === aid ? { ...m, content: m.content + token } : m))
          ),
        onDone: async (done) => {
          if (!currentId && done.conversationId) setCurrentId(done.conversationId);
          await loadConversations();
        },
        onError: (msg) => { throw new Error(msg); },
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to respond';
      setMessages((prev) =>
        prev.map((m) => (m.id === aid ? { ...m, content: `Something went wrong: ${msg}` } : m))
      );
    } finally {
      setIsSending(false);
    }
  };

  useEffect(() => { loadConversations(); }, []);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  const formatTime = (s: string) => {
    const d = new Date(s);
    const diff = Math.floor((Date.now() - d.getTime()) / 60000);
    if (diff < 1) return 'just now';
    if (diff < 60) return `${diff}m`;
    if (diff < 1440) return `${Math.floor(diff / 60)}h`;
    return `${Math.floor(diff / 1440)}d`;
  };

  return (
    <div className="flex h-full">
      {/* Conversation sidebar */}
      <aside className="hidden w-56 shrink-0 flex-col border-r border-border bg-card/40 md:flex">
        <div className="flex h-14 items-center justify-between border-b border-border px-3">
          <span className="text-sm font-medium">Chats</span>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={newChat} title="New chat">
            <span className="text-lg leading-none">+</span>
          </Button>
        </div>
        <div className="flex-1 overflow-y-auto p-2">
          {isLoadingConvos ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          ) : conversations.length === 0 ? (
            <p className="px-2 py-4 text-xs text-muted-foreground">No conversations yet</p>
          ) : (
            conversations.map((c) => (
              <button
                key={c.id}
                className={cn(
                  'w-full rounded-md px-2 py-2 text-left text-xs transition-colors hover:bg-accent',
                  currentId === c.id && 'bg-accent text-foreground'
                )}
                onClick={() => loadConversation(c.id)}
              >
                <p className="truncate font-medium">{c.title || 'Untitled'}</p>
                <p className="mt-0.5 text-muted-foreground">{formatTime(c.updatedAt)} ago</p>
              </button>
            ))
          )}
        </div>
      </aside>

      {/* Chat area */}
      <div className="flex flex-1 flex-col">
        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {messages.map((m) => (
            <div key={m.id} className={cn('flex', m.role === 'user' ? 'justify-end' : 'justify-start')}>
              {m.role === 'assistant' && (
                <div className="mr-2 mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary">
                  <Sparkles className="h-3 w-3 text-primary-foreground" />
                </div>
              )}
              <div
                className={cn(
                  'max-w-[72%] rounded-2xl px-4 py-3 text-sm',
                  m.role === 'user'
                    ? 'rounded-br-sm bg-primary text-primary-foreground'
                    : 'rounded-bl-sm bg-card border border-border text-foreground'
                )}
              >
                <p className="whitespace-pre-wrap leading-relaxed">
                  {m.content || (
                    <span className="inline-flex items-center gap-1 text-muted-foreground">
                      <Loader2 className="h-3 w-3 animate-spin" />
                      Thinking…
                    </span>
                  )}
                </p>
                <p className="mt-1.5 text-[10px] opacity-50">{m.timestamp}</p>
              </div>
            </div>
          ))}
          <div ref={bottomRef} />
        </div>

        {/* Input bar */}
        <div className="border-t border-border bg-card/30 p-4">
          <div className="flex items-end gap-2">
            <Input
              placeholder="Ask about markets, strategies, or risk…"
              className="flex-1"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
              disabled={isSending}
            />
            <Button size="icon" onClick={sendMessage} disabled={isSending || !input.trim()}>
              {isSending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
