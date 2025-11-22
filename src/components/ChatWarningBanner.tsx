/**
 * ChatWarningBanner - Warning banner shown when chat gets too long (>8000 tokens)
 */

import * as React from 'react';

interface ChatWarningBannerProps {
  message: string;
  onNewChat: () => void;
}

export const ChatWarningBanner: React.FC<ChatWarningBannerProps> = ({
  message,
  onNewChat,
}) => {
  return (
    <div className="chat-warning-banner">
      <span className="warning-icon">⚠️</span>
      <span className="warning-message">{message}</span>
      <button className="warning-action-button" onClick={onNewChat}>
        New Chat
      </button>
    </div>
  );
};
