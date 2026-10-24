/**
 * Imagina3D — Calculadora de orçamentos (UI)
 * Usa window.Pricing para o cálculo e window.calcImport (definido pelo painel MakerWorld)
 * para custos multi-filamento. Depende de window.appState, window.showToast e window.openNewOrderModal.
 */
(function () {
  'use strict';

  const DEFAULT_COST_PER_G = 0.02;
  const $ = (id) => document.getElementById(id);
  const eur = new Intl.NumberFormat('pt-PT', { style: 'currency', currency: 'EUR' });
  const fmt = (v) => eur.format(Number.isFinite(v) ? v : 0);

  function readNum(id, fallback) {
    const v = parseFloat($(id) && $(id).value);
    return Number.isFinite(v) ? v : fallback;
  }

  function costPerGram(spoolId) {
    const s = window.appState.spools.find((x) => x.id === spoolId);
    return s && s.initialWeight > 0 ? s.price / s.initialWeight : DEFAULT_COST_PER_G;
  }

  /** Linhas de material: multi-filamento se houver importação, senão a bobina selecionada. */
  function getMaterialLines(weightG, defaultSpoolId) {
    const imp = window.calcImport;
    if (imp && imp.lines.length > 0 && imp.baseWeightG > 0) {
      const scale = weightG / imp.baseWeightG; // permite ajustar o peso manualmente mantendo as proporções
      return imp.lines.map((l) => ({ grams: l.grams * scale, costPerG: costPerGram(l.spoolId), spoolId: l.spoolId, type: l.type, color: l.color }));
    }
    const spool = window.appState.spools.find((s) => s.id === defaultSpoolId);
    return [{ grams: weightG, costPerG: costPerGram(defaultSpoolId), spoolId: defaultSpoolId, type: spool ? spool.material : '', color: spool ? spool.colorHex : '' }];
  }

  function readInputs() {
    const settings = window.appState.settings;
    const spoolId = $('calc-spool') ? $('calc-spool').value : '';
    const printerId = $('calc-printer') ? $('calc-printer').value : '';
    const weightG = Math.max(0, readNum('calc-weight', 0));
    return {
      spoolId,
      printerId,
      weightG,
      timeH: Math.max(0, readNum('calc-time', 0)),
      quantity: Math.max(1, Math.floor(readNum('calc-qty', 1))),
      lines: getMaterialLines(weightG, spoolId),
      printer: window.appState.printers.find((p) => p.id === printerId) || window.appState.printers[0],
      wastePct: readNum('calc-waste', settings.defaultWastePercent) / 100,
      prepMin: readNum('calc-prep', settings.defaultPrepMin),
      packCost: readNum('calc-packaging', settings.defaultPackagingCost),
      marginPct: readNum('calc-margin', settings.targetMargin) / 100,
      roundStep: readNum('calc-rounding', settings.priceRounding)
    };
  }

  function setText(id, text) {
    const el = $(id);
    if (el) el.textContent = text;
  }

  function runLiveCalculator() {
    const input = readInputs();
    const settings = window.appState.settings;
    const q = window.Pricing.computeQuote({
      materialLines: input.lines,
      wastePct: input.wastePct,
      timeH: input.timeH,
      printer: input.printer,
      energyPriceKwh: settings.energyPriceKwh,
      laborRate: settings.laborHourlyRate,
      prepMin: input.prepMin,
      packCost: input.packCost,
      marginPct: input.marginPct,
      quantity: input.quantity,
      roundStep: input.roundStep
    });

    setText('calc-res-material-g', `${q.materialWeightG.toFixed(0)} g`);
    setText('calc-res-material-cost', fmt(q.materialCost));
    setText('calc-res-energy-cost', fmt(q.energyCost));
    setText('calc-res-machine-cost', fmt(q.machineCost));
    setText('calc-res-labor-cost', fmt(q.laborCost));
    setText('calc-res-pack-cost', fmt(q.packCost));
    setText('calc-res-total-cost', fmt(q.totalCost));
    setText('calc-res-suggested-price', fmt(q.finalPrice));
    setText('calc-res-profit', fmt(q.profit));
    setText('calc-res-markup', `Markup: ${q.markup.toFixed(1)}x`);
    setText('calc-res-unit', q.quantity > 1 ? `${q.quantity} un. × ${fmt(q.unitPrice)}` : '');
    setText('calc-res-raw', q.finalPrice !== q.suggestedPrice ? `Antes do arredondamento: ${fmt(q.suggestedPrice)}` : '');

    return { ...q, ...input };
  }

  function buildOrderNotes(calc) {
    const imp = window.calcImport;
    const filaments = calc.lines.map((l) => `${l.type || 'Filamento'} ${Math.round(l.grams * calc.quantity)}g${l.color ? ` (${l.color})` : ''}`).join(', ');
    const parts = [
      imp && `MakerWorld: ${imp.url}`,
      imp && `Perfil: ${imp.profileTitle}`,
      imp && imp.totalPlates > 0 && `Placas: ${imp.plateCount}/${imp.totalPlates}`,
      `Quantidade: ${calc.quantity} un.`,
      `Filamentos: ${filaments}`,
      `Orçamento: ${fmt(calc.finalPrice)} (custo ${fmt(calc.totalCost)})`
    ];
    return parts.filter(Boolean).join('\n');
  }

  function createOrderFromCalculator() {
    const calc = runLiveCalculator();
    const imp = window.calcImport;
    const mainLine = calc.lines.reduce((a, l) => (!a || l.grams > a.grams ? l : a), null);
    window.openNewOrderModal();
    $('orderTitle').value = imp ? (calc.quantity > 1 ? `${imp.title} (x${calc.quantity})` : imp.title) : '';
    $('orderWeight').value = Math.round(calc.weightG * calc.quantity);
    $('orderPrintTime').value = (calc.timeH * calc.quantity).toFixed(2);
    $('orderSalePrice').value = calc.finalPrice.toFixed(2);
    $('orderNotes').value = buildOrderNotes(calc);
    $('orderSourceUrl').value = imp ? imp.url : '';
    if (mainLine && mainLine.spoolId) $('orderSpool').value = mainLine.spoolId;
    if (calc.printerId) $('orderPrinter').value = calc.printerId;
  }

  function buildQuoteText(calc) {
    const imp = window.calcImport;
    const settings = window.appState.settings;
    const materials = Array.from(new Set(calc.lines.map((l) => l.type).filter(Boolean))).join(', ') || 'Filamento';
    const duration = window.MakerWorld.formatDuration(calc.timeH * calc.quantity * 3600);
    const lines = [
      '🧾 Orçamento Imagina3D',
      `Peça: ${imp ? imp.title : 'Peça personalizada'}`,
      imp ? `Modelo: ${imp.url}` : null,
      `Quantidade: ${calc.quantity} un.`,
      `Material: ${materials} · ${Math.round(calc.weightG * calc.quantity)} g`,
      `Tempo de impressão estimado: ${duration}`,
      `Valor: ${fmt(calc.finalPrice)}${calc.quantity > 1 ? ` (${fmt(calc.unitPrice)}/un.)` : ''}`,
      `Orçamento válido por ${settings.quoteValidityDays} dias.`
    ];
    return lines.filter(Boolean).join('\n');
  }

  async function copyQuote() {
    const text = buildQuoteText(runLiveCalculator());
    try {
      await navigator.clipboard.writeText(text);
      window.showToast('📋 Orçamento copiado — cola no WhatsApp ou email.');
    } catch (err) {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      window.showToast(ok ? '📋 Orçamento copiado!' : '⚠️ Não foi possível copiar automaticamente.');
    }
  }

  function applySettingsToCalculator() {
    const s = window.appState.settings;
    const set = (id, v) => { if ($(id)) $(id).value = v; };
    set('calc-waste', s.defaultWastePercent);
    set('calc-packaging', s.defaultPackagingCost);
    set('calc-margin', s.targetMargin);
    set('calc-prep', s.defaultPrepMin);
    set('calc-rounding', String(s.priceRounding));
  }

  Object.assign(window, {
    runLiveCalculator,
    createOrderFromCalculator,
    copyQuote,
    applySettingsToCalculator
  });
})();
