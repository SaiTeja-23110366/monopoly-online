import type { GameState } from '../../../shared/types';
import type { PresentationState } from './presentation';

/** Optional, synthesized tabletop cues. No autoplay, recordings, or network requests. */
export class SoundCues {
  private context: AudioContext | null = null;
  private enabled = false;
  private lastKey = '';
  setEnabled(enabled: boolean) {
    this.enabled = enabled;
    if (enabled) {
      try { this.context ??= new AudioContext(); void this.context.resume().catch(() => undefined); }
      catch { this.enabled = false; }
    }
    return this.enabled;
  }
  dispose() { void this.context?.close().catch(() => undefined); this.context = null; }
  observe(game: GameState | null, scene: PresentationState) {
    const key = `${game?.gameId}:${scene.sequence}:${scene.movingPlayer ? scene.positions[scene.movingPlayer] : ''}`;
    if (key === this.lastKey) return;
    this.lastKey = key;
    if (!this.enabled || !scene.busy || !game || !this.context || this.context.state !== 'running') return;
    const event = game.events.find(item => item.sequence === scene.sequence);
    const frequency = event?.type === 'payment' ? 420 : event?.type === 'dice' ? 210 : scene.movementKind === 'flight' ? 620 : 290;
    const duration = event?.type === 'payment' ? 0.17 : 0.055;
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(frequency, this.context.currentTime);
    oscillator.frequency.exponentialRampToValueAtTime(frequency * 0.6, this.context.currentTime + duration);
    gain.gain.setValueAtTime(0, this.context.currentTime);
    gain.gain.linearRampToValueAtTime(0.045, this.context.currentTime + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.001, this.context.currentTime + duration);
    oscillator.connect(gain); gain.connect(this.context.destination);
    oscillator.start(); oscillator.stop(this.context.currentTime + duration + 0.015);
    oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
  }
}
