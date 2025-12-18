/**
 * MessageList - Scrollable list of chat messages
 */

import * as React from 'react';
import { ChatMessage } from '../types';
import { MessageBubble } from './MessageBubble';

interface MessageListProps {
  messages: ChatMessage[];
  onExpandVariation: (messageId: string, variationIndex: number) => void;
  hasSelectedFrame: boolean;
  onPromptClick?: (prompt: string) => void;
  isMultiFrameOnFreePlan?: boolean;
}

export const MessageList: React.FC<MessageListProps> = ({
  messages,
  onExpandVariation,
  hasSelectedFrame,
  onPromptClick,
  isMultiFrameOnFreePlan,
}) => {
  const examplePrompts = [
    'Design what the empty state could look like.',
    'What are the different error states that this screen would need?',
    'What are alternative ways to design this screen?',
  ];

  if (messages.length === 0) {
    return (
      <div className="message-list empty">
        <div className="empty-state">
          {hasSelectedFrame ? (
            <>
              {isMultiFrameOnFreePlan ? (
                <p className="empty-state-text">Multi-frame iteration is only available on Pro plan.</p>
              ) : (
                <>
                  <p className="empty-state-heading">Here's some prompts for you to start:</p>
                  <div className="example-prompts">
                    {examplePrompts.map((prompt, index) => (
                      <button
                        key={index}
                        className="example-prompt-button"
                        onClick={() => onPromptClick?.(prompt)}
                      >
                        {prompt}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </>
          ) : (
            <p className="empty-state-text">Select a Frame to iterate on</p>
          )}
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
    </div>
  );
};
