import test from 'node:test';
import assert from 'node:assert/strict';
import { terminalResumeError, retryStrategy, validSnapshot, afterDisconnect } from '../src/lib/sessionRules.ts';
test('a timed out command retries its exact envelope without resuming an already-bound socket',()=>{
  assert.equal(retryStrategy('ready',true,true,true),'command');
  assert.equal(retryStrategy('reconnecting',false,true,true),'connect');
  assert.equal(retryStrategy('reconnecting',true,true,true),'resume');
});
test('session replacement is terminal until the user chooses a new seat',()=>{
  assert.equal(afterDisconnect('replaced'),'replaced');
  assert.equal(retryStrategy('replaced',false,true,true),'none');
  assert.equal(afterDisconnect('ready'),'reconnecting');
});
test('terminal room errors release stale local state; transient failures do not',()=>{
  for(const code of ['ROOM_EXPIRED','INVALID_SNAPSHOT','INVALID_SESSION','ROOM_NOT_FOUND']) assert.equal(terminalResumeError(code),true);
  for(const code of ['PERSISTENCE_UNAVAILABLE','RATE_LIMITED','INTERNAL_ERROR']) assert.equal(terminalResumeError(code),false);
});
test('snapshots are monotonic and isolated by game epoch',()=>{
  const current={gameId:'A',version:9};
  assert.equal(validSnapshot(current,{gameId:'A',version:8}),false);
  assert.equal(validSnapshot(current,{gameId:'A',version:9}),true);
  assert.equal(validSnapshot(current,{gameId:'B',version:100}),false);
  assert.equal(validSnapshot(current,{gameId:'B',version:1},true),true);
});
