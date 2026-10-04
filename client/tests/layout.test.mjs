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
test('flow-layout fallback retains the enlarged board on short desktop windows', () => {
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

test('flow-layout actions stay reachable, while tablet and phone panels keep their normal flow', () => {
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
  for (const size of [296, 351, 366, 478, 700, 736, 760, 768, 808, 832, 920, 1040, 1048, 1080]) {
    for (let index = 0; index < 56; index++) {
      const cell = gridCell(index);
      const anchor = squareAnchor(index);
      const center = track => (TRACKS.slice(0, track).reduce((sum, value) => sum + value, 0) + TRACKS[track] / 2) / TRACK_TOTAL * size;
      assert.ok(Math.abs(anchor.x * size - center(cell.column)) < 0.00001);
      assert.ok(Math.abs(anchor.y * size - center(cell.row)) < 0.00001);
    }
  }
});

const deskMedia = '(min-width: 1100px) and (min-height: 600px)';
test('desktop desk fits the complete board inside both viewport dimensions', () => {
  const desk = declarations('.app-shell.game-mode', deskMedia);
  assert.equal(desk['--desk-board-size'], 'min(1080px,calc(100dvh - 32px),calc(100vw - 404px))');
  assert.equal(desk.height, '100dvh');
  assert.equal(desk['min-height'], '0');
  assert.equal(desk.padding, '16px 24px');
  assert.equal(desk['grid-template-columns'], 'var(--desk-board-size) 330px');
  assert.equal(desk.gap, '10px 26px');
  assert.equal(desk.overflow, undefined, 'page content is not hidden to simulate a fit');
  const board = declarations('.game-mode .board-viewport', deskMedia);
  assert.equal(board['grid-column'], '1');
  assert.equal(board['grid-row'], '1 / -1');
  assert.equal(board.width, 'var(--desk-board-size)');
  for (const [width, height, expected] of [
    [1100, 600, 568], [1366, 768, 736], [1280, 800, 768],
    [1536, 864, 832], [1920, 1080, 1048], [2560, 1440, 1080],
    [1100, 1200, 696],
  ]) {
    const size = Math.min(1080, height - 32, width - 404);
    assert.equal(size, expected);
    assert.ok(size + 32 <= height);
    assert.ok(size + 330 + 26 + 48 <= width);
  }
});

test('desktop chrome occupies the side column, with room left for scrollable actions even with long notices', () => {
  assert.equal(declarations('.game-mode .game-layout, .game-mode .board-section', deskMedia).display, 'contents');
  for (const [selector, row] of [
    ['.app-header', 1], ['.session-notices', 2], ['.game-topline', 3],
    ['.board-toolbar', 4], ['.game-sidebar', 5], ['.board-footer', 6], ['.app-footer', 7],
  ]) {
    const style = declarations(`.game-mode ${selector}`, deskMedia);
    assert.equal(style['grid-column'], '2', selector);
    assert.equal(style['grid-row'], String(row), selector);
    assert.notEqual(style.display, 'none', selector);
  }
  assert.equal(declarations('.app-shell.game-mode', deskMedia)['grid-template-rows'], 'auto auto auto 44px minmax(120px,1fr) 44px 14px');
  let chromeMaximum = 0;
  for (const selector of ['.app-header', '.session-notices', '.game-topline']) {
    const style = declarations(`.game-mode ${selector}`, deskMedia);
    assert.equal(style['overflow-y'], 'auto', `${selector}: preserve long content`);
    chromeMaximum += Number.parseFloat(style['max-height']);
  }
  assert.ok(chromeMaximum + 44 + 120 + 44 + 14 + 6 * 10 + 32 <= 600,
    'maximum chrome plus useful action-panel space fits the smallest desk height');
  const panel = declarations('.game-mode .game-sidebar', deskMedia);
  assert.equal(panel['min-height'], '0');
  assert.equal(panel['overflow-y'], 'auto');
  assert.equal(panel.position, 'static');
  assert.equal(declarations('.game-mode .game-sidebar > *', deskMedia)['flex-shrink'], '0');
});

test('viewport desk is game-only and falls back for phones, portrait tablets and short windows', () => {
  const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  assert.match(app, /game && game\.state!=='lobby'\?'game-mode':''/);
  assert.match(app, /className="session-notices"/);
  assert.match(app, /className="game-topline" tabIndex=\{0\} role="region" aria-label="Turn and cash"/);
  assert.equal(declarations('.game-topline:focus-visible').outline, '2px solid var(--gold)');
  for (const [width, height] of [[320, 568], [375, 812], [390, 844], [768, 1024], [1099, 900], [1366, 599]]) {
    assert.equal(width >= 1100 && height >= 600, false);
  }
  assert.equal(declarations('.app-shell')['min-height'], '100dvh');
  assert.equal(declarations('.app-shell').height, undefined);
});
