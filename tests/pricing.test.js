// Testes do motor de preços (executar com: node --test tests/)
const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../js/pricing.js');

const BASE = {
  materialLines: [{ grams: 100, costPerG: 0.02 }],
  wastePct: 0.05,
  timeH: 4,
  printer: { powerKw: 0.15, hourlyRate: 0.65 },
  energyPriceKwh: 0.22,
  laborRate: 12,
  prepMin: 15,
  packCost: 1.2,
  marginPct: 0.6,
  quantity: 1,
  roundStep: 0
};

const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);

test('computeQuote: repartição de custos para 1 unidade', () => {
  const q = P.computeQuote(BASE);
  close(q.materialWeightG, 105);
  close(q.materialCost, 2.1);
  close(q.energyCost, 4 * 0.15 * 0.22);
  close(q.machineCost, 2.6);
  close(q.laborCost, 3);
  close(q.packCost, 1.2);
  close(q.totalCost, 2.1 + 0.132 + 2.6 + 3 + 1.2);
  close(q.suggestedPrice, q.totalCost / 0.4);
  close(q.finalPrice, q.suggestedPrice);
  close(q.profit, q.finalPrice - q.totalCost);
});

test('computeQuote: várias linhas de material (multi-filamento)', () => {
  const q = P.computeQuote({ ...BASE, materialLines: [{ grams: 100, costPerG: 0.02 }, { grams: 50, costPerG: 0.04 }], wastePct: 0 });
  close(q.materialCost, 2 + 2);
  close(q.materialWeightG, 150);
});

test('computeQuote: quantidade multiplica material, tempo e mão de obra; embalagem é por encomenda', () => {
  const one = P.computeQuote(BASE);
  const three = P.computeQuote({ ...BASE, quantity: 3 });
  close(three.materialCost, one.materialCost * 3);
  close(three.machineCost, one.machineCost * 3);
  close(three.laborCost, one.laborCost * 3);
  close(three.packCost, one.packCost);
  close(three.unitPrice, three.finalPrice / 3);
});

test('computeQuote: arredondamento para cima ao passo definido', () => {
  const q = P.computeQuote({ ...BASE, roundStep: 0.5 });
  assert.ok(q.finalPrice >= q.suggestedPrice);
  close(q.finalPrice % 0.5, 0);
});

test('computeQuote: valores inválidos são tratados como zero e margem limitada', () => {
  const q = P.computeQuote({ ...BASE, materialLines: [{ grams: -10, costPerG: NaN }], timeH: 'x', marginPct: 5, quantity: 0 });
  assert.equal(q.materialCost, 0);
  assert.equal(q.machineCost, 0);
  assert.ok(Number.isFinite(q.suggestedPrice));
  assert.equal(q.quantity, 1);
});

test('roundPrice', () => {
  close(P.roundPrice(12.01, 0.5), 12.5);
  close(P.roundPrice(12.5, 0.5), 12.5);
  close(P.roundPrice(12.01, 0), 12.01);
  close(P.roundPrice(12.01, 1), 13);
});

test('estimateOrderCost usa a bobina e impressora da encomenda', () => {
  const order = { weightG: 100, printTimeH: 2, spoolId: 'S', printerId: 'P', quantity: 1 };
  const spools = [{ id: 'S', price: 20, initialWeight: 1000 }];
  const printers = [{ id: 'P', powerKw: 0.1, hourlyRate: 0.5 }];
  const settings = { energyPriceKwh: 0.2, laborHourlyRate: 10, defaultWastePercent: 0, defaultPackagingCost: 1, defaultPrepMin: 0 };
  const c = P.estimateOrderCost(order, spools, printers, settings);
  close(c, 100 * 0.02 + 2 * 0.1 * 0.2 + 2 * 0.5 + 1);
});
