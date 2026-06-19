import React from 'react';
import type { GameState, TradeOffer } from '../../../shared/types';
import { socket } from '../socket';
import { SQUARES } from '../constants/boardData';

interface ViewTradeModalProps {
  gameState: GameState;
  trade: TradeOffer;
  onClose: () => void;
  onAccept: () => void;
  onReject: () => void;
  onCounter: () => void;
}

export const ViewTradeModal: React.FC<ViewTradeModalProps> = ({ gameState, trade, onClose, onAccept, onReject, onCounter }) => {
  const me = gameState.players.find(p => p.id === socket.id);
  const initiator = gameState.players.find(p => p.id === trade.initiatorId)?.name || 'Unknown';
  const target = gameState.players.find(p => p.id === trade.targetId)?.name || 'Unknown';
  
  if (!me) return null;
  
  const isTarget = me.id === trade.targetId;
  const isInitiator = me.id === trade.initiatorId;

  const renderProps = (propIds: number[]) => {
    if (propIds.length === 0) return <span className="text-gray-500 italic">No properties</span>;
    return (
      <div className="flex flex-wrap gap-2 mt-1">
        {propIds.map(id => {
          const sq = SQUARES[id];
          return (
            <div key={id} className="text-[0.65rem] px-2 py-1 rounded bg-[#111118] border border-white/10 flex items-center gap-1">
               {sq.color && <div className="w-2 h-2 rounded-full" style={{ backgroundColor: sq.color }}></div>}
               {sq.name}
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
      <div className="bg-[#161622] rounded-xl w-full max-w-xl p-6 border-2 border-blue-500 shadow-2xl animate-in fade-in zoom-in duration-200">
        <h2 className="text-2xl font-black mb-1 text-white uppercase text-center">Trade Offer</h2>
        <p className="text-sm text-gray-400 mb-6 text-center">
          <span className="font-bold text-white">{initiator}</span> wants to trade with <span className="font-bold text-white">{target}</span>
        </p>

        <div className="grid grid-cols-2 gap-4 mb-8">
          <div className="bg-[#212130] p-4 rounded-lg border border-red-500/30">
            <h3 className="text-red-400 font-bold mb-3 uppercase tracking-wider text-sm border-b border-red-500/20 pb-2">{initiator} Offers</h3>
            <div className="mb-3">
              <span className="text-gray-400 text-xs uppercase">Money:</span>
              <div className="text-xl font-bold text-white">${trade.offer.money}</div>
            </div>
            <div>
              <span className="text-gray-400 text-xs uppercase">Properties:</span>
              {renderProps(trade.offer.properties)}
            </div>
          </div>

          <div className="bg-[#212130] p-4 rounded-lg border border-green-500/30">
            <h3 className="text-green-400 font-bold mb-3 uppercase tracking-wider text-sm border-b border-green-500/20 pb-2">{initiator} Wants</h3>
            <div className="mb-3">
              <span className="text-gray-400 text-xs uppercase">Money:</span>
              <div className="text-xl font-bold text-white">${trade.request.money}</div>
            </div>
            <div>
              <span className="text-gray-400 text-xs uppercase">Properties:</span>
              {renderProps(trade.request.properties)}
            </div>
          </div>
        </div>

        <div className="flex gap-3 justify-end border-t border-white/10 pt-4">
          <button onClick={onClose} className="px-4 py-2 rounded-lg font-bold text-sm bg-gray-600 hover:bg-gray-500 transition-colors">
            Close
          </button>
          
          {isTarget && trade.status === 'pending' && (
            <>
              <button onClick={() => { onReject(); onClose(); }} className="px-4 py-2 rounded-lg font-bold text-sm bg-red-600 hover:bg-red-500 transition-colors">
                Reject
              </button>
              <button onClick={() => { onCounter(); onClose(); }} className="px-4 py-2 rounded-lg font-bold text-sm bg-yellow-600 hover:bg-yellow-500 transition-colors">
                Negotiate
              </button>
              <button onClick={() => { onAccept(); onClose(); }} className="px-4 py-2 rounded-lg font-bold text-sm bg-green-600 hover:bg-green-500 transition-colors">
                Accept Trade
              </button>
            </>
          )}

          {isInitiator && trade.status === 'pending' && (
             <button onClick={() => { onReject(); onClose(); }} className="px-4 py-2 rounded-lg font-bold text-sm bg-red-600 hover:bg-red-500 transition-colors">
               Withdraw Offer
             </button>
          )}
        </div>
      </div>
    </div>
  );
};
