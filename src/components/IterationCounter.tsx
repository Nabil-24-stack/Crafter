/**
 * IterationCounter - Displays user's iteration usage and plan status
 * Shows at bottom of chat interface
 */

import * as React from 'react';

interface IterationCounterProps {
  iterations_used: number;
  iterations_limit: number;
  plan_type: 'free' | 'pro';
  onUpgradeClick?: () => void;
  onBuyMoreClick?: () => void;
}

export const IterationCounter: React.FC<IterationCounterProps> = ({
  iterations_used,
  iterations_limit,
  plan_type,
  onUpgradeClick,
  onBuyMoreClick,
}) => {
  // Show "Buy more iterations" when:
  // - Free plan: >= 8 iterations
  // - Pro plan: >= 30 iterations
  const showBuyMore =
    (plan_type === 'free' && iterations_used >= 8) ||
    (plan_type === 'pro' && iterations_used >= 30);

  return (
    <div className="iteration-counter">
      <div className="iteration-count-wrapper">
        <div className="iteration-count">
          {iterations_used}/{iterations_limit} iterations
        </div>
        {showBuyMore && onBuyMoreClick && (
          <button
            className="buy-more-button"
            onClick={onBuyMoreClick}
            aria-label="Buy more iterations"
          >
            Buy more iterations
          </button>
        )}
      </div>

      {plan_type === 'free' ? (
        <button
          className="upgrade-button"
          onClick={onUpgradeClick}
          aria-label="Upgrade to Pro plan"
        >
          Upgrade Plan
        </button>
      ) : (
        <div className="pro-plan-badge">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="pro-icon">
            <path
              d="M8 1L10.5 6.5L16 7.5L12 11.5L13 17L8 14L3 17L4 11.5L0 7.5L5.5 6.5L8 1Z"
              fill="currentColor"
            />
          </svg>
          Pro Plan
        </div>
      )}
    </div>
  );
};
