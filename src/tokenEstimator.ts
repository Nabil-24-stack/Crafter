/**
 * Simple token estimator for chat messages
 * Rough approximation: 1 token ≈ 4 characters for English text
 * This is a conservative estimate to avoid hitting context limits
 */

import { ChatMessage } from './types';

export function estimateTokens(text: string): number {
  // Rough approximation: 1 token ≈ 4 characters
  // This is conservative and works for most cases
  return Math.ceil(text.length / 4);
}

export function estimateChatTokens(messages: ChatMessage[]): number {
  let totalTokens = 0;

  for (const message of messages) {
    // Count message content
    totalTokens += estimateTokens(message.content);

    // If assistant message with iteration data, count summary too
    if (message.role === 'assistant' && message.iterationData) {
      if (message.iterationData.summary) {
        totalTokens += estimateTokens(message.iterationData.summary);
      }

      // Count variation sub-prompts
      for (const variation of message.iterationData.variations) {
        if (variation.subPrompt) {
          totalTokens += estimateTokens(variation.subPrompt);
        }
        if (variation.reasoning) {
          totalTokens += estimateTokens(variation.reasoning);
        }
      }
    }
  }

  return totalTokens;
}

export function shouldShowChatWarning(messages: ChatMessage[]): boolean {
  const totalTokens = estimateChatTokens(messages);
  return totalTokens > 8000;
}
