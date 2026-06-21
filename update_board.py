import re

content = """// Data for 56 blocks exactly as specified
export const SQUARES = [
  // Bottom (0 to 13) + corner 14
  { name: 'Start', fullName: 'Start', type: 'corner' }, // 0
  { name: 'SAL', fullName: 'Salvador', type: 'property', color: '#10B981', price: 60, flagCode: 'br' },
  { name: 'RIO', fullName: 'Rio', type: 'property', color: '#10B981', price: 60, flagCode: 'br' },
  { name: 'Money Tax', fullName: 'Money Tax', type: 'tax', price: 200 },
  { name: 'SAO', fullName: 'Sao Paulo', type: 'property', color: '#10B981', price: 80, flagCode: 'br' },
  { name: 'TLV', fullName: 'Tel Aviv', type: 'property', color: '#ADD8E6', price: 100, flagCode: 'il' },
  { name: 'Airport 1', fullName: 'Airport 1', type: 'railroad', price: 200 },
  { name: 'HFA', fullName: 'Haifa', type: 'property', color: '#ADD8E6', price: 100, flagCode: 'il' },
  { name: 'JRS', fullName: 'Jerusalem', type: 'property', color: '#ADD8E6', price: 120, flagCode: 'il' },
  { name: 'VEN', fullName: 'Venice', type: 'property', color: '#FFC0CB', price: 140, flagCode: 'it' },
  { name: 'Mine 1', fullName: 'Mine 1', type: 'utility', price: 400 },
  { name: 'MIL', fullName: 'Milan', type: 'property', color: '#FFC0CB', price: 140, flagCode: 'it' },
  { name: 'ROM', fullName: 'Rome', type: 'property', color: '#FFC0CB', price: 160, flagCode: 'it' },
  { name: 'Chance', fullName: 'Chance', type: 'chance' },
  { name: 'Jail', fullName: 'Jail', type: 'corner' }, // 14
  
  // Left Edge physically (15 to 27) + corner 28
  { name: 'MUM', fullName: 'Mumbai', type: 'property', color: '#FFA500', price: 180, flagCode: 'in' },
  { name: 'DEL', fullName: 'Delhi', type: 'property', color: '#FFA500', price: 180, flagCode: 'in' },
  { name: 'Chance', fullName: 'Chance', type: 'chance' },
  { name: 'BAN', fullName: 'Bangalore', type: 'property', color: '#FFA500', price: 200, flagCode: 'in' },
  { name: 'SYD', fullName: 'Sydney', type: 'property', color: '#FF0000', price: 220, flagCode: 'au' },
  { name: 'MEL', fullName: 'Melbourne', type: 'property', color: '#FF0000', price: 220, flagCode: 'au' },
  { name: 'Airport 2', fullName: 'Airport 2', type: 'railroad', price: 200 },
  { name: 'BRI', fullName: 'Brisbane', type: 'property', color: '#FF0000', price: 240, flagCode: 'au' },
  { name: 'CAP', fullName: 'Cape Town', type: 'property', color: '#FFFF00', price: 260, flagCode: 'za' },
  { name: 'Chest', fullName: 'Chest', type: 'chest' },
  { name: 'JHB', fullName: 'Johannesburg', type: 'property', color: '#FFFF00', price: 260, flagCode: 'za' },
  { name: 'DUR', fullName: 'Durban', type: 'property', color: '#FFFF00', price: 280, flagCode: 'za' },
  { name: 'Mine 2', fullName: 'Mine 2', type: 'utility', price: 400 },
  { name: 'Vacation', fullName: 'Vacation', type: 'corner' }, // 28
  
  // Top (29 to 41) + corner 42
  { name: 'FRA', fullName: 'Frankfurt', type: 'property', color: '#008000', price: 300, flagCode: 'de' },
  { name: 'MUN', fullName: 'Munich', type: 'property', color: '#008000', price: 300, flagCode: 'de' },
  { name: 'Risk', fullName: 'Risk', type: 'chance' },
  { name: 'BER', fullName: 'Berlin', type: 'property', color: '#008000', price: 320, flagCode: 'de' },
  { name: 'PAR', fullName: 'Paris', type: 'property', color: '#00008B', price: 350, flagCode: 'fr' },
  { name: 'Airport 3', fullName: 'Airport 3', type: 'railroad', price: 200 },
  { name: 'TOU', fullName: 'Toulouse', type: 'property', color: '#00008B', price: 350, flagCode: 'fr' },
  { name: 'LYO', fullName: 'Lyon', type: 'property', color: '#00008B', price: 400, flagCode: 'fr' },
  { name: 'Mine 3', fullName: 'Mine 3', type: 'utility', price: 400 },
  { name: 'SHA', fullName: 'Shanghai', type: 'property', color: '#800080', price: 420, flagCode: 'cn' },
  { name: 'BEI', fullName: 'Beijing', type: 'property', color: '#800080', price: 420, flagCode: 'cn' },
  { name: 'Property Tax', fullName: 'Property Tax', type: 'tax', price: 200 },
  { name: 'SHE', fullName: 'Shenzhen', type: 'property', color: '#800080', price: 450, flagCode: 'cn' },
  { name: 'Go to Jail', fullName: 'Go to Jail', type: 'corner' }, // 42
  
  // Right Edge physically (43 to 55)
  { name: 'TOK', fullName: 'Tokyo', type: 'property', color: '#008080', price: 480, flagCode: 'jp' },
  { name: 'OSA', fullName: 'Osaka', type: 'property', color: '#008080', price: 480, flagCode: 'jp' },
  { name: 'Airport 4', fullName: 'Airport 4', type: 'railroad', price: 200 },
  { name: 'KYO', fullName: 'Kyoto', type: 'property', color: '#008080', price: 500, flagCode: 'jp' },
  { name: 'Chance', fullName: 'Chance', type: 'chance' },
  { name: 'LON', fullName: 'London', type: 'property', color: '#800000', price: 520, flagCode: 'gb' },
  { name: 'MAN', fullName: 'Manchester', type: 'property', color: '#800000', price: 520, flagCode: 'gb' },
  { name: 'Mine 4', fullName: 'Mine 4', type: 'utility', price: 400 },
  { name: 'LIV', fullName: 'Liverpool', type: 'property', color: '#800000', price: 550, flagCode: 'gb' },
  { name: 'NYC', fullName: 'New York', type: 'property', color: '#FFD700', price: 600, flagCode: 'us' },
  { name: 'Risk', fullName: 'Risk', type: 'chance' },
  { name: 'SFO', fullName: 'San Francisco', type: 'property', color: '#FFD700', price: 600, flagCode: 'us' },
  { name: 'CHI', fullName: 'Chicago', type: 'property', color: '#FFD700', price: 650, flagCode: 'us' }
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
"""

with open('client/src/constants/boardData.ts', 'w', encoding='utf-8') as f:
    f.write(content)
