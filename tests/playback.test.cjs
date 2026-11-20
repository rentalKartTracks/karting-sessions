const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../js/session.js'), 'utf8');
const states = { UNSTARTED: -1, ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3, CUED: 5 };

function setup() {
  const nodes = new Map();
  const documentEvents = {};
  const intervals = new Map();
  let nextInterval = 1;
  const node = id => {
    if (!nodes.has(id)) nodes.set(id, {
      textContent: '', style: {}, listeners: {},
      addEventListener(type, handler) {
        if (!this.listeners[type]) this.listeners[type] = new Set();
        this.listeners[type].add(handler);
      },
      removeEventListener(type, handler) { this.listeners[type]?.delete(handler); },
      getBoundingClientRect() { return { left: 0, top: 0, width: 720, height: 300 }; }
    });
    return nodes.get(id);
  };
  const context = vm.createContext({
    URLSearchParams, URL, console, setTimeout, clearTimeout,
    YT: { PlayerState: states },
    setInterval(callback) { const id = nextInterval++; intervals.set(id, callback); return id; },
    clearInterval(id) { intervals.delete(id); },
    window: { location: { search: '?id=A' }, addEventListener() {}, devicePixelRatio: 1 },
    document: {
      readyState: 'loading', visibilityState: 'visible',
      addEventListener(type, handler) { documentEvents[type] = handler; },
      getElementById: node, querySelector() { return null; }, querySelectorAll() { return []; }
    }
  });
  vm.runInContext(source, context);
  vm.runInContext(`
    currentSessionData = { id: 'A', laps: [{lap: 1, time: '1:00'}, {lap: 2, time: '0:50'}] };
    comparisonSessions = [
      { id: 'B', laps: [{lap: 1, time: '1:05'}, {lap: 2, time: '0:55'}] },
      { id: 'C', laps: [{lap: 1, time: '0:55'}, {lap: 2, time: '0:40'}] },
      { id: 'D', laps: [{lap: 1, time: '0:45'}] }
    ];
    videoConfigs = { A: {startTimeSeconds: 10}, B: {startTimeSeconds: 90}, C: {startTimeSeconds: 25}, D: {startTimeSeconds: 5} };
    activeVideoIds = ['A', 'B', 'C', 'D'];
    lapStartTimes = [{lapNumber: 1, videoTime: 10}, {lapNumber: 2, videoTime: 70}];
    drawLineChart = (...args) => { globalThis.lastChartTime = args[2]; };
    sendStatsToRemotes = () => {};
    updateAudioState = () => {};
  `, context);
  const players = {};
  for (const id of ['A', 'B', 'C', 'D']) {
    players[id] = {
      state: states.PAUSED, time: 10, duration: 300, seeks: [], playCalls: 0, pauseCalls: 0,
      getCurrentTime() { return this.time; }, getDuration() { return this.duration; },
      getPlayerState() { return this.state; },
      seekTo(time) { this.seeks.push(time); this.time = time; },
      playVideo() { this.playCalls++; this.state = states.PLAYING; },
      pauseVideo() { this.pauseCalls++; this.state = states.PAUSED; }
    };
  }
  context.playersForTest = players;
  vm.runInContext('videoPlayers = playersForTest', context);
  const read = code => vm.runInContext(code, context);
  return { context, players, read, node, documentEvents, intervals };
}

test('remote, chart and lap buttons share offset-aware seeking for every video', () => {
  const { context, players, node, read } = setup();
  assert.equal(context.handleRemoteCommand({ type: 'SEEK', value: 80 }), true);
  assert.deepEqual(Object.values(players).map(player => player.seeks.at(-1)), [80, 165, 90, 50]);
  assert.equal(read('currentLapMarker.lapNumber'), 2);
  assert.equal(read('lastChartTime'), 80);

  context.seekToLap(2);
  assert.deepEqual(Object.values(players).map(player => player.seeks.at(-1)), [70, 155, 80, 50]);

  // Halfway through lap 1 on a two-lap chart: A=40, B=120, C=55, D=35.
  context.setupTooltipInteractions(2, {}, 60, 600);
  [...node('lap-chart').listeners.click][0]({ clientX: 360 });
  assert.deepEqual(Object.values(players).map(player => player.seeks.at(-1)), [40, 120, 55, 35]);
});

test('600 chart refreshes still produce exactly one seek per player', () => {
  const { context, players, node } = setup();
  for (let i = 0; i < 600; i++) context.setupTooltipInteractions(2, {}, 60, 600);
  const canvas = node('lap-chart');
  assert.equal(canvas.listeners.click.size, 1);
  assert.equal(canvas.listeners.mousemove.size, 1);
  [...canvas.listeners.click][0]({ clientX: 360 });
  assert.deepEqual(Object.values(players).map(player => player.seeks.length), [1, 1, 1, 1]);
  // The same handler uses current geometry when comparisons change.
  context.setupTooltipInteractions(3, {}, 60, 600);
  [...canvas.listeners.click][0]({ clientX: 360 });
  assert.equal(players.A.seeks.at(-1), 70);
});

test('invalid commands never seek and timestamps stay inside recording bounds', () => {
  const { context, players } = setup();
  for (const value of [NaN, Infinity, -1, '80', null, {}, undefined]) {
    assert.equal(context.handleRemoteCommand({ type: 'SEEK', value }), false);
  }
  for (const command of [null, undefined, 3, {}, { type: 'UNKNOWN' }]) {
    assert.equal(context.handleRemoteCommand(command), false);
  }
  assert.ok(Object.values(players).every(player => player.seeks.length === 0));
  players.A.duration = 100;
  players.B.duration = 160;
  context.seekToVideoTime(500);
  assert.equal(players.A.seeks.at(-1), 100);
  assert.equal(players.B.seeks.at(-1), 160);
  context.seekToVideoTime(0);
  assert.ok(Object.values(players).every(player => player.seeks.at(-1) >= 0));
});

test('comparison buffering, pausing or ending does not stop reference statistics', () => {
  const { context, players, intervals, read } = setup();
  context.setPlaybackPlaying(true);
  assert.equal(intervals.size, 1);
  for (const state of [states.BUFFERING, states.PAUSED, states.ENDED, states.CUED]) {
    players.B.state = state;
    context.onPlayerStateChange({ target: players.B, data: state });
    assert.equal(intervals.size, 1);
    assert.equal(read('playbackRequested'), true);
    assert.equal(players.A.state, states.PLAYING);
  }
  players.A.state = states.BUFFERING;
  context.onPlayerStateChange({ target: players.A, data: states.BUFFERING });
  assert.equal(intervals.size, 1);
  players.A.state = states.PAUSED;
  context.onPlayerStateChange({ target: players.A, data: states.PAUSED });
  assert.equal(intervals.size, 0);
  assert.equal(read('playbackRequested'), false);
  assert.ok(Object.values(players).every(player => player.state !== states.PLAYING));
});

test('late player readiness respects pause and maps current reference lap', () => {
  const { context, players } = setup();
  players.A.time = 80;
  context.onPlayerReady({ target: players.B }, 'B');
  assert.equal(players.B.seeks.at(-1), 165);
  assert.equal(players.B.state, states.PAUSED);
  players.B.state = states.PLAYING;
  context.onPlayerStateChange({ target: players.B, data: states.PLAYING });
  assert.equal(players.B.state, states.PAUSED);

  context.setPlaybackPlaying(true);
  context.onPlayerReady({ target: players.C }, 'C');
  assert.equal(players.C.seeks.at(-1), 90);
  assert.equal(players.C.state, states.PLAYING);
});

test('returning to a TV tab preserves an intentional pause', () => {
  const { context, players, documentEvents } = setup();
  vm.runInContext("currentMode = 'tv'", context);
  context.setPlaybackPlaying(false);
  documentEvents.visibilitychange();
  assert.ok(Object.values(players).every(player => player.playCalls === 0));
});

test('late-ready cameras follow a pending seek until the reference clock catches up', () => {
  const { context, players } = setup();
  players.A.seekTo = function(time) { this.seeks.push(time); };
  context.seekToVideoTime(80);
  assert.equal(players.A.time, 10, 'The asynchronous player still reports its old time');
  context.onPlayerReady({ target: players.A }, 'A');
  assert.equal(context.getReferenceVideoTime(), 80);
  context.onPlayerReady({ target: players.B }, 'B');
  assert.equal(players.B.seeks.at(-1), 165);
  players.A.time = 80;
  assert.equal(context.getReferenceVideoTime(), 80);
  players.A.time = 85;
  assert.equal(context.getReferenceVideoTime(), 85, 'The live clock takes over after the seek settles');
});

test('an unbuffered seek stays authoritative while YouTube downloads the target', () => {
  const { context, players } = setup();
  players.A.seekTo = function(time) { this.seeks.push(time); };
  context.seekToVideoTime(80);
  players.A.state = states.BUFFERING;
  vm.runInContext('pendingSeekDeadline = 0', context);
  assert.equal(context.getReferenceVideoTime(), 80);
  context.onPlayerReady({ target: players.B }, 'B');
  assert.equal(players.B.seeks.at(-1), 165);
  players.A.state = states.PAUSED;
  players.A.time = 79;
  assert.equal(context.getReferenceVideoTime(), 79, 'The settled player clock wins even at an earlier keyframe');
});
