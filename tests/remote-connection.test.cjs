const assert = require('node:assert/strict');
const {EventEmitter} = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {test} = require('node:test');

function harness() {
  let timerId = 0;
  const timers = new Map();
  const intervals = new Map();
  const nodes = new Map();
  const peers = [];
  const documentListeners = new Map();
  const windowListeners = new Map();
  const document = {
    visibilityState: 'visible',
    getElementById(id) {
      if (!nodes.has(id)) {
        const classes = new Set();
        nodes.set(id, {
          textContent: '', innerHTML: '', style: {},
          classList: {
            add: value => classes.add(value), remove: value => classes.delete(value),
            contains: value => classes.has(value),
            toggle(value, enabled) { enabled ? classes.add(value) : classes.delete(value); }
          },
          setAttribute() {}, addEventListener() {}, removeEventListener() {}
        });
      }
      return nodes.get(id);
    },
    querySelector() { return null; }, querySelectorAll() { return []; },
    addEventListener(type, callback) {
      if (!documentListeners.has(type)) documentListeners.set(type, []);
      documentListeners.get(type).push(callback);
    }
  };
  class Channel extends EventEmitter {
    constructor(id) { super(); this.peer = id; this.open = false; this.sent = []; }
    send(data) { this.sent.push(data); }
    close() { this.open = false; this.emit('close'); }
    ready() { this.open = true; this.emit('open'); }
  }
  class Peer extends EventEmitter {
    constructor(id) { super(); this.id = id; this.open = false; this.destroyed = false; this.disconnected = false; this.channels = []; peers.push(this); }
    connect(id) { const channel = new Channel(id); this.channels.push(channel); return channel; }
    reconnect() { this.reconnectCalls = (this.reconnectCalls || 0) + 1; }
    destroy() { this.destroyed = true; this.emit('close'); }
    ready() { this.open = true; this.disconnected = false; this.emit('open', this.id); }
  }
  const QRCode = function () {};
  QRCode.CorrectLevel = {L: 1};
  const context = vm.createContext({
    document, Peer, QRCode, URLSearchParams,
    navigator: {},
    window: {
      location: {origin: 'https://example.com', pathname: '/session.html', search: '?host=HCH123456'},
      addEventListener(type, callback) {
        if (!windowListeners.has(type)) windowListeners.set(type, []);
        windowListeners.get(type).push(callback);
      }
    },
    setTimeout(callback, delay) { const id = ++timerId; timers.set(id, {callback, delay}); return id; },
    clearTimeout(id) { timers.delete(id); },
    setInterval(callback) { const id = ++timerId; intervals.set(id, callback); return id; },
    clearInterval(id) { intervals.delete(id); },
    getReferencePlayer: () => ({getPlayerState: () => 1}),
    getReferenceVideoTime: () => 42,
    getReferenceDuration: () => 420,
    getCurrentLapNumber: () => 1,
    validateLapData: laps => laps,
    handleRemoteCommand() {}
  });
  const read = code => vm.runInContext(code, context);
  const runNext = () => {
    const next = [...timers.entries()].sort((a, b) => a[1].delay - b[1].delay)[0];
    assert.ok(next, 'Expected a pending retry');
    timers.delete(next[0]);
    next[1].callback();
  };
  const dispatchDocument = type => (documentListeners.get(type) || []).forEach(callback => callback());
  const dispatchWindow = (type, event = {}) => (windowListeners.get(type) || []).forEach(callback => callback(event));
  return {context, read, runNext, peers, nodes, document, dispatchDocument, dispatchWindow, Channel, timers, intervals};
}

function hostHarness() {
  const h = harness();
  const source = fs.readFileSync(path.join(__dirname, '../js/session.js'), 'utf8');
  const networking = source.slice(source.indexOf('function generateShortPeerId()'), source.indexOf('/**\n* Handle remote command'));
  const stats = source.slice(source.indexOf('function updateConnectionUI()'), source.indexOf('/**\n* Toggle QR panel'));
  h.read(`let peer = null, connections = [], statsInterval = null, reconnectAttempts = 0;
    const MAX_RECONNECT_ATTEMPTS = 3;
    let hostPeerId = null, peerReconnectTimer = null, peerConnectionTimer = null, peerConnectionState = 'disabled', remoteAllowed = false;
    let currentMode = 'pc', currentLapMarker = {lapNumber: 1}, currentSessionData = {laps: [{time: '00:40.000'}]};
    ${networking}\n${stats}`);
  return h;
}

test('host retries ID collisions through full initialization and preserves IDs on network recovery', () => {
  const h = hostHarness();
  h.context.enablePhoneRemote();
  const first = h.peers[0];
  first.emit('error', {type: 'unavailable-id'});
  h.runNext();
  const replacement = h.peers[1];
  for (const event of ['open', 'connection', 'error', 'disconnected', 'close']) assert.ok(replacement.listenerCount(event), event);
  assert.ok(first.destroyed);
  replacement.ready();
  const pairedId = replacement.id;
  replacement.emit('error', {type: 'network'});
  h.runNext();
  assert.equal(h.peers[2].id, pairedId, 'Previously scanned host ID stays valid');
});

test('host retries are bounded even when the signaling service never answers', () => {
  const h = hostHarness();
  h.context.enablePhoneRemote();
  for (let i = 0; i < 4; i++) {
    h.peers.at(-1).emit('error', {type: 'network'});
    if (i < 3) h.runNext();
  }
  assert.equal(h.read('reconnectAttempts'), 3);
  assert.equal(h.read('peerConnectionState'), 'offline');
  assert.equal(h.timers.size, 0);
});

test('host counts only open channels and clears timers and channels on cleanup', () => {
  const h = hostHarness();
  h.context.enablePhoneRemote();
  const peer = h.peers[0];
  peer.ready();
  const channel = new h.Channel('phone');
  peer.emit('connection', channel);
  assert.equal(h.document.getElementById('connected-count').textContent, 0);
  assert.equal(h.intervals.size, 0);
  channel.ready();
  assert.equal(h.document.getElementById('connected-count').textContent, 1);
  assert.equal(channel.sent[0].currentTime, 42, 'Stats use the shared main timeline');
  assert.equal(channel.sent[0].duration, 420);
  assert.equal(h.intervals.size, 1);
  h.context.cleanupPeerConnection();
  assert.equal(h.document.getElementById('connected-count').textContent, 0);
  assert.equal(h.intervals.size, 0);
  assert.equal(h.timers.size, 0);
  assert.ok(peer.destroyed);
  assert.equal(channel.open, false);
});

test('host connection timeouts terminate without an endless retry loop', () => {
  const h = hostHarness();
  h.context.enablePhoneRemote();
  for (let step = 0; step < 10 && h.timers.size; step++) h.runNext();
  assert.equal(h.timers.size, 0, 'Connection attempts must terminate');
  assert.equal(h.peers.length, 4, 'Initial connection plus three attempts');
  assert.equal(h.read('peerConnectionState'), 'offline');
});

test('a disconnected host reconnects the existing peer and cancels its watchdog on success', () => {
  const h = hostHarness();
  h.context.enablePhoneRemote();
  const peer = h.peers[0];
  peer.ready();
  peer.open = false;
  peer.disconnected = true;
  peer.emit('disconnected');
  h.runNext();
  assert.equal(peer.reconnectCalls, 1);
  assert.equal(h.peers.length, 1);
  peer.ready();
  assert.equal(h.timers.size, 0);
  assert.equal(h.read('reconnectAttempts'), 0);
});

test('remote stats advance the lap from the video clock while the host chart timer is stopped', () => {
  const h = hostHarness();
  h.context.enablePhoneRemote();
  h.peers[0].ready();
  const channel = new h.Channel('phone');
  h.peers[0].emit('connection', channel);
  channel.ready();
  h.document.visibilityState = 'hidden';
  h.read("currentSessionData.laps = [{time: '00:40.000'}, {time: '00:45.000'}]");
  h.context.getReferenceVideoTime = () => 85;
  h.context.getCurrentLapNumber = time => time >= 80 ? 2 : 1;
  // Only the 500ms remote poll runs; there is no chart/live-stats interval.
  [...h.intervals.values()][0]();
  assert.equal(channel.sent.at(-1).lap, 2);
  assert.equal(channel.sent.at(-1).time, '00:45.000');
  assert.equal(h.read('currentLapMarker.lapNumber'), 2, 'Next/previous lap use the advancing marker');
});

function phoneHarness() {
  const h = harness();
  h.read(fs.readFileSync(path.join(__dirname, '../js/remote.js'), 'utf8'));
  return h;
}

test('host networking stays blocked until enabled and disabling cancels retries and pairing', () => {
  const h = hostHarness();
  h.context.initializePeer();
  assert.equal(h.peers.length, 0);
  h.context.enablePhoneRemote();
  h.context.enablePhoneRemote();
  assert.equal(h.peers.length, 1, 'Repeated enable does not create extra connections');
  const peer = h.peers[0];
  peer.ready();
  const channel = new h.Channel('phone');
  peer.emit('connection', channel);
  channel.ready();
  peer.emit('error', {type: 'network'});
  assert.ok(h.timers.size > 0);
  h.context.disablePhoneRemote();
  assert.equal(h.read('remoteAllowed'), false);
  assert.equal(h.read('hostPeerId'), null);
  assert.ok(peer.destroyed);
  assert.equal(channel.open, false);
  assert.equal(h.timers.size, 0);
  assert.equal(h.intervals.size, 0);
  assert.equal(h.document.getElementById('qr-code').innerHTML, '');
  h.context.initializePeer();
  h.context.schedulePeerReconnect(peer);
  assert.equal(h.peers.length, 1, 'Disabled state blocks resume and late retry requests');
  assert.equal(h.timers.size, 0);
  h.context.enablePhoneRemote();
  assert.equal(h.peers.length, 2, 'Explicit re-enable works');
});

test('phone landing and BFCache restoration wait for Connect and disconnect prevents resume', () => {
  const h = phoneHarness();
  h.dispatchWindow('DOMContentLoaded');
  h.dispatchWindow('pageshow', {persisted: true});
  h.context.setupPeerConnection();
  assert.equal(h.peers.length, 0);
  assert.equal(h.read('connectionState'), 'disabled');
  h.context.connectRemote();
  h.context.connectRemote();
  assert.equal(h.peers.length, 1);
  h.peers[0].ready();
  h.peers[0].channels[0].ready();
  h.context.disconnectRemote();
  assert.ok(h.peers[0].destroyed);
  assert.equal(h.timers.size, 0);
  assert.equal(h.intervals.size, 0);
  h.dispatchWindow('pageshow', {persisted: true});
  h.context.retryConnection();
  assert.equal(h.peers.length, 1);
  assert.equal(h.read('remoteAllowed'), false);
  assert.equal(h.read('connectionState'), 'disabled');
  h.context.connectRemote();
  assert.equal(h.peers.length, 2);
});

test('phone clears the connected banner and reconnects to the same scanned host', () => {
  const h = phoneHarness();
  h.context.connectRemote();
  h.peers[0].ready();
  const channel = h.peers[0].channels[0];
  channel.ready();
  const banner = h.document.getElementById('connection-banner');
  assert.ok(banner.classList.contains('connected'));
  channel.close();
  assert.equal(banner.classList.contains('connected'), false);
  assert.equal(h.read('connectionState'), 'reconnecting');
  h.runNext();
  h.peers[1].ready();
  assert.equal(h.peers[1].channels[0].peer, 'HCH123456');
  assert.equal(h.peers[0].destroyed, true);
});

test('phone stops retrying an obsolete pairing code and offers an explicit retry', () => {
  const h = phoneHarness();
  h.context.connectRemote();
  for (let i = 0; i < 4; i++) {
    h.peers.at(-1).emit('error', {type: 'peer-unavailable'});
    if (i < 3) h.runNext();
  }
  assert.equal(h.read('connectionState'), 'offline');
  assert.equal(h.timers.size, 0);
  assert.match(h.document.getElementById('content-area').innerHTML, /Scan the current QR code/);
  assert.doesNotMatch(h.document.getElementById('content-area').innerHTML, /location.reload/);
  h.context.retryConnection();
  assert.equal(h.read('reconnectAttempts'), 0);
  assert.equal(h.read('connectionState'), 'connecting');
});

test('phone detects a silent channel and clears the stale connected indicator', () => {
  const h = phoneHarness();
  h.context.connectRemote();
  h.peers[0].ready();
  h.peers[0].channels[0].ready();
  h.read('lastStatsAt = Date.now() - 11000');
  [...h.intervals.values()][0]();
  assert.equal(h.read('connectionState'), 'reconnecting');
  assert.equal(h.document.getElementById('connection-banner').classList.contains('connected'), false);
  assert.equal(h.intervals.size, 0);
});

test('phone preserves an open channel across background suspension and grants resume grace', () => {
  const h = phoneHarness();
  h.context.connectRemote();
  h.peers[0].ready();
  const channel = h.peers[0].channels[0];
  channel.ready();
  const watchdog = [...h.intervals.values()][0];
  h.document.visibilityState = 'hidden';
  h.read('lastStatsAt = Date.now() - 60000');
  watchdog();
  assert.equal(h.read('connectionState'), 'connected', 'Hidden-page timer throttling is not a disconnect');
  h.document.visibilityState = 'visible';
  h.dispatchDocument('visibilitychange');
  watchdog();
  assert.equal(h.read('connectionState'), 'connected', 'Queued stats have a fresh grace period on resume');
  assert.equal(h.peers.length, 1);
  assert.equal(channel.open, true);
  h.read('lastStatsAt = Date.now() - 11000');
  watchdog();
  assert.equal(h.read('connectionState'), 'reconnecting', 'A truly silent resumed channel still reconnects');
});
