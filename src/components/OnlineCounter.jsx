import React, { useState, useEffect, useRef, memo } from 'react';
import { subscribeToOnlineCount } from '../socket';

/**
 * OnlineCounter Micro-Component
 * Completely decouples the real-time online counter from the parent Landing Page.
 * Socket updates trigger re-renders ONLY inside this leaf node.
 */
export const OnlineCounter = memo(function OnlineCounter() {
  const [displayCount, setDisplayCount] = useState(0);
  const targetCountRef = useRef(0);
  const currentValRef = useRef(0);
  const rafIdRef = useRef(null);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;

    // Smooth RAF easing count-up without parent component overhead
    const animateCount = (newTarget) => {
      targetCountRef.current = newTarget;
      if (rafIdRef.current) cancelAnimationFrame(rafIdRef.current);

      const start = currentValRef.current;
      const target = newTarget;
      const duration = 400; // ms
      const startTime = performance.now();

      const step = (now) => {
        if (!isMountedRef.current) return;
        const progress = Math.min((now - startTime) / duration, 1);
        // Cubic ease out
        const eased = 1 - Math.pow(1 - progress, 3);
        const nextVal = Math.round(start + (target - start) * eased);
        currentValRef.current = nextVal;
        setDisplayCount(nextVal);

        if (progress < 1) {
          rafIdRef.current = requestAnimationFrame(step);
        } else {
          rafIdRef.current = null;
        }
      };

      rafIdRef.current = requestAnimationFrame(step);
    };

    // Clean subscription teardown
    const unsubscribe = subscribeToOnlineCount((count) => {
      animateCount(count);
    });

    return () => {
      isMountedRef.current = false;
      unsubscribe();
      if (rafIdRef.current) cancelAnimationFrame(rafIdRef.current);
    };
  }, []);

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
          minWidth: '1.5ch',
          willChange: 'transform, opacity',
          transform: 'translateZ(0)',
        }}
      >
        {displayCount > 0 ? displayCount.toLocaleString() : '—'}
      </span>
      <span
        className="live-label"
        style={{
          fontSize: '0.88rem',
          color: '#cbd5e1',
        }}
      >
        online now
      </span>
    </div>
  );
});

export default OnlineCounter;
