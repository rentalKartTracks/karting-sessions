const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync(require('node:path').join(__dirname, '../js/session.js'), 'utf8');
const fullscreenSource = source.slice(source.indexOf('// Keep fullscreen on a stable parent'), source.indexOf('/**\n * Handle clicks on the video container'));
const keyboardSource = source.slice(source.indexOf("document.addEventListener('keydown'"), source.indexOf('/**\n* Visibility change handler'));

function classList() {
  const values = new Set();
  return {
    add: value => values.add(value),
    remove: value => values.delete(value),
    contains: value => values.has(value),
    toggle(value, force) {
      const enabled = force === undefined ? !values.has(value) : force;
      enabled ? values.add(value) : values.delete(value);
      return enabled;
    }
  };
}

function setup() {
  const stage = {classList: classList()};
  const button = {attributes: {}, setAttribute(name, value) {this.attributes[name] = value;}};
  const root = {classList: classList()};
  const handlers = {};
  const calls = {play: 0, mute: 0, previous: 0, next: 0, nativeExit: 0};
  const document = {
    fullscreenElement: null,
    documentElement: root,
    getElementById(id) {return {'video-stage': stage, 'fullscreen-toggle': button}[id] || null;},
    querySelectorAll() {return [];},
    addEventListener(type, callback) {handlers[type] = callback;},
    async exitFullscreen() {calls.nativeExit++; this.fullscreenElement = null;}
  };
  const context = vm.createContext({
    document,
    togglePlayPause() {calls.play++;},
    toggleMute() {calls.mute++;},
    previousLap() {calls.previous++;},
    nextLap() {calls.next++;},
    closeBrowseModal() {}
  });
  vm.runInContext(fullscreenSource + '\n' + keyboardSource, context);
  function key(key, interactive = false) {
    const event = {key, target: {closest() {return interactive ? {} : null;}}, preventDefault() {this.prevented = true;}};
    handlers.keydown(event);
    return event;
  }
  return {stage, button, root, document, context, calls, key};
}

test('native fullscreen includes the stable stage and explicit exit state', async () => {
  const app = setup();
  app.stage.requestFullscreen = async () => {app.document.fullscreenElement = app.stage;};
  await app.context.toggleFullscreen();
  assert.equal(app.document.fullscreenElement, app.stage);
  assert.equal(app.button.textContent, 'Exit fullscreen');
  assert.equal(app.button.attributes['aria-pressed'], 'true');
  assert.equal(app.root.classList.contains('video-fullscreen-open'), true);
  await app.context.toggleFullscreen();
  assert.equal(app.document.fullscreenElement, null);
  assert.equal(app.button.textContent, 'Fullscreen');
  assert.equal(app.root.classList.contains('video-fullscreen-open'), false);
});

test('unavailable or rejected native fullscreen falls back and Escape exits even from a button', async () => {
  for (const request of [undefined, async () => {throw new Error('Fullscreen unavailable');}]) {
    const app = setup();
    app.stage.requestFullscreen = request;
    await app.context.toggleFullscreen();
    assert.equal(app.stage.classList.contains('is-fullscreen'), true);
    assert.equal(app.button.textContent, 'Exit fullscreen');
    const event = app.key('Escape', true);
    assert.equal(event.prevented, true);
    assert.equal(app.stage.classList.contains('is-fullscreen'), false);
    assert.equal(app.root.classList.contains('video-fullscreen-open'), false);
  }
});

test('a cancelled pending native request cannot reopen fullscreen', async () => {
  const app = setup();
  let resolve;
  app.stage.requestFullscreen = () => new Promise(done => {resolve = done;});
  const entering = app.context.toggleFullscreen();
  await app.context.exitVideoFullscreen();
  app.document.fullscreenElement = app.stage;
  resolve();
  await entering;
  assert.equal(app.document.fullscreenElement, null);
  assert.equal(app.stage.classList.contains('is-fullscreen'), false);
});

test('shortcuts preserve native control activation and use shared fullscreen/mute helpers', async () => {
  const app = setup();
  const buttonSpace = app.key(' ', true);
  assert.equal(app.calls.play, 0);
  assert.equal(buttonSpace.prevented, undefined);
  app.key(' ');
  app.key('M');
  assert.equal(app.calls.play, 1);
  assert.equal(app.calls.mute, 1);
  app.key('F');
  assert.equal(app.stage.classList.contains('is-fullscreen'), true);
  app.key('Escape');
  assert.equal(app.stage.classList.contains('is-fullscreen'), false);
});
