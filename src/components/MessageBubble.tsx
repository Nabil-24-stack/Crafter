/**
 * MessageBubble - Individual message bubble (user or assistant)
 */

import * as React from 'react';
import { ChatMessage } from '../types';
import { IterationStatus } from './IterationStatus';

interface MessageBubbleProps {
  message: ChatMessage;
  onExpandVariation: (messageId: string, variationIndex: number) => void;
}

export const MessageBubble: React.FC<MessageBubbleProps> = ({
  message,
  onExpandVariation,
}) => {
  if (message.role === 'user') {
    return (
      <div className="message-bubble user-message">
        <div className="message-content user-bubble">{message.content}</div>
      </div>
    );
  }

  // Assistant message
  return (
    <div className="message-bubble assistant-message">
      <div className="message-content assistant-bubble">{message.content}</div>

      {message.iterationData && (
        <IterationStatus
          data={message.iterationData}
          messageId={message.id}
          onExpandVariation={onExpandVariation}
        />
      )}
    </div>
  );
};
