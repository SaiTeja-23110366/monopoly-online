import { io, type Socket } from 'socket.io-client';
import type { ClientEvents, ServerEvents } from '../../shared/protocol';

// Vite proxies /socket.io in development, and production uses the same origin.
export const socket: Socket<ServerEvents, ClientEvents> = io(import.meta.env.VITE_SERVER_URL || undefined, {
  autoConnect: false,
  reconnection: true,
  reconnectionDelay: 700,
  reconnectionDelayMax: 5000,
});
