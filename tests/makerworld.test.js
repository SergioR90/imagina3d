// Testes da lógica de importação MakerWorld (executar com: node --test tests/)
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const MW = require('../js/makerworld.js');

const RAW = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'makerworld-design.json'), 'utf8'));

test('parseMakerWorldUrl: URL completo com slug e profileId', () => {
  const r = MW.parseMakerWorldUrl('https://makerworld.com/en/models/1400373-self-watering-seed#profileId-1452158');
  assert.deepEqual(r, { designId: '1400373', profileId: '1452158' });
});

test('parseMakerWorldUrl: URL sem idioma nem profile', () => {
  assert.deepEqual(MW.parseMakerWorldUrl('makerworld.com/models/987654'), { designId: '987654', profileId: null });
});

test('parseMakerWorldUrl: aceita apenas o ID numérico', () => {
  assert.deepEqual(MW.parseMakerWorldUrl('  1400373 '), { designId: '1400373', profileId: null });
});

test('parseMakerWorldUrl: rejeita URLs de outros sites e lixo', () => {
  assert.equal(MW.parseMakerWorldUrl('https://www.printables.com/model/12345'), null);
  assert.equal(MW.parseMakerWorldUrl('javascript:alert(1)'), null);
  assert.equal(MW.parseMakerWorldUrl(''), null);
  assert.equal(MW.parseMakerWorldUrl(null), null);
});

test('normalizeDesign: extrai perfis, placas e filamentos', () => {
  const d = MW.normalizeDesign(RAW);
  assert.equal(d.id, '1400373');
  assert.equal(d.title, 'Self Watering Seed Starter with Modular Grow Kit');
  assert.equal(d.defaultProfileId, '1452154');
  assert.equal(d.profiles.length, 3);
  const p = d.profiles[0];
  assert.equal(p.timeS, 39620);
  assert.equal(p.weightG, 322);
  assert.equal(p.plates.length, 4);
  assert.deepEqual(p.plates[0].filaments, [{ type: 'PLA', color: '#646941', grams: 107 }]);
  assert.equal(p.printer, 'X1 Carbon');
  assert.equal(p.nozzle, 0.4);
  assert.match(d.url, /makerworld\.com\/.*models\/1400373/);
});

test('normalizeDesign: falha com mensagem clara se o JSON não for de um modelo', () => {
  assert.throws(() => MW.normalizeDesign({ foo: 1 }), /MakerWorld/);
  assert.throws(() => MW.normalizeDesign(null), /MakerWorld/);
});

test('normalizeDesign: aceita dados já normalizados (vindos do bookmarklet) e sanitiza', () => {
  const once = MW.normalizeDesign(RAW);
  const twice = MW.normalizeDesign(JSON.parse(JSON.stringify(once)));
  assert.deepEqual(twice, once);
  const evil = { ...once, profiles: [{ ...once.profiles[0], weightG: -5, timeS: 'abc' }] };
  const clean = MW.normalizeDesign(evil);
  assert.equal(clean.profiles[0].weightG, 0);
  assert.equal(clean.profiles[0].timeS, 0);
});

test('normalizeDesign: não altera o objeto original (imutabilidade)', () => {
  const copy = JSON.parse(JSON.stringify(RAW));
  MW.normalizeDesign(copy);
  assert.deepEqual(copy, RAW);
});

test('summarizeSelection: todas as placas = totais do perfil', () => {
  const p = MW.normalizeDesign(RAW).profiles[0];
  const s = MW.summarizeSelection(p, null, 1);
  assert.equal(s.timeS, 39620);
  assert.equal(s.weightG, 322);
  assert.equal(s.plateCount, 4);
  const pla = s.filaments.find(f => f.type === 'PLA' && f.color === '#646941');
  // A mesma cor aparece em várias placas: o total deve bater com o resumo do perfil no MakerWorld
  assert.equal(pla.grams, 230);
});

test('summarizeSelection: subconjunto de placas e quantidade', () => {
  const p = MW.normalizeDesign(RAW).profiles[0];
  const s = MW.summarizeSelection(p, [1, 2], 3);
  assert.equal(s.timeS, (15026 + 3461) * 3);
  assert.equal(s.weightG, (107 + 35) * 3);
  assert.equal(s.plateCount, 2);
  assert.equal(s.filaments.reduce((a, f) => a + f.grams, 0), (107 + 35) * 3);
});

test('summarizeSelection: perfil sem placas usa totais do perfil', () => {
  const p = { ...MW.normalizeDesign(RAW).profiles[0], plates: [] };
  const s = MW.summarizeSelection(p, null, 2);
  assert.equal(s.weightG, 644);
  assert.equal(s.timeS, 79240);
});

test('formatDuration', () => {
  assert.equal(MW.formatDuration(39620), '11h 00m');
  assert.equal(MW.formatDuration(3461), '0h 58m');
  assert.equal(MW.formatDuration(0), '0h 00m');
});

test('encodeForHash / decodeFromHash round-trip com acentos', () => {
  const obj = { title: 'Organizador Coração ❤', n: 1 };
  assert.deepEqual(MW.decodeFromHash(MW.encodeForHash(obj)), obj);
  assert.equal(MW.decodeFromHash('%%%lixo'), null);
});

test('matchSpool: escolhe mesmo material e cor mais próxima com stock', () => {
  const spools = [
    { id: 'A', material: 'PLA', colorHex: '#000000', remainingWeight: 500 },
    { id: 'B', material: 'PLA', colorHex: '#6a6a40', remainingWeight: 500 },
    { id: 'C', material: 'PETG', colorHex: '#646941', remainingWeight: 500 },
    { id: 'D', material: 'PLA', colorHex: '#646941', remainingWeight: 0 }
  ];
  assert.equal(MW.matchSpool({ type: 'PLA', color: '#646941' }, spools), 'B');
  assert.equal(MW.matchSpool({ type: 'PETG', color: '#ffffff' }, spools), 'C');
  assert.equal(MW.matchSpool({ type: 'TPU', color: '#ffffff' }, spools), null);
});

test('buildBookmarklet gera um javascript: URL que aponta para a app', () => {
  const b = MW.buildBookmarklet('https://sergior90.github.io/imagina3d/');
  assert.ok(b.startsWith('javascript:'));
  assert.ok(b.includes(encodeURIComponent('https://sergior90.github.io/imagina3d/')) || b.includes('sergior90.github.io'));
});

test('bookmarklet executado numa página MakerWorld abre a app com os dados corretos', async () => {
  const vm = require('node:vm');
  const app = 'https://sergior90.github.io/imagina3d/';
  const code = decodeURIComponent(MW.buildBookmarklet(app).slice('javascript:'.length));
  let opened = null;
  let fetchedUrl = null;
  const sandbox = {
    location: { hostname: 'makerworld.com', origin: 'https://makerworld.com', pathname: '/en/models/1400373-seed', hash: '#profileId-1452158' },
    fetch: async (url) => { fetchedUrl = url; return { ok: true, json: async () => RAW }; },
    window: { open: (url) => { opened = url; } },
    alert: (msg) => { throw new Error('alert: ' + msg); },
    TextEncoder, btoa, String, JSON
  };
  vm.createContext(sandbox);
  await vm.runInContext(code, sandbox);
  await new Promise((r) => setImmediate(r));

  assert.equal(fetchedUrl, '/api/v1/design-service/design/1400373');
  assert.ok(opened && opened.startsWith(app + '#mw='));
  const decoded = MW.normalizeDesign(MW.decodeFromHash(opened.split('#mw=')[1]));
  const expected = MW.normalizeDesign(RAW);
  assert.equal(decoded.defaultProfileId, '1452158');
  assert.deepEqual(decoded.profiles, expected.profiles);
  assert.equal(decoded.title, expected.title);
});
