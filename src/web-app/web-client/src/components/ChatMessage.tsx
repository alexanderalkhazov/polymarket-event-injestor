import './ChatMessage.css';

interface ChatMessageProps {
  role: 'user' | 'assistant';
  content: string;
  timestamp?: string;
}

export const ChatMessage: React.FC<ChatMessageProps> = ({ role, content, timestamp }) => {
  return (
    <div className={`chat-message ${role}`}>
      <div className="message-avatar">
        {role === 'user' ? (
          <div className="user-avatar-chat">U</div>
        ) : (
          <div className="assistant-avatar">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          </div>
        )}
      </div>
      <div className="message-content">
        <div className="message-header">
          <span className="message-role">{role === 'user' ? 'You' : 'Polymarket AI'}</span>
          {timestamp && <span className="message-time">{timestamp}</span>}
        </div>
        <div className="message-text">{content}</div>
      </div>
    </div>
  );
};
