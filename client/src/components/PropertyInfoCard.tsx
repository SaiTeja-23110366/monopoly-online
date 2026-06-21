import React from 'react';
import { Home, Building2, X } from 'lucide-react';

interface PropertyInfoCardProps {
  square: any; // From SQUARES
  onClose: () => void;
}

export const PropertyInfoCard: React.FC<PropertyInfoCardProps> = ({ square, onClose }) => {
  if (!square.price && square.type !== 'property' && square.type !== 'railroad' && square.type !== 'utility') {
    return (
      <div className="bg-[#1b1b29] border border-white/10 p-6 md:p-8 rounded-2xl w-[90vw] md:w-full max-w-sm shadow-[0_20px_60px_rgba(0,0,0,0.8)] text-center pointer-events-auto relative animate-in zoom-in-95 duration-200">
        <button onClick={onClose} className="absolute top-4 right-4 text-gray-400 hover:text-white transition-colors">
          <X size={24} />
        </button>
        <h2 className="text-3xl font-black mb-2 text-white tracking-widest uppercase">{square.name}</h2>
        <p className="text-gray-400 text-lg">{square.type.toUpperCase()}</p>
      </div>
    );
  }

  const isProperty = square.type === 'property';
  const isRailroad = square.type === 'railroad';
  const isUtility = square.type === 'utility';

  return (
    <div className="bg-[#1e1a29] border border-white/10 p-6 rounded-2xl w-[90vw] md:w-full max-w-sm shadow-[0_30px_60px_rgba(0,0,0,0.9)] pointer-events-auto relative animate-in zoom-in-95 duration-200 flex flex-col">
      <button onClick={onClose} className="absolute top-4 right-4 text-gray-400 hover:text-white transition-colors z-10">
        <X size={24} />
      </button>

      <div className="text-center mb-6 relative">
        <h2 className="text-3xl font-black text-white tracking-wider">{square.name}</h2>
        {square.color && (
          <div 
            className="w-16 h-2 mx-auto mt-3 rounded-full opacity-80 shadow-[0_0_10px_currentColor]" 
            style={{ backgroundColor: square.color, color: square.color }}
          ></div>
        )}
      </div>

      <div className="flex-1 px-4">
        <div className="flex justify-between items-end border-b border-white/10 pb-2 mb-4">
          <span className="text-gray-400 text-sm tracking-wide">when</span>
          <span className="text-gray-400 text-sm tracking-wide">get</span>
        </div>

        <div className="flex flex-col gap-3">
          {isProperty && square.rent && (
            <>
              <div className="flex justify-between items-center text-gray-200">
                <span>with rent</span>
                <span className="font-medium text-lg"><span className="text-gray-500 mr-1">$</span>{square.rent[0]}</span>
              </div>
              <div className="flex justify-between items-center text-gray-200">
                <span>with one house</span>
                <span className="font-medium text-lg"><span className="text-gray-500 mr-1">$</span>{square.rent[1]}</span>
              </div>
              <div className="flex justify-between items-center text-gray-200">
                <span>with two houses</span>
                <span className="font-medium text-lg"><span className="text-gray-500 mr-1">$</span>{square.rent[2]}</span>
              </div>
              <div className="flex justify-between items-center text-gray-200">
                <span>with three houses</span>
                <span className="font-medium text-lg"><span className="text-gray-500 mr-1">$</span>{square.rent[3]}</span>
              </div>
              <div className="flex justify-between items-center text-gray-200">
                <span>with four houses</span>
                <span className="font-medium text-lg"><span className="text-gray-500 mr-1">$</span>{square.rent[4]}</span>
              </div>
              <div className="flex justify-between items-center text-gray-200">
                <span>with a hotel</span>
                <span className="font-medium text-lg"><span className="text-gray-500 mr-1">$</span>{square.rent[5]}</span>
              </div>
            </>
          )}

          {isRailroad && square.rent && (
            <>
              <div className="flex justify-between items-center text-gray-200">
                <span>with 1 airport</span>
                <span className="font-medium text-lg"><span className="text-gray-500 mr-1">$</span>{square.rent[0]}</span>
              </div>
              <div className="flex justify-between items-center text-gray-200">
                <span>with 2 airports</span>
                <span className="font-medium text-lg"><span className="text-gray-500 mr-1">$</span>{square.rent[1]}</span>
              </div>
              <div className="flex justify-between items-center text-gray-200">
                <span>with 3 airports</span>
                <span className="font-medium text-lg"><span className="text-gray-500 mr-1">$</span>{square.rent[2]}</span>
              </div>
              <div className="flex justify-between items-center text-gray-200">
                <span>with 4 airports</span>
                <span className="font-medium text-lg"><span className="text-gray-500 mr-1">$</span>{square.rent[3]}</span>
              </div>
            </>
          )}

          {isUtility && square.rent && (
            <>
              <div className="flex justify-between items-center text-gray-200">
                <span>with 1 mine</span>
                <span className="font-medium text-lg"><span className="text-gray-500 mr-1">$</span>{square.rent[0]}</span>
              </div>
              <div className="flex justify-between items-center text-gray-200">
                <span>with 2 mines</span>
                <span className="font-medium text-lg"><span className="text-gray-500 mr-1">$</span>{square.rent[1]}</span>
              </div>
              <div className="flex justify-between items-center text-gray-200">
                <span>with 3 mines</span>
                <span className="font-medium text-lg"><span className="text-gray-500 mr-1">$</span>{square.rent[2]}</span>
              </div>
              <div className="flex justify-between items-center text-gray-200">
                <span>with 4 mines</span>
                <span className="font-medium text-lg"><span className="text-gray-500 mr-1">$</span>{square.rent[3]}</span>
              </div>

              <div className="mt-4 border-t border-white/10 pt-4">
                <div className="flex justify-between items-end pb-2 mb-2">
                  <span className="text-emerald-400 text-sm tracking-wide font-bold uppercase">Pass Go Bonus</span>
                </div>
                <div className="flex flex-col gap-3">
                  <div className="flex justify-between items-center text-emerald-100">
                    <span>with 1 mine</span>
                    <span className="font-bold text-lg"><span className="text-emerald-600 mr-1">$</span>200</span>
                  </div>
                  <div className="flex justify-between items-center text-emerald-100">
                    <span>with 2 mines</span>
                    <span className="font-bold text-lg"><span className="text-emerald-600 mr-1">$</span>500</span>
                  </div>
                  <div className="flex justify-between items-center text-emerald-100">
                    <span>with 3 mines</span>
                    <span className="font-bold text-lg"><span className="text-emerald-600 mr-1">$</span>1000</span>
                  </div>
                  <div className="flex justify-between items-center text-emerald-100">
                    <span>with 4 mines</span>
                    <span className="font-bold text-lg"><span className="text-emerald-600 mr-1">$</span>2000</span>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {square.price && (
        <div className="mt-8 pt-4 border-t border-white/10 flex justify-between px-4 pb-2">
          <div className="flex flex-col items-center">
            <span className="text-gray-400 text-sm mb-1">Price</span>
            <span className="text-white font-bold text-xl"><span className="text-gray-500 mr-1 text-base">$</span>{square.price}</span>
          </div>
          
          {isProperty && square.housePrice && (
            <>
              <div className="flex flex-col items-center">
                <Home size={16} className="text-gray-400 mb-1" />
                <span className="text-white font-bold text-xl"><span className="text-gray-500 mr-1 text-base">$</span>{square.housePrice}</span>
              </div>
              <div className="flex flex-col items-center">
                <Building2 size={16} className="text-gray-400 mb-1" />
                <span className="text-white font-bold text-xl"><span className="text-gray-500 mr-1 text-base">$</span>{square.housePrice}</span>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
};
