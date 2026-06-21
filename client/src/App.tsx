import React, { useState, useEffect } from 'react';
import { socket } from './socket';
import { Lobby } from './components/Lobby';
import { Board } from './components/Board';
import { PropertyInfoCard } from './components/PropertyInfoCard';
import { TradeModal } from './components/TradeModal';
import { ViewTradeModal } from './components/ViewTradeModal';
import { SQUARES } from './constants/boardData';
import type { GameState, TradeOffer } from '../../shared/types';

const getStoredPlayerId = () => {
  let id = localStorage.getItem('monopoly_player_id');
  if (!id) {
    id = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
    localStorage.setItem('monopoly_player_id', id);
  }
  return id;
};

export const App: React.FC = () => {
  const [playerId] = useState(getStoredPlayerId);
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [showPopups, setShowPopups] = useState(true);
  const [viewingSquareIndex, setViewingSquareIndex] = useState<number | null>(null);
  
  // Trading Modal State
  const [isTradeModalOpen, setIsTradeModalOpen] = useState(false);
  const [editingTrade, setEditingTrade] = useState<TradeOffer | undefined>(undefined);
  const [viewingTrade, setViewingTrade] = useState<TradeOffer | undefined>(undefined);

  // Timer State
  const [timeLeft, setTimeLeft] = useState<number | null>(null);

  // Mobile Tab State
  const [activeTab, setActiveTab] = useState<'board' | 'players' | 'trades' | 'log'>('board');

  useEffect(() => {
    socket.on('game_state_update', (state: GameState) => {
      setGameState(state);
      localStorage.setItem('monopoly_room_code', state.roomCode);
    });

    socket.on('error', (msg: string) => {
      console.error(msg);
      if (msg === 'Game not found' || msg === 'Player not found in this game') {
         localStorage.removeItem('monopoly_room_code');
      }
    });

    const roomCode = localStorage.getItem('monopoly_room_code');
    const storedPlayerId = localStorage.getItem('monopoly_player_id');
    if (roomCode && storedPlayerId) {
      socket.emit('reconnect_player', { roomCode, playerId: storedPlayerId });
    }

    return () => {
      socket.off('game_state_update');
      socket.off('error');
    };
  }, []);

  const handleJoin = (roomCode: string, name: string) => {
    // Hardcoded color logic for demo; later let players pick
    const colors = ['#ef4444', '#3b82f6', '#10b981', '#f59e0b'];
    const color = colors[Math.floor(Math.random() * colors.length)];
    socket.emit('join_room', roomCode, playerId, name, color);
  };

  const handleChangeColor = (newColor: string) => {
    if (gameState) {
      socket.emit('change_color', gameState.roomCode, newColor);
    }
  };

  const handleUpdateStartingCash = (cash: number) => {
    if (gameState) {
      socket.emit('update_starting_cash', gameState.roomCode, cash);
    }
  };

  const handleStart = () => {
    if (gameState) {
      socket.emit('start_game', gameState.roomCode);
    }
  };

  const handleRollDice = () => {
    if (gameState) {
      socket.emit('roll_dice', gameState.roomCode);
    }
  };

  const handleOpenProposeTrade = () => {
    setEditingTrade(undefined);
    setIsTradeModalOpen(true);
  };

  const handleOpenCounterTrade = (trade: TradeOffer) => {
    setEditingTrade(trade);
    setIsTradeModalOpen(true);
  };

  const handleAcceptTrade = (tradeId: string) => {
    if (gameState) {
      socket.emit('accept_trade', gameState.roomCode, tradeId);
    }
  };

  const handleRejectTrade = (tradeId: string) => {
    if (gameState) {
      socket.emit('reject_trade', gameState.roomCode, tradeId);
    }
  };

  const handleBuyProperty = (houses: number) => {
    if (gameState && gameState.awaitingBuyDecision !== null) {
      socket.emit('buy_property', gameState.roomCode, gameState.awaitingBuyDecision, houses);
    }
  };

  const handleUpgradeProperty = (houses: number) => {
    if (gameState && gameState.awaitingBuyDecision !== null) {
      socket.emit('upgrade_property', gameState.roomCode, gameState.awaitingBuyDecision, houses);
    }
  };

  const handleSellToBank = (propertyIndex: number) => {
    if (gameState) {
      socket.emit('sell_property_to_bank', gameState.roomCode, propertyIndex);
    }
  };

  const handlePassProperty = () => {
    if (gameState) {
      socket.emit('pass_property', gameState.roomCode);
    }
  };

  useEffect(() => {
    if (gameState?.awaitingBuyDecision !== null && gameState?.awaitingBuyDecision !== undefined || gameState?.activeCard !== null && gameState?.activeCard !== undefined || gameState?.awaitingFlightDecision !== null && gameState?.awaitingFlightDecision !== undefined || gameState?.awaitingSabotage || gameState?.awaitingProtection) {
      const timer = setTimeout(() => setShowPopups(true), 1200);
      return () => clearTimeout(timer);
    } else {
      setShowPopups(false);
    }
  }, [gameState?.awaitingBuyDecision, gameState?.activeCard, gameState?.awaitingFlightDecision, gameState?.awaitingSabotage, gameState?.awaitingProtection]);

  useEffect(() => {
    if (!gameState?.turnDeadline || gameState.state !== 'playing') {
      setTimeLeft(null);
      return;
    }

    const updateTimer = () => {
      const remaining = Math.max(0, Math.floor((gameState.turnDeadline! - Date.now()) / 1000));
      setTimeLeft(remaining);

      // Emit check_timeout exactly when it hits 0
      if (remaining === 0 && gameState.players[gameState.turnIndex]?.id === playerId) {
        socket.emit('check_timeout', gameState.roomCode);
      }
    };

    updateTimer(); // Initial call
    const intervalId = setInterval(updateTimer, 500); // Check every 500ms

    return () => clearInterval(intervalId);
  }, [gameState?.turnDeadline, gameState?.state, gameState?.turnIndex, playerId, gameState?.roomCode]);

  if (!gameState) {
    return <Lobby onJoin={handleJoin} />;
  }



  const currentPlayer = gameState.players.find(p => p.id === playerId);
  const isMyTurn = currentPlayer?.id === gameState.players[gameState.turnIndex]?.id;
  const isAwaitingBuy = showPopups && gameState.awaitingBuyDecision !== null;
  const isAwaitingDebtResolution = gameState.awaitingDebtResolution === playerId;
  const isAwaitingFlight = showPopups && gameState.awaitingFlightDecision !== null && gameState.awaitingFlightDecision !== undefined;
  const isAwaitingSabotage = showPopups && gameState.awaitingSabotage;
  const isAwaitingProtection = showPopups && gameState.awaitingProtection;
  const isBankrupt = currentPlayer?.status === 'bankrupt';

  let validFlightDestinations: number[] = [];
  if (isAwaitingFlight && isMyTurn) {
    const start = gameState.awaitingFlightDecision!;
    let current = (start + 1) % 56;
    while (SQUARES[current].type !== 'railroad') {
      validFlightDestinations.push(current);
      current = (current + 1) % 56;
    }
    // Include the next airport as well
    validFlightDestinations.push(current);
  }

  const handleFlightDecision = (destIndex: number | null) => {
    socket.emit('flight_decision', gameState.roomCode, destIndex);
  };

  const handleSquareClick = (index: number) => {
    if (isMyTurn) {
      if (isAwaitingSabotage) {
         socket.emit('execute_sabotage', gameState.roomCode, index);
         return;
      } else if (isAwaitingProtection) {
         socket.emit('execute_protection', gameState.roomCode, index);
         return;
      } else if (isAwaitingDebtResolution) {
         socket.emit('sell_property_to_bank', gameState.roomCode, index);
         return;
      }
    }
    // View property details if not making an active move
    setViewingSquareIndex(index);
  };

  const isJailDecision = isMyTurn && currentPlayer?.inJail && !gameState.hasRolled;

  const handlePayJailFine = () => {
    socket.emit('pay_jail_fine', gameState.roomCode);
  };
  const handleUseJailCard = () => {
    socket.emit('use_jail_card', gameState.roomCode);
  };

  const buySquare = isAwaitingBuy ? SQUARES[gameState.awaitingBuyDecision!] : null;
  const propState = isAwaitingBuy ? gameState.properties[gameState.awaitingBuyDecision!] : null;
  const isUnowned = propState?.ownerId === null;
  const isOwnedByMe = propState?.ownerId === playerId;

  const sameColorProps = buySquare?.color ? (SQUARES as any[]).filter(s => s.color === buySquare.color).map(s => s.id) : [];
  const ownsAll = sameColorProps.length > 0 && sameColorProps.every(id => gameState.properties[id]?.ownerId === playerId);
  
  const AVAILABLE_COLORS = ['#ef4444', '#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#06b6d4', '#f97316'];
  const STARTING_CASH_OPTIONS = [1000, 1500, 2000, 2500, 3000, 4000, 5000, 6000];

  let centerContent: React.ReactNode = null;
  if (viewingSquareIndex !== null && !isAwaitingBuy && !isAwaitingFlight && !isJailDecision) {
    centerContent = (
      <PropertyInfoCard square={SQUARES[viewingSquareIndex]} onClose={() => setViewingSquareIndex(null)} />
    );
  } else if (isAwaitingBuy && isMyTurn && buySquare && propState) {
    centerContent = (
      <div className="bg-[#161622] border-2 border-indigo-500 p-6 md:p-8 rounded-2xl w-[90vw] md:w-full max-w-md shadow-[0_0_50px_rgba(99,102,241,0.5)] text-center transform scale-105 transition-transform animate-in fade-in zoom-in duration-300 pointer-events-auto max-h-[80vh] overflow-y-auto">
        <h2 className="text-3xl font-black mb-2 text-white tracking-widest uppercase">{buySquare.name}</h2>
        {buySquare.color && <div className="w-16 h-2 mx-auto mb-4 rounded-full" style={{ backgroundColor: buySquare.color }}></div>}
        {isUnowned ? (
          <>
            <p className="text-gray-300 mb-4 text-lg">Choose purchase option:</p>
            <div className="flex flex-col gap-3 mb-6">
              <button onClick={() => handleBuyProperty(0)} disabled={(currentPlayer?.money || 0) < (buySquare.price || 0)} className="flex justify-between px-4 py-3 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg font-bold text-white transition-colors">
                <span>Base Property <span className="text-gray-400 text-xs ml-2 font-normal">(Rent: ${(buySquare as any).rent?.[0] || 0})</span></span><span className="text-[#4ade80]">${buySquare.price}</span>
              </button>
              {(buySquare as any).housePrice && (
                <>
                  <button onClick={() => handleBuyProperty(1)} disabled={(currentPlayer?.money || 0) < (buySquare.price || 0) + (buySquare as any).housePrice} className="flex justify-between px-4 py-3 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg font-bold text-white transition-colors">
                    <span>Property + 1 House <span className="text-gray-400 text-xs ml-2 font-normal">(Rent: ${(buySquare as any).rent?.[1] || 0})</span></span><span className="text-[#4ade80]">${(buySquare.price || 0) + (buySquare as any).housePrice}</span>
                  </button>
                  <button onClick={() => handleBuyProperty(2)} disabled={(currentPlayer?.money || 0) < (buySquare.price || 0) + (2 * (buySquare as any).housePrice)} className="flex justify-between px-4 py-3 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg font-bold text-white transition-colors">
                    <span>Property + 2 Houses <span className="text-gray-400 text-xs ml-2 font-normal">(Rent: ${(buySquare as any).rent?.[2] || 0})</span></span><span className="text-[#4ade80]">${(buySquare.price || 0) + (2 * (buySquare as any).housePrice)}</span>
                  </button>
                </>
              )}
            </div>
          </>
        ) : isOwnedByMe ? (
          <>
            <p className="text-gray-300 mb-4 text-lg">Upgrade Property:</p>
            <div className="flex flex-col gap-3 mb-6">
              {(buySquare as any).housePrice && propState.houses < 4 && (
                Array.from({ length: 4 - (propState.houses || 0) }).map((_, i) => {
                  const numHouses = i + 1;
                  const cost = numHouses * (buySquare as any).housePrice!;
                  return (
                    <button key={`upgrade-${numHouses}`} onClick={() => handleUpgradeProperty(numHouses)} disabled={(currentPlayer?.money || 0) < cost} className="flex justify-between px-4 py-3 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg font-bold text-white transition-colors">
                      <span>Buy {numHouses} House{numHouses > 1 ? 's' : ''} <span className="text-gray-200 text-xs ml-2 font-normal">(Rent: ${(buySquare as any).rent?.[(propState.houses || 0) + numHouses] || 0})</span></span><span className="text-[#4ade80]">${cost}</span>
                    </button>
                  );
                })
              )}
              {(buySquare as any).housePrice && propState.houses === 4 && ownsAll && (
                <button onClick={() => handleUpgradeProperty(1)} disabled={(currentPlayer?.money || 0) < (buySquare as any).housePrice} className="flex justify-between px-4 py-3 bg-red-600 hover:bg-red-500 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg font-bold text-white transition-colors">
                  <span>Upgrade to Hotel <span className="text-gray-200 text-xs ml-2 font-normal">(Rent: ${(buySquare as any).rent?.[5] || 0})</span></span><span className="text-[#4ade80]">${(buySquare as any).housePrice}</span>
                </button>
              )}
              {!ownsAll && propState.houses === 4 && <p className="text-yellow-400 text-sm font-bold">You need the full color set to build a Hotel.</p>}
            </div>
          </>
        ) : null}
        <div className="flex gap-4">
          <button onClick={handlePassProperty} className="flex-1 bg-transparent border-2 border-gray-600 hover:border-gray-400 text-gray-300 py-3 rounded-lg font-bold transition-colors">Pass / End Turn</button>
        </div>
        {(currentPlayer?.money || 0) < (buySquare.price || 0) && isUnowned && <p className="text-red-400 text-sm mt-3 font-bold">You cannot afford the base property.</p>}
      </div>
    );
  } else if (isAwaitingFlight && isMyTurn && !isAwaitingDebtResolution) {
    centerContent = (
      <div className="bg-[#161622] border-2 border-cyan-500 p-6 md:p-8 rounded-2xl w-[90vw] md:w-full max-w-3xl shadow-[0_0_50px_rgba(6,182,212,0.5)] animate-in fade-in zoom-in duration-300 pointer-events-auto max-h-[80vh] overflow-y-auto">
        <h2 className="text-3xl font-black mb-2 text-white text-center tracking-widest uppercase">FLIGHT TERMINAL</h2>
        <p className="text-gray-300 mb-8 text-center text-lg">
          You have <span className="text-cyan-400 font-bold">{currentPlayer?.flightChances} Flight Chance(s)</span> remaining.<br/>Buy a ticket for <span className="text-[#4ade80] font-bold">${gameState.awaitingFlightDecision === 45 ? 700 : 400}</span> to fly to any destination before the next airport!
        </p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 max-h-[50vh] overflow-y-auto mb-6 pr-2">
          {validFlightDestinations.map(destIndex => {
            const sq = SQUARES[destIndex];
            return (
              <button key={destIndex} onClick={() => handleFlightDecision(destIndex)} disabled={(currentPlayer?.money || 0) < (gameState.awaitingFlightDecision === 45 ? 700 : 400)} className="flex flex-col items-center justify-center bg-[#212130] hover:bg-[#2a2a3b] border border-white/10 hover:border-cyan-500/50 p-4 rounded-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed group">
                {sq.color && <div className="w-8 h-2 rounded-full mb-2" style={{ backgroundColor: sq.color }}></div>}
                <span className="font-bold text-center text-sm group-hover:text-cyan-400 transition-colors">{sq.name}</span>
              </button>
            );
          })}
        </div>
        <div className="flex gap-4">
          <button onClick={() => handleFlightDecision(null)} className="flex-1 bg-transparent border-2 border-gray-600 hover:border-gray-400 text-gray-300 py-3 rounded-lg font-bold transition-colors">No Thanks (Pass)</button>
        </div>
      </div>
    );
  } else if (isJailDecision && !gameState.activeCard) {
    centerContent = (
      <div className="bg-[#161622] border-4 border-orange-500 p-6 md:p-8 rounded-2xl w-[90vw] md:w-full max-w-md shadow-[0_0_50px_rgba(249,115,22,0.5)] animate-in fade-in zoom-in duration-300 text-center pointer-events-auto max-h-[80vh] overflow-y-auto">
        <h2 className="text-4xl font-black mb-2 text-white tracking-widest uppercase">YOU ARE IN JAIL</h2>
        <p className="text-gray-300 mb-8 text-lg">
          You must get out before you can move! You've been in jail for <span className="font-bold text-orange-400">{currentPlayer?.jailTurns}</span> turn(s).
        </p>
        <div className="flex flex-col gap-4">
          <button onClick={handlePayJailFine} disabled={(currentPlayer?.money || 0) < 200} className="w-full bg-orange-600 hover:bg-orange-500 disabled:opacity-50 disabled:cursor-not-allowed py-4 rounded-xl font-bold text-white transition-colors text-lg flex justify-between px-6">
            <span>Pay Fine</span><span className="text-orange-200">$200</span>
          </button>
          <button onClick={handleUseJailCard} disabled={(currentPlayer?.getOutOfJailCards || 0) === 0} className="w-full bg-[#fb923c] hover:bg-[#fdba74] disabled:opacity-50 disabled:cursor-not-allowed py-4 rounded-xl font-bold text-black transition-colors text-lg shadow-[0_0_15px_rgba(251,146,60,0.5)] flex justify-between px-6">
            <span>Use Jail Card</span><span className="font-black bg-black/20 px-2 rounded">{currentPlayer?.getOutOfJailCards || 0}</span>
          </button>
          <button onClick={handleRollDice} className="w-full bg-indigo-600 hover:bg-indigo-500 py-4 rounded-xl font-black text-white transition-transform hover:scale-105 active:scale-95 text-xl mt-2 border border-white/20">
            Roll for Doubles
          </button>
        </div>
      </div>
    );
  }


  return (
    <div className="flex w-full h-screen bg-[#0a0a0f] text-white overflow-hidden relative pb-16 md:pb-0">
      
      {/* Debt Resolution Slide */}
      {isAwaitingDebtResolution && (
        <div className="fixed md:absolute inset-x-0 bottom-16 md:bottom-0 md:top-0 h-[70vh] md:h-auto md:w-96 bg-[#161622]/95 border-t md:border-t-0 md:border-r border-red-600 z-[60] flex flex-col shadow-[0_-20px_50px_rgba(220,38,38,0.3)] md:shadow-[20px_0_50px_rgba(220,38,38,0.3)] rounded-t-3xl md:rounded-none animate-in slide-in-from-bottom md:slide-in-from-left backdrop-blur-md">
          <div className="p-6 border-b border-white/10">
            <h2 className="text-2xl font-black text-red-500 tracking-widest uppercase mb-2">DEBT RESOLUTION</h2>
            <p className="text-gray-300 text-sm">
              Balance: <span className="font-bold text-red-400">${currentPlayer?.money}</span>
              <br/>Sell properties to the bank or trade with players!
            </p>
          </div>
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {Object.values(gameState.properties).filter(p => p.ownerId === playerId).map(prop => {
              const sq = SQUARES[prop.id];
              const baseValue = sq.price || 0;
              const houseValue = prop.houses * ((sq as any).housePrice || 0);
              const sellValue = Math.floor((baseValue + houseValue) * 0.75);
              
              return (
                <div key={prop.id} className="bg-[#212130] p-3 rounded-lg border border-white/5 flex flex-col gap-2">
                  <div className="flex items-center gap-3">
                    {sq.color && <div className="w-3 h-3 rounded-full" style={{ backgroundColor: sq.color }}></div>}
                    <div>
                      <p className="font-bold">{sq.name}</p>
                      <p className="text-xs text-gray-400">
                        {prop.houses > 0 ? `${prop.houses === 5 ? 'Hotel' : prop.houses + ' Houses'}` : 'Base'}
                      </p>
                    </div>
                  </div>
                  <button 
                    onClick={() => handleSellToBank(prop.id)}
                    className="w-full bg-red-900/50 hover:bg-red-600 text-red-200 hover:text-white py-2 rounded text-sm font-bold transition-colors border border-red-500/30"
                  >
                    Sell to Bank for ${sellValue}
                  </button>
                </div>
              );
            })}
            {Object.values(gameState.properties).filter(p => p.ownerId === playerId).length === 0 && (
              <div className="text-center p-4 bg-red-950/30 rounded border border-red-900/50">
                <p className="text-red-400 font-bold mb-1">No properties left!</p>
                <p className="text-gray-400 text-xs">You are bankrupt and will be eliminated.</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Card logic is now handled in Board.tsx center area */}

      {/* Bankrupt Overlay */}
      {isBankrupt && (
        <div className="fixed inset-0 z-[80] bg-black/95 flex flex-col items-center justify-center p-4 backdrop-blur-xl animate-in fade-in duration-1000">
          <h1 className="text-6xl md:text-8xl font-black text-red-600 mb-4 animate-pulse uppercase tracking-widest text-center" style={{ textShadow: '0 0 40px rgba(220,38,38,0.6)' }}>
            BANKRUPT
          </h1>
          <p className="text-xl md:text-2xl text-gray-400 text-center max-w-lg">
            You have run out of money and assets. You are officially eliminated from the game.
          </p>
          <div className="mt-12 text-sm text-gray-600">You can still watch the rest of the game unfold.</div>
        </div>
      )}

      {/* Modals were moved to the bottom */}

      {/* Left Sidebar - Logs & Trades */}
      <div className="w-64 bg-[#161622] border-r border-white/5 flex flex-col p-4">
        
        {/* Active Trades Section */}
        <h2 className="text-xl font-bold mb-4 text-blue-400">Active Trades</h2>
        <div className="space-y-4 mb-6">
          {Object.values(gameState.trades)
            .filter(t => t.status === 'pending' || t.status === 'countered')
            .map((trade) => {
              const initiator = gameState.players.find(p => p.id === trade.initiatorId)?.name || 'Someone';
              const target = gameState.players.find(p => p.id === trade.targetId)?.name || 'Someone';

              return (
                <div 
                  key={trade.id} 
                  className="bg-[#212130] p-3 rounded-lg border border-blue-500/30 cursor-pointer hover:bg-[#2a2a3b] hover:border-blue-500 transition-colors"
                  onClick={() => setViewingTrade(trade)}
                >
                  <p className="text-xs text-gray-300 mb-2">
                    <span className="font-bold text-white">{initiator}</span> wants to trade with <span className="font-bold text-white">{target}</span>
                  </p>
                  <div className="text-xs bg-[#161622] p-2 rounded">
                    <span className="text-red-400">Offers:</span> ${trade.offer.money} <br/>
                    <span className="text-green-400">Requests:</span> ${trade.request.money}
                  </div>
                  <p className="text-[0.65rem] text-blue-400 mt-2 text-center underline decoration-blue-500/50 underline-offset-2">Click to view details</p>
                </div>
              );
          })}
          {Object.values(gameState.trades).filter(t => t.status === 'pending' || t.status === 'countered').length === 0 && (
            <p className="text-sm text-gray-500 italic">No active trades.</p>
          )}
        </div>

        <h2 className="text-xl font-bold mb-4 text-[#a3e635]">Activity Log</h2>
        <div className="flex-1 overflow-y-auto space-y-2 text-sm text-gray-400 pr-2">
          {[...gameState.logs].reverse().map((log, i) => (
            <div key={i} className="bg-[#212130] p-2 rounded">{log}</div>
          ))}
        </div>
      </div>

      {/* Main Board Area */}
      <div className="flex-1 flex items-center justify-center relative">
        {gameState.state === 'lobby' && (
          <div className="absolute inset-0 bg-black/80 z-50 flex flex-col items-center justify-center backdrop-blur-sm">
            <h1 className="text-4xl font-black mb-4">Room Code: <span className="text-[#a3e635]">{gameState.roomCode}</span></h1>
            <p className="text-xl text-gray-300 mb-8">Waiting for players to join...</p>
            
            <div className="flex flex-col gap-6 mb-8 w-full max-w-2xl">
              {gameState.players.map((p) => (
                <div key={p.id} className="flex flex-col gap-3 bg-[#212130] p-4 rounded-xl border-2" style={{ borderColor: p.color }}>
                  <div className="flex items-center gap-3">
                    <div className="w-5 h-5 rounded-full" style={{ backgroundColor: p.color }}></div>
                    <span className="font-bold text-xl">{p.name} {p.id === playerId ? '(You)' : ''}</span>
                  </div>
                  
                  {p.id === playerId && (
                    <div className="flex flex-wrap gap-2 mt-2">
                      <span className="text-sm text-gray-400 mr-2 flex items-center">Pick Color:</span>
                      {AVAILABLE_COLORS.map(c => (
                        <button 
                          key={c}
                          onClick={() => handleChangeColor(c)}
                          className={`w-8 h-8 rounded-full border-2 transition-transform hover:scale-110 ${p.color === c ? 'border-white scale-110' : 'border-transparent'}`}
                          style={{ backgroundColor: c }}
                        />
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>

            {gameState.players[0]?.id === playerId ? (
              <div className="bg-[#212130] p-4 rounded-xl border border-white/10 mt-4 text-center w-full max-w-2xl">
                <p className="text-gray-300 font-bold mb-3">Starting Cash</p>
                <div className="flex flex-wrap gap-2 justify-center mb-6">
                  {STARTING_CASH_OPTIONS.map(c => (
                    <button 
                      key={c}
                      onClick={() => handleUpdateStartingCash(c)}
                      className={`px-4 py-2 rounded-lg font-bold transition-all ${gameState.startingCash === c ? 'bg-green-600 text-white shadow-lg scale-105' : 'bg-[#161622] text-gray-400 hover:bg-gray-700'}`}
                    >
                      ${c}
                    </button>
                  ))}
                </div>
                <button 
                  onClick={handleStart}
                  className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed px-8 py-3 rounded-xl font-bold text-lg transition-colors shadow-[0_0_20px_rgba(79,70,229,0.4)] hover:shadow-[0_0_30px_rgba(79,70,229,0.6)] w-full"
                >
                  Start Game (Dev Mode)
                </button>
              </div>
            ) : (
              <div className="text-center mt-4 w-full max-w-2xl">
                <p className="text-gray-400">Starting cash: <span className="font-bold text-green-400">${gameState.startingCash}</span></p>
                <p className="text-gray-500 italic mt-2">Waiting for host to start...</p>
              </div>
            )}
          </div>
        )}
        
        {/* Action Slides */}
        {gameState.awaitingSabotage && isMyTurn && (
          <div className="fixed md:absolute inset-x-0 bottom-16 md:bottom-0 md:top-0 h-[60vh] md:h-auto md:w-80 bg-[#161622]/95 border-t md:border-t-0 md:border-r border-red-500 z-[60] flex flex-col shadow-[0_-20px_50px_rgba(220,38,38,0.2)] md:shadow-[20px_0_50px_rgba(220,38,38,0.2)] rounded-t-3xl md:rounded-none animate-in slide-in-from-bottom md:slide-in-from-left backdrop-blur-md">
            <div className="p-6 border-b border-white/10">
              <h2 className="text-2xl font-black text-red-500 tracking-widest uppercase">SABOTAGE!</h2>
              <p className="text-gray-400 text-sm mt-2">Select an opponent's property to destroy.</p>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {Object.values(gameState.properties).filter(p => p.ownerId && p.ownerId !== playerId && !p.protected).map(prop => {
                const sq = SQUARES[prop.id];
                const owner = gameState.players.find(pl => pl.id === prop.ownerId);
                return (
                  <button 
                    key={prop.id}
                    onClick={() => socket.emit('execute_sabotage', gameState.roomCode, prop.id)}
                    className="w-full text-left bg-[#212130] hover:bg-red-900/50 p-3 rounded-lg border border-white/5 hover:border-red-500/50 transition-all group"
                  >
                    <div className="flex items-center gap-3 mb-1">
                      {sq.color && <div className="w-3 h-3 rounded-full" style={{ backgroundColor: sq.color }}></div>}
                      <span className="font-bold">{sq.name}</span>
                    </div>
                    <div className="text-xs text-gray-400 flex justify-between">
                      <span>Owner: {owner?.name}</span>
                      <span>{prop.houses > 0 ? (prop.houses === 5 ? 'Hotel' : `${prop.houses} Houses`) : 'Base'}</span>
                    </div>
                  </button>
                );
              })}
              {Object.values(gameState.properties).filter(p => p.ownerId && p.ownerId !== playerId && !p.protected).length === 0 && (
                <div className="text-center p-4 text-gray-400">No valid targets! Wait for timeout.</div>
              )}
            </div>
          </div>
        )}
        {gameState.awaitingProtection && isMyTurn && (
          <div className="fixed md:absolute inset-x-0 bottom-16 md:bottom-0 md:top-0 h-[60vh] md:h-auto md:w-80 bg-[#161622]/95 border-t md:border-t-0 md:border-r border-cyan-500 z-[60] flex flex-col shadow-[0_-20px_50px_rgba(6,182,212,0.2)] md:shadow-[20px_0_50px_rgba(6,182,212,0.2)] rounded-t-3xl md:rounded-none animate-in slide-in-from-bottom md:slide-in-from-left backdrop-blur-md">
            <div className="p-6 border-b border-white/10">
              <h2 className="text-2xl font-black text-cyan-400 tracking-widest uppercase">PROTECT!</h2>
              <p className="text-gray-400 text-sm mt-2">Select one of your properties to shield.</p>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {Object.values(gameState.properties).filter(p => p.ownerId === playerId && !p.protected).map(prop => {
                const sq = SQUARES[prop.id];
                return (
                  <button 
                    key={prop.id}
                    onClick={() => socket.emit('execute_protection', gameState.roomCode, prop.id)}
                    className="w-full text-left bg-[#212130] hover:bg-cyan-900/50 p-3 rounded-lg border border-white/5 hover:border-cyan-500/50 transition-all group"
                  >
                    <div className="flex items-center gap-3 mb-1">
                      {sq.color && <div className="w-3 h-3 rounded-full" style={{ backgroundColor: sq.color }}></div>}
                      <span className="font-bold">{sq.name}</span>
                    </div>
                    <div className="text-xs text-gray-400">
                      {prop.houses > 0 ? (prop.houses === 5 ? 'Hotel' : `${prop.houses} Houses`) : 'Base'}
                    </div>
                  </button>
                );
              })}
              {Object.values(gameState.properties).filter(p => p.ownerId === playerId && !p.protected).length === 0 && (
                <div className="text-center p-4 text-gray-400">No valid targets! Wait for timeout.</div>
              )}
            </div>
          </div>
        )}
        
        {/* Board Area */}
        <div className="w-full h-[60vh] md:h-full relative overflow-hidden bg-[#0a0a0f]">
          <Board 
            gameState={gameState} 
            onSquareClick={handleSquareClick}
            onRollDice={isMyTurn && !gameState.hasRolled && gameState.state === 'playing' ? handleRollDice : undefined}
            timeLeft={isMyTurn && activeTab === 'board' ? timeLeft : null}
            centerContent={centerContent}
          />
          
          {/* Mobile Floating Action Drawer */}
          {gameState.state === 'playing' && isMyTurn && activeTab === 'board' && (
            <div className="md:hidden absolute bottom-4 left-4 right-4 bg-[#212130] rounded-xl border border-white/10 p-4 flex flex-col gap-3 shadow-[0_10px_40px_rgba(0,0,0,0.8)] z-[45]">
              <div className="flex items-center justify-between">
                <h3 className="font-bold text-gray-300">It's your turn!</h3>
                {timeLeft !== null && (
                  <div className="flex items-center gap-2 bg-black/40 px-3 py-1 rounded-lg">
                    <span className={`font-mono font-black ${timeLeft <= 5 ? 'text-red-500 animate-pulse' : 'text-green-400'}`}>
                      {Math.floor(timeLeft / 60)}:{(timeLeft % 60).toString().padStart(2, '0')}
                    </span>
                  </div>
                )}
              </div>
              
              {/* Timer only, Roll Dice button moved to center of board */}
            </div>
          )}
        </div>
      </div>

      {/* Mobile Bottom Navigation Bar */}
      <div className="md:hidden fixed bottom-0 left-0 right-0 h-16 bg-[#161622] border-t border-white/10 flex items-center justify-around z-[50]">
        <button onClick={() => setActiveTab('board')} className={`flex flex-col items-center justify-center w-full h-full ${activeTab === 'board' ? 'text-cyan-400' : 'text-gray-400'}`}>
          <span className="text-xl leading-none">🎲</span>
          <span className="text-[10px] font-bold mt-1 uppercase">Board</span>
        </button>
        <button onClick={() => setActiveTab('players')} className={`flex flex-col items-center justify-center w-full h-full ${activeTab === 'players' ? 'text-cyan-400' : 'text-gray-400'}`}>
          <span className="text-xl leading-none">👥</span>
          <span className="text-[10px] font-bold mt-1 uppercase">Players</span>
        </button>
        <button onClick={() => setIsTradeModalOpen(true)} className={`flex flex-col items-center justify-center w-full h-full text-gray-400`}>
          <span className="text-xl leading-none">🤝</span>
          <span className="text-[10px] font-bold mt-1 uppercase">Trade</span>
        </button>
      </div>

      {/* Right Sidebar - Players & Controls */}
      <div className={`w-full md:w-72 bg-[#161622] border-l border-white/5 flex-col p-4 overflow-y-auto ${activeTab === 'players' ? 'flex' : 'hidden md:flex'}`}>
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-bold">Players</h2>
          <button 
            onClick={() => {
              socket.emit('leave_game', gameState.roomCode);
              localStorage.removeItem('monopoly_room_code');
              window.location.reload();
            }}
            className="px-2 py-1 bg-red-900/50 hover:bg-red-600 text-red-200 hover:text-white rounded text-xs font-bold uppercase tracking-wider transition-colors border border-red-500/30"
          >
            Exit Game
          </button>
        </div>
        <div className="flex-1 space-y-4">
          {gameState.players.filter(p => p.status !== 'bankrupt').map((p) => (
            <div key={p.id} className={`p-4 rounded-xl border-2 transition-all ${gameState.players[gameState.turnIndex]?.id === p.id ? 'border-[#a3e635] bg-[#212130]' : 'border-transparent bg-[#1a1a2e]'}`}>
              <div className="flex justify-between items-center mb-2">
                <div className="flex items-center gap-2">
                  <div className="w-4 h-4 rounded-full shadow-lg" style={{ backgroundColor: p.color }}></div>
                  <span className="font-bold text-lg">{p.name} {p.id === playerId ? '(You)' : ''}</span>
                </div>
                <span className="text-green-400 font-mono font-bold">${p.money}</span>
              </div>
              <div className="text-xs text-gray-500">
                Position: {p.position}
              </div>
            </div>
          ))}

          {gameState.players.some(p => p.status === 'bankrupt') && (
            <div className="mt-6 border-t border-white/10 pt-4">
              <h3 className="text-sm font-bold text-gray-500 uppercase tracking-wider mb-3">Spectators</h3>
              <div className="space-y-2">
                {gameState.players.filter(p => p.status === 'bankrupt').map((p) => (
                  <div key={p.id} className="p-3 rounded-lg border border-gray-800 bg-[#1a1a2e] opacity-60 grayscale flex justify-between items-center">
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 rounded-full shadow-lg" style={{ backgroundColor: p.color }}></div>
                      <span className="font-bold text-sm text-gray-400">{p.name} {p.id === playerId ? '(You)' : ''}</span>
                    </div>
                    <span className="text-xs text-gray-500 font-bold uppercase">Watching</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Action Panel */}
        {gameState.state === 'playing' && (
          <div className="mt-4 p-4 bg-[#212130] rounded-xl border border-white/10 flex flex-col gap-4">
            <div>
              <h3 className="font-bold text-gray-300 mb-2 text-center">
                {isMyTurn ? "It's your turn!" : `Waiting for ${currentPlayer?.name}...`}
              </h3>

              {timeLeft !== null && gameState.state === 'playing' && (
                <div className="flex items-center justify-center gap-2 mb-3 bg-black/40 py-2 px-4 rounded-lg border border-white/5 mx-auto w-max">
                  <span className="text-gray-400 font-bold uppercase tracking-wider text-xs">Time Left:</span>
                  <span className={`text-lg font-mono font-black ${timeLeft <= 5 ? 'text-red-500 animate-pulse' : 'text-green-400'}`}>
                    {Math.floor(timeLeft / 60)}:{(timeLeft % 60).toString().padStart(2, '0')}
                  </span>
                </div>
              )}
            </div>

            {/* Roll Dice button moved to center of board */}

            <button onClick={handleOpenProposeTrade} className="bg-blue-600 hover:bg-blue-500 w-full py-3 rounded-lg font-bold transition-colors shadow-lg">
              Propose Trade
            </button>
          </div>
        )}
      </div>

      {/* Modals */}
      {isTradeModalOpen && (
        <TradeModal gameState={gameState} playerId={playerId} onClose={() => setIsTradeModalOpen(false)} 
          existingTrade={editingTrade} 
        />
      )}

      {viewingTrade && (
        <ViewTradeModal gameState={gameState} playerId={playerId} trade={viewingTrade}
          onClose={() => setViewingTrade(undefined)}
          onAccept={() => handleAcceptTrade(viewingTrade.id)}
          onReject={() => handleRejectTrade(viewingTrade.id)}
          onCounter={() => handleOpenCounterTrade(viewingTrade)}
        />
      )}
    </div>
  );
};

export default App;
