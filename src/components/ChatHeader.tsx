/**
 * ChatHeader - Header showing chat name, new chat button, and user profile
 */

import * as React from 'react';

interface ChatHeaderProps {
  chatName: string;
  onNewChat: () => void;
  userEmail?: string;
  onLogout?: () => void;
}

export const ChatHeader: React.FC<ChatHeaderProps> = ({ chatName, onNewChat, userEmail, onLogout }) => {
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
    <div className="chat-header">
      <h2 className="chat-title">{chatName}</h2>
      <div className="chat-header-actions">
        <button
          className="new-chat-button"
          onClick={onNewChat}
          title="New chat"
          aria-label="Start new chat"
        >
          +
        </button>
        {userEmail && (
          <div className="profile-container" ref={profileRef}>
            <button
              className="profile-button"
              onClick={() => setShowProfileMenu(!showProfileMenu)}
              title={userEmail}
              aria-label="User profile"
            >
              {getInitial()}
            </button>
            {showProfileMenu && (
              <div className="profile-menu">
                <div className="profile-menu-email">{userEmail}</div>
                <button className="profile-menu-item" onClick={onLogout}>
                  Log out
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
