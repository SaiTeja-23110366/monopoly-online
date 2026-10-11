import test from 'node:test';
import assert from 'node:assert/strict';
import { gridCell, squareAnchor, tokenOffset, TRACKS, TRACK_TOTAL } from '../src/lib/geometry.ts';
test('56 squares occupy unique perimeter cells, with correctly weighted corners', () => {
  assert.equal(TRACKS.reduce((a,b)=>a+b,0), TRACK_TOTAL);
  const cells = Array.from({length:56},(_,i)=>gridCell(i));
  assert.equal(new Set(cells.map(c=>`${c.column}:${c.row}`)).size,56);
  cells.forEach(c=>assert.ok(c.column===0 || c.column===14 || c.row===0 || c.row===14));
  assert.deepEqual(gridCell(0),{column:14,row:14});
  assert.deepEqual(gridCell(14),{column:0,row:14});
  assert.deepEqual(gridCell(28),{column:0,row:0});
  assert.deepEqual(gridCell(42),{column:14,row:0});
  assert.ok(Math.abs(squareAnchor(0).x - (15.4/16.2)) < 0.00001);
});
test('all adjacent perimeter positions connect without cutting through the board',()=>{
  for(let i=0;i<56;i++) {
    const a=gridCell(i), b=gridCell((i+1)%56);
    assert.equal(Math.abs(a.column-b.column)+Math.abs(a.row-b.row),1);
  }
});
test('stable token slots do not depend on co-occupant count',()=>{
  assert.deepEqual(tokenOffset(2),tokenOffset(2));
  assert.notDeepEqual(tokenOffset(1),tokenOffset(2));
  assert.throws(()=>gridCell(56),RangeError);
  assert.throws(()=>gridCell(-1),RangeError);
});
