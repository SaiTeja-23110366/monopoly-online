import React, { useState } from 'react';
import type { GameState, TradeOffer } from '../../../shared/types';
import { socket } from '../socket';
import { SQUARES } from '../constants/boardData';

interface TradeModalProps {
  playerId: string;
  gameState: GameState;
  onClose: () => void;
  // If editing an existing trade (counter-offer)
  existingTrade?: TradeOffer; 
}

export const TradeModal: React.FC<TradeModalProps> = ({ gameState, playerId, onClose, existingTrade }) => {
  const me = gameState.players.find(p => p.id === playerId);
  const otherPlayers = gameState.players.filter(p => p.id !== playerId && p.status !== 'bankrupt');
  
  const [targetId, setTargetId] = useState<string>(existingTrade ? existingTrade.initiatorId : (otherPlayers[0]?.id || ''));
  
  const [offerMoney, setOfferMoney] = useState<number>(existingTrade ? existingTrade.request.money : 0);
  const [requestMoney, setRequestMoney] = useState<number>(existingTrade ? existingTrade.offer.money : 0);
  
  const [offerProps, setOfferProps] = useState<number[]>(existingTrade ? existingTrade.request.properties : []);
  const [requestProps, setRequestProps] = useState<number[]>(existingTrade ? existingTrade.offer.properties : []);

  if (!me) return null;
  const targetPlayer = gameState.players.find(p => p.id === targetId);

  // Helper to toggle property selection
  const toggleProp = (id: number, list: number[], setList: (l: number[]) => void) => {
    if (list.includes(id)) {
      setList(list.filter(x => x !== id));
    } else {
      setList([...list, id]);
    }
  };

  const myProperties = Object.values(gameState.properties).filter(p => p.ownerId === me.id);
  const theirProperties = targetPlayer ? Object.values(gameState.properties).filter(p => p.ownerId === targetPlayer.id) : [];

  const handleSubmit = () => {
    if (!targetPlayer) return;

    if (existingTrade) {
      socket.emit('counter_trade', gameState.roomCode, existingTrade.id, {
        money: offerMoney,
        properties: offerProps,
        getOutOfJailCards: 0
      }, {
        money: requestMoney,
        properties: requestProps,
        getOutOfJailCards: 0
      });
    } else {
      socket.emit('propose_trade', gameState.roomCode, {
        initiatorId: me.id,
        targetId: targetPlayer.id,
        offer: {
          money: offerMoney,
          properties: offerProps,
          getOutOfJailCards: 0
        },
        request: {
          money: requestMoney,
          properties: requestProps,
          getOutOfJailCards: 0
        }
      });
    }
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4 backdrop-blur-sm">
      <div className="bg-[#161622] border border-white/10 p-6 rounded-2xl w-full max-w-4xl shadow-2xl flex flex-col max-h-[90vh]">
        <h2 className="text-3xl font-black mb-6 text-white text-center tracking-widest">
          {existingTrade ? 'COUNTER OFFER' : 'PROPOSE TRADE'}
        </h2>

        {!existingTrade && (
          <div className="mb-6">
            <label className="block text-gray-400 text-sm font-bold mb-2">Trade With:</label>
            <select 
              value={targetId} 
              onChange={e => setTargetId(e.target.value)}
              className="w-full bg-[#212130] text-white p-3 rounded-lg border border-white/10 outline-none focus:border-indigo-500"
            >
              {otherPlayers.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
        )}

        <div className="flex flex-col md:flex-row gap-6 flex-1 overflow-hidden">
          
          {/* LEFT: MY OFFER */}
          <div className="flex-1 flex flex-col bg-[#212130] p-4 rounded-xl border border-white/5">
            <h3 className="text-xl font-bold text-red-400 mb-4 border-b border-white/10 pb-2">Your Offer</h3>
            
            <div className="mb-4">
              <label className="block text-gray-400 text-sm mb-1">Money ($)</label>
              <input 
                type="number" 
                min="0" 
                max={me.money}
                value={offerMoney}
                onChange={e => {
                  let val = Number(e.target.value);
                  if (val > me.money) val = me.money;
                  if (val < 0) val = 0;
                  setOfferMoney(val);
                }}
                className="w-full bg-[#161622] text-white p-2 rounded border border-white/10 outline-none"
              />
              <p className="text-xs text-gray-500 mt-1">You have ${me.money}</p>
            </div>

            <div className="flex-1 overflow-y-auto">
              <label className="block text-gray-400 text-sm mb-2">Properties</label>
              {myProperties.length === 0 ? (
                <p className="text-sm text-gray-600 italic">No properties to offer.</p>
              ) : (
                <div className="space-y-2">
                  {myProperties.map(p => {
                    const sq = SQUARES[p.id];
                    return (
                      <div 
                        key={p.id} 
                        onClick={() => toggleProp(p.id, offerProps, setOfferProps)}
                        className={`p-2 rounded cursor-pointer border flex justify-between items-center transition-colors
                          ${offerProps.includes(p.id) ? 'bg-indigo-600/20 border-indigo-500' : 'bg-[#161622] border-white/5 hover:border-white/20'}
                        `}
                      >
                        <span className="text-sm font-semibold">{sq.name}</span>
                        {sq.color && <div className="w-3 h-3 rounded-full shadow" style={{ backgroundColor: sq.color }}></div>}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* RIGHT: I WANT */}
          <div className="flex-1 flex flex-col bg-[#212130] p-4 rounded-xl border border-white/5">
            <h3 className="text-xl font-bold text-green-400 mb-4 border-b border-white/10 pb-2">You Want</h3>
            
            <div className="mb-4">
              <label className="block text-gray-400 text-sm mb-1">Money ($)</label>
              <input 
                type="number" 
                min="0" 
                max={targetPlayer?.money || 0}
                value={requestMoney}
                onChange={e => {
                  let val = Number(e.target.value);
                  const maxVal = targetPlayer?.money || 0;
                  if (val > maxVal) val = maxVal;
                  if (val < 0) val = 0;
                  setRequestMoney(val);
                }}
                className="w-full bg-[#161622] text-white p-2 rounded border border-white/10 outline-none"
                disabled={!targetPlayer}
              />
              <p className="text-xs text-gray-500 mt-1">{targetPlayer?.name || 'They'} have ${targetPlayer?.money || 0}</p>
            </div>

            <div className="flex-1 overflow-y-auto">
              <label className="block text-gray-400 text-sm mb-2">Properties</label>
              {theirProperties.length === 0 ? (
                <p className="text-sm text-gray-600 italic">They have no properties.</p>
              ) : (
                <div className="space-y-2">
                  {theirProperties.map(p => {
                    const sq = SQUARES[p.id];
                    return (
                      <div 
                        key={p.id} 
                        onClick={() => toggleProp(p.id, requestProps, setRequestProps)}
                        className={`p-2 rounded cursor-pointer border flex justify-between items-center transition-colors
                          ${requestProps.includes(p.id) ? 'bg-indigo-600/20 border-indigo-500' : 'bg-[#161622] border-white/5 hover:border-white/20'}
                        `}
                      >
                        <span className="text-sm font-semibold">{sq.name}</span>
                        {sq.color && <div className="w-3 h-3 rounded-full shadow" style={{ backgroundColor: sq.color }}></div>}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

        </div>

        <div className="flex justify-end gap-4 mt-6">
          <button 
            onClick={onClose}
            className="px-6 py-2 rounded-lg font-bold text-gray-400 hover:text-white transition-colors"
          >
            Cancel
          </button>
          <button 
            onClick={handleSubmit}
            disabled={!targetPlayer || (offerMoney === 0 && requestMoney === 0 && offerProps.length === 0 && requestProps.length === 0)}
            className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed px-8 py-2 rounded-lg font-bold text-white transition-colors shadow-lg"
          >
            {existingTrade ? 'Send Counter' : 'Send Offer'}
          </button>
        </div>
      </div>
    </div>
  );
};
