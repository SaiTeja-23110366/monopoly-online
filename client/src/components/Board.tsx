import React, { useState, useEffect } from 'react';
import { Square } from './Square';
import { TransformWrapper, TransformComponent } from 'react-zoom-pan-pinch';
import { Dices, Clock } from 'lucide-react';

const DiceContainer = ({ diceValues, isRolling }: { diceValues: [number, number], isRolling: boolean }) => {
  const [displayValues, setDisplayValues] = useState<[number, number]>(diceValues);

  useEffect(() => {
    let interval: any;
    if (isRolling) {
      interval = setInterval(() => {
        setDisplayValues([
          Math.floor(Math.random() * 6) + 1,
          Math.floor(Math.random() * 6) + 1,
        ]);
      }, 100);
    } else {
      setDisplayValues(diceValues);
    }
    return () => clearInterval(interval);
  }, [isRolling, diceValues]);

  // If dice are 0,0 (start of game), maybe show 1,1
  const d1 = displayValues[0] || 1;
  const d2 = displayValues[1] || 1;

  return (
    <div className="flex gap-6 mb-8 mt-[-40px]">
      <div className={`w-24 h-24 sm:w-32 sm:h-32 bg-gradient-to-br from-white to-gray-300 rounded-3xl shadow-[0_20px_50px_rgba(0,0,0,0.8),inset_0_-10px_0_rgba(180,180,180,0.5),inset_0_10px_10px_rgba(255,255,255,1)] flex items-center justify-center text-5xl sm:text-7xl font-black text-black transition-all duration-100 ${isRolling ? 'animate-bounce -rotate-12 scale-110' : 'rotate-6 scale-100'}`}>
        {d1}
      </div>
      <div className={`w-24 h-24 sm:w-32 sm:h-32 bg-gradient-to-br from-white to-gray-300 rounded-3xl shadow-[0_20px_50px_rgba(0,0,0,0.8),inset_0_-10px_0_rgba(180,180,180,0.5),inset_0_10px_10px_rgba(255,255,255,1)] flex items-center justify-center text-5xl sm:text-7xl font-black text-black transition-all duration-100 ${isRolling ? 'animate-bounce rotate-12 scale-110 delay-75' : '-rotate-6 scale-100'}`}>
        {d2}
      </div>
    </div>
  );
};

// Helper to determine the grid position of a square in a 15x15 grid
// Clockwise Layout: Start is Bottom-Right (col 15, row 15)
function getGridPosition(index: number) {
  if (index >= 0 && index <= 14) {
    // Bottom row (Right to Left)
    return { gridColumn: 15 - index, gridRow: 15 };
  } else if (index >= 15 && index <= 28) {
    // Left column (Bottom to Top)
    return { gridColumn: 1, gridRow: 15 - (index - 14) };
  } else if (index >= 29 && index <= 42) {
    // Top row (Left to Right)
    return { gridColumn: 1 + (index - 28), gridRow: 1 };
  } else if (index >= 43 && index <= 55) {
    // Right column (Top to Bottom)
    return { gridColumn: 15, gridRow: 1 + (index - 42) };
  }
  return { gridColumn: 1, gridRow: 1 };
}

import { SQUARES } from '../constants/boardData';

import type { GameState } from '../../../shared/types';

interface BoardProps {
  gameState?: GameState | null;
  onSquareClick?: (index: number) => void;
  onRollDice?: () => void;
  timeLeft?: number | null;
}

export const Board: React.FC<BoardProps> = ({ gameState, onSquareClick, onRollDice, timeLeft }) => {
  return (
    <div className="flex flex-col items-center justify-center w-full h-full bg-[#0a0a0f] overflow-hidden">
      <TransformWrapper
        initialScale={1}
        minScale={0.5}
        maxScale={4}
        centerOnInit={true}
        wheel={{ step: 0.1 }}
        doubleClick={{ step: 0.5 }}
      >
        <TransformComponent wrapperClass="!w-full !h-full" contentClass="w-[1000px] h-[1000px] md:w-full md:max-w-[800px] md:max-h-[800px] aspect-square flex items-center justify-center relative">
          
          {/* The Grid Container: 15 columns, 15 rows (corners are 1.6x larger to make edge blocks long rectangles) */}
          <div 
            className="w-full h-full grid gap-1 sm:gap-1.5 p-4"
            style={{ 
              gridTemplateColumns: '1.6fr repeat(13, minmax(0, 1fr)) 1.6fr', 
              gridTemplateRows: '1.6fr repeat(13, minmax(0, 1fr)) 1.6fr' 
            }}
          >
            
            {/* Render 56 Squares */}
            {SQUARES.map((sq, i) => {
              const style = getGridPosition(i);
              const playersOnSquare = gameState?.players.filter(p => p.position === i && p.status !== 'bankrupt') || [];
              const propState = gameState?.properties?.[i];
              const ownerId = propState?.ownerId;
              const ownerColor = ownerId ? gameState?.players.find(p => p.id === ownerId)?.color : undefined;
              
              let houses = propState?.houses || 0;
              if (ownerId && (sq.type === 'railroad' || sq.type === 'utility')) {
                 const ownedCount = Object.values(gameState!.properties).filter(
                    p => p.ownerId === ownerId && SQUARES[p.id].type === sq.type
                 ).length;
                 houses = Math.max(0, ownedCount - 1);
              }
              return (
                <div 
                  key={sq.id} 
                  style={style}
                  onClick={() => onSquareClick && onSquareClick(i)}
                  className={onSquareClick ? 'cursor-pointer hover:ring-2 hover:ring-cyan-500 rounded-lg z-50 transition-all' : ''}
                >
                  <Square 
                    {...sq} 
                    index={i} 
                    players={playersOnSquare}
                    turnIndex={gameState?.turnIndex}
                    allPlayers={gameState?.players}
                    ownerColor={ownerColor}
                    houses={houses}
                    vacationJackpot={gameState?.vacationJackpot || 0}
                    protected={propState?.protected}
                  />
                </div>
              );
            })}

            {/* Center Logo Area / Animation Area */}
            <div 
              className="flex flex-col justify-center items-center pointer-events-none relative"
              style={{ gridColumn: '3 / span 11', gridRow: '3 / span 11' }}
            >
              {/* Rent Payment Animation */}
              {gameState?.activeAnimation && gameState.activeAnimation.type === 'rent' && (
                <div className="absolute inset-0 flex flex-col items-center justify-center animate-in zoom-in fade-in duration-500 z-[100]">
                  <div className="bg-black/60 backdrop-blur-md border border-white/10 p-8 rounded-3xl shadow-[0_0_100px_rgba(239,68,68,0.4)] flex flex-col items-center">
                    <span className="text-6xl font-black text-red-500 drop-shadow-[0_0_20px_rgba(239,68,68,0.8)] mb-4">
                      -${gameState.activeAnimation.amount}
                    </span>
                    <span className="text-2xl font-bold text-gray-200 tracking-widest uppercase">
                      {gameState.activeAnimation.message}
                    </span>
                  </div>
                </div>
              )}
              
              {/* Card Animation */}
              {gameState?.activeCard && (
                <div className="absolute inset-0 flex flex-col items-center justify-center animate-in zoom-in fade-in duration-500 z-[100]">
                  <div className={`w-72 sm:w-80 h-96 p-6 rounded-2xl flex flex-col items-center justify-center shadow-[0_20px_50px_rgba(0,0,0,0.8)] border-[3px] text-center
                    ${gameState.activeCard.deck === 'chest' ? 'bg-gradient-to-br from-amber-200 to-yellow-600 border-yellow-300' : ''}
                    ${gameState.activeCard.deck === 'chance' ? 'bg-gradient-to-br from-orange-300 to-red-500 border-orange-200' : ''}
                    ${gameState.activeCard.deck === 'risk' ? 'bg-gradient-to-br from-purple-600 to-gray-900 border-purple-400' : ''}
                  `}>
                    <h2 className="text-3xl font-black text-white drop-shadow-md mb-6 uppercase tracking-widest">
                      {gameState.activeCard.deck}
                    </h2>
                    <p className="text-xl sm:text-2xl font-bold text-white drop-shadow-sm leading-snug">
                      {gameState.activeCard.text}
                    </p>
                  </div>
                </div>
              )}
              
              {/* Dice & Controls - Hidden during Rent & Card Animations */}
              {(!gameState?.activeAnimation || gameState.activeAnimation.type !== 'rent') && !gameState?.activeCard && gameState?.state === 'playing' && (
                <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-auto">
                  <DiceContainer 
                    diceValues={gameState.diceValues} 
                    isRolling={!!gameState.isRollingDice} 
                  />
                  
                  {onRollDice && (
                    <div className="flex flex-col items-center animate-in slide-in-from-bottom-4 fade-in duration-300">
                      <button 
                        onClick={onRollDice} 
                        className="bg-[#6366f1] hover:bg-[#4f46e5] text-white px-10 py-4 rounded-xl font-bold text-xl transition-all hover:scale-105 active:scale-95 shadow-[0_10px_30px_rgba(99,102,241,0.5)] flex items-center gap-3 border border-white/10"
                      >
                        <Dices size={28} />
                        Roll the dice
                      </button>
                      
                      {timeLeft !== null && timeLeft !== undefined && (
                        <div className="mt-6 flex items-center gap-2 bg-black/50 backdrop-blur-sm px-4 py-2 rounded-full border border-white/10">
                          <Clock size={16} className={timeLeft <= 5 ? 'text-red-500' : 'text-gray-400'} />
                          <span className={`font-mono font-black text-lg ${timeLeft <= 5 ? 'text-red-500 animate-pulse' : 'text-green-400'}`}>
                            {Math.floor(timeLeft / 60)}:{(timeLeft % 60).toString().padStart(2, '0')}
                          </span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>

          </div>
        </TransformComponent>
      </TransformWrapper>
    </div>
  );
};
