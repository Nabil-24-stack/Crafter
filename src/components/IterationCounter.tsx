/**
 * IterationCounter - Displays user's iteration usage and plan status
 * Shows at bottom of chat interface
 */

import * as React from 'react';

interface IterationCounterProps {
  iterations_used: number;
  iterations_limit: number;
  total_available: number;
  plan_type: 'free' | 'pro';
  onUpgradeClick?: () => void;
  onBuyMoreClick?: () => void;
}

export const IterationCounter: React.FC<IterationCounterProps> = ({
  iterations_used,
  iterations_limit,
  total_available,
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
          {iterations_used}/{iterations_limit + (total_available - iterations_limit)} iterations
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
          Pro Plan
        </div>
      )}
    </div>
  );
};
