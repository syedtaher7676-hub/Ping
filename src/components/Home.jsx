import React, { useState, useEffect, memo, useCallback } from 'react';
import OnlineCounter from './OnlineCounter';
import { subscribeToOnlineCount } from '../socket';

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
 * Isolated from parent render triggers so it stays 100% paint-stable.
 */
export const StartChatButton = memo(function StartChatButton({ onClick }) {
  return (
    <button
      id="startLandingBtn"
      className="cta-btn"
      onClick={onClick}
      type="button"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '12px',
        minWidth: '200px',
        padding: '18px 44px',
        background: 'linear-gradient(135deg, #7c3aed 0%, #db2777 100%)',
        border: 'none',
        borderRadius: '9999px',
        color: '#fff',
        fontFamily: "'Space Grotesk', sans-serif",
        fontSize: '1.15rem',
        fontWeight: 700,
        cursor: 'pointer',
        boxShadow: '0 4px 24px rgba(124, 58, 237, 0.55)',
        willChange: 'transform, opacity',
        transform: 'translateZ(0)',
        backfaceVisibility: 'hidden',
        WebkitBackfaceVisibility: 'hidden',
      }}
    >
      <span className="cta-label">Start Chat</span>
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

  useEffect(() => {
    const unsubscribe = subscribeToOnlineCount((count) => {
      setOnlineUserCount(count);
    });
    return () => {
      unsubscribe();
    };
  }, []);

  const handleStartChat = useCallback(() => {
    if (onStartChat) onStartChat();
  }, [onStartChat]);

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
        padding: '32px 20px',
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
          gap: '28px',
          maxWidth: '560px',
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
        <StartChatButton onClick={handleStartChat} />
      </div>
    </div>
  );
}

export default Home;
