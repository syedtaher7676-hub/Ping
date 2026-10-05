/**
 * Ping Production-Ready WebSocket Client Singleton
 * Enforces a single WebSocket connection across both global window and React component tree.
 * Prevents multiple concurrent connections, listener stacking, and reconnect loops.
 */
import { io } from 'socket.io-client';

const BACKEND_URL =
  process.env.REACT_APP_BACKEND_URL ||
  process.env.NEXT_PUBLIC_BACKEND_URL ||
  (typeof window !== 'undefined' && window.location.origin ? window.location.origin : 'http://localhost:3000');

// Persistent Anonymous User ID
const getPersistentUserId = () => {
  if (typeof window === 'undefined') return 'u_ssr';
  let uid = localStorage.getItem('ping_user_id');
  if (!uid) {
    uid = 'u_' + Math.random().toString(36).slice(2, 9) + Date.now().toString(36);
    localStorage.setItem('ping_user_id', uid);
  }
  return uid;
};

/**
 * Step 1 & 2: Global Singleton Socket Factory
 * Ensures exactly ONE persistent WebSocket connection per browser context.
 */
export const getSocket = () => {
  if (typeof window === 'undefined') return null;

  // 1. Check for existing global socket instance (prevents multiple concurrent connections)
  if (window.__PING_SOCKET__) {
    return window.__PING_SOCKET__;
  }

  if (window.socket && typeof window.socket.on === 'function') {
    window.__PING_SOCKET__ = window.socket;
    return window.__PING_SOCKET__;
  }

  const userId = getPersistentUserId();

  // 2. Instantiate singleton strictly outside component scope
  const socketInstance = io(BACKEND_URL, {
    transports: ['websocket'], // Explicitly enforce WebSocket transport to prevent polling fallback loops
    upgrade: false,
    autoConnect: true,
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    randomizationFactor: 0.2,
    timeout: 20000,
    auth: { userId }
  });

  // Step 3: Container-side graceful disconnect handling
  socketInstance.on('disconnect', (reason) => {
    console.warn('[WebSocket Singleton] Disconnected from container backend:', reason);
    // Maintain DOM state without unmounting/remounting; auto-reconnect will resume session seamlessly
  });

  socketInstance.on('connect_error', (error) => {
    console.error('[WebSocket Singleton] Connection error:', error.message);
  });

  socketInstance.on('connect', () => {
    console.log('[WebSocket Singleton] Connected to backend. ID:', socketInstance.id);
  });

  // Attach background reconnection & visibilitychange listener (iOS fix)
  if (typeof document !== 'undefined' && !window.__PING_VISIBILITY_ATTACHED__) {
    window.__PING_VISIBILITY_ATTACHED__ = true;
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        if (!socketInstance.connected) {
          console.log('[WebSocket Singleton] App resumed to visible foreground. Reconnecting immediately...');
          socketInstance.connect();
        }
      }
    });

    window.addEventListener('online', () => {
      if (!socketInstance.connected) {
        console.log('[WebSocket Singleton] Device back online. Reconnecting immediately...');
        socketInstance.connect();
      }
    });
  }

  // 15-second heartbeat ping mechanism to prevent mobile socket sleep
  if (!window.__PING_HEARTBEAT_ACTIVE__) {
    window.__PING_HEARTBEAT_ACTIVE__ = true;
    setInterval(() => {
      if (socketInstance && socketInstance.connected) {
        socketInstance.emit('heartbeat');
      }
    }, 15000);
  }

  window.__PING_SOCKET__ = socketInstance;
  window.socket = socketInstance;

  return socketInstance;
};

// Export singleton instance initialized once globally outside React lifecycle
export const socket = typeof window !== 'undefined' ? getSocket() : null;

/**
 * Step 3: Robust Event Subscription Helper with Clean Teardown
 * Guarantees event listeners are attached once and cleanly removed in useEffect returns.
 */
export function subscribeToOnlineCount(callback) {
  if (!callback || typeof callback !== 'function') return () => {};

  const activeSocket = getSocket();
  if (!activeSocket) return () => {};

  let lastCount = null;

  const handler = (data) => {
    const count = typeof data === 'number' ? data : (data?.count ?? 0);
    if (count !== lastCount) {
      lastCount = count;
      callback(count);
    }
  };

  const handleConnect = () => {
    if (activeSocket.connected) {
      activeSocket.emit('get_online_count');
    }
  };

  // Attach listeners
  activeSocket.on('onlineCount', handler);
  activeSocket.on('count', handler);
  activeSocket.on('connect', handleConnect);

  // Fetch initial count if connected
  if (activeSocket.connected) {
    activeSocket.emit('get_online_count');
  }

  // Teardown function for useEffect cleanup
  return () => {
    activeSocket.off('onlineCount', handler);
    activeSocket.off('count', handler);
    activeSocket.off('connect', handleConnect);
  };
}

export default socket;
