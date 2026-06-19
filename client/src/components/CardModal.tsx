import React from 'react';
import type { GameState } from '../../../shared/types';
import { socket } from '../socket';

interface CardModalProps {
  gameState: GameState;
  onClose?: () => void; // Optional, usually closed by backend update
}

export const CardModal: React.FC<CardModalProps> = ({ gameState }) => {
  const card = gameState.activeCard;
  if (!card) return null;

  const isMyTurn = gameState.players[gameState.turnIndex]?.id === socket.id;

  const handleAcknowledge = () => {
    if (isMyTurn) {
      socket.emit('acknowledge_card', gameState.roomCode);
    }
  };

  const getDeckColor = () => {
    if (card.deck === 'chest') return 'border-yellow-500 shadow-[0_0_40px_rgba(234,179,8,0.3)]';
    if (card.deck === 'chance') return 'border-blue-500 shadow-[0_0_40px_rgba(59,130,246,0.3)]';
    if (card.deck === 'risk') return 'border-red-600 shadow-[0_0_50px_rgba(220,38,38,0.4)]';
    return 'border-white';
  };

  const getDeckTitle = () => {
    if (card.deck === 'chest') return 'Community Chest';
    if (card.deck === 'chance') return 'Chance';
    if (card.deck === 'risk') return 'RISK!';
    return 'Card Drawn';
  };

  const getDeckBg = () => {
     if (card.deck === 'chest') return 'from-[#2a2010] to-[#161622]';
     if (card.deck === 'chance') return 'from-[#101a2a] to-[#161622]';
     if (card.deck === 'risk') return 'from-[#2a1010] to-[#161622]';
     return 'from-[#161622] to-[#111118]';
  };

  return (
    <div className="fixed inset-0 z-[70] bg-black/80 flex items-center justify-center p-4 backdrop-blur-sm">
      {/* Cool flip animation container */}
      <div 
        className={`bg-gradient-to-br ${getDeckBg()} border-4 ${getDeckColor()} p-10 rounded-2xl w-full max-w-lg animate-in zoom-in spin-in-12 duration-500`}
        style={{ perspective: '1000px' }}
      >
        <div className="flex flex-col items-center justify-center text-center">
          <h2 className="text-4xl font-black mb-8 text-white uppercase tracking-widest drop-shadow-md">
            {getDeckTitle()}
          </h2>
          
          <div className="bg-black/40 border border-white/10 p-6 rounded-xl mb-8 w-full">
            <p className="text-2xl md:text-3xl font-bold text-gray-200 leading-relaxed">
              "{card.text}"
            </p>
          </div>
          
          {isMyTurn ? (
            <button 
              onClick={handleAcknowledge}
              className="bg-white hover:bg-gray-200 text-black px-10 py-4 rounded-xl font-black text-xl transition-transform hover:scale-105 active:scale-95"
            >
              Continue
            </button>
          ) : (
            <p className="text-gray-400 italic mt-4 animate-pulse">Waiting for {gameState.players[gameState.turnIndex]?.name} to acknowledge...</p>
          )}
        </div>
      </div>
    </div>
  );
};
