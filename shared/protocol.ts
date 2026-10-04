import type { CommandAck, CommandEnvelope, GameState } from './types';

/** Credentials are returned only to their owner; never put them in public state. */
export interface SessionCredentials {
  roomCode: string;
  playerId: string;
  resumeSecret: string;
}
export interface PlayerProfile { name: string; color: string }
export interface AdmissionProfile extends PlayerProfile { admissionSecret: string }
export interface JoinRoomRequest extends AdmissionProfile { roomCode: string }
export interface ProtocolError { code: string; message: string; retryable?: boolean }
export type SessionAck =
  | { ok: true; session: SessionCredentials; state: GameState; serverTime: number }
  | { ok: false; error: ProtocolError };
export interface ClientEvents {
  create_room: (profile: AdmissionProfile, ack: (result: SessionAck) => void) => void;
  join_room: (request: JoinRoomRequest, ack: (result: SessionAck) => void) => void;
  resume_session: (session: SessionCredentials, ack: (result: SessionAck) => void) => void;
  game_command: (command: CommandEnvelope, ack: (result: CommandAck) => void) => void;
}
export interface ServerEvents {
  game_state_update: (state: GameState) => void;
  session_replaced: (data: { message: string }) => void;
  protocol_error: (error: ProtocolError) => void;
  room_closed: (data: { roomCode: string; reason: string }) => void;
}
