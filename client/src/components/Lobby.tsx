import React, { useState } from 'react';
import { socket } from '../socket';

interface LobbyProps {
  onJoin: (roomCode: string, name: string) => void;
}

export const Lobby: React.FC<LobbyProps> = ({ onJoin }) => {
  const [name, setName] = useState('');
  const [roomCode, setRoomCode] = useState('');
  const [isCreating, setIsCreating] = useState(true);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    if (isCreating) {
      socket.emit('create_room', (response: { roomCode: string }) => {
        onJoin(response.roomCode, name);
      });
    } else {
      if (!roomCode.trim()) return;
      onJoin(roomCode.toUpperCase(), name);
    }
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-[#0a0a0f] text-white p-4">
      <div className="bg-[#161622] border border-white/10 p-8 rounded-2xl shadow-2xl w-full max-w-md">
        <h1 className="text-4xl font-black mb-8 text-center tracking-widest text-[#a3e635] drop-shadow-[0_0_10px_rgba(163,230,53,0.5)]">
          MONOPOLY
        </h1>

        <div className="flex gap-4 mb-8">
          <button
            className={`flex-1 py-2 rounded-lg font-bold transition-colors ${isCreating ? 'bg-indigo-600 text-white' : 'bg-[#212130] text-gray-400'}`}
            onClick={() => setIsCreating(true)}
          >
            Create Game
          </button>
          <button
            className={`flex-1 py-2 rounded-lg font-bold transition-colors ${!isCreating ? 'bg-indigo-600 text-white' : 'bg-[#212130] text-gray-400'}`}
            onClick={() => setIsCreating(false)}
          >
            Join Game
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div>
            <label className="block text-sm font-semibold text-gray-400 mb-1">Your Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full bg-[#212130] border border-white/10 rounded-lg p-3 text-white focus:outline-none focus:border-indigo-500"
              placeholder="Enter your name..."
              required
            />
          </div>

          {!isCreating && (
            <div>
              <label className="block text-sm font-semibold text-gray-400 mb-1">Room Code</label>
              <input
                type="text"
                value={roomCode}
                onChange={(e) => setRoomCode(e.target.value)}
                className="w-full bg-[#212130] border border-white/10 rounded-lg p-3 text-white font-mono uppercase focus:outline-none focus:border-indigo-500"
                placeholder="6-character code"
                maxLength={6}
                required
              />
            </div>
          )}

          <button
            type="submit"
            className="w-full bg-[#4ade80] hover:bg-[#22c55e] text-black font-black text-lg py-3 rounded-lg mt-4 transition-colors shadow-[0_0_15px_rgba(74,222,128,0.3)]"
          >
            {isCreating ? 'CREATE & JOIN' : 'JOIN GAME'}
          </button>
        </form>
      </div>
    </div>
  );
};
