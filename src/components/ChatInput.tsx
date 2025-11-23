/**
 * ChatInput - Input area with variations stepper and model selector
 */

import * as React from 'react';

interface ChatInputProps {
  disabled: boolean;
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  onKeyPress: (e: React.KeyboardEvent) => void;
  numVariations: number;
  onNumVariationsChange: (num: number) => void;
  model: 'claude' | 'gemini';
  onModelChange: (model: 'claude' | 'gemini') => void;
  isGenerating: boolean;
  onStop: () => void;
}

export const ChatInput: React.FC<ChatInputProps> = ({
  disabled,
  placeholder,
  value,
  onChange,
  onSend,
  onKeyPress,
  numVariations,
  onNumVariationsChange,
  model,
  onModelChange,
  isGenerating,
  onStop,
}) => {
  const handleIncrement = () => {
    if (numVariations < 5) {
      onNumVariationsChange(numVariations + 1);
    }
  };

  const handleDecrement = () => {
    if (numVariations > 1) {
      onNumVariationsChange(numVariations - 1);
    }
  };

  return (
    <div className="chat-input-container">
      <div className="variations-control">
        <label className="variations-label">Number of variations</label>
        <div className="variations-stepper">
          <button
            className="stepper-button"
            onClick={handleDecrement}
            disabled={numVariations <= 1 || isGenerating}
            aria-label="Decrease variations"
          >
            −
          </button>
          <span className="variations-number">{numVariations}</span>
          <button
            className="stepper-button"
            onClick={handleIncrement}
            disabled={numVariations >= 5 || isGenerating}
            aria-label="Increase variations"
          >
            +
          </button>
        </div>
      </div>

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
        <select
          className="model-selector"
          value={model}
          onChange={(e) => onModelChange(e.target.value as 'claude' | 'gemini')}
          disabled={isGenerating}
        >
          <option value="gemini">Gemini 3 Pro</option>
          <option value="claude">Claude 4.5</option>
        </select>

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
