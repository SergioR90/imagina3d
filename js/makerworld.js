/**
 * Imagina3D — Importação de modelos MakerWorld
 * Lógica pura (sem DOM): parsing de links, normalização dos dados da API,
 * agregação de placas/filamentos, codificação para URL e geração do bookmarklet.
 * Funciona como <script> clássico (window.MakerWorld) e como módulo CommonJS (testes Node).
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.MakerWorld = api;
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const API_BASE = 'https://makerworld.com/api/v1/design-service/design/';
  const MAX_ID_DIGITS = 12;
  const MAX_TEXT = 300;
  const MAX_QUANTITY = 1000;
  const FALLBACK_COLOR = '#999999';

  // ---------- Sanitização ----------
  const toNum = (v) => {
    const n = typeof v === 'number' ? v : parseFloat(v);
    return Number.isFinite(n) && n > 0 ? n : 0;
  };
  const toText = (v, max = MAX_TEXT) => (typeof v === 'string' || typeof v === 'number' ? String(v).trim().slice(0, max) : '');
  const toColor = (v) => (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v.trim()) ? v.trim().toUpperCase() : FALLBACK_COLOR);
  const toHttpsUrl = (v) => (typeof v === 'string' && /^https:\/\/[^\s"'<>]+$/i.test(v) ? v : '');
  const toId = (v) => {
    const s = toText(v, MAX_ID_DIGITS + 1);
    return new RegExp(`^\\d{1,${MAX_ID_DIGITS}}$`).test(s) ? s : '';
  };

  // ---------- Links ----------
  function parseMakerWorldUrl(input) {
    if (typeof input !== 'string') return null;
    const value = input.trim();
    if (!value) return null;

    const plainId = toId(value);
    if (plainId) return { designId: plainId, profileId: null };

    const isMakerWorld = /^(https?:\/\/)?([a-z0-9-]+\.)*makerworld\.com(\.cn)?(\/|$)/i.test(value);
    if (!isMakerWorld) return null;

    const model = value.match(new RegExp(`/models/(\\d{1,${MAX_ID_DIGITS}})(?!\\d)`));
    if (!model) return null;
    const profile = value.match(/profileId-(\d{1,12})/);
    return { designId: model[1], profileId: profile ? profile[1] : null };
  }

  function buildApiUrl(designId) {
    const id = toId(designId);
    if (!id) throw new Error('ID de modelo MakerWorld inválido.');
    return API_BASE + id;
  }

  function buildModelUrl(designId, profileId) {
    const base = `https://makerworld.com/en/models/${designId}`;
    return profileId ? `${base}#profileId-${profileId}` : base;
  }

  // ---------- Normalização ----------
  const toMaterial = (v) => toText(v, 20).toUpperCase().replace(/[^A-Z0-9+\-_. ]/g, '');

  const normFilaments = (list) =>
    (Array.isArray(list) ? list : []).map((f) => ({
      type: toMaterial(f && f.type) || 'PLA',
      color: toColor(f && f.color),
      grams: toNum(f && (f.grams !== undefined ? f.grams : f.usedG))
    }));

  const normPlate = (p) => ({
    index: toNum(p && p.index),
    name: toText(p && p.name, 120),
    timeS: toNum(p && (p.timeS !== undefined ? p.timeS : p.prediction)),
    weightG: toNum(p && (p.weightG !== undefined ? p.weightG : p.weight)),
    thumb: toHttpsUrl(p && (p.thumb !== undefined ? p.thumb : p.thumbnail && p.thumbnail.url)),
    filaments: normFilaments(p && p.filaments)
  });

  function normRawProfile(inst) {
    const info = (inst.extention && inst.extention.modelInfo) || {};
    const compat = info.compatibility || {};
    return {
      id: toId(inst.id),
      title: toText(inst.title, 160),
      timeS: toNum(inst.prediction),
      weightG: toNum(inst.weight),
      needAms: Boolean(inst.needAms),
      printer: toText(compat.devProductName, 40),
      nozzle: toNum(compat.nozzleDiameter),
      filaments: normFilaments(inst.instanceFilaments),
      plates: (Array.isArray(info.plates) ? info.plates : []).map(normPlate)
    };
  }

  function normCleanProfile(p) {
    return {
      id: toId(p.id),
      title: toText(p.title, 160),
      timeS: toNum(p.timeS),
      weightG: toNum(p.weightG),
      needAms: Boolean(p.needAms),
      printer: toText(p.printer, 40),
      nozzle: toNum(p.nozzle),
      filaments: normFilaments(p.filaments),
      plates: (Array.isArray(p.plates) ? p.plates : []).map(normPlate)
    };
  }

  function normalizeDesign(raw) {
    if (!raw || typeof raw !== 'object') {
      throw new Error('Os dados não correspondem a um modelo MakerWorld.');
    }
    const isClean = Array.isArray(raw.profiles);
    const source = isClean ? raw.profiles : raw.instances;
    const id = toId(raw.id);
    if (!id || !Array.isArray(source)) {
      throw new Error('Os dados não correspondem a um modelo MakerWorld (faltam perfis de impressão).');
    }

    const profiles = source
      .filter((p) => p && typeof p === 'object')
      .map(isClean ? normCleanProfile : normRawProfile)
      .filter((p) => p.id);
    if (profiles.length === 0) {
      throw new Error('Este modelo MakerWorld não tem perfis de impressão publicados.');
    }

    const wantedDefault = toId(isClean ? raw.defaultProfileId : raw.defaultInstanceId);
    const defaultProfileId = profiles.some((p) => p.id === wantedDefault) ? wantedDefault : profiles[0].id;
    const cleanUrl = isClean && /^https:\/\/makerworld\.com(\.cn)?\//i.test(raw.url || '') ? toHttpsUrl(raw.url) : '';

    return {
      id,
      title: toText(raw.title, 200) || `Modelo MakerWorld ${id}`,
      coverUrl: toHttpsUrl(raw.coverUrl),
      url: cleanUrl || buildModelUrl(id),
      defaultProfileId,
      profiles
    };
  }

  // ---------- Agregação ----------
  function aggregateFilaments(lists, multiplier) {
    const map = new Map();
    lists.flat().forEach((f) => {
      const key = `${f.type}|${f.color}`;
      const prev = map.get(key);
      map.set(key, { type: f.type, color: f.color, grams: (prev ? prev.grams : 0) + f.grams * multiplier });
    });
    return Array.from(map.values());
  }

  function clampQuantity(q) {
    const n = Math.floor(toNum(q));
    return Math.min(MAX_QUANTITY, Math.max(1, n || 1));
  }

  function summarizeSelection(profile, plateIndexes, quantity) {
    const qty = clampQuantity(quantity);
    const plates = Array.isArray(profile && profile.plates) ? profile.plates : [];

    if (plates.length === 0) {
      return {
        timeS: toNum(profile && profile.timeS) * qty,
        weightG: toNum(profile && profile.weightG) * qty,
        plateCount: 0,
        quantity: qty,
        filaments: aggregateFilaments([normFilaments(profile && profile.filaments)], qty)
      };
    }

    const wanted = Array.isArray(plateIndexes) ? new Set(plateIndexes.map(Number)) : null;
    const selected = wanted ? plates.filter((p) => wanted.has(p.index)) : plates;
    return {
      timeS: selected.reduce((a, p) => a + p.timeS, 0) * qty,
      weightG: selected.reduce((a, p) => a + p.weightG, 0) * qty,
      plateCount: selected.length,
      quantity: qty,
      filaments: aggregateFilaments(selected.map((p) => p.filaments), qty)
    };
  }

  // ---------- Formatação ----------
  function formatDuration(seconds) {
    const total = Math.round(toNum(seconds) / 60);
    const h = Math.floor(total / 60);
    const m = total % 60;
    return `${h}h ${String(m).padStart(2, '0')}m`;
  }

  // ---------- Correspondência com o inventário ----------
  const hexToRgb = (hex) => {
    const c = toColor(hex).slice(1);
    return [0, 2, 4].map((i) => parseInt(c.slice(i, i + 2), 16));
  };
  const colorDistance = (a, b) => {
    const [r1, g1, b1] = hexToRgb(a);
    const [r2, g2, b2] = hexToRgb(b);
    return Math.hypot(r1 - r2, g1 - g2, b1 - b2);
  };

  function matchSpool(filament, spools) {
    const type = toText(filament && filament.type, 20).toUpperCase();
    const sameMaterial = (Array.isArray(spools) ? spools : []).filter(
      (s) => toText(s && s.material, 20).toUpperCase() === type
    );
    if (sameMaterial.length === 0) return null;
    const inStock = sameMaterial.filter((s) => toNum(s.remainingWeight) > 0);
    const pool = inStock.length > 0 ? inStock : sameMaterial;
    const best = pool.reduce((acc, s) => {
      const d = colorDistance(filament.color, s.colorHex);
      return !acc || d < acc.d ? { id: s.id, d } : acc;
    }, null);
    return best ? best.id : null;
  }

  // ---------- Codificação para hash do URL (base64url UTF-8) ----------
  function encodeForHash(obj) {
    const bytes = new TextEncoder().encode(JSON.stringify(obj));
    let bin = '';
    bytes.forEach((b) => { bin += String.fromCharCode(b); });
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function decodeFromHash(str) {
    try {
      const b64 = String(str).replace(/-/g, '+').replace(/_/g, '/');
      const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
      const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
      return JSON.parse(new TextDecoder().decode(bytes));
    } catch (err) {
      return null;
    }
  }

  // ---------- Bookmarklet (corre dentro de makerworld.com, sem CORS) ----------
  function buildBookmarklet(appUrl) {
    const target = toHttpsUrl(appUrl) || String(appUrl || '');
    const code = `(async()=>{try{var A=${JSON.stringify(target)};var m=location.pathname.match(/models\\/(\\d+)/);` +
      `if(!/makerworld\\./.test(location.hostname)||!m){alert('Abre primeiro a página de um modelo no MakerWorld.');return}` +
      `var h=location.hash.match(/profileId-(\\d+)/);` +
      `var r=await fetch('/api/v1/design-service/design/'+m[1],{credentials:'include'});if(!r.ok)throw new Error('HTTP '+r.status);` +
      `var d=await r.json();var F=function(a){return(a||[]).map(function(f){return{type:f.type,color:f.color,grams:+f.usedG||0}})};` +
      `var o={id:String(d.id),title:d.title,coverUrl:d.coverUrl,url:location.origin+location.pathname,` +
      `defaultProfileId:String(h?h[1]:d.defaultInstanceId),profiles:(d.instances||[]).map(function(i){` +
      `var mi=(i.extention&&i.extention.modelInfo)||{};var c=mi.compatibility||{};` +
      `return{id:String(i.id),title:i.title,timeS:+i.prediction||0,weightG:+i.weight||0,needAms:!!i.needAms,` +
      `printer:c.devProductName||'',nozzle:+c.nozzleDiameter||0,filaments:F(i.instanceFilaments),` +
      `plates:(mi.plates||[]).map(function(p){return{index:+p.index,name:p.name||'',timeS:+p.prediction||0,` +
      `weightG:+p.weight||0,thumb:(p.thumbnail&&p.thumbnail.url)||'',filaments:F(p.filaments)}})}})};` +
      `var b=new TextEncoder().encode(JSON.stringify(o));var s='';b.forEach(function(x){s+=String.fromCharCode(x)});` +
      `var e=btoa(s).replace(/\\+/g,'-').replace(/\\//g,'_').replace(/=+$/,'');window.open(A+'#mw='+e,'_blank')}` +
      `catch(err){alert('Imagina3D: não foi possível ler o modelo ('+err.message+')')}})();`;
    return 'javascript:' + encodeURIComponent(code);
  }

  return {
    parseMakerWorldUrl,
    buildApiUrl,
    buildModelUrl,
    normalizeDesign,
    summarizeSelection,
    formatDuration,
    matchSpool,
    encodeForHash,
    decodeFromHash,
    buildBookmarklet
  };
});
