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
}

export const IterationCounter: React.FC<IterationCounterProps> = ({
  iterations_used,
  iterations_limit,
  plan_type,
  onUpgradeClick,
}) => {
  return (
    <div className="iteration-counter">
      <div className="iteration-count">
        {iterations_used}/{iterations_limit} iterations
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
