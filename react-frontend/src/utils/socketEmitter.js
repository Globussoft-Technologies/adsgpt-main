import { getSocket } from '@/store/reducers/socket/socketSlice';

const eventQueue = [];
let isListenerAttached = false;
const MAX_QUEUE_SIZE = 100;

const flushQueue = (socket) => {
  while (eventQueue.length && socket.connected) {
    const queued = eventQueue.shift();
    const { event, payload, resolve, reject } = queued;
    try {
      socket.emit(event, payload);
      resolve();
    } catch (err) {
      console.error('Socket emit failed for event:', event, err);
      reject(err);
    }
  }
};

export const emitWhenConnected = (event, payload) => {
  return new Promise((resolve, reject) => {
    const socket = getSocket();
    if (!socket) return reject(new Error('Socket not initialized'));

    if (eventQueue.length >= MAX_QUEUE_SIZE) {
      eventQueue.shift();
      console.warn('Event queue full, dropping oldest event');
    }

    if (socket.connected) {
      try {
        socket.emit(event, payload);
        resolve();
      } catch (err) {
        console.error('Socket emit failed:', err);
        reject(err);
      }
      return;
    }

    eventQueue.push({ event, payload, resolve, reject });

    if (!isListenerAttached) {
      const handleConnect = () => {
        flushQueue(socket);
        isListenerAttached = false;
      };

      const handleReconnect = () => {
        flushQueue(socket);
      };

      const handleError = (err) => {
        console.error('Socket connection error:', err);
        while (eventQueue.length) {
          const queued = eventQueue.shift();
          queued.reject(err);
        }
      };

      socket.once('connect', handleConnect);
      socket.on('reconnect', handleReconnect);
      socket.on('connect_error', handleError);
      socket.on('reconnect_error', handleError);

      isListenerAttached = true;
    }
  });
};
