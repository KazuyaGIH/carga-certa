/* Carga Certa — transforma o cenário (dados da fábrica, em JSON) numa "instância" discreta no tempo.
 *
 * O horizonte (normalmente 1 semana) é dividido em intervalos de 15 min, o mesmo intervalo que a
 * distribuidora usa para medir a demanda. Para cada intervalo calculamos: preço da energia, posto
 * tarifário, cargas fixas, geração solar disponível, tensão de fundo da rede e limites de demanda.
 */
(function (G) {
  'use strict';
  const CC = G.CC = G.CC || {};
  const U = CC.util, TA = CC.tarifas, SO = CC.solar;
  const MO = CC.modelo = {};

  const tanFP = (fp) => { const f = +fp; return !(f > 0) || f >= 1 ? 0 : Math.tan(Math.acos(f)); };
  MO.tanFP = tanFP;

  MO.construir = function (cen) {
    const avisos = [];
    const passo = +cen.passoMin || 15;
    const dt = passo / 60;
    const t0 = U.parseDT(String(cen.inicio).slice(0, 10));
    if (!Number.isFinite(t0)) throw new Error('Data de início do horizonte inválida.');
    const dias = Math.max(1, Math.round(+cen.dias || 7));
    const T = Math.round(dias * 1440 / passo);
    const slot = (min, arred) => {
      const x = (min - t0) / passo;
      return arred === 'cima' ? Math.ceil(x - 1e-9) : arred === 'baixo' ? Math.floor(x + 1e-9) : Math.round(x);
    };

    const inst = { cen, passo, dt, t0, T, dias, fatorMes: 30.4375 / dias, avisos };
    inst.tempo = (t) => t0 + t * passo;
    const agoraMin = U.parseDT(cen.agora || cen.inicio);
    inst.agoraSlot = U.clamp(slot(Number.isFinite(agoraMin) ? agoraMin : t0, 'cima'), 0, T);

    // ---------- calendário e tarifa ----------
    const tar = cen.tarifa;
    const mod = tar.modalidade;
    const dow = new Uint8Array(T), minDia = new Uint16Array(T), dia = new Uint16Array(T), posto = new Uint8Array(T);
    const preco = new Float64Array(T), credito = new Float64Array(T), datas = new Array(T);
    for (let t = 0; t < T; t++) {
      const m = t0 + t * passo, p = U.partes(m);
      dow[t] = p.dow; minDia[t] = p.minDia; dia[t] = Math.floor((t * passo) / 1440);
      datas[t] = U.fmtData(m);
      posto[t] = TA.posto(m, tar, mod);
      preco[t] = TA.precoEnergia(posto[t], tar, mod);
      credito[t] = TA.precoCredito(posto[t], tar, mod);
    }
    Object.assign(inst, { dow, minDia, dia, posto, preco, credito });
    inst.dem = TA.parametrosDemanda(tar, mod, cen.objetivo ? cen.objetivo.pesoPico : 5);

    // ---------- exceções de turno (afetam máquinas e cargas que seguem o turno) ----------
    const excecoes = new Map();
    for (const e of cen.excecoesTurno || []) if (e && e.data) excecoes.set(String(e.data).slice(0, 10), e);
    function ativo(janelas, segueTurno, t) {
      if (segueTurno && excecoes.size) {
        const e = excecoes.get(datas[t]);
        if (e) {
          if (e.fechado) return false;
          const a = U.parseHora(e.inicio), b = U.parseHora(e.fim);
          if (Number.isFinite(a) && Number.isFinite(b)) return minDia[t] >= a && minDia[t] < (b <= a ? b + 1440 : b);
        }
      }
      return U.janelaAtiva(janelas, dow[t], minDia[t]);
    }

    // ---------- cargas fixas ----------
    const baseKW = new Float64Array(T), baseKVAr = new Float64Array(T);
    for (const c of cen.cargasFixas || []) {
      const { janelas, erros } = U.parseJanela(c.janela);
      if (erros.length) avisos.push(`Carga fixa "${c.nome}": horário não entendido (${erros.join('; ')}).`);
      const segue = c.segueTurno == null ? !U.janela24h(janelas) : !!c.segueTurno;
      const kw = +c.kW || 0, kvar = kw * tanFP(c.fp == null ? 0.92 : c.fp);
      for (let t = 0; t < T; t++) if (ativo(janelas, segue, t)) { baseKW[t] += kw; baseKVAr[t] += kvar; }
    }
    inst.baseKW = baseKW; inst.baseKVAr = baseKVAr;

    // ---------- máquinas ----------
    inst.maquinas = (cen.maquinas || []).map((m, i) => {
      const { janelas, erros } = U.parseJanela(m.janela);
      if (erros.length) avisos.push(`Máquina "${m.nome}": horário não entendido (${erros.join('; ')}).`);
      const segue = m.segueTurno == null ? !U.janela24h(janelas) : !!m.segueTurno;
      const perm = new Uint8Array(T);
      let maxRun = 0, run = 0;
      for (let t = 0; t < T; t++) {
        perm[t] = ativo(janelas, segue, t) ? 1 : 0;
        run = perm[t] ? run + 1 : 0;
        if (run > maxRun) maxRun = run;
      }
      const unidades = Math.max(1, Math.round(+m.unidades || 1));
      return {
        idx: i, id: String(m.id), nome: m.nome || m.id, unidades, kW: +m.potenciaKW || 0,
        fp: m.fp == null ? 0.85 : +m.fp, kvarPorKW: tanFP(m.fp == null ? 0.85 : m.fp),
        perm, maxRun, bloq: Array.from({ length: unidades }, () => new Uint8Array(T)),
      };
    });
    inst.maqIdx = new Map(inst.maquinas.map((m) => [m.id, m.idx]));

    for (const ind of cen.indisponibilidades || []) {
      const mi = inst.maqIdx.get(ind.maquina);
      if (mi == null) { avisos.push(`Parada de máquina com máquina desconhecida: ${ind.maquina}.`); continue; }
      const M = inst.maquinas[mi];
      const a = Math.max(0, slot(U.parseDT(ind.inicio), 'baixo'));
      const b = Math.min(T, slot(U.parseDT(ind.fim), 'cima'));
      if (!(b > a)) continue;
      const un = +ind.unidade >= 0.5 ? [U.clamp(Math.round(+ind.unidade), 1, M.unidades) - 1] : M.bloq.map((_, u) => u);
      for (const u of un) for (let t = a; t < b; t++) M.bloq[u][t] = 1;
    }

    // ---------- pedidos e operações ----------
    inst.ops = []; inst.pedidos = [];
    for (const p of cen.pedidos || []) {
      if (!p || p.cancelado) continue;
      const libMin = U.parseDT(p.liberacao || cen.inicio);
      const prazoMin = U.parseDT(p.prazo);
      const ped = {
        idx: inst.pedidos.length, id: String(p.id), cliente: p.cliente || '', produto: p.produto || '',
        quantidade: +p.quantidade || 0,
        lib: U.clamp(Number.isFinite(libMin) ? slot(libMin, 'cima') : 0, 0, T),
        prazo: Number.isFinite(prazoMin) ? Math.min(T, slot(prazoMin, 'baixo')) : T,
        prazoMin: Number.isFinite(prazoMin) ? prazoMin : t0 + T * passo,
        ops: [],
      };
      (p.etapas || []).forEach((e, j) => {
        const mi = inst.maqIdx.get(e.maquina);
        if (mi == null) { avisos.push(`${p.id}: etapa ${j + 1} usa a máquina "${e.maquina}", que não está cadastrada.`); return; }
        const M = inst.maquinas[mi];
        const horas = U.numeroBR(e.horas);
        const dur = Math.max(1, Math.round((Number.isFinite(horas) ? horas : 0) * 60 / passo));
        const kW = e.potenciaKW != null && e.potenciaKW !== '' ? +e.potenciaKW : M.kW;
        const op = {
          idx: inst.ops.length, id: `${p.id}#${j + 1}`, pedido: ped.idx, etapa: j, maq: mi, dur,
          kW, kvar: kW * M.kvarPorKW, horas: dur * dt,
        };
        if (dur > M.maxRun) {
          op.impossivel = true;
          avisos.push(`${p.id}: a etapa ${j + 1} (${M.nome}, ${U.num(dur * dt, 2)} h) é maior que o maior turno contínuo da máquina e não cabe sem pausa.`);
        }
        inst.ops.push(op); ped.ops.push(op.idx);
      });
      if (ped.ops.length) inst.pedidos.push(ped);
    }

    // ---------- cargas flexíveis (energia a entregar dentro de uma janela) ----------
    inst.flex = [];
    for (const c of cen.cargasFlexiveis || []) {
      // Os dias valem para cada trecho da janela ("08:00-10:00; 14:00-16:00").
      const diasTxt = String(c.dias || 'todos').trim() || 'todos';
      const trechos = String(c.janela || '00:00-24:00').split(/[;\n]+/).map((s) => s.trim()).filter(Boolean);
      const { janelas, erros } = U.parseJanela(trechos.map((s) => `${diasTxt} ${s}`).join('; '));
      if (erros.length || !janelas.length) { avisos.push(`Carga flexível "${c.nome}": janela não entendida.`); continue; }
      const kW = +c.potenciaMaxKW || 0, eDia = +c.energiaKWh || 0;
      if (!(kW > 0) || !(eDia > 0)) continue;
      for (let d = 0; d < dias; d++) {
        const dw = U.partes(t0 + d * 1440).dow;
        const doDia = janelas.filter((j) => j.dias[dw]);
        const minutosDia = doDia.reduce((s, j) => s + (j.fim - j.ini), 0);
        for (let k = 0; k < doDia.length; k++) {
          const j = doDia[k];
          const parte = minutosDia > 0 ? (j.fim - j.ini) / minutosDia : 1; // energia do dia dividida entre as janelas
          const aIdeal = Math.ceil((d * 1440 + j.ini) / passo - 1e-9), bIdeal = Math.floor((d * 1440 + j.fim) / passo + 1e-9);
          const a = Math.max(0, aIdeal), b = Math.min(T, bIdeal);
          if (b <= a) continue;
          let energia = eDia * parte * (b - a) / Math.max(1, bIdeal - aIdeal); // janela cortada pelo fim do horizonte
          const maxE = kW * dt * (b - a);
          if (energia > maxE + 1e-9) {
            if (b - a === bIdeal - aIdeal) avisos.push(`Carga flexível "${c.nome}": a energia pedida não cabe na janela; usando ${U.num(maxE, 1)} kWh.`);
            energia = maxE;
          }
          const slots = new Int32Array(b - a);
          for (let i = 0; i < slots.length; i++) slots[i] = a + i;
          inst.flex.push({
            idx: inst.flex.length, id: `${c.id}@${U.fmtData(t0 + d * 1440)}${doDia.length > 1 ? '#' + (k + 1) : ''}`, base: String(c.id), nome: c.nome || c.id,
            kW, kvarPorKW: tanFP(c.fp == null ? 0.9 : c.fp), energia, slots, continua: !!c.continua, dia: d,
          });
        }
      }
    }

    // ---------- geração solar e rede ----------
    const sol = cen.solar || {};
    const rede = sol.rede || {};
    const lat = sol.latitude == null ? -23.55 : +sol.latitude, lon = sol.longitude == null ? -46.63 : +sol.longitude;
    const pvDisp = new Float64Array(T), v0 = new Float64Array(T), ghi = new Float64Array(T);
    const vBase = rede.tensaoBase == null ? 1.0 : +rede.tensaoBase;
    const elev = +rede.elevacaoMeioDia || 0;
    const kWp = sol.ativo ? +sol.kWp || 0 : 0, pr = sol.pr == null ? 0.8 : +sol.pr;
    for (let t = 0; t < T; t++) {
      const g = SO.ghiCeuClaro(t0 + (t + 0.5) * passo, lat, lon, -3);
      const neb = sol.nebulosidade && sol.nebulosidade[dia[t]] != null ? U.clamp(+sol.nebulosidade[dia[t]], 0, 1) : 1;
      ghi[t] = g * neb;
      pvDisp[t] = kWp * pr * ghi[t] / 1000;
      v0[t] = vBase + elev * ghi[t] / 1000;
    }
    const vLL = +rede.tensaoV || 380;
    Object.assign(inst, {
      pvDisp, v0, ghi, kWp,
      sensV: (+rede.resistenciaOhm || 0) * 1000 / (vLL * vLL), // pu de subida de tensão por kW exportado
      vw: { ativo: !!(sol.ativo && sol.voltWatt && sol.voltWatt.ativo), v1: +(sol.voltWatt && sol.voltWatt.v1) || 1.05, v2: +(sol.voltWatt && sol.voltWatt.v2) || 1.10 },
      limInj: sol.ativo && sol.limiteInjecaoKW !== '' && sol.limiteInjecaoKW != null && Number.isFinite(+sol.limiteInjecaoKW) ? Math.max(0, +sol.limiteInjecaoKW) : Infinity,
    });
    if (inst.vw.v2 <= inst.vw.v1) inst.vw.v2 = inst.vw.v1 + 0.01;

    // ---------- limites de demanda pedidos (resposta da demanda, transformador etc.) ----------
    const cap = new Float64Array(T).fill(Infinity);
    for (const l of cen.limitesDemanda || []) {
      const a = Math.max(0, slot(U.parseDT(l.inicio), 'baixo')), b = Math.min(T, slot(U.parseDT(l.fim), 'cima'));
      const kw = +l.kW;
      if (!(b > a) || !Number.isFinite(kw)) continue;
      for (let t = a; t < b; t++) if (kw < cap[t]) cap[t] = kw;
    }
    inst.cap = cap;
    return inst;
  };
})(typeof window !== 'undefined' ? window : globalThis);
