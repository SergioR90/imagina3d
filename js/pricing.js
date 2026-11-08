/**
 * Imagina3D — Motor de preços (lógica pura, sem DOM)
 * Usado pela Calculadora e pelos KPIs do Dashboard para garantir o mesmo modelo de custos.
 * Funciona como <script> clássico (window.Pricing) e como módulo CommonJS (testes Node).
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.Pricing = api;
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const MAX_MARGIN = 0.95;
  const MAX_QUANTITY = 10000;
  const DEFAULT_COST_PER_G = 0.02;
  const DEFAULT_PRINTER = Object.freeze({ powerKw: 0.15, hourlyRate: 0.6 });

  const nonNeg = (v) => {
    const n = typeof v === 'number' ? v : parseFloat(v);
    return Number.isFinite(n) && n > 0 ? n : 0;
  };
  const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

  function roundPrice(value, step) {
    const v = nonNeg(value);
    const s = nonNeg(step);
    if (s === 0) return v;
    return Math.round(Math.ceil(v / s - 1e-9) * s * 100) / 100;
  }

  /**
   * Calcula a repartição de custos e o preço sugerido.
   * Material, tempo e mão de obra são por unidade (x quantidade); a embalagem é por encomenda.
   */
  function computeQuote(input) {
    const i = input || {};
    const quantity = clamp(Math.floor(nonNeg(i.quantity)) || 1, 1, MAX_QUANTITY);
    const waste = clamp(nonNeg(i.wastePct), 0, 1);
    const lines = Array.isArray(i.materialLines) ? i.materialLines : [];
    const printer = i.printer || DEFAULT_PRINTER;
    const timeH = nonNeg(i.timeH);

    const unitGrams = lines.reduce((a, l) => a + nonNeg(l && l.grams), 0);
    const unitMaterial = lines.reduce((a, l) => a + nonNeg(l && l.grams) * nonNeg(l && l.costPerG), 0);

    const materialWeightG = unitGrams * (1 + waste) * quantity;
    const materialCost = unitMaterial * (1 + waste) * quantity;
    const energyCost = timeH * nonNeg(printer.powerKw) * nonNeg(i.energyPriceKwh) * quantity;
    const machineCost = timeH * nonNeg(printer.hourlyRate) * quantity;
    const laborCost = (nonNeg(i.prepMin) / 60) * nonNeg(i.laborRate) * quantity;
    const packCost = nonNeg(i.packCost);

    const totalCost = materialCost + energyCost + machineCost + laborCost + packCost;
    const margin = clamp(nonNeg(i.marginPct), 0, MAX_MARGIN);
    const suggestedPrice = totalCost / (1 - margin);
    const finalPrice = roundPrice(suggestedPrice, i.roundStep);

    return {
      quantity,
      materialWeightG,
      materialCost,
      energyCost,
      machineCost,
      laborCost,
      packCost,
      totalCost,
      suggestedPrice,
      finalPrice,
      unitPrice: finalPrice / quantity,
      profit: finalPrice - totalCost,
      markup: totalCost > 0 ? finalPrice / totalCost : 0
    };
  }

  const findSpool = (order, spools) => (spools || []).find((x) => x.id === (order || {}).spoolId);
  const hasUsableSpool = (spool) => Boolean(spool) && nonNeg(spool.initialWeight) > 0;

  /** true se o custo de material da encomenda é uma estimativa (sem bobina válida associada). */
  function usesFallbackMaterialCost(order, spools) {
    return !hasUsableSpool(findSpool(order, spools));
  }

  /** Custo direto estimado de uma encomenda já registada (peso/tempo são totais). */
  function estimateOrderCost(order, spools, printers, settings) {
    const o = order || {};
    const s = settings || {};
    const spool = findSpool(o, spools);
    const printer = (printers || []).find((x) => x.id === o.printerId) || DEFAULT_PRINTER;
    const costPerG = hasUsableSpool(spool) ? nonNeg(spool.price) / spool.initialWeight : DEFAULT_COST_PER_G;

    return computeQuote({
      materialLines: [{ grams: o.weightG, costPerG }],
      wastePct: nonNeg(s.defaultWastePercent) / 100,
      timeH: o.printTimeH,
      printer,
      energyPriceKwh: s.energyPriceKwh,
      laborRate: s.laborHourlyRate,
      prepMin: s.defaultPrepMin,
      packCost: s.defaultPackagingCost,
      marginPct: 0,
      quantity: 1,
      roundStep: 0
    }).totalCost;
  }

  return { computeQuote, roundPrice, estimateOrderCost, usesFallbackMaterialCost };
});
