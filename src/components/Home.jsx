import React, { useState, useEffect, memo, useCallback } from 'react';
import OnlineCounter from './OnlineCounter';
import IOSInstallBanner from './IOSInstallBanner';
import { subscribeToOnlineCount, getSocket, socket } from '../socket';

/**
 * 1. Strictly Memoized Logo & Hero Title Section
 * Cached via React.memo so parent onlineUserCount updates cause 0 re-renders here.
 */
export const HeroSection = memo(function HeroSection() {
  return (
    <div
      className="hero-section"
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '20px',
        willChange: 'transform, opacity',
        transform: 'translateZ(0)',
        backfaceVisibility: 'hidden',
        WebkitBackfaceVisibility: 'hidden',
      }}
    >
      <div
        className="logo-lockup"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '16px',
          willChange: 'transform, opacity',
          transform: 'translateZ(0)',
          backfaceVisibility: 'hidden',
          WebkitBackfaceVisibility: 'hidden',
        }}
      >
        <div
          className="logo-mark"
          style={{
            position: 'relative',
            width: '72px',
            height: '72px',
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: '16px',
            willChange: 'transform, opacity',
            transform: 'translateZ(0)',
            backfaceVisibility: 'hidden',
            WebkitBackfaceVisibility: 'hidden',
          }}
        >
          <img
            src="/logo.svg"
            alt="Ping Logo"
            className="brand-logo-img"
            width="72"
            height="72"
            loading="eager"
            decoding="async"
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              borderRadius: '16px',
              willChange: 'transform, opacity',
              transform: 'translateZ(0)',
              backfaceVisibility: 'hidden',
              WebkitBackfaceVisibility: 'hidden',
            }}
          />
        </div>
        <h1
          className="logo-wordmark"
          style={{
            fontFamily: "'Space Grotesk', sans-serif",
            fontSize: 'clamp(3rem, 9vw, 5.5rem)',
            fontWeight: 700,
            letterSpacing: '-0.02em',
            lineHeight: 1,
            margin: 0,
            background: 'linear-gradient(160deg, #fff 20%, #c4b5fd 60%, #f472b6 100%)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            willChange: 'transform, opacity',
            transform: 'translateZ(0)',
            backfaceVisibility: 'hidden',
            WebkitBackfaceVisibility: 'hidden',
          }}
        >
          Ping
        </h1>
      </div>

      <p
        className="hero-tagline"
        style={{
          fontFamily: "'Space Grotesk', sans-serif",
          fontSize: 'clamp(1.1rem, 3.5vw, 1.5rem)',
          fontWeight: 400,
          color: '#cbd5e1',
          lineHeight: 1.55,
          margin: 0,
          textAlign: 'center',
          willChange: 'transform, opacity',
          transform: 'translateZ(0)',
          backfaceVisibility: 'hidden',
          WebkitBackfaceVisibility: 'hidden',
        }}
      >
        Talk to strangers.
        <br />
        <strong style={{ color: '#ffffff', fontWeight: 600 }}>Stay anonymous.</strong>
      </p>
    </div>
  );
});

/**
 * 2. Strictly Memoized "Start Chat" CTA Button
 * Supports disabled state when user is suspended.
 */
export const StartChatButton = memo(function StartChatButton({ onClick, disabled }) {
  return (
    <button
      id="startLandingBtn"
      className="cta-btn"
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      type="button"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '12px',
        minWidth: '200px',
        padding: 'clamp(12px, 2.5dvh, 18px) clamp(24px, 6vw, 44px)',
        background: disabled ? '#374151' : 'linear-gradient(135deg, #7c3aed 0%, #db2777 100%)',
        border: 'none',
        borderRadius: '9999px',
        color: disabled ? '#9ca3af' : '#fff',
        fontFamily: "'Space Grotesk', sans-serif",
        fontSize: 'clamp(15px, 4vw, 18px)',
        fontWeight: 700,
        cursor: disabled ? 'not-allowed' : 'pointer',
        boxShadow: disabled ? 'none' : '0 4px 24px rgba(124, 58, 237, 0.55)',
        willChange: 'transform, opacity',
        transform: 'translateZ(0)',
        backfaceVisibility: 'hidden',
        WebkitBackfaceVisibility: 'hidden',
        opacity: disabled ? 0.6 : 1,
        pointerEvents: disabled ? 'none' : 'auto',
      }}
    >
      <span className="cta-label">{disabled ? 'Chat Suspended' : 'Start Chat'}</span>
      <span className="cta-icon" aria-hidden="true">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
          <path d="M5 12h14M12 5l7 7-7 7" />
        </svg>
      </span>
    </button>
  );
});

/**
 * Home Landing View Container
 * Demonstrates state isolation: onlineUserCount updates ONLY re-render <OnlineCounter />
 */
export function Home({ onStartChat }) {
  const [onlineUserCount, setOnlineUserCount] = useState(0);
  const [banMinutes, setBanMinutes] = useState(null);

  useEffect(() => {
    const unsubscribe = subscribeToOnlineCount((count) => {
      setOnlineUserCount(count);
    });

    const activeSocket = typeof getSocket === 'function' ? getSocket() : socket;
    const handleConnectError = (error) => {
      const msg = (error && (error.message || (typeof error === 'string' ? error : ''))) || '';
      if (msg.includes('TEMPORARY_BAN:')) {
        const parts = msg.split('TEMPORARY_BAN:');
        const minutes = parseInt(parts[1], 10) || 15;
        setBanMinutes(minutes);
      }
    };

    if (activeSocket) {
      activeSocket.on('connect_error', handleConnectError);
    }

    return () => {
      unsubscribe();
      if (activeSocket) {
        activeSocket.off('connect_error', handleConnectError);
      }
    };
  }, []);

  const handleStartChat = useCallback(() => {
    if (banMinutes) return;
    if (onStartChat) onStartChat();
  }, [onStartChat, banMinutes]);

  const isBanned = banMinutes !== null;

  return (
    <div
      id="landingPage"
      className="landing"
      style={{
        minHeight: '100dvh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 'clamp(16px, 4dvh, 32px) clamp(14px, 4vw, 24px)',
        position: 'relative',
        overflow: 'hidden',
        willChange: 'transform, opacity',
        transform: 'translateZ(0)',
        backfaceVisibility: 'hidden',
        WebkitBackfaceVisibility: 'hidden',
      }}
    >
      <div
        className="landing-content"
        style={{
          position: 'relative',
          zIndex: 10,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          textAlign: 'center',
          gap: 'clamp(18px, 4dvh, 28px)',
          maxWidth: '480px',
          width: '100%',
          willChange: 'transform, opacity',
          transform: 'translateZ(0)',
          backfaceVisibility: 'hidden',
          WebkitBackfaceVisibility: 'hidden',
        }}
      >
        {/* Step 1 Optimization: Memoized Hero & Title section */}
        <HeroSection />

        {/* Step 2 Optimization: Standalone Decoupled Online Counter */}
        <OnlineCounter count={onlineUserCount} />

        {/* Step 1 & 3 Optimizations: Memoized & GPU-accelerated CTA button */}
        <StartChatButton onClick={handleStartChat} disabled={isBanned} />
      </div>

      {/* iOS PWA Install Guidance Banner */}
      <IOSInstallBanner />

      {/* Clean Dark Overlay for Temporary Ban */}
      {isBanned && (
        <div
          id="temporaryBanOverlay"
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(5, 5, 14, 0.92)',
            backdropFilter: 'blur(8px)',
            WebkitBackdropFilter: 'blur(8px)',
            zIndex: 9999,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '24px',
          }}
        >
          <div
            style={{
              maxWidth: '460px',
              width: '100%',
              backgroundColor: '#0c0c1e',
              border: '1px solid rgba(239, 68, 68, 0.35)',
              borderRadius: '20px',
              padding: '36px 28px',
              textAlign: 'center',
              boxShadow: '0 25px 60px rgba(0, 0, 0, 0.7), 0 0 35px rgba(239, 68, 68, 0.15)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '16px',
            }}
          >
            <div
              style={{
                width: '60px',
                height: '60px',
                borderRadius: '50%',
                backgroundColor: 'rgba(239, 68, 68, 0.15)',
                border: '1px solid rgba(239, 68, 68, 0.4)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '28px',
              }}
            >
              🚫
            </div>
            <h2
              style={{
                color: '#ffffff',
                fontFamily: "'Space Grotesk', sans-serif",
                fontSize: '1.45rem',
                fontWeight: 700,
                margin: 0,
              }}
            >
              Access Suspended
            </h2>
            <p
              id="temporaryBanMessage"
              style={{
                color: '#f87171',
                fontFamily: "'Space Grotesk', sans-serif",
                fontSize: '1.1rem',
                lineHeight: 1.5,
                margin: 0,
                fontWeight: 600,
              }}
            >
              Suspended for {banMinutes} minutes due to community reports
            </p>
            <p
              style={{
                color: '#94a3b8',
                fontSize: '0.875rem',
                lineHeight: 1.5,
                margin: 0,
              }}
            >
              Matchmaking and chatting are temporarily disabled. Your access will automatically resume when this suspension expires.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

export default Home;
