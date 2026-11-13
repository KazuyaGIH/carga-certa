/* Carga Certa — utilidades gerais (datas, formatação, horários de funcionamento).
 *
 * Datas: tratamos tudo como "horário de parede" local, sem fuso. Internamente uma data/hora
 * vira "minutos desde 1970" calculados em UTC, o que evita surpresas com fuso e horário de verão.
 * Formato de texto usado em todo o projeto: "AAAA-MM-DDTHH:MM" (o mesmo do <input type="datetime-local">).
 */
(function (G) {
  'use strict';
  const CC = G.CC = G.CC || {};
  const U = CC.util = {};

  U.DIAS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
  U.DIAS_LONGOS = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];

  const p2 = (n) => String(n).padStart(2, '0');

  /** "2026-11-23T06:00" (ou só a data) -> minutos absolutos. Número passa direto. */
  U.parseDT = function (s) {
    if (s == null || s === '') return NaN;
    if (typeof s === 'number') return s;
    const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{1,2}):(\d{2}))?/.exec(String(s).trim());
    if (!m) return NaN;
    return Date.UTC(+m[1], +m[2] - 1, +m[3], m[4] ? +m[4] : 0, m[5] ? +m[5] : 0) / 60000;
  };

  U.fmtDT = function (min) {
    const d = new Date(Math.round(min) * 60000);
    return `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())}T${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}`;
  };
  U.fmtData = (min) => U.fmtDT(min).slice(0, 10);

  U.partes = function (min) {
    const d = new Date(Math.floor(min) * 60000);
    return {
      ano: d.getUTCFullYear(), mes: d.getUTCMonth() + 1, dia: d.getUTCDate(),
      h: d.getUTCHours(), mi: d.getUTCMinutes(), dow: d.getUTCDay(),
      minDia: d.getUTCHours() * 60 + d.getUTCMinutes(),
    };
  };
  U.inicioDoDia = (min) => Math.floor(min / 1440) * 1440;
  U.diaDoAno = function (min) {
    const d = new Date(Math.floor(min) * 60000);
    return Math.floor((d.getTime() - Date.UTC(d.getUTCFullYear(), 0, 1)) / 86400000) + 1;
  };

  U.fmtHora = (min) => { const p = U.partes(min); return `${p2(p.h)}:${p2(p.mi)}`; };
  U.fmtDia = (min) => { const p = U.partes(min); return `${U.DIAS[p.dow]} ${p2(p.dia)}/${p2(p.mes)}`; };
  U.fmtCurto = (min) => `${U.fmtDia(min)} ${U.fmtHora(min)}`;
  U.fmtDuracao = function (horas) {
    const h = Math.floor(horas + 1e-9), m = Math.round((horas - h) * 60);
    if (h && m) return `${h} h ${p2(m)}`;
    return h ? `${h} h` : `${m} min`;
  };

  const nf0 = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0, minimumFractionDigits: 0 });
  const nf2 = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: 2 });
  U.brl = (v, casas) => (casas ? nf2 : nf0).format(Number.isFinite(v) ? v : 0);
  U.num = (v, casas = 0) => new Intl.NumberFormat('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas }).format(Number.isFinite(v) ? v : 0);
  U.pct = (v, casas = 0) => U.num(v * 100, casas) + '%';
  U.sinal = (v, fmt) => (v > 0 ? '+' : v < 0 ? '−' : '') + fmt(Math.abs(v));

  U.clamp = (x, a, b) => Math.min(b, Math.max(a, x));
  U.clonar = (o) => JSON.parse(JSON.stringify(o));
  U.esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  U.normalizar = (s) => String(s == null ? '' : s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  U.numeroBR = function (s) { // aceita "1,5" e "1.5"
    if (typeof s === 'number') return s;
    const t = String(s == null ? '' : s).trim().replace(/\s/g, '').replace(',', '.');
    return t === '' ? NaN : Number(t);
  };

  /** Gerador pseudoaleatório com semente (mulberry32): mesma entrada -> mesmo plano. */
  U.rng = function (seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };

  // ------------------------------------------------------------------
  // Horários de funcionamento em texto simples, por exemplo:
  //   "seg-sex 06:00-22:00; sab 06:00-14:00"   "todos 00:00-24:00"   "22:00-06:00" (vira a noite)
  // ------------------------------------------------------------------
  const DIA_IDX = { dom: 0, seg: 1, ter: 2, qua: 3, qui: 4, sex: 5, sab: 6 };

  function parseDias(txt) {
    const t = U.normalizar(txt).replace(/-?feira/g, '').replace(/\s+/g, ' ').trim();
    const dias = [false, false, false, false, false, false, false];
    if (!t || /^(todos( os dias)?|diario|todo dia|sempre)$/.test(t)) return dias.map(() => true);
    if (/^(fds|fim de semana)$/.test(t)) { dias[0] = dias[6] = true; return dias; }
    if (/^(uteis|dias uteis)$/.test(t)) { for (let i = 1; i <= 5; i++) dias[i] = true; return dias; }
    for (const parte of t.split(/\s*,\s*|\s+e\s+|\s+/)) {
      if (!parte) continue;
      const r = /^([a-z]{3})[a-z]*(?:-([a-z]{3})[a-z]*)?$/.exec(parte);
      if (!r || !(r[1] in DIA_IDX) || (r[2] && !(r[2] in DIA_IDX))) return null;
      const a = DIA_IDX[r[1]], b = r[2] ? DIA_IDX[r[2]] : a;
      for (let i = a; ; i = (i + 1) % 7) { dias[i] = true; if (i === b) break; }
    }
    return dias;
  }

  U.parseHora = function (txt) {
    const m = /^(\d{1,2})(?:[:h](\d{2})?)?h?$/.exec(String(txt == null ? '' : txt).trim().toLowerCase());
    if (!m) return NaN;
    const h = +m[1], mi = m[2] ? +m[2] : 0;
    if (h > 24 || mi > 59 || (h === 24 && mi > 0)) return NaN;
    return h * 60 + mi;
  };

  U.parseJanela = function (spec) {
    const janelas = [], erros = [];
    const txt = String(spec == null ? '' : spec).trim();
    if (!txt || /^(fechad|nenhum|-$)/i.test(txt)) return { janelas, erros };
    for (const seg of txt.split(/[;\n]+/)) {
      const s = seg.trim();
      if (!s) continue;
      const m = /^(.*?)\s*(\d{1,2}(?::\d{2}|h\d{0,2})?)\s*(?:-|a|até|ate|às|as)\s*(\d{1,2}(?::\d{2}|h\d{0,2})?)\s*$/i.exec(s);
      if (!m) { erros.push(s); continue; }
      const dias = parseDias(m[1]);
      const ini = U.parseHora(m[2]);
      let fim = U.parseHora(m[3]);
      if (!dias || isNaN(ini) || isNaN(fim)) { erros.push(s); continue; }
      if (fim <= ini) fim += 1440; // atravessa a meia-noite
      janelas.push({ dias, ini, fim });
    }
    return { janelas, erros };
  };

  U.janelaAtiva = function (janelas, dow, minDia) {
    for (const j of janelas) {
      if (j.dias[dow] && minDia >= j.ini && minDia < Math.min(j.fim, 1440)) return true;
      if (j.fim > 1440 && j.dias[(dow + 6) % 7] && minDia < j.fim - 1440) return true;
    }
    return false;
  };
  U.janela24h = (janelas) => janelas.some((j) => j.dias.every(Boolean) && j.ini === 0 && j.fim >= 1440);
})(typeof window !== 'undefined' ? window : globalThis);
