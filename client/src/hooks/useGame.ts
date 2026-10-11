import { useEffect, useState, useSyncExternalStore } from 'react';
import { GameSession } from '../lib/session';
import { socket } from '../socket';
export function useGame() {
  const [session] = useState(() => new GameSession(socket));
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const presentation = useSyncExternalStore(session.presentation.subscribe, session.presentation.getSnapshot);
  useEffect(() => session.mount(), [session]);
  return { session, ...state, presentation };
}
