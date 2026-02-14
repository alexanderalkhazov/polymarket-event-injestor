import './Sidebar.css';

interface Conversation {
  id: string;
  title: string;
  updatedAt: string;
  messageCount: number;
  lastMessage: string;
}

interface SidebarProps {
  conversations?: Conversation[];
  currentConversationId?: string | null;
  onNewChat?: () => void;
  onSelectConversation?: (id: string) => void;
  onDeleteConversation?: (id: string) => void;
  isLoading?: boolean;
  showChatSection?: boolean;
  side?: 'left' | 'right';
}

export const Sidebar: React.FC<SidebarProps> = ({ 
  conversations = [],
  currentConversationId = null,
  onNewChat,
  onSelectConversation,
  onDeleteConversation,
  isLoading = false,
  showChatSection = true,
  side = 'left',
}) => {
  const formatTime = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  };

  return (
    <div className={`sidebar ${side === 'right' ? 'sidebar-right' : ''}`}>
      {showChatSection && (
        <>
          <button className="new-chat-btn" onClick={onNewChat}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            New Chat
          </button>

          <div className="conversations">
            {isLoading ? (
              <div className="conversations-loading">Loading...</div>
            ) : conversations.length > 0 ? (
              <>
                <div className="conversations-header">Recent Conversations</div>
                {conversations.map((conv) => (
                  <div
                    key={conv.id}
                    className={`conversation-item ${currentConversationId === conv.id ? 'active' : ''}`}
                    onClick={() => onSelectConversation?.(conv.id)}
                  >
                    <div className="conversation-icon">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                      </svg>
                    </div>
                    <div className="conversation-info">
                      <div className="conversation-title">{conv.title}</div>
                      <div className="conversation-time">{formatTime(conv.updatedAt)}</div>
                    </div>
                    <button
                      className="delete-conversation-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (window.confirm('Delete this conversation?')) {
                          onDeleteConversation?.(conv.id);
                        }
                      }}
                      title="Delete conversation"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  </div>
                ))}
              </>
            ) : (
              <div className="conversations-empty">
                <p>No conversations yet</p>
                <p className="empty-subtitle">Start chatting to create your first conversation!</p>
              </div>
            )}
          </div>
        </>
      )}

      {!showChatSection && <div className="conversations" />}
    </div>
  );
};
