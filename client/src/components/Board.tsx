import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { TransformWrapper, TransformComponent, type ReactZoomPanPinchRef } from 'react-zoom-pan-pinch';
import { Focus, ArrowUpRight, Dices, Maximize, Minus, Plus, Plane, Pickaxe, Shield, LockKeyhole, Gift, Palmtree } from 'lucide-react';
import type { GameState } from '../../../shared/types';
import { SQUARES } from '../../../shared/board';
import { gridCell, squareAnchor, tokenOffset, formatMoney } from '../lib/geometry';
import { tokenSymbol } from '../lib/tokens';
import type { PresentationState } from '../lib/presentation';

const PIPS: Record<number, number[]> = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };
function Die({ value, rolling }: { value: number; rolling: boolean }) {
  return <div className={`die ${rolling ? 'die-rolling' : ''}`} aria-label={`Die: ${value}`}>
    {Array.from({ length: 9 }, (_, index) => <span key={index} className={PIPS[value || 1]?.includes(index) ? 'pip visible' : 'pip'} />)}
  </div>;
}
export function Dice({ values, rolling }: { values: [number, number]; rolling: boolean }) {
  return <div className="dice-tray" role="img" aria-label={rolling ? 'Dice rolling' : `Dice: ${values[0]} and ${values[1]}`}><Die value={values[0]} rolling={rolling} /><Die value={values[1]} rolling={rolling} /></div>;
}
function SquareIcon({ index }: { index: number }) {
  const square = SQUARES[index];
  if (square.type === 'railroad') return <Plane />;
  if (square.type === 'utility') return <Pickaxe />;
  if (square.type === 'chest') return <Gift />;
  if (square.name === 'Risk') return <span className="special-letter">!</span>;
  if (square.type === 'chance') return <span className="special-letter">?</span>;
  if (index === 0) return <ArrowUpRight />;
  if (index === 14 || index === 42) return <LockKeyhole />;
  if (index === 28) return <Palmtree />;
  return <span className="special-letter">$</span>;
}
export function Board({ game, presentation, selected, onSquare, onBrowse, reducedMotion, children }: {
  game: GameState; presentation: PresentationState; selected: number | null; onSquare: (index: number) => void;
  onBrowse: () => void; reducedMotion: boolean; children?: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const camera = useRef<ReactZoomPanPinchRef>(null);
  const [follow, setFollow] = useState(false);
  const [size, setSize] = useState(0);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setSize(entry.contentRect.width));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const turnPlayer = game.players[game.turnIndex];
  useEffect(() => {
    const controls = camera.current;
    if (!follow || reducedMotion || !controls || controls.state.scale <= 1.05 || !turnPlayer || !size) return;
    const anchor = squareAnchor(presentation.positions[turnPlayer.id] ?? turnPlayer.position);
    const scale = controls.state.scale;
    const clamp = (value: number) => Math.min(0, Math.max(size * (1 - scale), value));
    controls.setTransform(clamp(size / 2 - anchor.x * size * scale), clamp(size / 2 - anchor.y * size * scale), scale, Math.max(140, presentation.stepDuration));
  }, [follow, reducedMotion, turnPlayer, presentation.positions, presentation.stepDuration, size]);
  return <section className="board-section" aria-label="Game board">
    <TransformWrapper ref={camera} onPanningStart={() => setFollow(false)} onPinchStart={() => setFollow(false)} onWheelStart={() => setFollow(false)} initialScale={1} minScale={1} maxScale={3} centerOnInit wheel={{ step: 0.15 }} doubleClick={{ disabled: true }} panning={{ excluded: ['button'] }}>
      {({ zoomIn, zoomOut, resetTransform }) => <>
        <div className="board-toolbar"><span><span className="live-dot" /> WORLD EDITION · 56 SPACES</span><div className="zoom-controls"><button className="icon-button" onClick={() => setFollow(!follow)} disabled={reducedMotion} aria-pressed={follow && !reducedMotion} aria-label="Follow current token while zoomed" title="Follow the current token while zoomed; manual panning stops following"><Focus size={17} /></button>
          <button className="icon-button" onClick={() => { setFollow(false); zoomOut(); }} aria-label="Zoom out"><Minus size={17} /></button>
          <button className="icon-button" onClick={() => { setFollow(false); resetTransform(); }} aria-label="Fit entire board"><Maximize size={16} /></button>
          <button className="icon-button" onClick={() => { setFollow(false); zoomIn(); }} aria-label="Zoom in"><Plus size={17} /></button>
        </div></div>
        <div className="board-viewport">
          <TransformComponent wrapperClass="board-pan-wrapper" contentClass="board-pan-content">
            <div className="board" ref={ref} data-testid="board">
              {SQUARES.map(square => {
                const cell = gridCell(square.id);
                const property = game.properties[square.id];
                const owner = game.players.find(player => player.id === property?.ownerId);
                const isCorner = square.id % 14 === 0;
                const isTarget = game.phase.kind === 'risk_target' && game.phase.targets.includes(square.id);
                const style = { gridColumn: cell.column + 1, gridRow: cell.row + 1, '--square-color': square.color || '#b89b68', '--owner-color': owner?.color || 'transparent' } as CSSProperties;
                return <button key={square.id} data-square={square.id} type="button" style={style} onClick={() => onSquare(square.id)}
                  aria-label={`${square.fullName}${square.type === 'tax' ? square.name === 'Money Tax' ? ', tax: 10% of cash' : ', tax: 5% of property and building value' : square.price ? `, ${formatMoney(square.price)}` : ''}${owner ? `, owned by ${owner.name}` : ''}${property?.houses ? `, ${property.houses === 5 ? 'hotel' : `${property.houses} houses`}` : ''}`}
                  className={`square ${isCorner ? 'square-corner' : ''} ${square.type === 'property' ? 'square-city' : 'square-special'} ${selected === square.id ? 'square-selected' : ''} ${presentation.highlightedProperties.includes(square.id) ? 'square-changed' : ''} ${isTarget ? 'square-target' : ''}`}>
                  {square.type === 'property' ? <><span className="color-band" /><span className={`square-flag fi fi-${square.flagCode}`} aria-hidden="true" /><span className="square-name">{square.name}</span></> : <><SquareIcon index={square.id} /><span className="square-name">{square.name}</span></>}
                  {square.type === 'tax' ? <span className="square-price">{square.name === 'Money Tax' ? '10%' : '5%'}</span> : square.price && <span className="square-price">${square.price}</span>}
                  {property?.houses ? <span className="square-buildings" aria-hidden="true">{property.houses === 5 ? '▣' : '▰'.repeat(property.houses)}</span> : null}
                  {property?.protected && <Shield className="square-protected" aria-label="Protected" />}
                  {owner && <span className="ownership-strip" />}
                </button>;
              })}
              <div className="board-center">
                <div className="center-eyebrow">THE WORLD IS YOUR BOARD</div>
                <div className="monopoly-wordmark">MONOPOLY<span>ONLINE</span></div>
                <div className="center-rule" />
                <div className="turn-indicator"><span className="token-inline" style={{ color: turnPlayer?.color }}>{tokenSymbol(turnPlayer?.color || '')}</span><span>{turnPlayer?.name || 'Your table'}<small>{game.state === 'ended' ? 'Game finished' : 'At the table'}</small></span></div>
                <Dice values={presentation.dice} rolling={presentation.rolling} />
                {children}
                <p className="board-announcement" aria-live="polite">{presentation.announcement || 'A little strategy. A little luck.'}</p>
                <div className="jackpot"><Palmtree size={14} /><span>VACATION POT</span><strong>{formatMoney(game.vacationJackpot)}</strong></div>
              </div>
              <div className="token-layer" aria-hidden="true">
                {game.players.filter(player => player.status === 'active').map(player => {
                  const seat = game.players.findIndex(item => item.id === player.id);
                  const anchor = squareAnchor(presentation.positions[player.id] ?? player.position);
                  const offset = tokenOffset(seat);
                  const jailZone = (presentation.positions[player.id] ?? player.position) === 14 ? (player.inJail ? -0.018 : 0.018) * size : 0;
                  const moving = presentation.movingPlayer === player.id;
                  const style = { '--token-color': player.color, transform: `translate(${anchor.x * size + offset.x * size / 20 + jailZone}px, ${anchor.y * size + offset.y * size / 20 + jailZone}px) translate(-50%, -50%)`, transitionDuration: `${moving ? presentation.stepDuration : 0}ms` } as CSSProperties;
                  return <span key={player.id} data-player-token={player.id} data-position={presentation.positions[player.id] ?? player.position} className={`board-token ${(presentation.positions[player.id] ?? player.position) === 14 ? player.inJail ? 'token-jail-cell token-incarcerated' : 'token-jail-cell token-visiting' : ''} ${turnPlayer?.id === player.id ? 'token-current' : ''} ${moving ? `token-moving token-${presentation.movementKind}` : ''}`} style={style}><span>{tokenSymbol(player.color)}</span></span>;
                })}
              </div>
            </div>
          </TransformComponent>
        </div>
      </>}
    </TransformWrapper>
    <div className="board-footer"><span>Pinch or use + to explore · Tap a space for its deed</span><button className="text-button" onClick={onBrowse}><Dices size={15} /> Browse spaces</button></div>
  </section>;
}
