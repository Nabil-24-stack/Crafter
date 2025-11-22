/**
 * ChatHeader - Header showing chat name and new chat button
 */

import * as React from 'react';

interface ChatHeaderProps {
  chatName: string;
  onNewChat: () => void;
}

export const ChatHeader: React.FC<ChatHeaderProps> = ({ chatName, onNewChat }) => {
  return (
    <div className="chat-header">
      <h2 className="chat-title">{chatName}</h2>
      <button
        className="new-chat-button"
        onClick={onNewChat}
        title="New chat"
        aria-label="Start new chat"
      >
        +
      </button>
    </div>
  );
};
