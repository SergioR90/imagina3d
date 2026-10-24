// Testes de integração da UI da Calculadora + MakerWorld (executar com: node --test tests/)
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const RAW = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'makerworld-design.json'), 'utf8'));

function createDomSandbox() {
  const elements = {};
  const makeEl = (id) => ({
    id,
    value: '',
    textContent: '',
    innerText: '',
    innerHTML: '',
    href: '',
    disabled: false,
    className: '',
    options: [],
    classList: {
      set: new Set(['hidden']),
      add(...cls) { cls.forEach((c) => this.set.add(c)); },
      remove(...cls) { cls.forEach((c) => this.set.delete(c)); },
      contains(c) { return this.set.has(c); }
    },
    select() {},
    remove() {}
  });
  const getEl = (id) => {
    if (!elements[id]) elements[id] = makeEl(id);
    return elements[id];
  };

  let copiedText = '';
  let lastToast = '';

  const win = {
    location: { origin: 'https://sergior90.github.io', pathname: '/imagina3d/', search: '', hash: '' },
    history: { replaceState() {} },
    navigator: { clipboard: { writeText: async (t) => { copiedText = t; } } },
    document: {
      getElementById: getEl,
      createElement: () => makeEl('tmp'),
      body: { appendChild() {} }
    },
    appState: {
      spools: [
        { id: 'SPL-01', name: 'PLA Verde', material: 'PLA', colorHex: '#646941', price: 20, initialWeight: 1000, remainingWeight: 700 },
        { id: 'SPL-02', name: 'PETG Branco', material: 'PETG', colorHex: '#FFFFFF', price: 25, initialWeight: 1000, remainingWeight: 800 }
      ],
      printers: [
        { id: 'PRN-01', name: 'Bambu Lab A1', hourlyRate: 0.65, powerKw: 0.15 }
      ],
      settings: {
        energyPriceKwh: 0.22,
        laborHourlyRate: 12,
        defaultWastePercent: 5,
        defaultPackagingCost: 1.2,
        defaultPrepMin: 15,
        targetMargin: 60,
        priceRounding: 0.5,
        quoteValidityDays: 15,
        mwProxyUrl: ''
      }
    },
    escapeHtml: (s) => String(s ?? ''),
    showToast: (m) => { lastToast = m; },
    switchTab: () => {},
    openNewOrderModal: () => {},
    AbortController,
    setTimeout,
    clearTimeout,
    Intl,
    Math,
    Number,
    String,
    Array,
    Object,
    Set,
    Map,
    JSON,
     Error,
    SyntaxError,
    TextEncoder,
    TextDecoder,
    Uint8Array,
    btoa,
    atob,
    encodeURIComponent,
    decodeURIComponent,
    parseFloat,
    parseInt,
    console: { warn() {}, error() {} }
  };
  win.window = win;
  win.self = win;

  // Defaults iniciais nos inputs da calculadora
  getEl('calc-spool').value = 'SPL-01';
  getEl('calc-printer').value = 'PRN-01';
  getEl('calc-weight').value = '120';
  getEl('calc-time').value = '4';
  getEl('calc-qty').value = '1';
  getEl('calc-waste').value = '5';
  getEl('calc-prep').value = '15';
  getEl('calc-packaging').value = '1.20';
  getEl('calc-margin').value = '60';
  getEl('calc-rounding').value = '0.5';

  vm.createContext(win);
  ['pricing.js', 'makerworld.js', 'calculator.js', 'makerworld-ui.js'].forEach((file) => {
    const code = fs.readFileSync(path.join(__dirname, '..', 'js', file), 'utf8');
    vm.runInContext(code, win, { filename: file });
  });

  return { win, getEl, getCopied: () => copiedText, getToast: () => lastToast };
}

test('Fluxo completo: importar via JSON colado -> pré-preenche calculadora -> cria encomenda e orçamento', async () => {
  const { win, getEl, getCopied } = createDomSandbox();

  getEl('mw-url').value = 'https://makerworld.com/en/models/1400373-seed#profileId-1452154';
  getEl('mw-paste').value = JSON.stringify(RAW);
  win.mwImportFromPaste();

  // Verifica que o peso (322g) e tempo (39620s = 11.01h) foram pré-preenchidos
  assert.equal(getEl('calc-weight').value, 322);
  assert.equal(getEl('calc-time').value, '11.01');
  assert.ok(win.calcImport);
  assert.equal(win.calcImport.lines.length, 3);

  // Selecionar apenas a placa 1 (107g, 15026s = 4.17h)
  win.mwSelectAllPlates(false);
  win.mwTogglePlate(1, true);
  assert.equal(getEl('calc-weight').value, 107);
  assert.equal(getEl('calc-time').value, '4.17');

  // Testar quantidade = 2 e criar encomenda
  getEl('calc-qty').value = '2';
  win.createOrderFromCalculator();
  assert.equal(getEl('orderTitle').value, 'Self Watering Seed Starter with Modular Grow Kit (x2)');
  assert.equal(getEl('orderWeight').value, 214);
  assert.match(getEl('orderSourceUrl').value, /makerworld\.com\/en\/models\/1400373/);
  assert.match(getEl('orderNotes').value, /Placas: 1\/4/);

  // Copiar orçamento para o cliente
  await win.copyQuote();
  assert.match(getCopied(), /Orçamento Imagina3D/);
  assert.match(getCopied(), /214 g/);
});
