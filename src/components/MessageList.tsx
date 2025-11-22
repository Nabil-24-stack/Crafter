/**
 * MessageList - Scrollable list of chat messages
 */

import * as React from 'react';
import { ChatMessage } from '../types';
import { MessageBubble } from './MessageBubble';

interface MessageListProps {
  messages: ChatMessage[];
  onExpandVariation: (messageId: string, variationIndex: number) => void;
}

export const MessageList: React.FC<MessageListProps> = ({
  messages,
  onExpandVariation,
}) => {
  const messagesEndRef = React.useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new messages arrive
  React.useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  if (messages.length === 0) {
    return (
      <div className="message-list empty">
        <div className="empty-state">
          <p className="empty-state-text">Select a Frame to iterate on</p>
        </div>
      </div>
    );
  }

  return (
    <div className="message-list">
      {messages.map((message) => (
        <MessageBubble
          key={message.id}
          message={message}
          onExpandVariation={onExpandVariation}
        />
      ))}
      <div ref={messagesEndRef} />
    </div>
  );
};
