import React, { memo } from 'react';

/**
 * AppContainer component
 * Enforces 100dvh height, overflow: hidden, and overscroll-behavior: none
 */
export const AppContainer = memo(function AppContainer({ children }) {
  return (
    <div
      className="app-container"
      style={{
        width: '100%',
        maxWidth: '480px',
        margin: '0 auto',
        height: '100dvh',
        minHeight: '100dvh',
        overflow: 'hidden',
        overscrollBehavior: 'none',
        display: 'flex',
        flexDirection: 'column',
        position: 'relative',
        backgroundColor: '#0b0713',
      }}
    >
      {children}
    </div>
  );
});

export default AppContainer;
