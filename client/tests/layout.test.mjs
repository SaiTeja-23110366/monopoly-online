import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import postcss from 'postcss';
import { gridCell, squareAnchor, TRACKS, TRACK_TOTAL } from '../src/lib/geometry.ts';

const css = postcss.parse(readFileSync(new URL('../src/App.css', import.meta.url), 'utf8'));
function declarations(selector, media = null) {
  const result = {};
  css.walkRules(selector, rule => {
    const context = rule.parent.type === 'atrule' ? rule.parent.params : null;
    if (context === media) rule.walkDecls(declaration => { result[declaration.prop] = declaration.value; });
  });
  return result;
}

// Source-level CSS and geometry contracts, not browser pixel/layout assertions.
test('desktop board gets a readable floor and bounded enlargement instead of the old height squeeze', () => {
  const frame = declarations('.game-layout');
  assert.equal(frame.width, 'min(100% - 48px, 1440px)');
  assert.equal(frame['grid-template-columns'], 'minmax(0,1fr) 330px');
  assert.equal(frame.gap, '23px 26px');
  const cap = declarations('.game-layout', '(min-width: 1050px)')['max-width'];
  assert.equal(cap, 'calc(clamp(760px,100dvh - 160px,1080px) + 356px)');
  assert.equal(frame.overflow, undefined);

  // Evaluate that declared desktop size contract at representative CSS viewports.
  for (const [width, height, expectedBoard] of [
    [1280, 800, 760], [1536, 864, 760], [1856, 968, 808],
    [1920, 1080, 920], [1920, 1200, 1040], [2560, 1440, 1080],
    [2560, 600, 760],
  ]) {
    const frameWidth = Math.min(width - 48, 1440, Math.min(1080, Math.max(760, height - 160)) + 356);
    const boardSize = frameWidth - 330 - 26;
    assert.equal(boardSize, expectedBoard);
    assert.ok(frameWidth <= width - 48, `${width}×${height}: no horizontal frame overflow`);
    assert.ok(boardSize > Math.min(width - 64, 1200, Math.max(560, height - 252) + 356) - 356);
  }
});

test('desktop actions stay reachable, while tablet and phone panels keep their normal flow', () => {
  const desktop = declarations('.game-sidebar', '(min-width: 851px)');
  assert.equal(desktop.position, 'sticky');
  assert.equal(desktop.top, '16px');
  assert.equal(desktop['max-height'], 'calc(100dvh - 32px)');
  assert.equal(desktop['overflow-y'], 'auto');
  assert.equal(declarations('.game-sidebar').position, undefined);
  const tablet = declarations('.game-layout', '(max-width: 850px)');
  assert.equal(tablet.width, 'min(100% - 40px,700px)');
  assert.equal(tablet['grid-template-columns'], 'minmax(0,1fr)');
  assert.equal(declarations('.game-layout', '(max-width: 560px)').width, 'calc(100% - 24px)');
  assert.equal(declarations('.game-sidebar', '(max-width: 560px)').display, 'flex');
  assert.equal(declarations('.board')['aspect-ratio'], '1');
  assert.equal(declarations('.board')['container-type'], 'inline-size');
});

test('larger property labels can grow with the board without changing the phone-size formula', () => {
  assert.equal(declarations('.square-name')['font-size'], 'clamp(4.5px,1.13cqw,14px)');
  assert.equal(declarations('.square-price')['font-size'], 'clamp(4.4px,.92cqw,11.5px)');
  assert.equal(declarations('.square-special .square-name')['font-size'], 'clamp(4.5px,.96cqw,12px)');
});

test('all token anchors remain centered in their grid cells at phone, tablet, and enlarged desktop sizes', () => {
  for (const size of [296, 351, 366, 478, 700, 760, 808, 920, 1040, 1080]) {
    for (let index = 0; index < 56; index++) {
      const cell = gridCell(index);
      const anchor = squareAnchor(index);
      const center = track => (TRACKS.slice(0, track).reduce((sum, value) => sum + value, 0) + TRACKS[track] / 2) / TRACK_TOTAL * size;
      assert.ok(Math.abs(anchor.x * size - center(cell.column)) < 0.00001);
      assert.ok(Math.abs(anchor.y * size - center(cell.row)) < 0.00001);
    }
  }
});
