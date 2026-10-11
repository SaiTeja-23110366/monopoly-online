import type { PropertyState } from './types';

export interface BoardSquare {
  id: number;
  name: string;
  fullName: string;
  color?: string;
  flagCode?: string;
  housePrice?: number;
  type: 'property' | 'corner' | 'tax' | 'chance' | 'chest' | 'railroad' | 'utility';
  colorGroup?: string;
  price?: number;
  houseCost?: number;
  rent?: number[]; // [base, 1 house, 2 houses, 3 houses, 4 houses, hotel]
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
  { name: 'Start', fullName: 'Start', type: 'corner' },
  { name: 'SAL', fullName: 'Salvador', type: 'property', colorGroup: 'brown', price: 60, color: '#10B981', flagCode: 'br' },
  { name: 'RIO', fullName: 'Rio', type: 'property', colorGroup: 'brown', price: 60, color: '#10B981', flagCode: 'br' },
  { name: 'Money Tax', fullName: 'Money Tax', type: 'tax' },
  { name: 'SAO', fullName: 'Sao Paulo', type: 'property', colorGroup: 'brown', price: 80, color: '#10B981', flagCode: 'br' },
  { name: 'TLV', fullName: 'Tel Aviv', type: 'property', colorGroup: 'lightblue', price: 100, color: '#ADD8E6', flagCode: 'il' },
  { name: 'Airport 1', fullName: 'Airport 1', type: 'railroad', price: 200 },
  { name: 'HFA', fullName: 'Haifa', type: 'property', colorGroup: 'lightblue', price: 100, color: '#ADD8E6', flagCode: 'il' },
  { name: 'JRS', fullName: 'Jerusalem', type: 'property', colorGroup: 'lightblue', price: 120, color: '#ADD8E6', flagCode: 'il' },
  { name: 'VEN', fullName: 'Venice', type: 'property', colorGroup: 'pink', price: 140, color: '#FFC0CB', flagCode: 'it' },
  { name: 'Mine 1', fullName: 'Mine 1', type: 'utility', price: 150 },
  { name: 'MIL', fullName: 'Milan', type: 'property', colorGroup: 'pink', price: 140, color: '#FFC0CB', flagCode: 'it' },
  { name: 'ROM', fullName: 'Rome', type: 'property', colorGroup: 'pink', price: 160, color: '#FFC0CB', flagCode: 'it' },
  { name: 'Chance', fullName: 'Chance', type: 'chance' },
  { name: 'Jail', fullName: 'Jail', type: 'corner' },
  
  // Left
  { name: 'MUM', fullName: 'Mumbai', type: 'property', colorGroup: 'orange', price: 180, color: '#FFA500', flagCode: 'in' },
  { name: 'DEL', fullName: 'Delhi', type: 'property', colorGroup: 'orange', price: 180, color: '#FFA500', flagCode: 'in' },
  { name: 'Chance', fullName: 'Chance', type: 'chance' },
  { name: 'BAN', fullName: 'Bangalore', type: 'property', colorGroup: 'orange', price: 200, color: '#FFA500', flagCode: 'in' },
  { name: 'SYD', fullName: 'Sydney', type: 'property', colorGroup: 'red', price: 220, color: '#FF0000', flagCode: 'au' },
  { name: 'MEL', fullName: 'Melbourne', type: 'property', colorGroup: 'red', price: 220, color: '#FF0000', flagCode: 'au' },
  { name: 'Airport 2', fullName: 'Airport 2', type: 'railroad', price: 200 },
  { name: 'BRI', fullName: 'Brisbane', type: 'property', colorGroup: 'red', price: 240, color: '#FF0000', flagCode: 'au' },
  { name: 'CAP', fullName: 'Cape Town', type: 'property', colorGroup: 'yellow', price: 260, color: '#FFFF00', flagCode: 'za' },
  { name: 'Chest', fullName: 'Chest', type: 'chest' },
  { name: 'JHB', fullName: 'Johannesburg', type: 'property', colorGroup: 'yellow', price: 260, color: '#FFFF00', flagCode: 'za' },
  { name: 'DUR', fullName: 'Durban', type: 'property', colorGroup: 'yellow', price: 280, color: '#FFFF00', flagCode: 'za' },
  { name: 'Mine 2', fullName: 'Mine 2', type: 'utility', price: 150 },
  { name: 'Vacation', fullName: 'Vacation', type: 'corner' },
  
  // Top
  { name: 'FRA', fullName: 'Frankfurt', type: 'property', colorGroup: 'green', price: 300, color: '#008000', flagCode: 'de' },
  { name: 'MUN', fullName: 'Munich', type: 'property', colorGroup: 'green', price: 300, color: '#008000', flagCode: 'de' },
  { name: 'Risk', fullName: 'Risk', type: 'chance' },
  { name: 'BER', fullName: 'Berlin', type: 'property', colorGroup: 'green', price: 320, color: '#008000', flagCode: 'de' },
  { name: 'PAR', fullName: 'Paris', type: 'property', colorGroup: 'darkblue', price: 350, color: '#00008B', flagCode: 'fr' },
  { name: 'Airport 3', fullName: 'Airport 3', type: 'railroad', price: 200 },
  { name: 'TOU', fullName: 'Toulouse', type: 'property', colorGroup: 'darkblue', price: 350, color: '#00008B', flagCode: 'fr' },
  { name: 'LYO', fullName: 'Lyon', type: 'property', colorGroup: 'darkblue', price: 400, color: '#00008B', flagCode: 'fr' },
  { name: 'Mine 3', fullName: 'Mine 3', type: 'utility', price: 150 },
  { name: 'SHA', fullName: 'Shanghai', type: 'property', colorGroup: 'purple', price: 420, color: '#800080', flagCode: 'cn' },
  { name: 'BEI', fullName: 'Beijing', type: 'property', colorGroup: 'purple', price: 420, color: '#800080', flagCode: 'cn' },
  { name: 'Property Tax', fullName: 'Property Tax', type: 'tax' },
  { name: 'SHE', fullName: 'Shenzhen', type: 'property', colorGroup: 'purple', price: 450, color: '#800080', flagCode: 'cn' },
  { name: 'Go to Jail', fullName: 'Go to Jail', type: 'corner' },
  
  // Right
  { name: 'TOK', fullName: 'Tokyo', type: 'property', colorGroup: 'teal', price: 480, color: '#008080', flagCode: 'jp' },
  { name: 'OSA', fullName: 'Osaka', type: 'property', colorGroup: 'teal', price: 480, color: '#008080', flagCode: 'jp' },
  { name: 'Airport 4', fullName: 'Airport 4', type: 'railroad', price: 200 },
  { name: 'KYO', fullName: 'Kyoto', type: 'property', colorGroup: 'teal', price: 500, color: '#008080', flagCode: 'jp' },
  { name: 'Chance', fullName: 'Chance', type: 'chance' },
  { name: 'LON', fullName: 'London', type: 'property', colorGroup: 'maroon', price: 520, color: '#800000', flagCode: 'gb' },
  { name: 'MAN', fullName: 'Manchester', type: 'property', colorGroup: 'maroon', price: 520, color: '#800000', flagCode: 'gb' },
  { name: 'Mine 4', fullName: 'Mine 4', type: 'utility', price: 150 },
  { name: 'LIV', fullName: 'Liverpool', type: 'property', colorGroup: 'maroon', price: 550, color: '#800000', flagCode: 'gb' },
  { name: 'NYC', fullName: 'New York', type: 'property', colorGroup: 'gold', price: 600, color: '#FFD700', flagCode: 'us' },
  { name: 'Risk', fullName: 'Risk', type: 'chance' },
  { name: 'SFO', fullName: 'San Francisco', type: 'property', colorGroup: 'gold', price: 600, color: '#FFD700', flagCode: 'us' },
  { name: 'CHI', fullName: 'Chicago', type: 'property', colorGroup: 'gold', price: 650, color: '#FFD700', flagCode: 'us' }
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
    result.housePrice = houseCost;
    result.rent = generateRent(sq.price, houseCost);
  } else if (sq.type === 'railroad' || sq.type === 'utility') {
    result.rent = [20, 75, 200, 300];
  }
  
  return result;
});

/** Custom 56-square rules. This catalog is the only economics source for both clients and the server. */
export const RULES = Object.freeze({ version: 3, boardSize: 56, passingStart: 200, landingStart: 300,
  mineBonuses: [0, 25, 60, 100, 150] as readonly number[], jailIndex: 14, vacationIndex: 28,
  jailFine: 200, jailFailedAttempts: 3, liquidationRate: 0.75, minPlayers: 2, maxPlayers: 8,
  minStartingCash: 500, maxStartingCash: 10000, moneyTaxRate: 0.1, propertyTaxRate: 0.05,
  initialHouseLimit: 2, maxHouses: 4, hotelLevel: 5, hotelRequiresFullGroup: true,
  fullSetBaseRentMultiplier: 2, hotelRentRequiresFullGroup: true,
  flightChanceLimit: 1, flightChanceRefresh: 1, flightsCollectStartIncome: false,
  flightTicketBase: 400, flightTicketFinalAirport: 700 });
/** Persisted games keep their original economics rather than changing mid-match. */
const LEGACY_RULES = Object.freeze({ ...RULES, version: 2, passingStart: 750, landingStart: 1000,
  fullSetBaseRentMultiplier: 1, hotelRentRequiresFullGroup: false,
  mineBonuses: [0, 200, 500, 1000, 2000] as readonly number[] });
export function rulesForGame(game: { rulesVersion?: 2 | 3 }) {
  return game.rulesVersion === 3 ? RULES : LEGACY_RULES;
}
export function ownsColorGroup(properties: Record<number, PropertyState>, index: number, ownerId: string | null): boolean {
  const group = BOARD_DATA[index]?.colorGroup;
  return !!ownerId && !!group && BOARD_DATA.filter(square => square.colorGroup === group)
    .every(square => properties[square.id]?.ownerId === ownerId);
}
export function hotelActive(properties: Record<number, PropertyState>, index: number, rulesVersion?: 2 | 3): boolean {
  const property = properties[index];
  return !!property?.ownerId && !property.mortgaged && property.houses === RULES.hotelLevel &&
    (!rulesForGame({ rulesVersion }).hotelRentRequiresFullGroup || ownsColorGroup(properties, index, property.ownerId));
}
/** The same ownership-sensitive quote is used by the server and every client. */
export function propertyRent(properties: Record<number, PropertyState>, index: number, rulesVersion?: 2 | 3): number {
  const square = BOARD_DATA[index], property = properties[index];
  if (!square || !property?.ownerId || property.mortgaged) return 0;
  if (square.type !== 'property') {
    const count = Object.values(properties).filter(other => other.ownerId === property.ownerId &&
      !other.mortgaged && BOARD_DATA[other.id]?.type === square.type).length;
    return square.rent?.[Math.max(0, count - 1)] ?? 0;
  }
  const rules = rulesForGame({ rulesVersion }), wholeGroup = ownsColorGroup(properties, index, property.ownerId);
  const level = property.houses === RULES.hotelLevel && rules.hotelRentRequiresFullGroup && !wholeGroup ? RULES.maxHouses : property.houses;
  const rent = square.rent?.[level] ?? 0;
  return level === 0 && wholeGroup ? rent * rules.fullSetBaseRentMultiplier : rent;
}
export const AIRPORTS = [6, 21, 34, 45] as const;
export function flightDestinations(airportId: number): number[] {
  const index = AIRPORTS.findIndex(id => id === airportId);
  if (index < 0) return [];
  const next = AIRPORTS[(index + 1) % AIRPORTS.length];
  const result: number[] = [];
  for (let id = (airportId + 1) % RULES.boardSize; id !== next; id = (id + 1) % RULES.boardSize) {
    result.push(id);
  }
  return result;
}
export function flightTicket(airportId: number): number { return airportId === 45 ? RULES.flightTicketFinalAirport : RULES.flightTicketBase; }
export function propertyValue(id: number, houses = 0): number {
  const square = BOARD_DATA[id];
  return (square?.price ?? 0) + houses * (square?.houseCost ?? 0);
}
export function liquidationValue(id: number, houses = 0): number {
  return Math.floor(propertyValue(id, houses) * RULES.liquidationRate);
}
export const SQUARES = BOARD_DATA;

export const PLAYER_COLORS = ['#ef4444', '#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#06b6d4', '#f97316'] as const;
