import * as React from 'react';
// @ts-ignore
import crafterLogo from '../../Logo/crafter_logo.png';

interface LoginModalProps {
  onLogin: () => void;
  onClose: () => void;
}

export const LoginModal: React.FC<LoginModalProps> = ({ onLogin, onClose }) => {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="login-modal" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close-button" onClick={onClose}>×</button>

        <div className="login-modal-content">
          <div className="login-modal-logo">
            <img src={crafterLogo} alt="Crafter" />
          </div>

          <h2 className="login-modal-title">Start Ideating</h2>
          <p className="login-modal-subtitle">Sign in to view your iterations.</p>

          <button className="login-modal-button" onClick={onLogin}>
            Log in with Figma
          </button>
        </div>
      </div>
    </div>
  );
};
