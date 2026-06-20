import { io, Socket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents } from '../../shared/types';

// Connect to the backend server (automatically uses current host in production)
const URL = import.meta.env.PROD ? undefined : 'http://localhost:3001';
export const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io(URL as any);

// Debugging
socket.on('connect', () => {
  console.log('Connected to socket server:', socket.id);
});
