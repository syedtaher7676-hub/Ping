import React, { memo, useCallback } from 'react';
import OnlineCounter from './OnlineCounter';
import IOSInstallBanner from './IOSInstallBanner';

/**
 * Isolated Static Logo Component
 * Guaranteed zero re-renders when online counter state fluctuates
 */
const LandingLogo = memo(function LandingLogo() {
  return (
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
          background: 'transparent',
          border: 'none',
          boxShadow: 'none',
          padding: 0,
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
            position: 'relative',
            zIndex: 2,
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            borderRadius: '16px',
            border: 'none',
            boxShadow: 'none',
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
  );
});

/**
 * Isolated Static Hero Copy
 */
const HeroCopy = memo(function HeroCopy() {
  return (
    <p
      className="hero-tagline"
      style={{
        fontFamily: "'Space Grotesk', sans-serif",
        fontSize: 'clamp(1.1rem, 3.5vw, 1.5rem)',
        fontWeight: 400,
        color: '#cbd5e1',
        lineHeight: 1.55,
        margin: 0,
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
  );
});

/**
 * Isolated Action Buttons Row
 */
const ActionButtons = memo(function ActionButtons({ onStartChat, onDownloadApp }) {
  return (
    <div
      className="landing-actions-row"
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '16px',
        flexWrap: 'wrap',
        width: '100%',
        willChange: 'transform, opacity',
        transform: 'translateZ(0)',
      }}
    >
      <button
        id="startLandingBtn"
        className="cta-btn"
        onClick={onStartChat}
        type="button"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '12px',
          minWidth: '180px',
          height: 'clamp(48px, 6.5dvh, 56px)',
          padding: '0 clamp(20px, 5vw, 32px)',
          background: 'linear-gradient(135deg, #7c3aed 0%, #db2777 100%)',
          border: 'none',
          borderRadius: '9999px',
          color: '#fff',
          fontFamily: "'Space Grotesk', sans-serif",
          fontSize: 'clamp(14px, 3.8vw, 17px)',
          fontWeight: 700,
          cursor: 'pointer',
          boxShadow: '0 4px 24px rgba(124, 58, 237, 0.55)',
          willChange: 'transform, opacity',
          transform: 'translateZ(0)',
          backfaceVisibility: 'hidden',
          WebkitBackfaceVisibility: 'hidden',
          boxSizing: 'border-box',
        }}
      >
        <span className="cta-label">Start Chat</span>
        <span className="cta-icon" aria-hidden="true" style={{ width: '32px', height: '32px', borderRadius: '50%', background: 'rgba(255, 255, 255, 0.18)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M5 12h14M12 5l7 7-7 7" />
          </svg>
        </span>
      </button>

      <button
        id="downloadLandingBtn"
        className="download-app-btn"
        onClick={onDownloadApp}
        type="button"
        title="Download & Install Ping"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '12px',
          minWidth: '180px',
          height: 'clamp(48px, 6.5dvh, 56px)',
          padding: '0 clamp(20px, 5vw, 32px)',
          background: 'rgba(255, 255, 255, 0.055)',
          border: '1px solid rgba(124, 58, 237, 0.4)',
          borderRadius: '9999px',
          color: '#fff',
          fontFamily: "'Space Grotesk', sans-serif",
          fontSize: 'clamp(14px, 3.8vw, 17px)',
          fontWeight: 700,
          cursor: 'pointer',
          boxShadow: '0 4px 20px rgba(0, 0, 0, 0.3)',
          willChange: 'transform, opacity',
          transform: 'translateZ(0)',
          backfaceVisibility: 'hidden',
          WebkitBackfaceVisibility: 'hidden',
          boxSizing: 'border-box',
        }}
      >
        <span className="download-label">Download App</span>
        <span className="download-icon-wrap" aria-hidden="true" style={{ width: '32px', height: '32px', borderRadius: '50%', background: 'rgba(6, 182, 212, 0.16)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <svg className="download-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#22d3ee" strokeWidth="2.4">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />
          </svg>
        </span>
      </button>
    </div>
  );
});

/**
 * Production-Ready LandingPage Component
 * Stably decoupled state hierarchy with zero layout thrashing
 */
export const LandingPage = memo(function LandingPage({ onStartChat, onDownloadApp }) {
  const handleStart = useCallback(() => {
    if (onStartChat) onStartChat();
  }, [onStartChat]);

  const handleDownload = useCallback(() => {
    if (onDownloadApp) onDownloadApp();
  }, [onDownloadApp]);

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
        {/* Memoized Static Logo Lockup */}
        <LandingLogo />

        {/* Memoized Static Tagline */}
        <HeroCopy />

        {/* Dynamic Leaf Component: Only this node updates when online count changes */}
        <OnlineCounter />

        {/* Memoized Static CTA Action Buttons */}
        <ActionButtons onStartChat={handleStart} onDownloadApp={handleDownload} />
      </div>

      {/* iOS PWA Install Guidance Banner */}
      <IOSInstallBanner />
    </div>
  );
});

export default LandingPage;
