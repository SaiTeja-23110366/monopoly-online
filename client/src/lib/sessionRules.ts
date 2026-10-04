export const terminalResumeError = (code: string) => ['SESSION_INVALID', 'INVALID_SESSION', 'ROOM_NOT_FOUND', 'GAME_NOT_FOUND', 'PLAYER_NOT_FOUND', 'ROOM_EXPIRED', 'INVALID_SNAPSHOT', 'INVALID_ROOM'].includes(code);
export function retryStrategy(connection: string, connected: boolean, hasPending: boolean, hasCredentials: boolean): 'none' | 'connect' | 'command' | 'resume' | 'clear' {
  if (connection === 'replaced') return 'none';
  if (!connected) return 'connect';
  if (connection === 'ready' && hasPending) return 'command';
  if (connection !== 'ready' && hasCredentials) return 'resume';
  return 'clear';
}
export function validSnapshot(current: {gameId:string;version:number}|null, incoming:{gameId:string;version:number}, reset=false) {
  return reset || !current || (current.gameId===incoming.gameId && incoming.version>=current.version);
}
export function afterDisconnect(connection: string): 'replaced' | 'reconnecting' {
  return connection === 'replaced' ? 'replaced' : 'reconnecting';
}
