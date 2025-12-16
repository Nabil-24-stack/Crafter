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
            <img src="Info.png" alt="Info" />
          </div>

          <h2 className="limit-reached-title">
            You have met your monthly iterations.
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
