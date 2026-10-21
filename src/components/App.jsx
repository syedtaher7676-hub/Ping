import React, { useState, memo } from 'react';
import AppContainer from './AppContainer';
import Home from './Home';
import ChatMessages from './ChatMessages';
import IOSInstallBanner from './IOSInstallBanner';

/**
 * Root App Component
 * Wrapped in .app-container shell (width: 100%, max-width: 480px, margin: 0 auto)
 * Uses Dynamic Viewport Height (100dvh) for smooth cross-device scaling
 */
export const App = memo(function App() {
  const [currentView, setCurrentView] = useState('home'); // 'home' | 'chat'

  const handleStartChat = () => {
    setCurrentView('chat');
  };

  const handleLeaveChat = () => {
    setCurrentView('home');
  };

  return (
    <AppContainer>
      <main
        style={{
          width: '100%',
          minHeight: '100dvh',
          height: '100dvh',
          backgroundColor: '#05050e',
          willChange: 'transform, opacity',
          transform: 'translateZ(0)',
          backfaceVisibility: 'hidden',
          WebkitBackfaceVisibility: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        {currentView === 'home' ? (
          <Home onStartChat={handleStartChat} />
        ) : (
          <ChatMessages onLeaveChat={handleLeaveChat} />
        )}
        <IOSInstallBanner />
      </main>
    </AppContainer>
  );
});

export default App;
