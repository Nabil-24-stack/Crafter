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
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);

  // Only show model selector for Pro users
  const showModelSelector = planType === 'pro';

  // Auto-resize textarea
  React.useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = textareaRef.current.scrollHeight + 'px';
    }
  }, [value]);

  return (
    <div className="chat-input-wrapper">
      <div className="chat-input-container">
        <textarea
          ref={textareaRef}
          className="chat-textarea"
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyPress={onKeyPress}
          disabled={disabled}
          rows={1}
        />

        <div className="input-controls-inline">
          {showModelSelector && (
            <select
              className="model-selector-inline"
              value={model}
              onChange={(e) => onModelChange(e.target.value as 'claude' | 'gemini')}
              disabled={isGenerating}
            >
              <option value="gemini">Gemini 3 Pro</option>
              <option value="claude">Claude 4.5</option>
            </select>
          )}

          {isGenerating ? (
            <button className="stop-button-inline" onClick={onStop}>
              Stop
            </button>
          ) : (
            <button
              className="send-button-inline"
              onClick={onSend}
              disabled={disabled || !value.trim()}
            >
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M2.5 10L17.5 3.33334L10.8333 18.3333L9.16667 11.6667L2.5 10Z" fill="currentColor" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
