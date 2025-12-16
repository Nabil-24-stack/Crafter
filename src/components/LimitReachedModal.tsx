/**
 * LimitReachedModal - Shows when user reaches iteration limit
 */

import * as React from 'react';

interface LimitReachedModalProps {
  onClose: () => void;
  onViewPlans: () => void;
  resetDate?: string;
}

export const LimitReachedModal: React.FC<LimitReachedModalProps> = ({
  onClose,
  onViewPlans,
  resetDate,
}) => {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="limit-reached-modal" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close-button" onClick={onClose}>
          ×
        </button>

        <div className="limit-reached-content">
          <div className="limit-reached-icon">
            <svg width="64" height="64" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
              <circle cx="32" cy="32" r="30" stroke="#161616" strokeWidth="4"/>
              <circle cx="32" cy="20" r="3" fill="#161616"/>
              <rect x="29" y="28" width="6" height="20" rx="3" fill="#161616"/>
            </svg>
          </div>

          <h2 className="limit-reached-title">
            You have used all your iterations.
          </h2>

          <p className="limit-reached-description">
            Your iterations will be refreshed on {resetDate || 'the 1st of next month'}. Consider upgrading or buying extra iterations.
          </p>

          <button className="limit-reached-button" onClick={onViewPlans}>
            View Plans
          </button>
        </div>
      </div>
    </div>
  );
};
