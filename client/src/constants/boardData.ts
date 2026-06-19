// Data for 56 blocks exactly as specified
export const SQUARES = [
  // Bottom (0 to 13) + corner 14
  { name: 'Start', type: 'corner' }, // 0
  { name: 'P1', type: 'property', color: '#10B981', price: 60 },
  { name: 'P2', type: 'property', color: '#10B981', price: 60 },
  { name: 'Money Tax', type: 'tax', price: 200 },
  { name: 'P3', type: 'property', color: '#10B981', price: 80 },
  { name: 'P4', type: 'property', color: '#ADD8E6', price: 100 },
  { name: 'Airport 1', type: 'railroad', price: 200 },
  { name: 'P5', type: 'property', color: '#ADD8E6', price: 100 },
  { name: 'P6', type: 'property', color: '#ADD8E6', price: 120 },
  { name: 'P7', type: 'property', color: '#FFC0CB', price: 140 },
  { name: 'Mine 1', type: 'utility', price: 150 },
  { name: 'P8', type: 'property', color: '#FFC0CB', price: 140 },
  { name: 'P9', type: 'property', color: '#FFC0CB', price: 160 },
  { name: 'Chance', type: 'chance' },
  { name: 'Jail', type: 'corner' }, // 14
  
  // Left Edge physically (15 to 27) + corner 28
  { name: 'P10', type: 'property', color: '#FFA500', price: 180 },
  { name: 'P11', type: 'property', color: '#FFA500', price: 180 },
  { name: 'Chance', type: 'chance' },
  { name: 'P12', type: 'property', color: '#FFA500', price: 200 },
  { name: 'P13', type: 'property', color: '#FF0000', price: 220 },
  { name: 'P14', type: 'property', color: '#FF0000', price: 220 },
  { name: 'Airport 2', type: 'railroad', price: 200 },
  { name: 'P15', type: 'property', color: '#FF0000', price: 240 },
  { name: 'P16', type: 'property', color: '#FFFF00', price: 260 },
  { name: 'Chest', type: 'chest' },
  { name: 'P17', type: 'property', color: '#FFFF00', price: 260 },
  { name: 'P18', type: 'property', color: '#FFFF00', price: 280 },
  { name: 'Mine 2', type: 'utility', price: 150 },
  { name: 'Vacation', type: 'corner' }, // 28
  
  // Top (29 to 41) + corner 42
  { name: 'P19', type: 'property', color: '#008000', price: 300 },
  { name: 'P20', type: 'property', color: '#008000', price: 300 },
  { name: 'Risk', type: 'chance' },
  { name: 'P21', type: 'property', color: '#008000', price: 320 },
  { name: 'P22', type: 'property', color: '#00008B', price: 350 },
  { name: 'Airport 3', type: 'railroad', price: 200 },
  { name: 'P23', type: 'property', color: '#00008B', price: 350 },
  { name: 'P24', type: 'property', color: '#00008B', price: 400 },
  { name: 'Mine 3', type: 'utility', price: 150 },
  { name: 'P25', type: 'property', color: '#800080', price: 420 },
  { name: 'P26', type: 'property', color: '#800080', price: 420 },
  { name: 'Property Tax', type: 'tax', price: 200 },
  { name: 'P27', type: 'property', color: '#800080', price: 450 },
  { name: 'Go to Jail', type: 'corner' }, // 42
  
  // Right Edge physically (43 to 55)
  { name: 'P28', type: 'property', color: '#008080', price: 480 },
  { name: 'P29', type: 'property', color: '#008080', price: 480 },
  { name: 'Airport 4', type: 'railroad', price: 200 },
  { name: 'P30', type: 'property', color: '#008080', price: 500 },
  { name: 'Chance', type: 'chance' },
  { name: 'P31', type: 'property', color: '#800000', price: 520 },
  { name: 'P32', type: 'property', color: '#800000', price: 520 },
  { name: 'Mine 4', type: 'utility', price: 150 },
  { name: 'P33', type: 'property', color: '#800000', price: 550 },
  { name: 'P34', type: 'property', color: '#FFD700', price: 600 },
  { name: 'Risk', type: 'chance' },
  { name: 'P35', type: 'property', color: '#FFD700', price: 600 },
  { name: 'P36', type: 'property', color: '#FFD700', price: 650 }
].map((sq, i) => {
  if (sq.type === 'railroad' || sq.type === 'utility') return { ...sq, id: i, rent: [20, 75, 200, 300] };
  if (sq.type !== 'property' || !sq.price) return { ...sq, id: i };

  // Determine House Price based on property price tiers
  let housePrice = 50;
  if (sq.price > 120 && sq.price <= 240) housePrice = 100;
  else if (sq.price > 240 && sq.price <= 360) housePrice = 150;
  else if (sq.price > 360) housePrice = 200;

  // Calculate approximate rent tiers
  const baseRent = Math.max(2, Math.ceil((sq.price * 0.1) / 2) * 2);
  const rent = [
    baseRent,
    Math.floor(baseRent * 2 + (housePrice * 0.2)),
    Math.floor(baseRent * 3 + (housePrice * 0.5)),
    Math.floor(baseRent * 5 + (housePrice * 1.0)),
    Math.floor(baseRent * 10 + (housePrice * 2.0)),
    Math.floor(baseRent * 25 + (housePrice * 4.0))
  ];

  return { ...sq, id: i, housePrice, rent };
});
