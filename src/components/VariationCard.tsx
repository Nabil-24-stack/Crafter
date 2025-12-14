/**
 * VariationCard - Individual variation status card with expand/collapse
 */

import * as React from 'react';
import { VariationStatus } from '../types';
import { FormattedReasoning } from './FormattedReasoning';

interface VariationCardProps {
  variation: VariationStatus;
  onToggleExpand: () => void;
}

export const VariationCard: React.FC<VariationCardProps> = ({
  variation,
  onToggleExpand,
}) => {
  const getStatusIcon = () => {
    switch (variation.status) {
      case 'complete':
        return <span className="status-icon success">✓</span>;
      case 'error':
        return <span className="status-icon error">⚠️</span>;
      case 'stopped':
        return (
          <svg className="status-icon info" width="16" height="16" viewBox="0 0 16 16" fill="none">
            <circle cx="8" cy="8" r="7" stroke="#EF4444" strokeWidth="1.5"/>
            <path d="M8 4V8M8 10.5V11" stroke="#EF4444" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
        );
      default:
        // thinking, designing, rendering
        return <span className="status-icon loading"></span>;
    }
  };

  return (
    <div className={`variation-card ${variation.status}`}>
      <div className="variation-header" onClick={onToggleExpand}>
        {getStatusIcon()}
        <div className="variation-info">
          <div className="variation-title">
            {variation.sourceFrameName
              ? `Variation ${variation.index + 1} - ${variation.sourceFrameName}`
              : `Variation ${variation.index + 1}`
            }
          </div>
          <div className="variation-status-text">{variation.statusText}</div>
        </div>
        <button
          className="expand-button"
          aria-label={variation.isExpanded ? 'Collapse' : 'Expand'}
        >
          <span className={`expand-arrow ${variation.isExpanded ? 'expanded' : ''}`}>
            ▲
          </span>
        </button>
      </div>

      {variation.isExpanded && (
        <div className="variation-details">
          {/* Show live streaming reasoning or final reasoning (prioritize over sub-prompt) */}
          {(variation.streamingReasoning || variation.reasoning) && (
            <div className="detail-section">
              <div className="detail-label">
                AI Reasoning:
                {variation.isStreamingLive && (
                  <span className="live-badge">● LIVE</span>
                )}
              </div>
              <div className="detail-value">
                <FormattedReasoning
                  text={variation.streamingReasoning || variation.reasoning || ''}
                  isStreaming={variation.isStreamingLive}
                />
              </div>
            </div>
          )}

          {/* Show placeholder while waiting for reasoning to start */}
          {!variation.streamingReasoning && !variation.reasoning && !variation.subPrompt && !variation.error && (variation.status === 'designing' || variation.status === 'thinking') && (
            <div className="detail-section">
              <div className="detail-label">AI Reasoning:</div>
              <div className="detail-value placeholder-text">
                Showing AI reasoning in a moment...
              </div>
            </div>
          )}

          {/* Only show sub-prompt if no reasoning is available */}
          {!variation.streamingReasoning && !variation.reasoning && variation.subPrompt && (
            <div className="detail-section">
              <div className="detail-label">Sub-prompt:</div>
              <div className="detail-value">{variation.subPrompt}</div>
            </div>
          )}

          {variation.error && (
            <div className="detail-section error-detail">
              <div className="detail-label">Error Details:</div>
              <div className="detail-value">{variation.error}</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
