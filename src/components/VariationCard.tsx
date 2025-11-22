/**
 * VariationCard - Individual variation status card with expand/collapse
 */

import * as React from 'react';
import { VariationStatus } from '../types';

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
          <div className="variation-title">Variation {variation.index + 1}</div>
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
          {variation.subPrompt && (
            <div className="detail-section">
              <div className="detail-label">Sub-prompt:</div>
              <div className="detail-value">{variation.subPrompt}</div>
            </div>
          )}

          {variation.reasoning && (
            <div className="detail-section">
              <div className="detail-label">AI Reasoning:</div>
              <div className="detail-value">{variation.reasoning}</div>
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
