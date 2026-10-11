import { PLAYER_COLORS } from '../../../shared/board';
import { TOKEN_SYMBOLS } from './geometry';
export function tokenSymbol(color: string) {
  const index = (PLAYER_COLORS as readonly string[]).indexOf(color.toLowerCase());
  return TOKEN_SYMBOLS[Math.max(0, index)];
}
