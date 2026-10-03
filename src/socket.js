/**
 * Ping WebSocket Client Singleton (Socket.io)
 * Enforces single connection lifecycle outside of the React component tree
 * Prevents reconnection thrashing and duplicate event listeners
 */
import { io } from 'socket.io-client';

const BACKEND_URL =
  process.env.REACT_APP_BACKEND_URL ||
  process.env.NEXT_PUBLIC_BACKEND_URL ||
  (typeof window !== 'undefined' && window.location.origin ? window.location.origin : 'http://localhost:3000');

// Persistent anonymous User ID
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
 * Singleton Socket Instance
 * transports: ['websocket'] explicitly avoids polling handshake fallback loops
 */
export const socket = io(BACKEND_URL, {
  transports: ['websocket'],
  autoConnect: true,
  reconnection: true,
  reconnectionAttempts: Infinity,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 5000,
  randomizationFactor: 0.2,
  timeout: 20000,
  auth: {
    userId: typeof window !== 'undefined' ? getPersistentUserId() : 'u_init'
  }
});

/**
 * Helper to subscribe to onlineCount with clean teardown
 */
export function subscribeToOnlineCount(callback) {
  if (!callback || typeof callback !== 'function') return () => {};

  const handler = (data) => {
    const count = typeof data === 'number' ? data : (data?.count ?? 0);
    callback(count);
  };

  const handleConnect = () => {
    socket.emit('get_online_count');
  };

  socket.on('onlineCount', handler);
  socket.on('count', handler);
  socket.on('connect', handleConnect);

  // Request initial count if connected
  if (socket.connected) {
    socket.emit('get_online_count');
  }

  // Teardown function for React useEffect cleanup
  return () => {
    socket.off('onlineCount', handler);
    socket.off('count', handler);
    socket.off('connect', handleConnect);
  };
}

export default socket;
