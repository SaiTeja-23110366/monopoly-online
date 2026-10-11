/** All board coordinates share the same 1.6 / 13 / 1.6 weighted grid. */
export const TRACKS = [1.6, ...Array<number>(13).fill(1), 1.6];
export const TRACK_TOTAL = 16.2;
export function gridCell(index: number): { column: number; row: number } {
  if (!Number.isInteger(index) || index < 0 || index > 55) throw new RangeError('Invalid board square');
  if (index <= 14) return { column: 14 - index, row: 14 };
  if (index <= 28) return { column: 0, row: 28 - index };
  if (index <= 42) return { column: index - 28, row: 0 };
  return { column: 14, row: index - 42 };
}
const midpoint = (track: number) => (TRACKS.slice(0, track).reduce((a, b) => a + b, 0) + TRACKS[track] / 2) / TRACK_TOTAL;
export function squareAnchor(index: number): { x: number; y: number } {
  const cell = gridCell(index);
  return { x: midpoint(cell.column), y: midpoint(cell.row) };
}
/** Slot is tied to the seat, never to which player renders first on a square. */
export function tokenOffset(seat: number): { x: number; y: number } {
  const offsets = [[-0.2, -0.2], [0.2, -0.2], [-0.2, 0.2], [0.2, 0.2], [0, 0], [0, -0.4], [0, 0.4], [0.4, 0]];
  const [x, y] = offsets[seat % offsets.length];
  return { x, y };
}
export function formatMoney(value: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value);
}
export const TOKEN_SYMBOLS = ['◆', '●', '▲', '■', '✦', '⬟', '♥', '✚'];
