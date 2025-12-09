/**
 * FormattedReasoning - Renders AI reasoning with proper formatting
 * Converts markdown-style bold (**text**) to actual bold
 * Handles paragraphs and numbered lists
 */

import * as React from 'react';

interface FormattedReasoningProps {
  text: string;
  isStreaming?: boolean;
}

export const FormattedReasoning: React.FC<FormattedReasoningProps> = ({
  text,
  isStreaming = false,
}) => {
  // Parse the text and convert markdown-style formatting
  const formatText = (rawText: string): React.ReactNode[] => {
    if (!rawText) return [];

    // Split into paragraphs (double newline or numbered list items)
    const paragraphs = rawText.split(/(?:\n\n+|\n(?=\d+\.))/g).filter(p => p.trim());

    return paragraphs.map((paragraph, pIndex) => {
      // Check if this is a numbered list item
      const isNumberedItem = /^\d+\./.test(paragraph.trim());

      // Parse bold text (**text**)
      const parts: React.ReactNode[] = [];
      let remaining = paragraph;
      let keyIndex = 0;

      while (remaining.length > 0) {
        const boldMatch = remaining.match(/\*\*(.*?)\*\*/);

        if (boldMatch && boldMatch.index !== undefined) {
          // Add text before the bold part
          if (boldMatch.index > 0) {
            parts.push(
              <React.Fragment key={`${pIndex}-${keyIndex++}`}>
                {remaining.substring(0, boldMatch.index)}
              </React.Fragment>
            );
          }

          // Add the bold part
          parts.push(
            <strong key={`${pIndex}-${keyIndex++}`}>{boldMatch[1]}</strong>
          );

          // Continue with remaining text
          remaining = remaining.substring(boldMatch.index + boldMatch[0].length);
        } else {
          // No more bold text, add the rest
          parts.push(
            <React.Fragment key={`${pIndex}-${keyIndex++}`}>
              {remaining}
            </React.Fragment>
          );
          break;
        }
      }

      // Wrap in appropriate element
      if (isNumberedItem) {
        return (
          <div key={pIndex} className="reasoning-list-item">
            {parts}
          </div>
        );
      } else {
        return (
          <p key={pIndex} className="reasoning-paragraph">
            {parts}
          </p>
        );
      }
    });
  };

  const formatted = formatText(text);

  return (
    <div className="formatted-reasoning">
      {formatted}
      {isStreaming && <span className="typing-cursor">▌</span>}
    </div>
  );
};
