const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {test} = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../js/ride.js'), 'utf8');

async function setup({latestId = 'aaaaaaaaaaa'} = {}) {
  const nodes = new Map();
  const images = [];
  const element = id => {
    if (!nodes.has(id)) {
      const node = {
        value: '', hidden: false, handlers: {}, textContent: '', options: [{text: 'All tracks'}],
        addEventListener(type, callback) { this.handlers[type] = callback; },
        add(option) { this.options.push(option); },
        setAttribute() {}
      };
      Object.defineProperty(node, 'src', {
        get() { return this.imageSource; },
        set(value) { this.imageSource = value; images.push(value); }
      });
      nodes.set(id, node);
    }
    return nodes.get(id);
  };
  const requested = [];
  const tileLayers = [];
  const maps = [];
  let reloads = 0;
  const data = {
    'latest-video.json': {id: latestId, title: 'Latest ride', published: '2026-11-20T00:00:00Z'},
    'sessions/tracks-list.json': [
      {name: 'Alpha circuit', lat: 55, lng: 24},
      {name: 'Beta circuit', lat: 54, lng: 25},
      {name: 'Invalid circuit', lat: 56, lng: 26}
    ],
    'sessions/sessions-list.json': {sessions: [
      {id: 'alpha', track: {name: 'Alpha circuit'}, has_video: true, session_date: '2026-11-19', driver: 'Driver A'},
      {id: 'beta', track: {name: 'Beta circuit'}, has_video: true, session_date: '2026-11-18', driver: 'Driver B'},
      {id: 'invalid', track: {name: 'Invalid circuit'}, has_video: true, session_date: '2026-11-17'}
    ]},
    'sessions/alpha.json': {video_url: 'https://youtu.be/bbbbbbbbbbb'},
    'sessions/beta.json': {video_url: 'https://www.youtube.com/watch?v=ccccccccccc'},
    'sessions/invalid.json': {video_url: 'https://youtu.be/not-a-valid-video-id'}
  };
  const context = vm.createContext({
    URL, console,
    window: {location: {reload() { reloads++; }}},
    document: {getElementById: element, createElement: () => ({})},
    Option: function (text, value) { this.text = text; this.value = value; },
    fetch: async url => {
      requested.push(url);
      assert.ok(Object.hasOwn(data, url), 'Only known same-origin JSON is fetched');
      return {ok: true, json: async () => data[url]};
    },
    L: {
      map() {
        const map = {
          views: [], setView(position, zoom) { this.views.push({position, zoom}); return this; },
          fitBounds() {}, getZoom: () => 6, invalidateSize() {}, remove() {}
        };
        maps.push(map);
        return map;
      },
      tileLayer(url, options) { tileLayers.push({url, options}); return {addTo() {}}; },
      marker(position) {
        return {
          addTo() { return this; }, bindTooltip() { return this; }, on() { return this; },
          getLatLng: () => position, openTooltip() {}, closeTooltip() {}
        };
      }
    }
  });
  vm.runInContext(source, context);
  await vm.runInContext('tracksReady', context);
  await new Promise(setImmediate);
  return {
    element, requested, images, tileLayers, maps,
    reloads: () => reloads,
    select: name => element('track').handlers.change({target: {value: name}})
  };
}

test('homepage loads only local content until approval and track selection still works', async () => {
  const h = await setup();
  assert.equal(h.tileLayers.length, 0);
  assert.equal(h.maps.length, 0);
  assert.ok(h.requested.every(url => !/^https?:/.test(url)));
  assert.ok(h.images.every(url => url === 'og-image.png'));
  assert.equal(h.element('track').options.length, 4);
  await h.select('Alpha circuit');
  assert.equal(h.element('title').textContent, 'Alpha circuit');
  assert.equal(h.element('watch').href, 'https://youtu.be/bbbbbbbbbbb');
  assert.equal(h.element('archive').href, 'sessions.html?track=Alpha%20circuit');
  assert.equal(h.element('thumbnail').src, 'og-image.png');
  assert.equal(h.tileLayers.length, 0);
});

test('image approval applies to current and future rides and withdrawal resets it', async () => {
  const h = await setup();
  h.element('allow-preview').handlers.click();
  assert.equal(h.element('thumbnail').src, 'https://i.ytimg.com/vi/aaaaaaaaaaa/hqdefault.jpg');
  await h.select('Beta circuit');
  assert.equal(h.element('thumbnail').src, 'https://i.ytimg.com/vi/ccccccccccc/hqdefault.jpg');
  h.element('reset').handlers.click();
  assert.equal(h.element('thumbnail').src, 'https://i.ytimg.com/vi/aaaaaaaaaaa/hqdefault.jpg');
  h.element('stop-preview').handlers.click();
  assert.equal(h.element('thumbnail').src, 'og-image.png');
  assert.equal(h.reloads(), 1);
  assert.equal(h.tileLayers.length, 0, 'Image approval does not approve map tiles');
  const fresh = await setup();
  assert.ok(fresh.images.every(url => url === 'og-image.png'));
});

test('map approval loads tiles once, preserves the selected track and can be withdrawn', async () => {
  const h = await setup();
  await h.select('Alpha circuit');
  const first = h.element('allow-map').handlers.click();
  const duplicate = h.element('allow-map').handlers.click();
  await Promise.all([first, duplicate]);
  await h.element('allow-map').handlers.click();
  assert.equal(h.maps.length, 1);
  assert.equal(h.tileLayers.length, 1);
  assert.equal(h.tileLayers[0].url, 'https://tile.openstreetmap.org/{z}/{x}/{y}.png');
  assert.deepEqual(Array.from(h.maps[0].views.at(-1).position), [55, 24]);
  assert.equal(h.element('stop-map').hidden, false);
  assert.equal(h.element('thumbnail').src, 'og-image.png', 'Map approval does not approve YouTube images');
  h.element('stop-map').handlers.click();
  assert.equal(h.reloads(), 1);
  const fresh = await setup();
  assert.equal(fresh.tileLayers.length, 0);
});

test('invalid video IDs cannot generate external preview requests even after approval', async () => {
  const h = await setup({latestId: 'not-valid'});
  h.element('allow-preview').handlers.click();
  assert.equal(h.element('cover').hidden, true);
  assert.equal(h.element('watch').href, 'https://www.youtube.com/@HelmetCamHeroes');
  await h.select('Invalid circuit');
  assert.equal(h.element('cover').hidden, true);
  assert.equal(h.element('watch').hidden, true);
  assert.ok(h.images.every(url => url === 'og-image.png'));
});
