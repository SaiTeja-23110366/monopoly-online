import React from 'react';
import { Square } from './Square';

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
    <div className="flex flex-col items-center justify-center p-4 min-h-screen bg-[#0a0a0f]">
      <div className="w-full max-w-[800px] max-h-[800px] aspect-square relative box-border flex items-center justify-center">
        
        {/* The Grid Container: 15 columns, 15 rows (corners are 1.6x larger to make edge blocks long rectangles) */}
        <div 
          className="w-full h-full grid gap-1 sm:gap-1.5"
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

          {/* Center Logo Area */}
          <div 
            className="flex flex-col justify-center items-center pointer-events-none"
            style={{ gridColumn: '3 / span 11', gridRow: '3 / span 11' }}
          >
            {/* Blank center per user request */}
          </div>

        </div>
      </div>
    </div>
  );
};
