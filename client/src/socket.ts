import { io, Socket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents } from '../../shared/types';

// Connect to the backend server running on port 3001
export const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io('http://localhost:3001');

// Debugging
socket.on('connect', () => {
  console.log('Connected to socket server:', socket.id);
});
