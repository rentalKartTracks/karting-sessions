const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../js/session.js'), 'utf8');

function setup() {
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, {
      value: '', textContent: '', innerHTML: '', style: {},
      setAttribute() {}, addEventListener() {}, remove() { this.removed = true; }
    });
    return elements.get(id);
  };
  const context = vm.createContext({
    URLSearchParams, URL, console, setTimeout, clearTimeout, setInterval, clearInterval,
    window: { location: { search: '?id=A', origin: 'https://example.test' }, addEventListener() {} },
    document: {
      readyState: 'loading', addEventListener() {},
      getElementById: element, querySelector: element, querySelectorAll: () => []
    },
    fetch: async () => ({ ok: false })
  });
  vm.runInContext(source, context);
  vm.runInContext(`
    currentSessionData = { id: 'A', laps: [{lap: 1, time: '00:40.000'}] };
    videoConfigs = { A: { videoId: 'aaaaaaaaaaa', startTimeSeconds: 10 } };
    activeVideoIds = ['A'];
    drawLineChart = () => {};
    renderComparisonResults = errors => { globalThis.lastErrors = errors; };
    changeVideoLayout = layout => { activeLayout = layout; };
  `, context);
  const read = expression => JSON.parse(vm.runInContext(`JSON.stringify(${expression})`, context));
  const load = async (ids, mode = 'pc') => {
    element('compare-id-input').value = ids;
    context.modeForTest = mode;
    vm.runInContext('currentMode = modeForTest', context);
    await context.compareSession();
  };
  return { context, element, read, load };
}

function session(id) {
  return { session_id: id, driver: id, video_url: 'https://youtu.be/bbbbbbbbbbb', video_start_time: '00:20', laps: [{ lap: 1, time: '00:41.000' }] };
}

test('replacing comparisons removes stale players/configs and keeps the reference', async () => {
  const { context, element, read, load } = setup();
  const destroyed = [];
  context.destroyedForTest = destroyed;
  vm.runInContext(`
    videoConfigs.B = { videoId: 'bbbbbbbbbbb' };
    activeVideoIds = ['A', 'B'];
    comparisonSessions = [{id: 'B'}];
    videoPlayers = { A: { destroy() { destroyedForTest.push('A'); } }, B: { destroy() { destroyedForTest.push('B'); } } };
  `, context);
  context.fetch = async () => ({ ok: true, json: async () => session('C') });
  await load('C');
  assert.deepEqual(read('activeVideoIds'), ['A', 'C']);
  assert.deepEqual(read('Object.keys(videoConfigs)'), ['A', 'C']);
  assert.deepEqual(destroyed, ['B']);
  assert.equal(element('container-B').removed, true);
  assert.deepEqual(read('comparisonSessions.map(s => s.id)'), ['C']);

  context.fetch = async () => ({ ok: false });
  await load('missing');
  assert.deepEqual(read('activeVideoIds'), ['A']);
  assert.deepEqual(read('Object.keys(videoConfigs)'), ['A']);
  assert.equal(read('lastErrors.length'), 1);
});

test('TV comparisons restore videos and partial failures keep correct session IDs', async () => {
  const { context, read, load } = setup();
  context.fetch = async url => url.includes('missing') ? { ok: false } : { ok: true, json: async () => session('B') };
  await load('missing,B', 'tv');
  assert.deepEqual(read('comparisonSessions.map(s => s.id)'), ['B']);
  assert.deepEqual(read('activeVideoIds'), ['A', 'B']);
  assert.equal(read('activeLayout'), 'dual');
});

test('a late comparison response cannot overwrite a newer selection or Clear', async () => {
  const { context, element, read } = setup();
  let finishOld;
  context.fetch = url => url.endsWith('B.json') ? new Promise(resolve => { finishOld = resolve; }) : Promise.resolve({ ok: true, json: async () => session('C') });
  element('compare-id-input').value = 'B';
  const oldRequest = context.compareSession();
  element('compare-id-input').value = 'C';
  await context.compareSession();
  finishOld({ ok: true, json: async () => session('B') });
  await oldRequest;
  assert.deepEqual(read('comparisonSessions.map(s => s.id)'), ['C']);

  element('compare-id-input').value = 'B';
  const clearedRequest = context.compareSession();
  context.clearComparison();
  finishOld({ ok: true, json: async () => session('B') });
  await clearedRequest;
  assert.deepEqual(read('activeVideoIds'), ['A']);
  assert.deepEqual(read('comparisonSessions'), []);
});

test('tile mute persists across refreshes and global unmute enables only one source', () => {
  const { context, read } = setup();
  vm.runInContext(`
    activeLayout = 'dual';
    activeVideoIds = ['A', 'B'];
    videoPlayers = Object.fromEntries(['A', 'B'].map(id => [id, {
      muted: true, mute() { this.muted = true; }, unMute() { this.muted = false; }
    }]));
    updateAudioState();
  `, context);
  assert.deepEqual(read('Object.values(videoPlayers).map(p => p.muted)'), [false, true]);
  context.toggleAudio('A');
  context.updateAudioState();
  assert.equal(read('audioMuted'), true);
  assert.equal(read('activeAudioSessionId'), 'A');
  assert.deepEqual(read('Object.values(videoPlayers).map(p => p.muted)'), [true, true]);
  context.toggleMute();
  assert.deepEqual(read('Object.values(videoPlayers).map(p => p.muted)'), [false, true]);
  context.toggleAudio('B');
  assert.deepEqual(read('Object.values(videoPlayers).map(p => p.muted)'), [true, false]);
  context.toggleMute();
  vm.runInContext("activeVideoIds = ['A']; updateAudioState();", context);
  assert.equal(read('activeAudioSessionId'), 'A');
  assert.equal(read('audioMuted'), true);
});

test('reference camera cannot be disabled or dropped by a narrow layout', () => {
  const { context, read } = setup();
  context.toggleActiveVideo('A', false);
  assert.deepEqual(read('activeVideoIds'), ['A']);
  vm.runInContext("activeVideoIds = ['B', 'C', 'A']; activeLayout = 'dual';", context);
  assert.deepEqual(read('getRenderedVideoIds()'), ['B', 'A']);
});
