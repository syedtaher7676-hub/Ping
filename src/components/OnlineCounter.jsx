import React, { useState, useEffect, memo } from 'react';
import { subscribeToOnlineCount } from '../socket';

/**
 * OnlineCounter Standalone Micro-Component
 * Decouples the online user count state and glowing dot badge from the parent component tree.
 * Prop `count` is optional; if omitted, subscribes directly to socket updates.
 */
export const OnlineCounter = memo(function OnlineCounter({ count }) {
  const [internalCount, setInternalCount] = useState(0);
  const displayCount = count !== undefined ? count : internalCount;

  useEffect(() => {
    if (count !== undefined) return;

    const unsubscribe = subscribeToOnlineCount((newCount) => {
      setInternalCount(newCount);
    });

    return () => {
      unsubscribe();
    };
  }, [count]);

  return (
    <div
      className="live-count-row"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '10px',
        padding: '11px 26px',
        background: 'rgba(10, 10, 24, 0.65)',
        border: '1px solid rgba(255, 255, 255, 0.1)',
        borderRadius: '9999px',
        backdropFilter: 'blur(24px)',
        WebkitBackdropFilter: 'blur(24px)',
        boxShadow: '0 4px 20px rgba(0, 0, 0, 0.3)',
        willChange: 'transform, opacity',
        transform: 'translateZ(0)',
        backfaceVisibility: 'hidden',
        WebkitBackfaceVisibility: 'hidden',
        contentVisibility: 'auto',
        containIntrinsicSize: '0 48px',
      }}
    >
      <span
        className="live-dot"
        style={{
          width: '9px',
          height: '9px',
          borderRadius: '50%',
          background: '#22c55e',
          boxShadow: '0 0 12px rgba(34, 197, 94, 0.9)',
          flexShrink: 0,
          willChange: 'transform, opacity',
          transform: 'translateZ(0)',
          backfaceVisibility: 'hidden',
          WebkitBackfaceVisibility: 'hidden',
        }}
        aria-hidden="true"
      />
      <span
        className="live-num"
        style={{
          fontFamily: "'Space Grotesk', sans-serif",
          fontSize: '1.35rem',
          fontWeight: 700,
          color: '#ffffff',
          fontVariantNumeric: 'tabular-nums',
          minWidth: '2ch',
          textAlign: 'center',
          willChange: 'transform, opacity',
          transform: 'translateZ(0)',
          backfaceVisibility: 'hidden',
          WebkitBackfaceVisibility: 'hidden',
        }}
      >
        {displayCount > 0 ? Number(displayCount).toLocaleString() : '—'}
      </span>
      <span
        className="live-label"
        style={{
          fontSize: '0.88rem',
          color: '#cbd5e1',
          willChange: 'transform, opacity',
          transform: 'translateZ(0)',
          backfaceVisibility: 'hidden',
          WebkitBackfaceVisibility: 'hidden',
        }}
      >
        online now
      </span>
    </div>
  );
});

export default OnlineCounter;
