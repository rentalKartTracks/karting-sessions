const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {test} = require('node:test');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '../map.html'), 'utf8');
const source = html.match(/<script>\s*([\s\S]*?)<\/script>/)[1];

async function setup() {
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, {
      textContent: '', innerHTML: '', children: [], handlers: {}, disabled: id === 'near-me-btn',
      hidden: id === 'stop-map', classList: {add() {}, remove() {}},
      addEventListener(type, callback) { this.handlers[type] = callback; },
      appendChild(child) { this.children.push(child); }
    });
    return elements.get(id);
  };
  let ready;
  const tileRequests = [];
  const removedStorage = [];
  const geoRequests = [];
  let reloads = 0;
  const map = {setView() {}, fitBounds() {}, invalidateSize() {}, removeLayer() {}};
  const context = vm.createContext({
    console, encodeURIComponent, setTimeout, clearTimeout,
    window: {
      addEventListener(type, callback) { if (type === 'DOMContentLoaded') ready = callback; },
      location: {reload() { reloads++; }}
    },
    document: {
      getElementById: element,
      querySelector: element,
      querySelectorAll: () => [],
      createElement: () => element(Symbol())
    },
    localStorage: {
      removeItem: key => removedStorage.push(key),
      getItem() { throw Error('Map should not read persisted location'); },
      setItem() { throw Error('Map should not persist location'); }
    },
    navigator: {geolocation: {getCurrentPosition(callback, failure, options) { geoRequests.push({callback, options}); }}},
    L: {
      map: () => map,
      control: {zoom: () => ({addTo() {}})},
      tileLayer(url, options) { tileRequests.push({url, options}); return {addTo() {}}; },
      latLngBounds: points => points,
      divIcon: options => options,
      marker() { return {addTo() {return this;}, bindPopup() {return this;}, openPopup() {}}; }
    },
    fetch: async url => {
      assert.equal(url, 'sessions/tracks-list.json', 'Only same-origin data is fetched before map approval');
      return {json: async () => [{id: 'track', name: 'Local track', lat: 55, lng: 24, configs: ['Full'], sessions: 3}]};
    }
  });
  vm.runInContext(source, context);
  ready();
  await new Promise(setImmediate);
  return {element, tileRequests, removedStorage, geoRequests, reloads: () => reloads};
}

test('map keeps external tiles and geolocation blocked while local track links work', async () => {
  const h = await setup();
  assert.equal(h.tileRequests.length, 0);
  assert.equal(h.geoRequests.length, 0);
  assert.equal(h.element('near-me-btn').disabled, true);
  assert.deepEqual(h.removedStorage, ['hch:mapView']);
  const cards = h.element('tracks-list').children;
  assert.equal(cards.length, 1);
  assert.match(cards[0].innerHTML, /sessions\.html\?track=Local%20track/);
  h.element('near-me-btn').handlers.click();
  assert.equal(h.geoRequests.length, 0, 'Even a programmatic click cannot bypass map approval');
});

test('explicit map approval loads tiles once and Near me requests location separately', async () => {
  const h = await setup();
  h.element('allow-map').handlers.click();
  h.element('allow-map').handlers.click();
  assert.equal(h.tileRequests.length, 1);
  assert.equal(h.tileRequests[0].url, 'https://tile.openstreetmap.org/{z}/{x}/{y}.png');
  assert.match(h.tileRequests[0].options.attribution, /https:\/\/www\.openstreetmap\.org\/copyright/);
  assert.match(h.tileRequests[0].options.attribution, /contributors/);
  assert.equal(h.geoRequests.length, 0, 'Loading tiles does not request location');
  assert.equal(h.element('near-me-btn').disabled, false);
  assert.equal(h.element('allow-map').hidden, true);
  assert.equal(h.element('stop-map').hidden, false);
  h.element('near-me-btn').handlers.click();
  assert.equal(h.geoRequests.length, 1);
  h.geoRequests[0].callback({coords: {latitude: 54.6, longitude: 25.3}});
  h.element('stop-map').handlers.click();
  assert.equal(h.reloads(), 1);
  const fresh = await setup();
  assert.equal(fresh.tileRequests.length, 0, 'Reload returns to blocked map tiles');
});
