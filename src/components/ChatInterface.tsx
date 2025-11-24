/**
 * ChatInterface - Main chat-based iteration interface
 * Replaces the previous tab-based generate/iterate UI
 */

import * as React from 'react';
import {
  Chat,
  ChatMessage,
  DesignSystemData,
  IterationData,
  VariationStatus,
} from '../types';
import { shouldShowChatWarning } from '../tokenEstimator';
import { ChatHeader } from './ChatHeader';
import { ChatWarningBanner } from './ChatWarningBanner';
import { MessageList } from './MessageList';
import { ChatInput } from './ChatInput';

interface ChatInterfaceProps {
  chat: Chat;
  designSystem: DesignSystemData | null;
  selectedFrameInfo: { frameId: string; frameName: string } | null;
  isGenerating: boolean;
  onSendMessage: (prompt: string, numVariations: number, model: 'claude' | 'gemini') => void;
  onStop: () => void;
  onNewChat: () => void;
  onExpandVariation: (messageId: string, variationIndex: number) => void;
}

export const ChatInterface: React.FC<ChatInterfaceProps> = ({
  chat,
  designSystem,
  selectedFrameInfo,
  isGenerating,
  onSendMessage,
  onStop,
  onNewChat,
  onExpandVariation,
}) => {
  const [inputValue, setInputValue] = React.useState('');
  const [numVariations, setNumVariations] = React.useState(3);
  const [selectedModel, setSelectedModel] = React.useState<'claude' | 'gemini'>('gemini');
  const prevIsGeneratingRef = React.useRef(isGenerating);

  // Clear input field when generation completes (goes from generating to not generating)
  React.useEffect(() => {
    if (prevIsGeneratingRef.current === true && isGenerating === false) {
      setInputValue('');
    }
    prevIsGeneratingRef.current = isGenerating;
  }, [isGenerating]);

  // Check if chat is too long
  const showWarning = shouldShowChatWarning(chat.messages);

  // Determine placeholder text
  const getPlaceholder = (): string => {
    if (isGenerating) {
      return 'Wait for your design to finish.';
    }

    if (!selectedFrameInfo) {
      return 'Select a frame to iterate on.';
    }

    return 'How do you want to iterate this design?';
  };

  const handleSend = () => {
    if (!inputValue.trim() || !selectedFrameInfo || isGenerating) {
      return;
    }

    onSendMessage(inputValue, numVariations, selectedModel);
    setInputValue(''); // Clear input after sending
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handlePromptClick = (prompt: string) => {
    // Automatically send the prompt (input will be cleared by useEffect when generation completes)
    if (selectedFrameInfo && !isGenerating) {
      onSendMessage(prompt, numVariations, selectedModel);
    }
  };

  return (
    <div className="chat-interface">
      <ChatHeader chatName={chat.name} onNewChat={onNewChat} />

      {showWarning && (
        <ChatWarningBanner
          message="Your chat is getting long. Consider starting a new chat for better performance."
          onNewChat={onNewChat}
        />
      )}

      <MessageList
        messages={chat.messages}
        onExpandVariation={onExpandVariation}
        hasSelectedFrame={!!selectedFrameInfo}
        onPromptClick={handlePromptClick}
      />

      <ChatInput
        disabled={!selectedFrameInfo || isGenerating}
        placeholder={getPlaceholder()}
        value={inputValue}
        onChange={setInputValue}
        onSend={handleSend}
        onKeyPress={handleKeyPress}
        numVariations={numVariations}
        onNumVariationsChange={setNumVariations}
        model={selectedModel}
        onModelChange={setSelectedModel}
        isGenerating={isGenerating}
        onStop={onStop}
      />
    </div>
  );
};
