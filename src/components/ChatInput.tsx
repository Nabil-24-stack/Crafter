/**
 * ChatInput - Input area with model selector
 */

import * as React from 'react';

interface ChatInputProps {
  disabled: boolean;
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  onKeyPress: (e: React.KeyboardEvent) => void;
  model: 'claude' | 'gemini';
  onModelChange: (model: 'claude' | 'gemini') => void;
  isGenerating: boolean;
  onStop: () => void;
  planType?: 'free' | 'pro';
}

export const ChatInput: React.FC<ChatInputProps> = ({
  disabled,
  placeholder,
  value,
  onChange,
  onSend,
  onKeyPress,
  model,
  onModelChange,
  isGenerating,
  onStop,
  planType,
}) => {
  // Only show model selector for Pro users
  const showModelSelector = planType === 'pro';

  return (
    <div className="chat-input-container">
      <textarea
        className="chat-textarea"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyPress={onKeyPress}
        disabled={disabled}
        rows={2}
      />

      <div className="input-controls">
        {showModelSelector && (
          <select
            className="model-selector"
            value={model}
            onChange={(e) => onModelChange(e.target.value as 'claude' | 'gemini')}
            disabled={isGenerating}
          >
            <option value="gemini">Gemini 3 Pro</option>
            <option value="claude">Claude 4.5</option>
          </select>
        )}

        {isGenerating ? (
          <button className="stop-button" onClick={onStop}>
            Stop
          </button>
        ) : (
          <button
            className="send-button"
            onClick={onSend}
            disabled={disabled || !value.trim()}
          >
            Send
          </button>
        )}
      </div>
    </div>
  );
};
