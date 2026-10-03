import React, { memo } from 'react';
import Home from './Home';

/**
 * Root App Component
 */
export const App = memo(function App() {
  const handleStartChat = () => {
    console.log('Starting chat...');
  };

  return (
    <main
      style={{
        width: '100%',
        minHeight: '100dvh',
        backgroundColor: '#05050e',
        willChange: 'transform, opacity',
        transform: 'translateZ(0)',
        backfaceVisibility: 'hidden',
        WebkitBackfaceVisibility: 'hidden',
      }}
    >
      <Home onStartChat={handleStartChat} />
    </main>
  );
});

export default App;
