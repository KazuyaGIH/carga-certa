/* Carga Certa — gráficos (Chart.js 4, incluído na pasta vendor) e agenda das máquinas (HTML). */
(function (G) {
  'use strict';
  const CC = G.CC = G.CC || {};
  const U = CC.util;
  const GR = CC.graficos = {};

  const COR = GR.CORES = {
    base: '#aab4c0', maq: '#4b77b8', flex: '#2f9e86', solar: '#d98b0b', rede: '#18212b', antes: '#8a95a3',
    ponta: 'rgba(200, 55, 45, 0.10)', inter: 'rgba(222, 150, 20, 0.13)', contratada: '#b42318', limite: '#6941c6',
    texto: '#566170', grade: '#e8ebef', acento: '#0f6b5c', cinza: '#c5ccd5',
  };
  GR.PALETA = ['#3b6fb6', '#d9822b', '#2a9d8f', '#b5485d', '#7a5cc4', '#5b8c2a', '#c2410c', '#0e7490', '#a16207',
    '#9d4edd', '#2f6f4f', '#b23a48', '#4361ee', '#6c757d', '#8d6e63', '#00897b'];
  const rgba = (hex, a) => { const n = parseInt(hex.slice(1), 16); return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`; };
  GR.rgba = rgba;

  function disponivel() { return typeof G.Chart === 'function'; }
  function destruir(canvas) { if (canvas && canvas._grafico) { canvas._grafico.destroy(); canvas._grafico = null; } }
  GR.destruir = destruir;

  // ------------------------------------------------------------------ faixas de ponta, linhas de referência
  const pluginReferencias = {
    id: 'referencias',
    beforeDatasetsDraw(chart) {
      const o = chart.options.plugins.referencias;
      if (!o || !o.inst) return;
      const { ctx, chartArea: a, scales: { x } } = chart, inst = o.inst, T = inst.T;
      ctx.save();
      let t = 0;
      while (t < T) {
        const p = inst.posto[t];
        let k = t;
        while (k < T && inst.posto[k] === p) k++;
        if (p > 0) {
          const x0 = Math.max(a.left, x.getPixelForValue(t)), x1 = Math.min(a.right, x.getPixelForValue(k));
          ctx.fillStyle = p === 2 ? COR.ponta : COR.inter;
          ctx.fillRect(x0, a.top, x1 - x0, a.bottom - a.top);
        }
        t = k;
      }
      ctx.strokeStyle = '#d5dae0'; ctx.lineWidth = 1;
      const porDia = 1440 / inst.passo;
      for (let d = 1; d < inst.dias; d++) {
        const xx = Math.round(x.getPixelForValue(d * porDia)) + 0.5;
        ctx.beginPath(); ctx.moveTo(xx, a.top); ctx.lineTo(xx, a.bottom); ctx.stroke();
      }
      ctx.restore();
    },
    afterDatasetsDraw(chart) {
      const o = chart.options.plugins.referencias;
      if (!o) return;
      const { ctx, chartArea: a, scales: { x, y } } = chart, inst = o.inst;
      ctx.save();
      ctx.font = '11px system-ui, "Segoe UI", sans-serif';
      for (const ref of o.horizontais || []) {
        const yy = y.getPixelForValue(ref.valor);
        if (yy < a.top || yy > a.bottom) continue;
        ctx.strokeStyle = ref.cor; ctx.setLineDash([6, 4]); ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.moveTo(a.left, yy); ctx.lineTo(a.right, yy); ctx.stroke();
        ctx.setLineDash([]); ctx.textAlign = 'right';
        if (ref.fundo) { // rótulo sobre as barras: caixinha branca para continuar legível
          const w = ctx.measureText(ref.rotulo).width;
          ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
          ctx.fillRect(a.right - 8 - w, yy - 16, w + 8, 14);
        }
        ctx.fillStyle = ref.cor;
        ctx.fillText(ref.rotulo, a.right - 4, yy - 4);
      }
      if (inst && o.limites) { // trechos com limite de demanda pedido
        ctx.strokeStyle = COR.limite; ctx.lineWidth = 2;
        let t = 0;
        while (t < inst.T) {
          if (!Number.isFinite(inst.cap[t])) { t++; continue; }
          const v = inst.cap[t];
          let k = t;
          while (k < inst.T && inst.cap[k] === v) k++;
          const yy = y.getPixelForValue(v);
          ctx.beginPath(); ctx.moveTo(x.getPixelForValue(t), yy); ctx.lineTo(x.getPixelForValue(k), yy); ctx.stroke();
          ctx.fillStyle = COR.limite; ctx.textAlign = 'left';
          ctx.fillText(`limite ${U.num(v)} kW`, x.getPixelForValue(t) + 2, yy - 4);
          t = k;
        }
      }
      if (inst && o.agora > 0 && o.agora < inst.T) {
        const xx = Math.round(x.getPixelForValue(o.agora)) + 0.5;
        ctx.strokeStyle = '#18212b'; ctx.lineWidth = 1; ctx.setLineDash([2, 3]);
        ctx.beginPath(); ctx.moveTo(xx, a.top); ctx.lineTo(xx, a.bottom); ctx.stroke();
        ctx.setLineDash([]); ctx.fillStyle = '#18212b'; ctx.textAlign = 'left'; ctx.fillText('agora', xx + 3, a.top + 11);
      }
      for (const m of o.verticais || []) {
        const xx = x.getPixelForValue(m.valor);
        if (xx < a.left || xx > a.right) continue;
        ctx.strokeStyle = m.cor; ctx.lineWidth = 1.4; ctx.setLineDash(m.tracejado ? [5, 4] : []);
        ctx.beginPath(); ctx.moveTo(xx, a.top); ctx.lineTo(xx, a.bottom); ctx.stroke();
        ctx.setLineDash([]); ctx.fillStyle = m.cor; ctx.textAlign = 'left'; ctx.fillText(m.rotulo, xx + 4, a.top + 12 + (m.desloc || 0));
      }
      ctx.restore();
    },
  };

  const base = () => ({
    responsive: true, maintainAspectRatio: false, animation: false, normalized: true,
    plugins: { legend: { position: 'bottom', labels: { boxWidth: 12, boxHeight: 12, color: COR.texto, font: { size: 12 } } } },
  });

  // ------------------------------------------------------------------ curva de carga
  /** av = avaliação detalhada mostrada; opc: { avBase (para comparar), contratadas: [{valor, rotulo}], agora } */
  GR.curvaCarga = function (canvas, inst, av, opc) {
    destruir(canvas);
    if (!disponivel() || !av || !av.arr) return null;
    opc = opc || {};
    const A = av.arr, T = inst.T;
    const serie = (fn) => { const r = new Array(T); for (let t = 0; t < T; t++) r[t] = { x: t, y: fn(t) }; return r; };
    const ds = [
      { label: 'Cargas fixas', bruto: A.base, data: serie((t) => A.base[t]), fill: 'origin', backgroundColor: rgba(COR.base, 0.55), borderColor: rgba(COR.base, 0.9), borderWidth: 0.5 },
      { label: 'Máquinas', bruto: A.maq, data: serie((t) => A.base[t] + A.maq[t]), fill: '-1', backgroundColor: rgba(COR.maq, 0.42), borderColor: rgba(COR.maq, 0.8), borderWidth: 0.5 },
      { label: 'Cargas flexíveis', bruto: A.flx, data: serie((t) => A.base[t] + A.maq[t] + A.flx[t]), fill: '-1', backgroundColor: rgba(COR.flex, 0.5), borderColor: rgba(COR.flex, 0.85), borderWidth: 0.5 },
    ];
    if (inst.kWp > 0) ds.push({ label: 'Solar disponível', bruto: A.pvDisp, data: serie((t) => A.pvDisp[t]), fill: false, borderColor: COR.solar, borderWidth: 1.6, borderDash: [5, 4] });
    ds.push({ label: 'Puxado da rede', bruto: A.imp, data: serie((t) => A.imp[t]), fill: false, borderColor: COR.rede, borderWidth: 1.7 });
    if (opc.avBase && opc.avBase.arr) ds.push({ label: 'Rede, como é hoje', bruto: opc.avBase.arr.imp, data: serie((t) => opc.avBase.arr.imp[t]), fill: false, borderColor: '#c2410c', borderWidth: 1.3, borderDash: [3, 3] });
    for (const d of ds) { d.pointRadius = 0; d.pointHoverRadius = 2; d.tension = 0; }
    const porDia = 1440 / inst.passo;
    const op = base();
    if (opc.estatico) { op.responsive = false; op.devicePixelRatio = 2; }
    op.parsing = false;
    op.interaction = { mode: 'index', intersect: false };
    op.scales = {
      x: {
        type: 'linear', min: 0, max: T, grid: { display: false },
        ticks: {
          stepSize: porDia / 2, autoSkip: false, maxRotation: 0, color: COR.texto, font: { size: 11 },
          callback: (v) => (v >= T ? '' : v % porDia === 0 ? U.fmtDia(inst.tempo(v)) : '12h'),
        },
      },
      y: { beginAtZero: true, grid: { color: COR.grade }, ticks: { color: COR.texto, callback: (v) => `${v} kW` } },
    };
    op.plugins.legend.onClick = null;
    op.plugins.tooltip = {
      callbacks: {
        title: (it) => (it.length ? U.fmtCurto(inst.tempo(Math.round(it[0].parsed.x))) : ''),
        label: (c) => ` ${c.dataset.label}: ${U.num(c.dataset.bruto[c.dataIndex], 1)} kW`,
      },
    };
    op.plugins.referencias = { inst, horizontais: opc.contratadas || [], limites: true, agora: opc.agora };
    const g = new G.Chart(canvas, { type: 'line', data: { datasets: ds }, options: op, plugins: [pluginReferencias] });
    canvas._grafico = g;
    return g;
  };

  // ------------------------------------------------------------------ modalidades
  GR.barrasModalidades = function (canvas, linhas) {
    destruir(canvas);
    if (!disponivel() || !linhas) return null;
    const op = base();
    op.scales = {
      x: { grid: { display: false }, ticks: { color: COR.texto } },
      y: { beginAtZero: true, grid: { color: COR.grade }, ticks: { color: COR.texto, callback: (v) => U.brl(v) } },
    };
    op.plugins.tooltip = { callbacks: { label: (c) => ` ${c.dataset.label}: ${U.brl(c.parsed.y)}/mês` } };
    const g = new G.Chart(canvas, {
      type: 'bar',
      data: {
        labels: linhas.map((l) => l.nome.replace('Horária ', '') + (l.mesmoGrupo ? '' : ' *')),
        datasets: [
          { label: 'Agenda de hoje', data: linhas.map((l) => l.contaHoje), backgroundColor: COR.cinza, borderRadius: 3 },
          { label: 'Agenda replanejada para a tarifa', data: linhas.map((l) => (l.contaReplanejada != null ? l.contaReplanejada : l.contaAgendaAtual)), backgroundColor: linhas.map((l) => (l.mesmoGrupo ? COR.acento : rgba(COR.acento, 0.35))), borderRadius: 3 },
        ],
      },
      options: op,
    });
    canvas._grafico = g;
    return g;
  };

  // ------------------------------------------------------------------ acompanhamento das faturas
  /** r = resultado de CC.impacto.acompanhar: barras do valor de cada mês (cinza antes do plano, verde depois). */
  GR.barrasFaturas = function (canvas, r) {
    destruir(canvas);
    if (!disponivel() || !r) return null;
    const lista = r.faturas.filter((f) => Number.isFinite(f.valor));
    if (!lista.length) return null;
    const fmtMes = CC.impacto.fmtMes;
    const depois = (f) => !!r.inicio && f.mes >= r.inicio;
    const op = base();
    op.plugins.legend.display = false;
    op.scales = {
      x: { grid: { display: false }, ticks: { color: COR.texto } },
      y: { beginAtZero: true, grid: { color: COR.grade }, ticks: { color: COR.texto, callback: (v) => U.brl(v) } },
    };
    op.plugins.tooltip = { callbacks: { label: (c) => ` ${U.brl(c.parsed.y)}${depois(lista[c.dataIndex]) ? ' (seguindo o plano)' : ' (antes do plano)'}` } };
    const refs = [];
    const mA = r.mediaAntes && r.mediaAntes.valor;
    if (mA != null) {
      refs.push({ valor: mA, rotulo: `média antes ${U.brl(mA)}`, cor: '#566170', fundo: true });
      if (r.previsto && r.previsto.economiaPct > 0) {
        const prev = mA * (1 - r.previsto.economiaPct);
        refs.push({ valor: prev, rotulo: `previsto com o plano ${U.brl(prev)}`, cor: COR.acento, fundo: true });
      }
    }
    op.plugins.referencias = { horizontais: refs };
    const g = new G.Chart(canvas, {
      type: 'bar',
      data: {
        labels: lista.map((f) => fmtMes(f.mes)),
        datasets: [{ label: 'Valor da fatura', data: lista.map((f) => f.valor), backgroundColor: lista.map((f) => (depois(f) ? COR.acento : COR.cinza)), borderRadius: 3, maxBarThickness: 46 }],
      },
      options: op,
      plugins: [pluginReferencias],
    });
    canvas._grafico = g;
    return g;
  };

  // ------------------------------------------------------------------ demanda contratada
  GR.curvaDemanda = function (canvas, parcela) {
    destruir(canvas);
    if (!disponivel() || !parcela) return null;
    const op = base();
    op.parsing = false;
    op.plugins.legend.display = false;
    op.scales = {
      x: { type: 'linear', title: { display: true, text: 'Demanda contratada (kW)', color: COR.texto }, grid: { display: false }, ticks: { color: COR.texto } },
      y: { beginAtZero: true, grid: { color: COR.grade }, ticks: { color: COR.texto, callback: (v) => U.brl(v) } },
    };
    op.plugins.tooltip = { callbacks: { title: (it) => `${it[0].parsed.x} kW contratados`, label: (c) => ` ${U.brl(c.parsed.y)}/mês de demanda` } };
    op.plugins.referencias = {
      verticais: [
        { valor: parcela.contratada, cor: COR.texto, rotulo: `atual ${U.num(parcela.contratada)} kW`, tracejado: true },
        { valor: parcela.recomendada, cor: COR.acento, rotulo: `sugerida ${U.num(parcela.recomendada)} kW`, desloc: 14 },
        { valor: parcela.medida, cor: COR.contratada, rotulo: `pico planejado ${U.num(parcela.medida)} kW`, tracejado: true, desloc: 28 },
      ],
    };
    const ds = [{ data: parcela.curva.map((p) => ({ x: p.dc, y: p.custo })), borderColor: COR.rede, borderWidth: 1.8, pointRadius: 0, fill: false, tension: 0 }];
    const g = new G.Chart(canvas, { type: 'line', data: { datasets: ds }, options: op, plugins: [pluginReferencias] });
    canvas._grafico = g;
    return g;
  };

  // ------------------------------------------------------------------ solar
  GR.curvaSolar = function (canvas, res) {
    destruir(canvas);
    if (!disponivel() || !res) return null;
    const op = base();
    op.scales = {
      x: { grid: { display: false }, ticks: { color: COR.texto } },
      y: { beginAtZero: true, position: 'left', grid: { color: COR.grade }, ticks: { color: COR.texto, callback: (v) => U.brl(v) }, title: { display: true, text: 'Economia por mês', color: COR.texto } },
      y2: { beginAtZero: true, suggestedMax: 10, position: 'right', grid: { display: false }, ticks: { color: COR.solar, precision: 0, callback: (v) => `${U.num(v)} kWh` }, title: { display: true, text: 'Energia cortada por mês', color: COR.solar } },
    };
    op.plugins.tooltip = {
      callbacks: {
        label: (c) => (c.dataset.yAxisID === 'y2' ? ` Cortado: ${U.num(c.parsed.y)} kWh/mês` : ` Economia: ${U.brl(c.parsed.y)}/mês`),
      },
    };
    const cores = res.linhas.map((l) => (l === res.recomendado ? COR.acento : l.kWp === res.atual ? '#4b77b8' : COR.cinza));
    const g = new G.Chart(canvas, {
      data: {
        labels: res.linhas.map((l) => `${l.kWp} kWp`),
        datasets: [
          { type: 'bar', label: 'Economia na conta', data: res.linhas.map((l) => l.economiaMes), backgroundColor: cores, borderRadius: 3, yAxisID: 'y', order: 2 },
          { type: 'line', label: 'Cortado (limite de injeção + volt-watt)', data: res.linhas.map((l) => l.cortLimMes + l.cortVWMes), borderColor: COR.solar, backgroundColor: COR.solar, pointRadius: 3, tension: 0, yAxisID: 'y2', order: 1 },
        ],
      },
      options: op,
    });
    canvas._grafico = g;
    return g;
  };

  // ------------------------------------------------------------------ agenda das máquinas (Gantt em HTML)
  GR.gantt = function (cont, inst, plano, opc) {
    opc = opc || {};
    const porDia = 1440 / inst.passo;
    const a = opc.dia >= 0 ? opc.dia * porDia : 0, b = opc.dia >= 0 ? Math.min(inst.T, a + porDia) : inst.T, span = b - a;
    const L = (t) => `${((Math.max(a, t) - a) / span * 100).toFixed(3)}%`;
    const W = (t0, t1) => `${((Math.min(b, t1) - Math.max(a, t0)) / span * 100).toFixed(3)}%`;
    const esc = U.esc;
    const trechos = (n, teste) => { // intervalos [i, k) onde teste(t) é verdadeiro
      const r = [];
      let t = a;
      while (t < b) {
        if (!teste(t)) { t++; continue; }
        let k = t;
        while (k < b && teste(k)) k++;
        r.push([t, k]); t = k;
      }
      return r;
    };
    let h = '<div class="g-linha g-eixo"><div class="g-rot"></div><div class="g-trilho">';
    if (opc.dia >= 0) { for (let hh = 0; hh < 24; hh += 2) h += `<span class="g-tick" style="left:${L(a + hh * 60 / inst.passo)}">${String(hh).padStart(2, '0')}h</span>`; }
    else { for (let d = 0; d < inst.dias; d++) h += `<span class="g-tick" style="left:${L(d * porDia)}">${U.fmtDia(inst.tempo(d * porDia))}</span>`; }
    h += '</div></div>';
    const ponta = trechos(0, (t) => inst.posto[t] === 2).map(([x, y]) => `<i class="g-ponta" style="left:${L(x)};width:${W(x, y)}"></i>`).join('');
    const dias = opc.dia >= 0 ? '' : Array.from({ length: inst.dias - 1 }, (_, d) => `<i class="g-dia" style="left:${L((d + 1) * porDia)}"></i>`).join('');
    const agora = inst.agoraSlot > a && inst.agoraSlot < b ? `<i class="g-agora" style="left:${L(inst.agoraSlot)}"></i>` : '';
    for (const M of inst.maquinas) {
      for (let u = 0; u < M.unidades; u++) {
        const fechado = trechos(0, (t) => !M.perm[t]).map(([x, y]) => `<i class="g-fechado" style="left:${L(x)};width:${W(x, y)}"></i>`).join('');
        const parada = trechos(0, (t) => M.bloq[u][t]).map(([x, y]) => `<i class="g-parada" style="left:${L(x)};width:${W(x, y)}" data-dica="${esc(`${M.nome}${M.unidades > 1 ? ` (unidade ${u + 1})` : ''} parada\n${U.fmtCurto(inst.tempo(x))} até ${U.fmtCurto(inst.tempo(y))}`)}"></i>`).join('');
        let barras = '';
        inst.ops.forEach((op, o) => {
          const s = plano.ini[o];
          if (s < 0 || op.maq !== M.idx || plano.uni[o] !== u || s + op.dur <= a || s >= b) return;
          const ped = inst.pedidos[op.pedido];
          const cor = GR.PALETA[ped.idx % GR.PALETA.length];
          const fimPed = ped.ops.reduce((m, oo) => Math.max(m, plano.ini[oo] >= 0 ? plano.ini[oo] + inst.ops[oo].dur : -1), -1);
          const atrasa = fimPed > ped.prazo;
          const dica = `${ped.id} · etapa ${op.etapa + 1} de ${ped.ops.length} · ${M.nome}${M.unidades > 1 ? ` (unidade ${u + 1})` : ''}\n${U.fmtCurto(inst.tempo(s))} até ${U.fmtCurto(inst.tempo(s + op.dur))} (${U.fmtDuracao(op.dur * inst.dt)}) · ${U.num(op.kW, 1)} kW\n${ped.cliente} · ${ped.produto}\nPrazo do pedido: ${U.fmtCurto(inst.tempo(ped.prazo))}${atrasa ? ' · ATRASA' : ''}`;
          barras += `<b class="g-barra${atrasa ? ' atrasa' : ''}${opc.destaque === ped.id ? ' destaque' : ''}" style="left:${L(s)};width:${W(s, s + op.dur)};background:${cor}" data-dica="${esc(dica)}" data-pedido="${esc(ped.id)}">${esc(ped.id)}</b>`;
        });
        h += `<div class="g-linha"><div class="g-rot" title="${esc(M.nome)}">${esc(M.nome)}${M.unidades > 1 ? ` <small>${u + 1}</small>` : ''}</div><div class="g-trilho">${ponta}${dias}${fechado}${parada}${barras}${agora}</div></div>`;
      }
    }
    const grupos = new Map();
    inst.flex.forEach((f, i) => { if (!grupos.has(f.base)) grupos.set(f.base, []); grupos.get(f.base).push(i); });
    for (const [, idxs] of grupos) {
      const nome = inst.flex[idxs[0]].nome;
      let barras = '';
      for (const i of idxs) {
        const f = inst.flex[i], aloc = plano.flex[i];
        let k = 0;
        while (k < f.slots.length) {
          if (!(aloc[k] > 0)) { k++; continue; }
          let j = k, e = 0;
          while (j < f.slots.length && aloc[j] > 0) { e += aloc[j] * inst.dt; j++; }
          const t0 = f.slots[k], t1 = f.slots[j - 1] + 1;
          if (t1 > a && t0 < b) {
            const dica = `${f.nome}\n${U.fmtCurto(inst.tempo(t0))} até ${U.fmtCurto(inst.tempo(t1))} · ${U.num(e, 1)} kWh`;
            barras += `<b class="g-barra flex" style="left:${L(t0)};width:${W(t0, t1)}" data-dica="${esc(dica)}"></b>`;
          }
          k = j;
        }
      }
      h += `<div class="g-linha g-linha-flex"><div class="g-rot" title="${esc(nome)}">${esc(nome)}</div><div class="g-trilho">${ponta}${dias}${barras}${agora}</div></div>`;
    }
    cont.innerHTML = h;
  };
})(typeof window !== 'undefined' ? window : globalThis);
