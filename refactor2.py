with open('client/src/App.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

assign_str = """
  if (isAwaitingBuy && isMyTurn && buySquare && propState) {
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
"""

content = content.replace('  let centerContent: React.ReactNode = null;', '  let centerContent: React.ReactNode = null;' + assign_str)

content = content.replace(
    "onRollDice={isMyTurn && !gameState.hasRolled && gameState.state === 'playing' ? handleRollDice : undefined}\n            timeLeft={isMyTurn && activeTab === 'board' ? timeLeft : null}\n          />",
    "onRollDice={isMyTurn && !gameState.hasRolled && gameState.state === 'playing' ? handleRollDice : undefined}\n            timeLeft={isMyTurn && activeTab === 'board' ? timeLeft : null}\n            centerContent={centerContent}\n          />"
)

import re

# Remove the old JSX blocks using generic parsing to avoid regex misses
# For isAwaitingBuy
idx1 = content.find('{/* Property Modal (Buy or Upgrade) */}')
idx2 = content.find('{/* Debt Resolution Slide */}', idx1)
if idx1 != -1 and idx2 != -1:
    content = content[:idx1] + content[idx2:]

# For isAwaitingFlight
idx3 = content.find('{/* Flight Terminal Modal */}')
idx4 = content.find('{/* Card logic is now handled in Board.tsx center area */}', idx3)
if idx3 != -1 and idx4 != -1:
    content = content[:idx3] + content[idx4:]

# For isJailDecision
idx5 = content.find('{/* Jail Decision Modal */}')
idx6 = content.find('{/* Bankrupt Overlay */}', idx5)
if idx5 != -1 and idx6 != -1:
    content = content[:idx5] + content[idx6:]

with open('client/src/App.tsx', 'w', encoding='utf-8') as f:
    f.write(content)
