import type { GamePhase } from '../../../shared/types';
export function phaseDescription(phase: GamePhase) {
  const titles: Record<GamePhase['kind'], string> = { lobby: 'Waiting for players', awaiting_roll: 'Ready to roll', rolling: 'Rolling the dice', moving: 'On the move', buy: phase.kind === 'buy' && phase.mode === 'upgrade' ? 'Room to grow' : 'An opportunity awaits', card: 'A twist in the game', risk_target: 'Choose your target', rent: 'Settling up', debt: 'Time to make a deal', flight: 'Ready for takeoff?', awaiting_end: 'Turn complete', ended: 'A game to remember' };
  return titles[phase.kind];
}
