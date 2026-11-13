/* Carga Certa — otimizador da agenda de produção com custo de energia.
 *
 * Problema: cada pedido tem etapas em sequência (corte -> torno -> forno ...). Cada etapa ocupa uma
 * unidade de uma máquina por um tempo fixo e consome a potência da máquina. Restrições: uma etapa por
 * unidade de máquina por vez, ordem das etapas, horário de funcionamento, paradas de máquina,
 * liberação do material e prazo de entrega. Cargas flexíveis (recarga de empilhadeira, bomba d'água...)
 * precisam receber uma energia dentro de uma janela.
 *
 * Objetivo (R$/mês): conta de energia estimada (energia por posto tarifário, créditos da solar,
 * demanda e ultrapassagem) + peso extra por kW de pico + penalidades (atraso, limite de demanda).
 *
 * Método:
 *  1) "Como é hoje": cada etapa entra o mais cedo possível, pedidos por ordem de prazo (EDD).
 *  2) Busca em vizinhança grande: tira um pedido (ou dois, ou uma carga flexível) da agenda e o
 *     recoloca na melhor posição. Para um pedido, a melhor posição de TODAS as etapas juntas sai de uma
 *     programação dinâmica no tempo (respeita ordem das etapas, máquinas livres e prazo). A aceitação
 *     segue um recozimento simulado com semente fixa (resultado reprodutível) e, no fim, um polimento
 *     guloso até não haver melhora.
 */
(function (G) {
  'use strict';
  const CC = G.CC = G.CC || {};
  const U = CC.util, TA = CC.tarifas, SO = CC.solar;
  const O = CC.otim = {};

  const PENAL_ATRASO_H = 3000;    // R$ por hora de atraso de um pedido (penalidade de planejamento)
  const PENAL_NAO_PROG = 1e6;     // etapa sem lugar na agenda
  const PENAL_LIMITE = 400;       // R$ por kW acima de um limite de demanda pedido, por intervalo
  const PENAL_FALTA_FLEX = 2000;  // R$ por kWh de carga flexível não entregue
  O.PENALIDADES = { PENAL_ATRASO_H, PENAL_NAO_PROG, PENAL_LIMITE, PENAL_FALTA_FLEX };

  const BAL = { pv: 0, imp: 0, exp: 0, cl: 0, cv: 0, v: 1 };

  /** Custo (R$/mês equivalente) de um intervalo com carga L. Deixa o balanço em BAL. */
  function custoSlot(inst, t, L) {
    SO.balanco(inst, t, L, BAL);
    let c = (BAL.imp * inst.preco[t] - BAL.exp * inst.credito[t]) * inst.dt * inst.fatorMes;
    const cap = inst.cap[t];
    if (BAL.imp > cap) c += (BAL.imp - cap) * PENAL_LIMITE;
    return c;
  }
  function demandaObj(inst, all, p, fp) { return TA.demandaConta(inst.dem, all, p, fp) + inst.dem.pesoPico * all; }

  // =====================================================================
  // Estado da agenda: início e unidade de cada etapa, ocupação das máquinas e perfis de carga.
  // =====================================================================
  O.planoVazio = (inst) => ({
    ini: new Int32Array(inst.ops.length).fill(-1),
    uni: new Int16Array(inst.ops.length).fill(-1),
    flex: inst.flex.map((f) => new Float32Array(f.slots.length)),
  });

  class Estado {
    constructor(inst, plano) {
      this.inst = inst;
      const T = inst.T, n = inst.ops.length;
      this.ini = new Int32Array(n).fill(-1);
      this.uni = new Int16Array(n).fill(-1);
      this.cong = new Uint8Array(n);
      this.machKW = new Float64Array(T);
      this.flexKW = new Float64Array(T);
      this.occ = inst.maquinas.map((m) => Array.from({ length: m.unidades }, () => new Int32Array(T).fill(-1)));
      this.flex = inst.flex.map((f) => new Float32Array(f.slots.length));
      this.ref = null; this.refU = null; this.penMud = 0; // estabilidade no replanejamento
      if (plano) this.carregar(plano);
    }
    /** Plano de referência: mover uma etapa dele custa `pen` (R$/mês equivalentes). */
    definirReferencia(ref, pen) {
      if (!ref || !(pen > 0)) { this.ref = null; this.refU = null; this.penMud = 0; return; }
      this.ref = Int32Array.from(ref.ini); this.refU = Int16Array.from(ref.uni); this.penMud = pen;
    }
    penalidadeMudancas() {
      if (!this.ref) return 0;
      let n = 0;
      for (let o = 0; o < this.ini.length; o++) if (this.ref[o] >= 0 && this.ini[o] >= 0 && this.ini[o] !== this.ref[o]) n++;
      return n * this.penMud;
    }
    L(t) { return this.inst.baseKW[t] + this.machKW[t] + this.flexKW[t]; }
    livre(o, s, u) {
      const inst = this.inst, op = inst.ops[o], M = inst.maquinas[op.maq];
      if (s < 0 || s + op.dur > inst.T || u < 0 || u >= M.unidades) return false;
      const occ = this.occ[op.maq][u], bl = M.bloq[u];
      for (let t = s; t < s + op.dur; t++) if (!M.perm[t] || bl[t] || (occ[t] !== -1 && occ[t] !== o)) return false;
      return true;
    }
    colocar(o, s, u) {
      const op = this.inst.ops[o], occ = this.occ[op.maq][u];
      this.ini[o] = s; this.uni[o] = u;
      for (let t = s; t < s + op.dur; t++) { occ[t] = o; this.machKW[t] += op.kW; }
    }
    remover(o) {
      const s = this.ini[o];
      if (s < 0) return;
      const op = this.inst.ops[o], occ = this.occ[op.maq][this.uni[o]];
      for (let t = s; t < s + op.dur; t++) { if (occ[t] === o) occ[t] = -1; this.machKW[t] -= op.kW; }
      this.ini[o] = -1; this.uni[o] = -1;
    }
    colocarFlex(i, arr) {
      const sl = this.inst.flex[i].slots;
      this.flex[i] = arr;
      for (let k = 0; k < sl.length; k++) this.flexKW[sl[k]] += arr[k];
    }
    removerFlex(i) {
      const sl = this.inst.flex[i].slots, arr = this.flex[i];
      for (let k = 0; k < sl.length; k++) this.flexKW[sl[k]] -= arr[k];
      this.flex[i] = new Float32Array(sl.length);
    }
    carregar(plano) {
      const inst = this.inst, n = inst.ops.length;
      const ordem = [];
      for (let o = 0; o < n; o++) if (plano.ini[o] >= 0) ordem.push(o);
      ordem.sort((a, b) => plano.ini[a] - plano.ini[b]);
      for (const o of ordem) {
        const s = plano.ini[o], u = plano.uni[o];
        if (this.livre(o, s, u)) { this.colocar(o, s, u); continue; }
        if (s < inst.agoraSlot) continue; // já começou: não muda de unidade no passado (vai recomeçar)
        const M = inst.maquinas[inst.ops[o].maq];
        for (let uu = 0; uu < M.unidades; uu++) if (this.livre(o, s, uu)) { this.colocar(o, s, uu); break; }
      }
      for (const ped of inst.pedidos) { // ordem das etapas e liberação
        let fimAnt = ped.lib, quebrou = false;
        for (const o of ped.ops) {
          if (quebrou) { this.remover(o); continue; }
          if (this.ini[o] < 0 || this.ini[o] < fimAnt) { this.remover(o); quebrou = true; continue; }
          fimAnt = this.ini[o] + inst.ops[o].dur;
        }
      }
      inst.flex.forEach((f, i) => {
        const a = plano.flex && plano.flex[i];
        if (!a || a.length !== f.slots.length) return;
        const arr = new Float32Array(a.length);
        for (let k = 0; k < a.length; k++) arr[k] = U.clamp(+a[k] || 0, 0, f.kW);
        this.colocarFlex(i, arr);
      });
    }
    /** Etapas que já começaram antes de "agora" ficam fixas; as interrompidas por parada voltam para a fila. */
    congelar(ag) {
      const inst = this.inst;
      this.cong.fill(0);
      for (const ped of inst.pedidos) {
        for (let j = 0; j < ped.ops.length; j++) {
          const o = ped.ops[j], s = this.ini[o];
          if (s < 0 || s >= ag) break;
          const op = inst.ops[o], M = inst.maquinas[op.maq], bl = M.bloq[this.uni[o]];
          let interrompida = false;
          for (let t = Math.max(s, ag); t < s + op.dur; t++) if (!M.perm[t] || bl[t]) { interrompida = true; break; }
          if (interrompida) { for (let k = j; k < ped.ops.length; k++) this.remover(ped.ops[k]); break; }
          this.cong[o] = 1;
        }
      }
    }
    exportar() {
      return { ini: Int32Array.from(this.ini), uni: Int16Array.from(this.uni), flex: this.flex.map((a) => Float32Array.from(a)) };
    }
  }
  O.Estado = Estado;

  // =====================================================================
  // Avaliação completa (conta do mês, indicadores e, se pedido, as curvas)
  // =====================================================================
  O.avaliar = function (inst, est, detalhado) {
    const T = inst.T, dt = inst.dt;
    let custoImp = 0, valorCred = 0, penalLim = 0, all = 0, p = 0, fp = 0;
    let eCons = 0, eRede = 0, eInj = 0, eSol = 0, eSolDisp = 0, eCl = 0, eCv = 0, ePonta = 0, eInter = 0, excessoLim = 0;
    const A = detalhado ? {
      carga: new Float64Array(T), imp: new Float64Array(T), exp: new Float64Array(T), pv: new Float64Array(T),
      cl: new Float64Array(T), cv: new Float64Array(T), v: new Float64Array(T),
      maq: Float64Array.from(est.machKW), flx: Float64Array.from(est.flexKW), base: inst.baseKW, pvDisp: inst.pvDisp,
    } : null;
    for (let t = 0; t < T; t++) {
      const L = inst.baseKW[t] + est.machKW[t] + est.flexKW[t];
      SO.balanco(inst, t, L, BAL);
      const imp = BAL.imp;
      custoImp += imp * inst.preco[t] * dt;
      valorCred += BAL.exp * inst.credito[t] * dt;
      if (imp > inst.cap[t]) { penalLim += (imp - inst.cap[t]) * PENAL_LIMITE; excessoLim = Math.max(excessoLim, imp - inst.cap[t]); }
      if (imp > all) all = imp;
      if (inst.posto[t] === 2) { if (imp > p) p = imp; ePonta += imp * dt; } else { if (imp > fp) fp = imp; if (inst.posto[t] === 1) eInter += imp * dt; }
      eCons += L * dt; eRede += imp * dt; eInj += BAL.exp * dt; eSol += BAL.pv * dt; eSolDisp += inst.pvDisp[t] * dt; eCl += BAL.cl * dt; eCv += BAL.cv * dt;
      if (A) { A.carga[t] = L; A.imp[t] = imp; A.exp[t] = BAL.exp; A.pv[t] = BAL.pv; A.cl[t] = BAL.cl; A.cv[t] = BAL.cv; A.v[t] = BAL.v; }
    }
    let penalAtraso = 0, naoProg = 0, noPrazo = 0;
    const pedidos = inst.pedidos.map((ped) => {
      let fim = -1, prog = true;
      for (const o of ped.ops) { if (est.ini[o] < 0) { prog = false; naoProg++; } else fim = Math.max(fim, est.ini[o] + inst.ops[o].dur); }
      const atrasoH = prog ? Math.max(0, fim - ped.prazo) * dt : 0;
      penalAtraso += atrasoH * PENAL_ATRASO_H;
      if (prog && atrasoH <= 1e-9) noPrazo++;
      return { idx: ped.idx, id: ped.id, fim, atrasoH, programado: prog };
    });
    let faltaFlex = 0;
    inst.flex.forEach((f, i) => {
      let e = 0; const a = est.flex[i];
      for (let k = 0; k < a.length; k++) e += a[k] * dt;
      faltaFlex += Math.max(0, f.energia - e);
    });
    // Lei 14.300: a energia injetada só compensa a energia consumida da rede. O que sobra vira crédito
    // para os meses seguintes (até 60 meses) e não reduz a conta deste mês.
    const eComp = Math.min(eInj, eRede);
    const creditoUsado = eInj > 0 ? valorCred * (eComp / eInj) : 0;
    const energia = custoImp - creditoUsado;
    const demandaMes = TA.demandaConta(inst.dem, all, p, fp);
    const energiaMes = energia * inst.fatorMes;
    const contaMes = energiaMes + demandaMes;
    const penalMud = est.penalidadeMudancas ? est.penalidadeMudancas() : 0;
    const objetivo = contaMes + inst.dem.pesoPico * all + penalLim + penalAtraso + naoProg * PENAL_NAO_PROG + faltaFlex * PENAL_FALTA_FLEX + penalMud;
    const horas = T * dt;
    return {
      objetivo, contaMes, energiaMes, demandaMes, energiaHorizonte: energia, penalMud,
      custoImportacaoMes: custoImp * inst.fatorMes, creditoUsadoMes: creditoUsado * inst.fatorMes,
      creditoSobraKWh: (eInj - eComp) * inst.fatorMes,
      picos: { all, p, fp }, penalLim, excessoLim, penalAtraso, naoProg, faltaFlex, pedidos, noPrazo,
      kwh: { consumo: eCons, rede: eRede, injecao: eInj, solar: eSol, solarDisp: eSolDisp, cortLim: eCl, cortVW: eCv, ponta: ePonta, inter: eInter },
      fatorCarga: all > 0 ? eRede / (all * horas) : 0,
      custoMedioKWh: eRede > 0 ? contaMes / (eRede * inst.fatorMes) : 0,
      autoconsumo: eSol > 0 ? (eSol - eInj) / eSol : 0,
      aproveitamentoSolar: eSolDisp > 0 ? eSol / eSolDisp : 0,
      arr: A,
    };
  };

  // =====================================================================
  // Rascunhos reaproveitados (evita criar arrays a cada movimento)
  // =====================================================================
  function contexto(inst) {
    const T = inst.T;
    let maxEt = 1;
    for (const p of inst.pedidos) maxEt = Math.max(maxEt, p.ops.length);
    return {
      L0: new Float64Array(T), c0: new Float64Array(T), imp0: new Float64Array(T),
      S: new Float64Array(T + 1), imp1: new Float64Array(T), tmp: new Float64Array(T),
      wAll: new Float64Array(T), wP: new Float64Array(T), wFP: new Float64Array(T), dq: new Int32Array(T + 1),
      c: new Float64Array(T),
      f: Array.from({ length: maxEt }, () => new Float64Array(T)),
      a: Array.from({ length: maxEt }, () => new Int32Array(T)),
      run: inst.maquinas.map((m) => Array.from({ length: m.unidades }, () => new Int32Array(T + 1))),
      runOk: new Uint8Array(inst.maquinas.length),
      pk: { all: 0, p: 0, fp: 0 }, dem0: 0,
    };
  }

  /** Máximo de src em janelas de tamanho d: out[s] = max(src[s..s+d-1]). */
  function janelaMax(src, n, d, out, dq) {
    let h = 0, tl = 0;
    for (let i = 0; i < n; i++) {
      while (tl > h && src[dq[tl - 1]] <= src[i]) tl--;
      dq[tl++] = i;
      if (dq[h] <= i - d) h++;
      if (i >= d - 1) out[i - d + 1] = src[dq[h]];
    }
  }

  function prepararBase(est, ctx) {
    const inst = est.inst, T = inst.T;
    let all = 0, p = 0, fp = 0;
    for (let t = 0; t < T; t++) {
      const L = inst.baseKW[t] + est.machKW[t] + est.flexKW[t];
      ctx.L0[t] = L;
      ctx.c0[t] = custoSlot(inst, t, L);
      const imp = BAL.imp;
      ctx.imp0[t] = imp;
      if (imp > all) all = imp;
      if (inst.posto[t] === 2) { if (imp > p) p = imp; } else if (imp > fp) fp = imp;
    }
    ctx.pk.all = all; ctx.pk.p = p; ctx.pk.fp = fp;
    ctx.dem0 = demandaObj(inst, all, p, fp);
  }

  /** Quantos intervalos livres seguidos existem a partir de t, para cada unidade da máquina. */
  function obterRuns(est, ctx, mi) {
    const inst = est.inst, M = inst.maquinas[mi], T = inst.T, runs = ctx.run[mi];
    if (!ctx.runOk[mi]) {
      for (let u = 0; u < M.unidades; u++) {
        const run = runs[u], occ = est.occ[mi][u], bl = M.bloq[u];
        run[T] = 0;
        for (let t = T - 1; t >= 0; t--) run[t] = (M.perm[t] && !bl[t] && occ[t] === -1) ? run[t + 1] + 1 : 0;
      }
      ctx.runOk[mi] = 1;
    }
    return runs;
  }

  /** Custo de colocar a etapa o começando em cada instante s (Infinity se não couber). Resultado em ctx.c. */
  function custoEtapa(est, ctx, o, inicioMin) {
    const inst = est.inst, T = inst.T, op = inst.ops[o], d = op.dur, P = op.kW;
    const azul = inst.dem.mod === 'A4_azul';
    const S = ctx.S, imp1 = ctx.imp1;
    S[0] = 0;
    for (let t = 0; t < T; t++) {
      const c1 = custoSlot(inst, t, ctx.L0[t] + P);
      imp1[t] = BAL.imp;
      S[t + 1] = S[t] + (c1 - ctx.c0[t]);
    }
    if (d <= T) {
      janelaMax(imp1, T, d, ctx.wAll, ctx.dq);
      if (azul) {
        for (let t = 0; t < T; t++) ctx.tmp[t] = inst.posto[t] === 2 ? imp1[t] : -1;
        janelaMax(ctx.tmp, T, d, ctx.wP, ctx.dq);
        for (let t = 0; t < T; t++) ctx.tmp[t] = inst.posto[t] !== 2 ? imp1[t] : -1;
        janelaMax(ctx.tmp, T, d, ctx.wFP, ctx.dq);
      }
    }
    const runs = obterRuns(est, ctx, op.maq), pk = ctx.pk, c = ctx.c;
    for (let s = 0; s < T; s++) {
      if (s < inicioMin || s + d > T) { c[s] = Infinity; continue; }
      let ok = false;
      for (let u = 0; u < runs.length; u++) if (runs[u][s] >= d) { ok = true; break; }
      if (!ok) { c[s] = Infinity; continue; }
      const all = ctx.wAll[s] > pk.all ? ctx.wAll[s] : pk.all;
      const p = azul && ctx.wP[s] > pk.p ? ctx.wP[s] : pk.p;
      const fp = azul && ctx.wFP[s] > pk.fp ? ctx.wFP[s] : pk.fp;
      c[s] = (S[s + d] - S[s]) + (demandaObj(inst, all, p, fp) - ctx.dem0);
    }
    if (est.ref && est.ref[o] >= 0) { // mexer no que já estava combinado tem um custo
      const r = est.ref[o], pen = est.penMud;
      for (let s = 0; s < T; s++) if (s !== r && c[s] < Infinity) c[s] += pen;
    }
  }

  function escolherUnidade(est, ctx, o, s) {
    const op = est.inst.ops[o], runs = obterRuns(est, ctx, op.maq);
    if (est.ref && est.ref[o] === s) { const u0 = est.refU[o]; if (u0 >= 0 && u0 < runs.length && runs[u0][s] >= op.dur) return u0; }
    let best = -1, bestRun = Infinity;
    for (let u = 0; u < runs.length; u++) {
      const r = runs[u][s];
      if (r >= op.dur && r < bestRun) { bestRun = r; best = u; } // melhor encaixe: deixa os buracos grandes livres
    }
    return best;
  }

  /** Recoloca todas as etapas ainda não iniciadas de um pedido na melhor posição (programação dinâmica). */
  function reinserirPedido(est, pi, ctx) {
    const inst = est.inst, T = inst.T, ped = inst.pedidos[pi], ops = ped.ops;
    let k0 = 0;
    while (k0 < ops.length && est.cong[ops[k0]]) k0++;
    for (let j = k0; j < ops.length; j++) est.remover(ops[j]);
    if (k0 === ops.length) return true;
    for (let j = k0; j < ops.length; j++) if (inst.ops[ops[j]].impossivel) return false;
    ctx.runOk.fill(0);
    prepararBase(est, ctx);
    const fimAnt = k0 > 0 ? est.ini[ops[k0 - 1]] + inst.ops[ops[k0 - 1]].dur : 0;
    const inicioMin = Math.max(inst.agoraSlot, ped.lib, fimAnt);
    const n = ops.length - k0;
    for (let jj = 0; jj < n; jj++) {
      custoEtapa(est, ctx, ops[k0 + jj], jj === 0 ? inicioMin : 0);
      const c = ctx.c, f = ctx.f[jj], a = ctx.a[jj];
      if (jj === 0) {
        for (let s = 0; s < T; s++) { f[s] = c[s]; a[s] = -1; }
      } else {
        const fPrev = ctx.f[jj - 1], dPrev = inst.ops[ops[k0 + jj - 1]].dur;
        let best = Infinity, bestS = -1;
        for (let s = 0; s < T; s++) {
          const sp = s - dPrev;
          if (sp >= 0 && fPrev[sp] < best) { best = fPrev[sp]; bestS = sp; }
          if (best < Infinity && c[s] < Infinity) { f[s] = best + c[s]; a[s] = bestS; } else { f[s] = Infinity; a[s] = -1; }
        }
      }
    }
    const dl = inst.ops[ops[ops.length - 1]].dur, fL = ctx.f[n - 1], penSlot = PENAL_ATRASO_H * inst.dt;
    let bestV = Infinity, bestS = -1;
    for (let s = 0; s + dl <= T; s++) {
      const v = fL[s];
      if (v === Infinity) continue;
      const late = s + dl - ped.prazo;
      const tot = v + (late > 0 ? late * penSlot : 0);
      if (tot < bestV - 1e-9) { bestV = tot; bestS = s; }
    }
    if (bestS < 0) return false;
    const inicios = new Int32Array(n);
    inicios[n - 1] = bestS;
    for (let jj = n - 1; jj > 0; jj--) inicios[jj - 1] = ctx.a[jj][inicios[jj]];
    for (let jj = 0; jj < n; jj++) {
      const o = ops[k0 + jj], u = escolherUnidade(est, ctx, o, inicios[jj]);
      if (u < 0 || inicios[jj] < 0) return false;
      est.colocar(o, inicios[jj], u);
    }
    return true;
  }

  /** Recoloca a energia ainda não entregue de uma carga flexível nos intervalos mais baratos da janela. */
  function reinserirFlex(est, fi, ctx) {
    const inst = est.inst, f = inst.flex[fi], dt = inst.dt, ag = inst.agoraSlot, n = f.slots.length;
    const velho = est.flex[fi], nova = new Float32Array(n);
    let entregue = 0;
    for (let k = 0; k < n; k++) if (f.slots[k] < ag) { nova[k] = velho[k]; entregue += velho[k] * dt; }
    est.removerFlex(fi);
    let rest = f.energia - entregue;
    if (rest <= 1e-9 || !(f.kW > 0)) { est.colocarFlex(fi, nova); return true; }
    prepararBase(est, ctx);
    let k0 = 0;
    while (k0 < n && f.slots[k0] < ag) k0++;
    const disp = n - k0;
    if (disp <= 0) { est.colocarFlex(fi, nova); return false; }

    if (f.continua) {
      // Bloco contínuo de m intervalos na potência máxima (o último pode ser parcial).
      const m = Math.min(disp, Math.ceil(rest / (f.kW * dt) - 1e-9));
      const mc = ctx.tmp, imp1 = ctx.imp1;
      for (let i = 0; i < disp; i++) {
        const t = f.slots[k0 + i];
        mc[i] = custoSlot(inst, t, ctx.L0[t] + f.kW) - ctx.c0[t];
        imp1[i] = BAL.imp;
      }
      const S = ctx.S; S[0] = 0;
      for (let i = 0; i < disp; i++) S[i + 1] = S[i] + mc[i];
      janelaMax(imp1, disp, m, ctx.wAll, ctx.dq);
      const azul = inst.dem.mod === 'A4_azul', pk = ctx.pk;
      let best = -1, bestC = Infinity;
      for (let i = 0; i + m <= disp; i++) {
        const all = Math.max(pk.all, ctx.wAll[i]);
        let p = pk.p, fp = pk.fp;
        if (azul) for (let q = i; q < i + m; q++) { const t = f.slots[k0 + q]; if (inst.posto[t] === 2) p = Math.max(p, imp1[q]); else fp = Math.max(fp, imp1[q]); }
        const cc = S[i + m] - S[i] + demandaObj(inst, all, p, fp) - ctx.dem0;
        if (cc < bestC - 1e-9) { bestC = cc; best = i; }
      }
      for (let q = 0; q < m && rest > 1e-9; q++) {
        const kw = Math.min(f.kW, rest / dt);
        nova[k0 + best + q] = kw; rest -= kw * dt;
      }
    } else {
      // Intervalos soltos: escolhe um a um o intervalo de menor custo marginal.
      const usado = new Uint8Array(n);
      const pk = { all: ctx.pk.all, p: ctx.pk.p, fp: ctx.pk.fp };
      let dem = ctx.dem0;
      while (rest > 1e-9) {
        const pw = Math.min(f.kW, rest / dt);
        let best = -1, bestC = Infinity, bestImp = 0;
        for (let k = k0; k < n; k++) {
          if (usado[k]) continue;
          const t = f.slots[k];
          const c1 = custoSlot(inst, t, ctx.L0[t] + pw), imp = BAL.imp;
          const all = imp > pk.all ? imp : pk.all;
          const p = inst.posto[t] === 2 && imp > pk.p ? imp : pk.p;
          const fp = inst.posto[t] !== 2 && imp > pk.fp ? imp : pk.fp;
          const cc = c1 - ctx.c0[t] + demandaObj(inst, all, p, fp) - dem;
          if (cc < bestC - 1e-12) { bestC = cc; best = k; bestImp = imp; }
        }
        if (best < 0) break;
        const t = f.slots[best];
        usado[best] = 1; nova[best] = pw; rest -= pw * dt;
        ctx.L0[t] += pw;
        ctx.c0[t] = custoSlot(inst, t, ctx.L0[t]);
        ctx.imp0[t] = BAL.imp;
        if (bestImp > pk.all) pk.all = bestImp;
        if (inst.posto[t] === 2) { if (bestImp > pk.p) pk.p = bestImp; } else if (bestImp > pk.fp) pk.fp = bestImp;
        dem = demandaObj(inst, pk.all, pk.p, pk.fp);
      }
    }
    est.colocarFlex(fi, nova);
    return rest <= 1e-6;
  }

  // =====================================================================
  // Agenda "como é hoje": tudo o mais cedo possível, pedidos por ordem de prazo
  // =====================================================================
  function primeiroEncaixe(est, ctx, o, inicioMin) {
    const inst = est.inst, op = inst.ops[o];
    const runs = obterRuns(est, ctx, op.maq);
    let best = null;
    for (let u = 0; u < runs.length; u++) {
      for (let s = inicioMin; s + op.dur <= inst.T; s++) {
        if (best && s >= best.s) break;
        if (runs[u][s] >= op.dur) { best = { s, u }; break; }
      }
    }
    return best;
  }

  function flexASAP(est, i, ag) {
    const inst = est.inst, f = inst.flex[i], dt = inst.dt, n = f.slots.length;
    const velho = est.flex[i], nova = new Float32Array(n);
    let entregue = 0;
    for (let k = 0; k < n; k++) if (f.slots[k] < ag) { nova[k] = velho[k]; entregue += velho[k] * dt; }
    est.removerFlex(i);
    let rest = f.energia - entregue;
    for (let k = 0; k < n && rest > 1e-9; k++) {
      if (f.slots[k] < ag) continue;
      const kw = Math.min(f.kW, rest / dt);
      nova[k] = kw; rest -= kw * dt;
    }
    est.colocarFlex(i, nova);
  }

  O.planoASAP = function (inst, planoAnterior) {
    const est = new Estado(inst, planoAnterior || null);
    const ag = inst.agoraSlot;
    est.congelar(ag);
    for (let o = 0; o < inst.ops.length; o++) if (!est.cong[o]) est.remover(o);
    const ctx = contexto(inst);
    const ordem = inst.pedidos.slice().sort((a, b) => a.prazo - b.prazo || a.lib - b.lib || a.idx - b.idx);
    for (const ped of ordem) {
      let fimAnt = ped.lib;
      for (const o of ped.ops) {
        const op = inst.ops[o];
        if (est.cong[o]) { fimAnt = est.ini[o] + op.dur; continue; }
        if (op.impossivel) break;
        ctx.runOk.fill(0);
        const r = primeiroEncaixe(est, ctx, o, Math.max(ag, ped.lib, fimAnt));
        if (!r) break;
        est.colocar(o, r.s, r.u);
        fimAnt = r.s + op.dur;
      }
    }
    for (let i = 0; i < inst.flex.length; i++) flexASAP(est, i, ag);
    return est.exportar();
  };

  // =====================================================================
  // Otimização
  // =====================================================================
  function foto(est, peds, flexes) {
    const inst = est.inst, ops = [];
    for (const pi of peds) for (const o of inst.pedidos[pi].ops) ops.push([o, est.ini[o], est.uni[o]]);
    return { ops, flex: flexes.map((fi) => [fi, Float32Array.from(est.flex[fi])]) };
  }
  function restaurar(est, f) {
    for (const [o] of f.ops) est.remover(o);
    for (const [o, s, u] of f.ops) if (s >= 0) est.colocar(o, s, u);
    for (const [fi, arr] of f.flex) { est.removerFlex(fi); est.colocarFlex(fi, Float32Array.from(arr)); }
  }

  /**
   * Otimiza a partir de um plano (o anterior ou o "como é hoje"). Assíncrona para não travar a tela.
   * opc: { iteracoes, semente, aoProgresso(fração), cancelado() }
   */
  O.otimizar = async function (inst, planoInicial, opc) {
    opc = opc || {};
    const rnd = U.rng(opc.semente == null ? 20261123 : opc.semente);
    let est = new Estado(inst, planoInicial || null);
    est.congelar(inst.agoraSlot);
    est.definirReferencia(opc.referencia || null, opc.estabilidade || 0);
    const ctx = contexto(inst);
    const nPed = inst.pedidos.length, nFlex = inst.flex.length;

    // Garante que tudo está na agenda (etapas soltas entram pela programação dinâmica).
    for (const ped of inst.pedidos) if (ped.ops.some((o) => est.ini[o] < 0)) reinserirPedido(est, ped.idx, ctx);
    for (let i = 0; i < nFlex; i++) {
      const f = inst.flex[i];
      let e = 0; for (const x of est.flex[i]) e += x * inst.dt;
      if (e < f.energia - 1e-6) reinserirFlex(est, i, ctx);
    }

    let atual = O.avaliar(inst, est).objetivo;
    let melhor = atual, melhorPlano = est.exportar();
    const N = opc.iteracoes == null ? Math.max(200, 20 * (nPed + nFlex)) : opc.iteracoes;
    const T0 = Math.max(1, 0.002 * Math.abs(atual));
    let ultimoRespiro = Date.now();

    const tentar = (peds, flexes, temp) => {
      const f = foto(est, peds, flexes);
      for (const pi of peds) for (const o of inst.pedidos[pi].ops) if (!est.cong[o]) est.remover(o);
      let ok = true;
      for (const pi of peds) ok = reinserirPedido(est, pi, ctx) && ok;
      for (const fi of flexes) reinserirFlex(est, fi, ctx);
      if (!ok) { restaurar(est, f); return false; }
      const novo = O.avaliar(inst, est).objetivo;
      const delta = novo - atual;
      if (delta < -1e-6 || (temp > 0 && delta < 50 * temp && rnd() < Math.exp(-delta / temp))) {
        atual = novo;
        if (novo < melhor - 1e-6) { melhor = novo; melhorPlano = est.exportar(); }
        return true;
      }
      restaurar(est, f);
      return false;
    };
    const ordemAleatoria = (n) => { const a = Array.from({ length: n }, (_, i) => i); for (let i = n - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
    const passadaGulosa = () => {
      for (const pi of ordemAleatoria(nPed)) tentar([pi], [], 0);
      for (const fi of ordemAleatoria(nFlex)) tentar([], [fi], 0);
    };

    if (nPed + nFlex > 0) {
      passadaGulosa();
      for (let it = 0; it < N; it++) {
        if (opc.cancelado && opc.cancelado()) break;
        const temp = T0 * (1 - it / N);
        const r = rnd();
        if ((r < 0.62 || nFlex === 0) && nPed > 0) {
          tentar([Math.floor(rnd() * nPed)], [], temp);
        } else if (r < 0.84 && nPed >= 2) {
          const a = Math.floor(rnd() * nPed);
          let b = Math.floor(rnd() * (nPed - 1)); if (b >= a) b++;
          tentar(rnd() < 0.5 ? [a, b] : [b, a], [], temp);
        } else if (nFlex > 0) {
          tentar([], [Math.floor(rnd() * nFlex)], temp);
        }
        if (Date.now() - ultimoRespiro > 45) {
          if (opc.aoProgresso) opc.aoProgresso(it / N);
          await new Promise((res) => setTimeout(res, 0));
          ultimoRespiro = Date.now();
        }
      }
      // Polimento: volta ao melhor plano e melhora até não dar mais.
      est = new Estado(inst, melhorPlano);
      est.congelar(inst.agoraSlot);
      est.definirReferencia(opc.referencia || null, opc.estabilidade || 0);
      atual = O.avaliar(inst, est).objetivo;
      for (let rodada = 0; rodada < 4; rodada++) {
        const antes = atual;
        passadaGulosa();
        if (atual > antes - 1e-3) break;
      }
      if (atual < melhor) { melhor = atual; melhorPlano = est.exportar(); }
    }
    if (opc.aoProgresso) opc.aoProgresso(1);
    return melhorPlano;
  };

  // =====================================================================
  // Plano <-> JSON (por identificador e horário absoluto, sobrevive a mudanças no cenário)
  // =====================================================================
  O.serializar = function (inst, plano) {
    const ops = {}, flex = {};
    inst.ops.forEach((op, o) => { if (plano.ini[o] >= 0) ops[op.id] = [inst.t0 + plano.ini[o] * inst.passo, plano.uni[o]]; });
    inst.flex.forEach((f, i) => {
      const a = plano.flex[i];
      if (!a) return;
      let algum = false;
      const kw = Array.from(a, (x) => { if (x > 0) algum = true; return Math.round(x * 1000) / 1000; });
      if (algum) flex[f.id] = { ini: inst.t0 + f.slots[0] * inst.passo, kw };
    });
    return { ops, flex };
  };

  O.desserializar = function (inst, ser) {
    const plano = O.planoVazio(inst);
    if (!ser) return plano;
    inst.ops.forEach((op, o) => {
      const v = ser.ops && ser.ops[op.id];
      if (!v) return;
      const s = (v[0] - inst.t0) / inst.passo;
      if (Math.abs(s - Math.round(s)) < 1e-6) { plano.ini[o] = Math.round(s); plano.uni[o] = v[1] | 0; }
    });
    inst.flex.forEach((f, i) => {
      const v = ser.flex && ser.flex[f.id];
      if (!v) return;
      const off = Math.round((v.ini - inst.t0) / inst.passo);
      for (let k = 0; k < f.slots.length; k++) {
        const j = f.slots[k] - off;
        if (j >= 0 && j < v.kw.length) plano.flex[i][k] = Math.min(f.kW, +v.kw[j] || 0);
      }
    });
    return plano;
  };

  /** Perfis de reativo (kvar) da agenda, para o diagnóstico de fator de potência. */
  O.reativo = function (inst, plano) {
    const q = Float64Array.from(inst.baseKVAr);
    inst.ops.forEach((op, o) => { const s = plano.ini[o]; if (s >= 0) for (let t = s; t < s + op.dur; t++) q[t] += op.kvar; });
    inst.flex.forEach((f, i) => { const a = plano.flex[i]; for (let k = 0; k < a.length; k++) q[f.slots[k]] += a[k] * f.kvarPorKW; });
    return q;
  };

  /** O que mudou entre a agenda "como é hoje" e a otimizada, com o motivo principal. */
  O.mudancas = function (inst, base, otim) {
    const dt = inst.dt, lista = [];
    const horasPonta = (s, d) => { let n = 0; for (let t = s; t < s + d; t++) if (inst.posto[t] === 2) n++; return n * dt; };
    const solar = (s, d) => { let x = 0; for (let t = s; t < s + d; t++) x += inst.pvDisp[t]; return x * dt; };
    inst.ops.forEach((op, o) => {
      const a = base.ini[o], b = otim.ini[o];
      if (a < 0 || b < 0 || a === b) return;
      const M = inst.maquinas[op.maq], ped = inst.pedidos[op.pedido];
      const pa = horasPonta(a, op.dur), pb = horasPonta(b, op.dur);
      const sa = solar(a, op.dur), sb = solar(b, op.dur);
      let motivo, peso;
      if (pa > pb + 1e-9) { motivo = `sai do horário de ponta (${U.fmtDuracao(pa - pb)})`; peso = (pa - pb) * op.kW * 10; }
      else if (sb > sa * 1.15 + 1) { motivo = 'aproveita a geração solar'; peso = op.kW * 3; }
      else { motivo = 'evita somar com outras máquinas (pico menor)'; peso = op.kW; }
      lista.push({ tipo: 'etapa', id: op.id, rotulo: `${ped.id} · ${M.nome}`, antes: inst.tempo(a), depois: inst.tempo(b), horas: op.dur * dt, kW: op.kW, motivo, peso });
    });
    inst.flex.forEach((f, i) => {
      const A = base.flex[i], B = otim.flex[i];
      let ea = 0, eb = 0, pa = 0, pb = 0, ia = -1, ib = -1;
      for (let k = 0; k < f.slots.length; k++) {
        const t = f.slots[k];
        if (A[k] > 0) { ea += A[k]; if (ia < 0) ia = t; if (inst.posto[t] === 2) pa += A[k] * dt; }
        if (B[k] > 0) { eb += B[k]; if (ib < 0) ib = t; if (inst.posto[t] === 2) pb += B[k] * dt; }
      }
      if (ia < 0 || ib < 0 || ia === ib) return;
      const motivo = pa > pb + 1e-6 ? `tira ${U.num(pa - pb, 0)} kWh da ponta` : 'liga quando a energia é mais barata';
      lista.push({ tipo: 'flex', id: f.id, rotulo: `${f.nome} (${U.fmtDia(inst.tempo(f.slots[0]))})`, antes: inst.tempo(ia), depois: inst.tempo(ib), horas: eb * dt / f.kW, kW: f.kW, motivo, peso: (pa - pb) * 10 + 0.5 });
    });
    lista.sort((x, y) => y.peso - x.peso);
    return lista;
  };
})(typeof window !== 'undefined' ? window : globalThis);
