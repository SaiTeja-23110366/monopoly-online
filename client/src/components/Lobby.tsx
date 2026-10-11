import { useState, type FormEvent } from 'react';
import { ArrowRight, Globe2, Copy, Check, Users, Wifi, ArrowUpRight } from 'lucide-react';
import type { GameCommand, GameState } from '../../../shared/types';
import type { PlayerProfile } from '../../../shared/protocol';
import { rulesForGame, PLAYER_COLORS } from '../../../shared/board';
import { TOKEN_SYMBOLS, formatMoney } from '../lib/geometry';
import { tokenSymbol } from '../lib/tokens';

export function ColorPicker({ color, onChange, used = [] }: { color: string; onChange: (color: string) => void; used?: string[] }) {
  return <div className="color-picker" role="group" aria-label="Token color">{PLAYER_COLORS.map((choice, index) => <button key={choice} type="button" disabled={used.includes(choice)} title={used.includes(choice) ? 'Already chosen' : `Token ${index + 1}`} className={color === choice ? 'color-choice selected' : 'color-choice'} style={{ color: choice }} aria-label={`Choose ${['red','blue','green','amber','purple','pink','cyan','orange'][index]} token`} aria-pressed={color === choice} onClick={() => onChange(choice)}>{TOKEN_SYMBOLS[index]}</button>)}</div>;
}
export function Lobby({ game, playerId, ready, pending, enter, command }: {
  game: GameState | null; playerId?: string; ready: boolean; pending: string | null;
  enter: (profile: PlayerProfile, roomCode?: string) => void; command: (command: GameCommand) => void;
}) {
  const rules = rulesForGame(game ?? { rulesVersion: 3 });
  const [mode, setMode] = useState<'create' | 'join'>(() => new URLSearchParams(location.search).has('room') ? 'join' : 'create');
  const [name, setName] = useState(() => { try { return localStorage.getItem('monopoly_name') || ''; } catch { return ''; } });
  const [code, setCode] = useState(() => new URLSearchParams(location.search).get('room')?.toUpperCase() || '');
  const [color, setColor] = useState<string>(PLAYER_COLORS[0]);
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const [cash, setCash] = useState(game?.startingCash || 2500);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    try { localStorage.setItem('monopoly_name', name.trim()); } catch { /* A seat still works without storage. */ }
    enter({ name: name.trim(), color }, mode === 'join' ? code.trim().toUpperCase() : undefined);
  };
  const copyInvite = async () => {
    if (!game) return;
    const url = new URL(location.href); url.searchParams.set('room', game.roomCode);
    try { await navigator.clipboard.writeText(url.toString()); setCopied(true); setCopyFailed(false); }
    catch { setCopyFailed(true); }
  };
  const me = game?.players.find(player => player.id === playerId);
  const isHost = game?.hostId === playerId;
  return <main className="lobby-layout">
    <section className="lobby-story">
      <div className="edition-pill"><Globe2 size={16} /> THE 56-SPACE WORLD EDITION</div>
      <h1>Big cities.<br />Bigger ambitions.</h1>
      <p>Build an empire with your favorite people. Buy cities, catch a flight, take a risk. The next great deal is yours.</p>
      <div className="lobby-art" aria-hidden="true"><div className="art-orbit orbit-one" /><div className="art-orbit orbit-two" /><div className="art-deed"><span className="art-deed-band" /><span>NEW YORK</span><Globe2 size={52} /><strong>$600</strong><small>TITLE DEED</small></div><div className="art-die">✦</div><div className="art-label"><ArrowUpRight size={16} /> EVERY TURN, A NEW POSSIBILITY</div></div>
      <div className="lobby-features"><span><Users size={18} /> 2–8 players</span><span><Wifi size={18} /> Play together, anywhere</span></div>
    </section>
    <section className="lobby-card">
      {!game ? <>
        <span className="eyebrow">YOUR NEXT GAME NIGHT</span><h2>Take a seat</h2><p className="muted">A table, a token, and a little friendly rivalry.</p>
        <div className="segmented"><button className={mode === 'create' ? 'active' : ''} onClick={() => setMode('create')}>Create a table</button><button className={mode === 'join' ? 'active' : ''} onClick={() => setMode('join')}>Join friends</button></div>
        <form onSubmit={submit}>
          <label htmlFor="player-name">Your name</label><input id="player-name" autoComplete="nickname" maxLength={24} minLength={1} required placeholder="What should we call you?" value={name} onChange={event => setName(event.target.value)} />
          {mode === 'join' && <><label htmlFor="room-code">Room code</label><input id="room-code" className="code-input" autoComplete="off" maxLength={8} minLength={6} required placeholder="ABC123" value={code} onChange={event => setCode(event.target.value.replace(/[^a-z0-9]/gi, '').toUpperCase())} /></>}
          <label>Choose your token</label><ColorPicker color={color} onChange={setColor} />
          <button className="button primary full" type="submit" disabled={!ready || !!pending || !name.trim() || (mode === 'join' && code.length < 6)}>{pending ? 'Setting your table…' : mode === 'create' ? 'Create table' : 'Join table'}<ArrowRight size={18} /></button>
        </form>
        <p className="footnote">New tables use the balanced economy: {formatMoney(rules.passingStart)} passing Start, {formatMoney(rules.landingStart)} landing exactly. Mine bonuses: {rules.mineBonuses.slice(1).map(formatMoney).join(' / ')} total for 1–4 mines. Joining friends keeps that table’s rules.</p>
        <p className="footnote">No account needed. Your seat is saved on this browser.</p>
      </> : <>
        <span className="eyebrow">THE TABLE IS OPEN</span><h2>{isHost ? 'Make yourself at home' : 'You’re in good company'}</h2>
        <p className="form-note">{rules.version === 3 ? 'Balanced economy' : 'Legacy economy · This saved table keeps its original rules. New tables use the balanced economy.'} · Start: {formatMoney(rules.passingStart)} passing / {formatMoney(rules.landingStart)} landing. Mine bonuses: {rules.mineBonuses.slice(1).map(formatMoney).join(' / ')} total for 1–4 mines.</p>
        <div className="invite-card"><div><span>ROOM CODE</span><strong>{game.roomCode}</strong></div><button className="button secondary" onClick={copyInvite}>{copied ? <Check size={17} /> : <Copy size={17} />}{copied ? 'Copied' : 'Invite'}</button></div>
        {copyFailed && <p className="form-note">Share this room code with your friends: {game.roomCode}</p>}
        <div className="lobby-players">{game.players.map((player) => <div className="lobby-player" key={player.id}><span className="player-token" style={{ color: player.color }}>{tokenSymbol(player.color)}</span><strong>{player.name}{player.id === playerId ? ' (you)' : ''}</strong><span className="badge">{player.id === game.hostId ? 'HOST' : player.connected === false ? 'AWAY' : 'READY'}</span></div>)}</div>
        <label>Your token</label><ColorPicker color={me?.color || color} used={game.players.filter(player => player.id !== playerId).map(player => player.color)} onChange={choice => command({ type: 'change_color', color: choice })} />
        {isHost ? <div className="cash-setting"><label htmlFor="starting-cash">Starting cash per player</label><div className="input-action"><input id="starting-cash" type="number" step="100" min={rules.minStartingCash} max={rules.maxStartingCash} value={cash} onChange={event => setCash(Number(event.target.value))} /><button className="button secondary" disabled={!!pending || !Number.isInteger(cash) || cash < rules.minStartingCash || cash > rules.maxStartingCash || cash === game.startingCash} onClick={() => command({ type: 'update_starting_cash', cash })}>Apply</button></div><small>At this table: {formatMoney(game.startingCash)} each</small></div> : <p className="form-note">Starting cash: <strong>{formatMoney(game.startingCash)}</strong> each</p>}
        <button className="button primary full" disabled={!ready || !!pending || !isHost || game.players.length < rules.minPlayers} onClick={() => command({ type: 'start_game' })}>{isHost ? game.players.length < rules.minPlayers ? 'Invite at least one friend' : 'Let’s play' : 'Waiting for the host to start'}<ArrowRight size={18} /></button>
        <p className="footnote">{game.players.length} of {rules.maxPlayers} seats filled · Host sets the starting cash</p>
      </>}
    </section>
  </main>;
}
