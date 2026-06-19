export interface BoardSquare {
  id: number;
  name: string;
  type: 'property' | 'corner' | 'tax' | 'chance' | 'chest' | 'railroad' | 'utility';
  colorGroup?: string;
  price?: number;
  houseCost?: number;
  rent?: number[]; // [base, 1 house, 2 houses, 3 houses, 4 houses, 5 houses, hotel]
}

// Helper to generate generic rents based on price
function generateRent(price: number, houseCost: number): number[] {
  const baseRent = Math.max(2, Math.ceil((price * 0.1) / 2) * 2);
  return [
    baseRent,
    Math.floor(baseRent * 2 + (houseCost * 0.2)),
    Math.floor(baseRent * 3 + (houseCost * 0.5)),
    Math.floor(baseRent * 5 + (houseCost * 1.0)),
    Math.floor(baseRent * 10 + (houseCost * 2.0)),
    Math.floor(baseRent * 25 + (houseCost * 4.0))
  ];
}

const rawSquares: Omit<BoardSquare, 'id' | 'rent' | 'houseCost'>[] = [
  // Bottom
  { name: 'Start', type: 'corner' },
  { name: 'P1', type: 'property', colorGroup: 'brown', price: 60 },
  { name: 'P2', type: 'property', colorGroup: 'brown', price: 60 },
  { name: 'Money Tax', type: 'tax', price: 200 },
  { name: 'P3', type: 'property', colorGroup: 'brown', price: 80 },
  { name: 'P4', type: 'property', colorGroup: 'lightblue', price: 100 },
  { name: 'Airport 1', type: 'railroad', price: 200 },
  { name: 'P5', type: 'property', colorGroup: 'lightblue', price: 100 },
  { name: 'P6', type: 'property', colorGroup: 'lightblue', price: 120 },
  { name: 'P7', type: 'property', colorGroup: 'pink', price: 140 },
  { name: 'Mine 1', type: 'utility', price: 150 },
  { name: 'P8', type: 'property', colorGroup: 'pink', price: 140 },
  { name: 'P9', type: 'property', colorGroup: 'pink', price: 160 },
  { name: 'Chance', type: 'chance' },
  { name: 'Jail', type: 'corner' },
  
  // Left
  { name: 'P10', type: 'property', colorGroup: 'orange', price: 180 },
  { name: 'P11', type: 'property', colorGroup: 'orange', price: 180 },
  { name: 'Chance', type: 'chance' },
  { name: 'P12', type: 'property', colorGroup: 'orange', price: 200 },
  { name: 'P13', type: 'property', colorGroup: 'red', price: 220 },
  { name: 'P14', type: 'property', colorGroup: 'red', price: 220 },
  { name: 'Airport 2', type: 'railroad', price: 200 },
  { name: 'P15', type: 'property', colorGroup: 'red', price: 240 },
  { name: 'P16', type: 'property', colorGroup: 'yellow', price: 260 },
  { name: 'Chest', type: 'chest' },
  { name: 'P17', type: 'property', colorGroup: 'yellow', price: 260 },
  { name: 'P18', type: 'property', colorGroup: 'yellow', price: 280 },
  { name: 'Mine 2', type: 'utility', price: 150 },
  { name: 'Vacation', type: 'corner' },
  
  // Top
  { name: 'P19', type: 'property', colorGroup: 'green', price: 300 },
  { name: 'P20', type: 'property', colorGroup: 'green', price: 300 },
  { name: 'Risk', type: 'chance' },
  { name: 'P21', type: 'property', colorGroup: 'green', price: 320 },
  { name: 'P22', type: 'property', colorGroup: 'darkblue', price: 350 },
  { name: 'Airport 3', type: 'railroad', price: 200 },
  { name: 'P23', type: 'property', colorGroup: 'darkblue', price: 350 },
  { name: 'P24', type: 'property', colorGroup: 'darkblue', price: 400 },
  { name: 'Mine 3', type: 'utility', price: 150 },
  { name: 'P25', type: 'property', colorGroup: 'purple', price: 420 },
  { name: 'P26', type: 'property', colorGroup: 'purple', price: 420 },
  { name: 'Property Tax', type: 'tax', price: 200 },
  { name: 'P27', type: 'property', colorGroup: 'purple', price: 450 },
  { name: 'Go to Jail', type: 'corner' },
  
  // Right
  { name: 'P28', type: 'property', colorGroup: 'teal', price: 480 },
  { name: 'P29', type: 'property', colorGroup: 'teal', price: 480 },
  { name: 'Airport 4', type: 'railroad', price: 200 },
  { name: 'P30', type: 'property', colorGroup: 'teal', price: 500 },
  { name: 'Chance', type: 'chance' },
  { name: 'P31', type: 'property', colorGroup: 'maroon', price: 520 },
  { name: 'P32', type: 'property', colorGroup: 'maroon', price: 520 },
  { name: 'Mine 4', type: 'utility', price: 150 },
  { name: 'P33', type: 'property', colorGroup: 'maroon', price: 550 },
  { name: 'P34', type: 'property', colorGroup: 'gold', price: 600 },
  { name: 'Risk', type: 'chance' },
  { name: 'P35', type: 'property', colorGroup: 'gold', price: 600 },
  { name: 'P36', type: 'property', colorGroup: 'gold', price: 650 }
];

export const BOARD_DATA: BoardSquare[] = rawSquares.map((sq, index) => {
  const result: BoardSquare = {
    ...sq,
    id: index,
  };
  
  if (sq.type === 'property' && sq.price) {
    let houseCost = 50;
    if (sq.price < 150) houseCost = 50;
    else if (sq.price < 300) houseCost = 100;
    else if (sq.price < 450) houseCost = 150;
    else if (sq.price < 550) houseCost = 200;
    else houseCost = 250;
    
    result.houseCost = houseCost;
    result.rent = generateRent(sq.price, houseCost);
  } else if (sq.type === 'railroad' || sq.type === 'utility') {
    result.rent = [20, 75, 200, 300];
  }
  
  return result;
});
