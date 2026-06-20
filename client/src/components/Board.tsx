import React from 'react';
import { Square } from './Square';
import { TransformWrapper, TransformComponent } from 'react-zoom-pan-pinch';

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
}

export const Board: React.FC<BoardProps> = ({ gameState, onSquareClick }) => {
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
              {gameState?.activeAnimation && gameState.activeAnimation.type === 'rent' && (
                <div className="absolute inset-0 flex flex-col items-center justify-center animate-in zoom-in fade-in duration-500">
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
            </div>

          </div>
        </TransformComponent>
      </TransformWrapper>
    </div>
  );
};
