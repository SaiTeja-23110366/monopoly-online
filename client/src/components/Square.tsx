import React from 'react';
import { Plane, HelpCircle, Package, Zap, ArrowLeft, Skull, MapPin, Shield } from 'lucide-react';

import type { Player } from '../../../shared/types';

interface SquareProps {
  index: number;
  name: string;
  type: string;
  color?: string;
  price?: number;
  players?: Player[];
  turnIndex?: number;
  allPlayers?: Player[];
  ownerColor?: string;
  houses?: number;
  rent?: number[];
  vacationJackpot?: number;
  protected?: boolean;
  flagCode?: string;
}

export const Square: React.FC<SquareProps> = ({ index, name, type, color, price, players = [], turnIndex, allPlayers = [], ownerColor, houses = 0, vacationJackpot = 0, protected: isProtected, flagCode }) => {
  // Determine layout based on side of the board for upright text
  let layoutClass = 'flex-col';
  let colorBarClass = 'w-full h-4 mb-1';
  let priceContainerClass = 'w-full flex justify-center pb-1';

  if (index >= 0 && index <= 14) {
    // Bottom (color top, price bottom)
    layoutClass = 'flex-col';
    colorBarClass = 'w-full h-4 mb-1 border-b border-black/20 flex flex-row items-center justify-center gap-[2px]';
    priceContainerClass = 'w-full flex justify-center pb-1';
  } else if (index >= 15 && index <= 28) {
    // Left (color right, price left)
    layoutClass = 'flex-row-reverse';
    colorBarClass = 'w-4 h-full ml-1 border-l border-black/20 flex flex-col items-center justify-center gap-[2px]';
    priceContainerClass = 'h-full flex flex-col justify-center pl-1';
  } else if (index >= 29 && index <= 42) {
    // Top (color bottom, price top)
    layoutClass = 'flex-col-reverse';
    colorBarClass = 'w-full h-4 mt-1 border-t border-black/20 flex flex-row items-center justify-center gap-[2px]';
    priceContainerClass = 'w-full flex justify-center pt-1';
  } else if (index >= 43 && index <= 55) {
    // Right (color left, price right)
    layoutClass = 'flex-row';
    colorBarClass = 'w-4 h-full mr-1 border-r border-black/20 flex flex-col items-center justify-center gap-[2px]';
    priceContainerClass = 'h-full flex flex-col justify-center pr-1';
  }

  const isCorner = type === 'corner';

  // Rendering icons based on type
  const renderIcon = () => {
    if (type === 'railroad') return <Plane size={16} className="text-[#a1a1aa]" />;
    if (type === 'utility') return <Zap size={16} className="text-[#fbbf24]" />;
    if (type === 'chance') return <HelpCircle size={20} className="text-[#f472b6] drop-shadow-[0_0_8px_rgba(244,114,182,0.8)]" />;
    if (type === 'chest') return <Package size={20} className="text-[#fb923c] drop-shadow-[0_0_8px_rgba(251,146,60,0.8)]" />;
    if (type === 'tax') return <div className="text-gray-400 text-[0.6rem] font-bold mt-0.5">TAX</div>;
    
    // Corners
    if (name.toLowerCase().includes('start')) return <ArrowLeft size={28} className="text-[#4ade80] drop-shadow-[0_0_10px_rgba(74,222,128,0.5)]" />;
    if (name.toLowerCase().includes('jail')) return <Skull size={28} className="text-gray-200" />;
    if (name.toLowerCase().includes('vacation')) return <MapPin size={28} className="text-[#60a5fa]" />;
    
    return null;
  };

  return (
    <div 
      className={`relative rounded-xl overflow-hidden flex flex-col justify-between items-center text-center text-white transition-all duration-500
        ${isCorner ? 'p-2 bg-gradient-to-br from-[#2a2a3b] to-[#161622]' : ''}
      `}
      style={{
        backgroundColor: ownerColor ? `${ownerColor}60` : (isCorner ? undefined : '#212130'),
        boxShadow: ownerColor 
          ? `inset 0 0 0 3px ${ownerColor}, 0 0 20px ${ownerColor}40` 
          : '0 4px 6px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.05)',
        width: '100%',
        height: '100%'
      }}
    >
      {/* Player Tokens Container */}
      <div className="absolute inset-0 z-10 flex flex-wrap items-center justify-center gap-1 p-1 pointer-events-none">
        {players.map(p => {
          const isCurrentTurn = allPlayers[turnIndex ?? -1]?.id === p.id;
          return (
            <div 
              key={p.id} 
              className={`w-3 h-3 sm:w-4 sm:h-4 rounded-full border border-white/50 shadow-md transition-all duration-300
                ${isCurrentTurn ? 'animate-pulse scale-125' : ''}
              `}
              style={{ 
                backgroundColor: p.color,
                boxShadow: isCurrentTurn ? `0 0 12px ${p.color}, 0 0 4px white` : '0 2px 4px rgba(0,0,0,0.5)'
              }}
            />
          );
        })}
      </div>

      <div className={`w-full h-full flex justify-between items-center ${layoutClass}`}>
        
        {/* Property Color Bar */}
        {!isCorner && color && (
          <div 
            className={`${colorBarClass} opacity-90 shadow-sm shrink-0 relative`} 
            style={{ 
              backgroundColor: color,
              boxShadow: `0 0 10px ${color}40` // subtle glow
            }}
          >
            {flagCode && (
               <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-4 h-4 rounded-full overflow-hidden shadow-[0_2px_4px_rgba(0,0,0,0.8)] border border-white/20 bg-black flex items-center justify-center">
                 <span className={`fi fi-${flagCode} text-lg leading-none m-0 p-0 block`} style={{ transform: 'scale(1.2)' }}></span>
               </div>
            )}
            {houses === 5 ? (
              <div className="w-3.5 h-3.5 bg-red-600 border-[0.5px] border-white shadow-[0_1px_3px_rgba(0,0,0,0.8)] rounded-[1px] flex items-center justify-center">
                <span className="text-[0.4rem] font-black text-white leading-none tracking-tighter" style={{ textShadow: '0 1px 1px rgba(0,0,0,0.5)' }}>H</span>
              </div>
            ) : houses > 0 ? (
              Array.from({ length: houses }).map((_, i) => (
                <div key={i} className="w-1.5 h-1.5 bg-green-500 border border-green-950 shadow-[0_1px_2px_rgba(0,0,0,0.5)] rounded-[1px]"></div>
              ))
            ) : null}
          </div>
        )}

        {/* Special Padding for non-colored squares */}
        {!isCorner && !color && <div className={`shrink-0 ${layoutClass.includes('col') ? 'h-2' : 'w-2'}`}></div>}
        
        {/* Name & Icon Area */}
        <div className="flex-1 flex flex-col items-center justify-center p-0.5 overflow-hidden w-full h-full">
          {name.toLowerCase().includes('start') && (
             <span className="font-black text-[0.7rem] tracking-widest text-[#a3e635] mb-1">START</span>
          )}
          {!name.toLowerCase().includes('start') && (
             <span 
              className={`font-semibold ${isCorner ? 'text-[0.7rem] text-gray-200' : 'text-[0.55rem] leading-[1.1] text-[#e2e8f0]'}`}
              style={{ textShadow: '0 1px 2px rgba(0,0,0,0.8)' }}
             >
               {name}
             </span>
          )}
          {renderIcon() && (
            <div className={`mt-0.5 ${isCorner ? 'mb-1' : ''}`}>
              {renderIcon()}
            </div>
          )}
          {name === 'Vacation' && vacationJackpot > 0 && (
             <div className="mt-1 bg-green-500 text-black px-1.5 py-0.5 rounded text-[0.6rem] font-bold shadow-sm whitespace-nowrap animate-pulse">
               ${vacationJackpot}
             </div>
          )}
          {isProtected && (
             <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-cyan-400 drop-shadow-[0_0_10px_rgba(34,211,238,0.8)] opacity-70 pointer-events-none z-20">
               <Shield size={32} />
             </div>
          )}
        </div>

        {/* Price Pill */}
        {!isCorner && price && !ownerColor ? (
          <div className={`${priceContainerClass} shrink-0`}>
            <div className={`bg-[#111118]/80 px-1 py-0.5 rounded-sm border border-white/10 text-[0.55rem] font-bold text-gray-300 shadow-inner whitespace-nowrap`}>
              {name === 'Money Tax' ? '10% Cash' : (name === 'Property Tax' ? '5% Assets' : `$${price}`)}
            </div>
          </div>
        ) : (
          !isCorner && <div className={`shrink-0 ${layoutClass.includes('col') ? 'h-4 pb-1' : 'w-4 pr-1'}`}></div>
        )}
        
      </div>
    </div>
  );
};
