/**
 * Imagina3D — Painel de importação MakerWorld (UI da Calculadora)
 * Depende de: window.MakerWorld, window.appState, window.showToast, window.escapeHtml,
 *             window.runLiveCalculator, window.switchTab (definidos em index.html / calculator.js)
 */
(function () {
  'use strict';

  const FETCH_TIMEOUT_MS = 9000;
  const MW = () => window.MakerWorld;
  const esc = (s) => window.escapeHtml(s);
  const $ = (id) => document.getElementById(id);

  // Estado imutável do painel: substituído (nunca mutado) a cada alteração
  let state = null; // { design, profileId, plates: number[], spoolMap: { [key]: spoolId } }

  const filamentKey = (f) => `${f.type}|${f.color}`;
  const currentProfile = () => (state ? state.design.profiles.find((p) => p.id === state.profileId) : null);

  // ---------- Obtenção dos dados ----------
  function buildStrategies(designId) {
    const api = MW().buildApiUrl(designId);
    const enc = encodeURIComponent(api);
    const proxy = (window.appState.settings.mwProxyUrl || '').trim();
    const list = [];
    if (/^https:\/\//i.test(proxy)) {
      list.push({ name: 'Proxy próprio', url: `${proxy}${proxy.includes('?') ? '&' : '?'}id=${designId}` });
    }
    list.push({ name: 'Direto', url: api });
    list.push({ name: 'corsproxy.io', url: `https://corsproxy.io/?url=${enc}` });
    list.push({ name: 'allorigins', url: `https://api.allorigins.win/raw?url=${enc}` });
    return list;
  }

  async function fetchWithTimeout(url) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(url, { signal: ctrl.signal, headers: { Accept: 'application/json' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } finally {
      clearTimeout(timer);
    }
  }

  async function fetchDesign(designId) {
    const failures = [];
    for (const s of buildStrategies(designId)) {
      setStatus(`A obter dados (${s.name})…`, 'info');
      try {
        const raw = await fetchWithTimeout(s.url);
        return MW().normalizeDesign(raw);
      } catch (err) {
        failures.push(`${s.name}: ${err.name === 'AbortError' ? 'tempo esgotado' : err.message}`);
      }
    }
    const error = new Error('Não foi possível obter os dados automaticamente.');
    error.details = failures;
    throw error;
  }

  // ---------- Ações públicas ----------
  async function importFromInput() {
    const input = $('mw-url').value;
    const parsed = MW().parseMakerWorldUrl(input);
    if (!parsed) {
      setStatus('Link inválido. Cola o link de um modelo MakerWorld (ex.: https://makerworld.com/pt/models/123456).', 'error');
      return;
    }
    const btn = $('mw-import-btn');
    btn.disabled = true;
    hideManual();
    try {
      const design = await fetchDesign(parsed.designId);
      applyDesign(design, parsed.profileId);
    } catch (err) {
      console.warn('[MakerWorld] Importação automática falhou:', err.details || err);
      showManual(parsed.designId);
      setStatus('O MakerWorld bloqueou o acesso automático. Usa o modo manual abaixo (30 segundos) ou configura o proxy em ⚙️ Definições.', 'warn');
    } finally {
      btn.disabled = false;
    }
  }

  function importFromPaste() {
    const text = $('mw-paste').value.trim();
    if (!text) return setStatus('Cola primeiro o conteúdo copiado da página de dados.', 'error');
    try {
      const design = MW().normalizeDesign(JSON.parse(text));
      const parsed = MW().parseMakerWorldUrl($('mw-url').value);
      applyDesign(design, parsed && parsed.profileId);
      hideManual();
    } catch (err) {
      setStatus(err instanceof SyntaxError ? 'O texto colado não é JSON válido. Copia a página inteira (Ctrl+A, Ctrl+C).' : err.message, 'error');
    }
  }

  function importFromHash() {
    const match = window.location.hash.match(/^#mw=(.+)$/);
    if (!match) return false;
    history.replaceState(null, '', window.location.pathname + window.location.search);
    const data = MW().decodeFromHash(match[1]);
    try {
      const design = MW().normalizeDesign(data);
      window.switchTab('calculator');
      $('mw-url').value = design.url;
      applyDesign(design, design.defaultProfileId);
      return true;
    } catch (err) {
      window.showToast('⚠️ Dados do MakerWorld inválidos no link.');
      return false;
    }
  }

  function applyDesign(design, preferredProfileId) {
    const profileId = design.profiles.some((p) => p.id === preferredProfileId) ? preferredProfileId : design.defaultProfileId;
    const profile = design.profiles.find((p) => p.id === profileId);
    state = { design, profileId, plates: profile.plates.map((p) => p.index), spoolMap: {} };
    setStatus(`✔ Importado: ${design.profiles.length} perfil(is) de impressão disponível(is).`, 'ok');
    renderAndApply();
    window.showToast('📥 Modelo MakerWorld importado!');
  }

  function selectProfile(profileId) {
    if (!state) return;
    const profile = state.design.profiles.find((p) => p.id === profileId);
    if (!profile) return;
    state = { ...state, profileId, plates: profile.plates.map((p) => p.index) };
    renderAndApply();
  }

  function togglePlate(index, checked) {
    if (!state) return;
    const without = state.plates.filter((i) => i !== index);
    state = { ...state, plates: checked ? [...without, index].sort((a, b) => a - b) : without };
    renderAndApply();
  }

  function selectAllPlates(all) {
    const profile = currentProfile();
    if (!profile) return;
    state = { ...state, plates: all ? profile.plates.map((p) => p.index) : [] };
    renderAndApply();
  }

  function setFilamentSpool(lineIndex, spoolId) {
    const line = window.calcImport && window.calcImport.lines[lineIndex];
    if (!state || !line) return;
    state = { ...state, spoolMap: { ...state.spoolMap, [line.key]: spoolId } };
    applyToCalculator();
  }

  function clearImport() {
    state = null;
    $('mw-result').innerHTML = '';
    $('mw-result').classList.add('hidden');
    $('mw-url').value = '';
    setStatus('', 'info');
    hideManual();
    window.calcImport = null;
    renderFilamentLines();
    window.runLiveCalculator();
  }

  // ---------- Integração com a calculadora ----------
  function applyToCalculator() {
    const profile = currentProfile();
    if (!profile) return;
    const summary = MW().summarizeSelection(profile, profile.plates.length ? state.plates : null, 1);
    const spools = window.appState.spools;
    const fallbackSpool = $('calc-spool').value;
    const lines = summary.filaments.map((f) => ({
      ...f,
      key: filamentKey(f),
      spoolId: state.spoolMap[filamentKey(f)] || MW().matchSpool(f, spools) || fallbackSpool
    }));

    window.calcImport = Object.freeze({
      title: state.design.title,
      url: MW().buildModelUrl(state.design.id, state.profileId),
      profileTitle: profile.title,
      plateCount: summary.plateCount,
      totalPlates: profile.plates.length,
      baseWeightG: summary.weightG,
      lines: Object.freeze(lines)
    });

    $('calc-weight').value = Math.round(summary.weightG);
    $('calc-time').value = (summary.timeS / 3600).toFixed(2);
    renderFilamentLines();
    window.runLiveCalculator();
  }

  function renderAndApply() {
    render();
    applyToCalculator();
  }

  // ---------- Renderização ----------
  function setStatus(msg, kind) {
    const el = $('mw-status');
    if (!el) return;
    const colors = {
      info: 'text-gray-500 dark:text-gray-400',
      ok: 'text-emerald-600 dark:text-emerald-400',
      warn: 'text-amber-600 dark:text-amber-400',
      error: 'text-red-600 dark:text-red-400'
    };
    el.className = `text-[11px] mt-2 ${colors[kind] || colors.info}`;
    el.textContent = msg;
  }

  function showManual(designId) {
    $('mw-manual-link').href = MW().buildApiUrl(designId);
    $('mw-manual').classList.remove('hidden');
  }

  function hideManual() {
    $('mw-manual').classList.add('hidden');
    $('mw-paste').value = '';
  }

  function plateRow(p, checked) {
    const fil = p.filaments.map((f) => `<span class="inline-block w-2.5 h-2.5 rounded-full border border-black/10" style="background:${esc(f.color)}" title="${esc(f.type)} ${Math.round(f.grams)}g"></span>`).join('');
    return `
      <label class="flex items-center gap-2 p-2 rounded-lg border ${checked ? 'border-indigo-300 bg-indigo-50/60 dark:bg-indigo-950/30 dark:border-indigo-800' : 'border-gray-200 dark:border-notion-darkBorder opacity-60'} cursor-pointer text-[11px]">
        <input type="checkbox" ${checked ? 'checked' : ''} onchange="mwTogglePlate(${p.index}, this.checked)" class="accent-indigo-600">
        ${p.thumb ? `<img src="${esc(p.thumb)}" alt="" loading="lazy" class="w-8 h-8 rounded object-cover bg-gray-100">` : ''}
        <span class="flex-1 min-w-0">
          <span class="block font-medium truncate text-gray-800 dark:text-gray-200">${p.index}. ${esc(p.name || 'Placa ' + p.index)}</span>
          <span class="text-gray-500">${MW().formatDuration(p.timeS)} · ${Math.round(p.weightG)} g</span>
        </span>
        <span class="flex gap-0.5">${fil}</span>
      </label>`;
  }

  function render() {
    const box = $('mw-result');
    const profile = currentProfile();
    if (!state || !profile) return;
    const d = state.design;
    const summary = MW().summarizeSelection(profile, profile.plates.length ? state.plates : null, 1);
    const options = d.profiles.map((p) => `<option value="${esc(p.id)}" ${p.id === state.profileId ? 'selected' : ''}>${esc(p.title)} — ${MW().formatDuration(p.timeS)} · ${Math.round(p.weightG)} g</option>`).join('');
    const plates = profile.plates.map((p) => plateRow(p, state.plates.includes(p.index))).join('');
    const meta = [profile.printer && `🖨️ ${esc(profile.printer)}`, profile.nozzle && `Bico ${profile.nozzle} mm`, profile.needAms && 'Requer AMS/multicor'].filter(Boolean).join(' · ');

    box.innerHTML = `
      <div class="flex gap-3 items-start">
        ${d.coverUrl ? `<img src="${esc(d.coverUrl)}" alt="" class="w-16 h-16 rounded-lg object-cover bg-gray-100 shrink-0">` : ''}
        <div class="min-w-0 flex-1">
          <a href="${esc(d.url)}" target="_blank" rel="noopener noreferrer" class="text-sm font-semibold text-gray-900 dark:text-white hover:text-indigo-600 line-clamp-2">${esc(d.title)} <i class="fa-solid fa-arrow-up-right-from-square text-[10px]"></i></a>
          <div class="text-[11px] text-gray-500 mt-0.5">${meta}</div>
        </div>
        <button onclick="mwClearImport()" class="text-gray-400 hover:text-red-500 text-xs" title="Limpar importação"><i class="fa-solid fa-xmark"></i></button>
      </div>
      <div class="mt-3">
        <label class="block text-[11px] font-medium text-gray-600 dark:text-gray-300 mb-1">Perfil de impressão</label>
        <select onchange="mwSelectProfile(this.value)" class="w-full text-xs p-2 rounded-lg border border-gray-200 dark:border-notion-darkBorder bg-gray-50 dark:bg-notion-darkBg">${options}</select>
      </div>
      ${profile.plates.length ? `
        <div class="mt-3">
          <div class="flex justify-between items-center mb-1 text-[11px]">
            <span class="font-medium text-gray-600 dark:text-gray-300">Placas a imprimir (${state.plates.length}/${profile.plates.length})</span>
            <span class="space-x-2"><button onclick="mwSelectAllPlates(true)" class="text-indigo-600 hover:underline">Todas</button><button onclick="mwSelectAllPlates(false)" class="text-gray-500 hover:underline">Nenhuma</button></span>
          </div>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-1.5 max-h-56 overflow-y-auto pr-1">${plates}</div>
        </div>` : ''}
      <div class="mt-3 p-2.5 rounded-lg bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-100 dark:border-emerald-900/50 text-[11px] text-emerald-800 dark:text-emerald-300 flex flex-wrap gap-x-4 gap-y-1">
        <span><i class="fa-regular fa-clock"></i> <strong>${MW().formatDuration(summary.timeS)}</strong> por unidade</span>
        <span><i class="fa-solid fa-weight-hanging"></i> <strong>${Math.round(summary.weightG)} g</strong> por unidade</span>
        <span>Valores pré-preenchidos na calculadora ↓</span>
      </div>`;
    box.classList.remove('hidden');
  }

  function renderFilamentLines() {
    const box = $('calc-filament-lines');
    if (!box) return;
    const imp = window.calcImport;
    if (!imp || imp.lines.length === 0) {
      box.innerHTML = '';
      box.classList.add('hidden');
      $('calc-spool-wrapper').classList.remove('hidden');
      return;
    }
    const spools = window.appState.spools;
    const rows = imp.lines.map((l, idx) => {
      const opts = spools.map((s) => `<option value="${esc(s.id)}" ${s.id === l.spoolId ? 'selected' : ''}>${esc(s.name)} (${esc(s.material)})</option>`).join('');
      const warn = spools.some((s) => s.id === l.spoolId && String(s.material).toUpperCase() === l.type) ? '' : '<span class="text-amber-600" title="Sem bobina deste material no inventário">⚠️</span>';
      return `
        <div class="flex items-center gap-2 text-[11px]">
          <span class="w-3 h-3 rounded-full border border-black/10 shrink-0" style="background:${esc(l.color)}"></span>
          <span class="w-20 shrink-0 font-medium">${esc(l.type)} · ${Math.round(l.grams)}g ${warn}</span>
          <select onchange="mwSetFilamentSpool(${idx}, this.value)" class="flex-1 min-w-0 p-1.5 rounded border border-gray-200 dark:border-notion-darkBorder bg-gray-50 dark:bg-notion-darkBg">${opts}</select>
        </div>`;
    }).join('');
    box.innerHTML = `<label class="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Filamentos do modelo → Bobinas do inventário</label><div class="space-y-1.5">${rows}</div>`;
    box.classList.remove('hidden');
    $('calc-spool-wrapper').classList.add('hidden');
  }

  function renderBookmarklet() {
    const link = $('mw-bookmarklet');
    if (!link) return;
    link.href = MW().buildBookmarklet(window.location.origin + window.location.pathname);
  }

  // ---------- Exposição global ----------
  Object.assign(window, {
    mwImportFromInput: importFromInput,
    mwImportFromPaste: importFromPaste,
    mwImportFromHash: importFromHash,
    mwSelectProfile: selectProfile,
    mwTogglePlate: togglePlate,
    mwSelectAllPlates: selectAllPlates,
    mwSetFilamentSpool: setFilamentSpool,
    mwClearImport: clearImport,
    mwRenderFilamentLines: renderFilamentLines,
    mwRenderBookmarklet: renderBookmarklet
  });
})();
