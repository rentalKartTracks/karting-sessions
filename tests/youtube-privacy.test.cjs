const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../js/session.js'), 'utf8');

function harness() {
  const nodes = new Map();
  const scripts = [];
  const players = [];
  let reloads = 0;
  const node = id => {
    if (!nodes.has(id)) {
      const listeners = new Map();
      nodes.set(id, {
        hidden: id === 'stop-youtube', textContent: '', style: {},
        addEventListener(type, callback) { listeners.set(type, callback); },
        click() { listeners.get('click')?.(); }
      });
    }
    return nodes.get(id);
  };
  const context = vm.createContext({
    URLSearchParams, URL, console, setTimeout, clearTimeout, setInterval, clearInterval,
    window: {
      location: {search: '?id=A', origin: 'https://example.test', reload() { reloads++; }},
      addEventListener() {}
    },
    document: {
      readyState: 'loading', addEventListener() {}, getElementById: node,
      createElement(tagName) { return {tagName, remove() { this.removed = true; }}; },
      body: {appendChild(script) { scripts.push(script); }}
    }
  });
  vm.runInContext(source, context);
  vm.runInContext(`
    detectInitialMode = updateConnectionUI = loadSessionsList = loadSessionData = () => {};
    activeVideoIds = ['A', 'B'];
    videoConfigs = {
      A: {videoId: 'aaaaaaaaaaa', startTimeSeconds: 10},
      B: {videoId: 'bbbbbbbbbbb', startTimeSeconds: 20}
    };
  `, context);
  context.initializeApp();
  const installAPI = () => {
    const YT = {Player: function (id, options) { players.push({id, options}); }};
    context.YT = context.window.YT = YT;
  };
  return {context, node, scripts, players, installAPI, reloads: () => reloads};
}

test('session videos do not load the API or construct players before explicit approval', () => {
  const h = harness();
  h.context.loadYouTubeAPI();
  h.context.createPlayer('A', {videoId: 'aaaaaaaaaaa', startTimeSeconds: 10});
  assert.equal(h.scripts.length, 0);
  h.installAPI();
  h.context.loadYouTubeAPI();
  h.context.window.onYouTubeIframeAPIReady();
  assert.equal(h.scripts.length, 0);
  assert.equal(h.players.length, 0, 'An existing API cannot bypass permission');
  assert.equal(h.node('allow-youtube').hidden, false);
});

test('approval loads the API once, uses privacy-enhanced players, and disabling reloads into blocked defaults', () => {
  const h = harness();
  h.node('allow-youtube').click();
  h.context.loadYouTubeAPI();
  assert.equal(h.scripts.length, 1);
  assert.equal(h.scripts[0].src, 'https://www.youtube.com/iframe_api');
  assert.equal(h.node('allow-youtube').hidden, true);
  assert.equal(h.node('stop-youtube').hidden, false);
  h.installAPI();
  h.context.window.onYouTubeIframeAPIReady();
  h.context.window.onYouTubeIframeAPIReady();
  assert.equal(h.players.length, 2, 'Each active video is initialized once');
  for (const {options} of h.players) {
    assert.equal(options.host, 'https://www.youtube-nocookie.com');
    assert.equal(options.playerVars.autoplay, 0);
    assert.equal(options.playerVars.origin, 'https://example.test');
  }
  h.node('stop-youtube').click();
  assert.equal(h.reloads(), 1, 'Disabling requests a reload to tear down third-party resources');
  const freshPage = harness();
  freshPage.context.loadYouTubeAPI();
  assert.equal(freshPage.scripts.length, 0);
  assert.equal(freshPage.node('allow-youtube').hidden, false);
  assert.equal(freshPage.node('stop-youtube').hidden, true);
});
