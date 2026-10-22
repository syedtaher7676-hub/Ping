import React, { useState, useEffect, memo } from 'react';

/**
 * IOSInstallBanner Component
 * Renders guidance banner/modal for installing Ping on iOS devices (Safari/Chrome on iOS)
 * and handles PWA install trigger state.
 */
export const IOSInstallBanner = memo(function IOSInstallBanner() {
  const [showBanner, setShowBanner] = useState(false);
  const [showModal, setShowModal] = useState(false);

  useEffect(() => {
    // Check if running on iOS
    const ua = window.navigator.userAgent.toLowerCase();
    const isIOS = /iphone|ipad|ipod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    
    // Check standalone mode
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
    
    // Check dismiss state
    const isDismissed = localStorage.getItem('ping_ios_banner_dismissed') === 'true';

    if (isIOS && !isStandalone && !isDismissed) {
      setShowBanner(true);
    }

    // Listen for custom global event to open install modal from download buttons
    const handleOpenInstallModal = () => {
      setShowModal(true);
    };

    window.addEventListener('ping:open-install-modal', handleOpenInstallModal);
    return () => {
      window.removeEventListener('ping:open-install-modal', handleOpenInstallModal);
    };
  }, []);

  const handleDismissBanner = () => {
    setShowBanner(false);
    localStorage.setItem('ping_ios_banner_dismissed', 'true');
  };

  return (
    <>
      {showBanner && (
        <div
          id="iosInstallBanner"
          style={{
            position: 'fixed',
            bottom: '16px',
            left: '50%',
            transform: 'translateX(-50%)',
            width: 'calc(100% - 32px)',
            maxWidth: '440px',
            backgroundColor: 'rgba(15, 12, 32, 0.94)',
            backdropFilter: 'blur(16px)',
            WebkitBackdropFilter: 'blur(16px)',
            border: '1px solid rgba(124, 58, 237, 0.4)',
            borderRadius: '16px',
            padding: '14px 18px',
            zIndex: 9990,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '12px',
            boxShadow: '0 10px 30px rgba(0,0,0,0.6), 0 0 20px rgba(124, 58, 237, 0.25)',
            animation: 'slideUp 0.3s ease-out',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <span style={{ fontSize: '24px' }}>📱</span>
            <div>
              <div style={{ color: '#ffffff', fontWeight: 700, fontSize: '0.88rem' }}>
                Install Ping on iOS
              </div>
              <div style={{ color: '#a78bfa', fontSize: '0.78rem' }}>
                Tap Share <span style={{ fontSize: '1rem' }}>⎋</span> then "Add to Home Screen"
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <button
              onClick={() => setShowModal(true)}
              type="button"
              style={{
                backgroundColor: 'rgba(124, 58, 237, 0.3)',
                border: '1px solid rgba(167, 139, 250, 0.5)',
                color: '#ffffff',
                padding: '6px 12px',
                borderRadius: '8px',
                fontSize: '0.78rem',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              How?
            </button>
            <button
              onClick={handleDismissBanner}
              type="button"
              aria-label="Close"
              style={{
                background: 'none',
                border: 'none',
                color: '#94a3b8',
                fontSize: '18px',
                cursor: 'pointer',
                padding: '4px',
              }}
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {showModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(5, 5, 14, 0.88)',
            backdropFilter: 'blur(10px)',
            WebkitBackdropFilter: 'blur(10px)',
            zIndex: 99999,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '20px',
          }}
          onClick={() => setShowModal(false)}
        >
          <div
            style={{
              maxWidth: '420px',
              width: '100%',
              backgroundColor: '#0d091f',
              border: '1px solid rgba(124, 58, 237, 0.45)',
              borderRadius: '20px',
              padding: '28px 24px',
              textAlign: 'center',
              boxShadow: '0 20px 50px rgba(0,0,0,0.8), 0 0 30px rgba(124, 58, 237, 0.3)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ fontSize: '36px', marginBottom: '12px' }}>📲</div>
            <h3 style={{ color: '#fff', fontSize: '1.25rem', fontWeight: 700, margin: '0 0 8px 0' }}>
              Install Ping App
            </h3>
            <p style={{ color: '#cbd5e1', fontSize: '0.88rem', lineHeight: 1.5, margin: '0 0 20px 0' }}>
              Add Ping directly to your home screen for instant fullscreen chat without the browser bar!
            </p>

            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '12px',
                textAlign: 'left',
                backgroundColor: 'rgba(255,255,255,0.04)',
                padding: '16px',
                borderRadius: '12px',
                border: '1px solid rgba(255,255,255,0.08)',
                marginBottom: '20px',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <span style={{ width: '28px', height: '28px', borderRadius: '50%', backgroundColor: 'rgba(124,58,237,0.3)', color: '#c4b5fd', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: '0.85rem' }}>1</span>
                <span style={{ color: '#e2e8f0', fontSize: '0.85rem' }}>
                  Tap the <strong>Share</strong> button <span style={{ fontSize: '1.1rem' }}>⎋</span> in Safari / Chrome
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <span style={{ width: '28px', height: '28px', borderRadius: '50%', backgroundColor: 'rgba(124,58,237,0.3)', color: '#c4b5fd', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: '0.85rem' }}>2</span>
                <span style={{ color: '#e2e8f0', fontSize: '0.85rem' }}>
                  Scroll down and select <strong>Add to Home Screen</strong> ➕
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <span style={{ width: '28px', height: '28px', borderRadius: '50%', backgroundColor: 'rgba(124,58,237,0.3)', color: '#c4b5fd', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: '0.85rem' }}>3</span>
                <span style={{ color: '#e2e8f0', fontSize: '0.85rem' }}>
                  Open Ping anytime directly from your home screen! ✨
                </span>
              </div>
            </div>

            <button
              onClick={() => setShowModal(false)}
              type="button"
              style={{
                width: '100%',
                padding: '12px',
                background: 'linear-gradient(135deg, #7c3aed 0%, #db2777 100%)',
                border: 'none',
                borderRadius: '12px',
                color: '#fff',
                fontSize: '0.95rem',
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              Got It
            </button>
          </div>
        </div>
      )}
    </>
  );
});

export default IOSInstallBanner;
