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
      `Quantidade: ${calc.quantity} un.`,
      `Material: ${materials} · ${Math.round(calc.weightG * calc.quantity)} g`,
      `Tempo de impressão estimado: ${duration}`,
      `Valor: ${fmt(calc.finalPrice)}${calc.quantity > 1 ? ` (${fmt(calc.unitPrice)}/un.)` : ''}`,
      `Orçamento válido por ${settings.quoteValidityDays} dias.`
    ];
    return lines.filter(Boolean).join('\n');
  }

  const esc = (s) => window.escapeHtml(s);
  const isHttps = (u) => typeof u === 'string' && /^https:\/\/[^\s"'<>]+$/i.test(u);

  /**
   * Documento de orçamento para o cliente (HTML autónomo, pronto a imprimir / guardar em PDF).
   * Mostra só fotos de referência: sem link do modelo e sem custos internos ou margem.
   */
  function buildClientQuoteHtml(calc, now) {
    const imp = window.calcImport;
    const settings = window.appState.settings;
    const date = now || new Date();
    const validUntil = new Date(date.getTime() + settings.quoteValidityDays * 86400000);
    const day = new Intl.DateTimeFormat('pt-PT', { day: '2-digit', month: 'long', year: 'numeric' });
    const materials = Array.from(new Set(calc.lines.map((l) => l.type).filter(Boolean))).join(', ') || 'Filamento';
    const duration = window.MakerWorld.formatDuration(calc.timeH * calc.quantity * 3600);
    const title = imp ? imp.title : 'Peça personalizada';
    const photos = ((imp && imp.photos) || []).filter(isHttps);

    const row = (label, value) => `<tr><th>${esc(label)}</th><td>${esc(value)}</td></tr>`;
    const gallery = photos.length
      ? `<h2>Fotos de referência</h2><div class="photos">${photos
          .map((u) => `<img src="${esc(u)}" alt="Foto de referência" referrerpolicy="no-referrer">`)
          .join('')}</div>`
      : '';

    return `<!doctype html>
<html lang="pt-PT"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Orçamento Imagina3D</title>
<style>
  *{box-sizing:border-box}
  body{font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:#1f2937;margin:0;background:#f3f4f6}
  .page{max-width:760px;margin:24px auto;background:#fff;padding:40px;border-radius:12px;box-shadow:0 1px 6px rgba(0,0,0,.08)}
  header{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #4f46e5;padding-bottom:16px}
  header h1{margin:0;font-size:26px;color:#4f46e5}
  header .meta{text-align:right;font-size:13px;color:#6b7280}
  h2{font-size:15px;margin:32px 0 10px;color:#374151}
  .piece{font-size:20px;font-weight:700;margin:24px 0 4px}
  table{width:100%;border-collapse:collapse;font-size:14px}
  th{text-align:left;font-weight:500;color:#6b7280;padding:8px 0;width:45%;border-bottom:1px solid #f0f0f0}
  td{padding:8px 0;border-bottom:1px solid #f0f0f0}
  .price{margin:24px 0 0;background:#eef2ff;border-radius:10px;padding:18px 20px;display:flex;justify-content:space-between;align-items:center}
  .price .label{font-size:14px;color:#4338ca}
  .price .value{font-size:30px;font-weight:800;color:#3730a3}
  .price .unit{font-size:12px;color:#6366f1;text-align:right}
  .photos{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}
  .photos img{display:block;width:100%;height:220px;object-fit:cover;border-radius:8px;background:#f3f4f6}
  footer{margin-top:28px;font-size:12px;color:#6b7280;border-top:1px solid #e5e7eb;padding-top:12px}
  .actions{max-width:760px;margin:16px auto 0;text-align:right}
  .actions button{background:#4f46e5;color:#fff;border:0;border-radius:8px;padding:10px 16px;font-size:14px;cursor:pointer}
  @media print{body{background:#fff}.page{box-shadow:none;margin:0;padding:0}.actions{display:none}}
  @media (max-width:560px){.page{padding:20px;margin:0;border-radius:0}.photos{grid-template-columns:repeat(2,1fr)}.photos img{height:160px}}
</style></head><body>
<div class="actions"><button onclick="window.print()">Imprimir / Guardar PDF</button></div>
<div class="page">
  <header>
    <h1>Imagina3D</h1>
    <div class="meta">Orçamento<br>${esc(day.format(date))}</div>
  </header>
  <div class="piece">${esc(title)}</div>
  <table>
    ${row('Quantidade', `${calc.quantity} un.`)}
    ${row('Material', `${materials} · ${Math.round(calc.weightG * calc.quantity)} g`)}
    ${row('Tempo de impressão estimado', duration)}
  </table>
  <div class="price">
    <span class="label">Valor total</span>
    <span><div class="value">${esc(fmt(calc.finalPrice))}</div>${calc.quantity > 1 ? `<div class="unit">${esc(fmt(calc.unitPrice))} / un.</div>` : ''}</span>
  </div>
  ${gallery}
  <footer>Orçamento válido até ${esc(day.format(validUntil))} (${settings.quoteValidityDays} dias). As imagens são meramente ilustrativas.</footer>
</div>
</body></html>`;
  }

  function openClientQuote() {
    const html = buildClientQuoteHtml(runLiveCalculator());
    const w = window.open('', '_blank');
    if (!w) {
      window.showToast('⚠️ O browser bloqueou a janela. Permite pop-ups para este site.');
      return;
    }
    w.document.open();
    w.document.write(html);
    w.document.close();
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
    openClientQuote,
    buildClientQuoteHtml,
    applySettingsToCalculator
  });
})();
