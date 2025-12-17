/**
 * IterationCounter - Displays user's iteration usage, plan status, and profile
 * Shows at bottom of chat interface with avatar, counter, and action buttons
 */

import * as React from 'react';

interface IterationCounterProps {
  iterations_used: number;
  iterations_limit: number;
  total_available: number;
  plan_type: 'free' | 'pro';
  onUpgradeClick?: () => void;
  onBuyMoreClick?: () => void;
  userEmail?: string;
  onLogout?: () => void;
  onManageSubscription?: () => void;
}

export const IterationCounter: React.FC<IterationCounterProps> = ({
  iterations_used,
  iterations_limit,
  total_available,
  plan_type,
  onUpgradeClick,
  onBuyMoreClick,
  userEmail,
  onLogout,
  onManageSubscription,
}) => {
  const [showProfileMenu, setShowProfileMenu] = React.useState(false);
  const profileRef = React.useRef<HTMLDivElement>(null);

  // Get first letter of email for avatar
  const getInitial = () => {
    return userEmail ? userEmail.charAt(0).toUpperCase() : 'U';
  };

  // Close menu when clicking outside
  React.useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (profileRef.current && !profileRef.current.contains(event.target as Node)) {
        setShowProfileMenu(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div className="iteration-counter">
      {/* Left: Profile Avatar */}
      <div className="profile-container-bottom" ref={profileRef}>
        <button
          className="profile-button-bottom"
          onClick={() => setShowProfileMenu(!showProfileMenu)}
          title={userEmail}
          aria-label="User profile"
        >
          {getInitial()}
        </button>
        {showProfileMenu && (
          <div className="profile-menu-bottom">
            <div className="profile-menu-email">{userEmail}</div>
            {plan_type === 'free' && onUpgradeClick && (
              <button className="profile-menu-item" onClick={() => {
                setShowProfileMenu(false);
                onUpgradeClick();
              }}>
                Upgrade
              </button>
            )}
            {plan_type === 'pro' && onManageSubscription && (
              <button className="profile-menu-item" onClick={() => {
                setShowProfileMenu(false);
                onManageSubscription();
              }}>
                Manage subscription
              </button>
            )}
            {onLogout && (
              <button className="profile-menu-item" onClick={onLogout}>
                Log out
              </button>
            )}
          </div>
        )}
      </div>

      {/* Center: Iteration Count and Plan Type */}
      <div className="iteration-info">
        <div className="iteration-count">
          {iterations_used}/{iterations_limit + (total_available - iterations_limit)} iterations
        </div>
        <div className="plan-label">
          {plan_type === 'free' ? 'Free plan' : 'Pro plan'}
        </div>
      </div>

      {/* Right: Action Buttons */}
      <div className="iteration-actions">
        {plan_type === 'free' && onUpgradeClick && (
          <button
            className="upgrade-button-bottom"
            onClick={onUpgradeClick}
            aria-label="Upgrade to Pro plan"
          >
            Upgrade
          </button>
        )}
        {onBuyMoreClick && (
          <button
            className="buy-more-button-bottom"
            onClick={onBuyMoreClick}
            aria-label="Buy more iterations"
          >
            Buy more iterations
          </button>
        )}
      </div>
    </div>
  );
};
