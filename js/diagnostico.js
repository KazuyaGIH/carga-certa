/* Carga Certa — diagnóstico de engenharia elétrica sobre a agenda planejada.
 *
 *  1) Modalidade tarifária: quanto a conta seria em cada modalidade (com a agenda de hoje, com a agenda
 *     atual e replanejando para aquela tarifa). Mostra que a Tarifa Branca só compensa se a agenda mudar.
 *  2) Demanda contratada: custo mensal em função da demanda contratada, com a regra de ultrapassagem.
 *  3) Fator de carga e custo médio do kWh.
 *  4) Geração solar: varre a potência instalada e replaneja para cada tamanho. Mostra o corte por limite
 *     de injeção e por volt-watt, o autoconsumo, o retorno simples e o VPL.
 *  5) Fator de potência: reativo excedente (grupo A, referência 0,92) e banco de capacitores automático.
 */
(function (G) {
  'use strict';
  const CC = G.CC = G.CC || {};
  const U = CC.util, TA = CC.tarifas, MO = CC.modelo, OT = CC.otim;
  const D = CC.diag = {};

  const espera = () => new Promise((r) => setTimeout(r, 0));

  function avaliarPlanoSerial(cen, serial) {
    const inst = MO.construir(cen);
    const plano = OT.desserializar(inst, serial);
    const est = new OT.Estado(inst, plano);
    return { inst, plano, av: OT.avaliar(inst, est) };
  }

  // ---------------------------------------------------------------- 1) modalidades
  D.compararModalidades = async function (cen, serialBase, serialOtim, opc) {
    opc = opc || {};
    const grupoAtual = TA.grupo(cen.tarifa.modalidade);
    const mods = Object.keys(TA.MODALIDADES);
    const res = [];
    for (let i = 0; i < mods.length; i++) {
      const mod = mods[i];
      const cen2 = U.clonar(cen);
      cen2.tarifa.modalidade = mod;
      const hoje = avaliarPlanoSerial(cen2, serialBase);
      const mesma = avaliarPlanoSerial(cen2, serialOtim);
      let replanejada = null;
      if (opc.replanejar) {
        const p = await OT.otimizar(mesma.inst, mesma.plano, { iteracoes: opc.iteracoes == null ? 60 : opc.iteracoes });
        replanejada = OT.avaliar(mesma.inst, new OT.Estado(mesma.inst, p));
      }
      res.push({
        mod, nome: TA.MODALIDADES[mod].nome, grupo: TA.grupo(mod), atual: mod === cen.tarifa.modalidade,
        mesmoGrupo: TA.grupo(mod) === grupoAtual,
        contaHoje: hoje.av.contaMes, contaAgendaAtual: mesma.av.contaMes,
        contaReplanejada: replanejada ? replanejada.contaMes : null,
        atrasos: replanejada ? replanejada.pedidos.filter((p) => p.atrasoH > 0).length : 0,
      });
      if (opc.aoProgresso) opc.aoProgresso((i + 1) / mods.length);
      await espera();
    }
    const validas = res.filter((r) => r.mesmoGrupo);
    const chave = (r) => (r.contaReplanejada != null ? r.contaReplanejada : r.contaAgendaAtual);
    const melhor = validas.reduce((a, b) => (chave(b) < chave(a) ? b : a), validas[0]);
    return { linhas: res, melhor };
  };

  // ---------------------------------------------------------------- 2) demanda contratada
  D.demandaContratada = function (inst, av) {
    const d = inst.dem;
    if (d.mod !== 'A4_verde' && d.mod !== 'A4_azul') return { aplica: false };
    const picos = av.picos;
    const ft = d.ft;
    function custoParcela(med, con, preco) {
      const fat = Math.max(med, con), ultr = med > con * (1 + d.tol) ? med - con : 0;
      return (preco * fat + d.fu * preco * ultr) * ft;
    }
    const arred = (x) => Math.max(30, Math.ceil(x / 5) * 5); // múltiplos de 5 kW, mínimo de 30 kW
    const parcelas = d.mod === 'A4_verde'
      ? [{ nome: 'Demanda', medida: picos.all, contratada: d.Dc, preco: d.D }]
      : [{ nome: 'Demanda na ponta', medida: picos.p, contratada: d.DcP, preco: d.DP }, { nome: 'Demanda fora de ponta', medida: picos.fp, contratada: d.DcFP, preco: d.DFP }];
    let economia = 0;
    for (const p of parcelas) {
      p.recomendada = arred(p.medida * 1.05); // folga de 5% para variações entre semanas
      p.custoAtual = custoParcela(p.medida, p.contratada, p.preco);
      p.custoRecomendado = custoParcela(p.medida, p.recomendada, p.preco);
      p.ultrapassagem = p.medida > p.contratada * (1 + d.tol);
      economia += p.custoAtual - p.custoRecomendado;
      const max = Math.max(p.contratada, p.medida) * 1.6 + 10;
      p.curva = [];
      for (let dc = 0; dc <= max; dc += Math.max(1, Math.round(max / 60))) p.curva.push({ dc, custo: custoParcela(p.medida, dc, p.preco) });
    }
    return { aplica: true, parcelas, economia };
  };

  // ---------------------------------------------------------------- 4) solar
  D.dimensionarSolar = async function (cen, serialOtim, opc) {
    opc = opc || {};
    const atual = cen.solar && cen.solar.ativo ? +cen.solar.kWp || 0 : 0;
    // Limite regulatório (REN 1.000/2021): potência instalada da geração até a demanda contratada (grupo A)
    // ou a potência disponibilizada (grupo B; aqui usamos o teto da microgeração, 75 kW).
    // Potência instalada = menor valor entre módulos e inversores, então os módulos podem passar 20% dos inversores.
    const tar = cen.tarifa, dc = tar.demandaContratada || {};
    const grupoA = TA.grupo(tar.modalidade) === 'A';
    const limiteKW = grupoA ? (tar.modalidade === 'A4_azul' ? Math.max(+dc.ponta || 0, +dc.foraPonta || 0) : +dc.unica || 0) : 75;
    const fatorDCAC = 1.2;
    const capKWp = Math.max(10, Math.round(limiteKW * fatorDCAC));
    const passo = Math.max(5, Math.round(capKWp / 10 / 5) * 5);
    const tamanhos = [];
    for (let k = 0; k <= capKWp; k += passo) tamanhos.push(k);
    if (tamanhos[tamanhos.length - 1] !== capKWp) tamanhos.push(capKWp);
    if (atual && !tamanhos.includes(atual)) { tamanhos.push(atual); tamanhos.sort((a, b) => a - b); }
    const custoKWp = +(cen.solar && cen.solar.custoKWp) || 3600;
    const taxa = 0.10, anos = 25, degr = 0.005, om = 0.01;
    const linhas = [];
    for (let i = 0; i < tamanhos.length; i++) {
      const kWp = tamanhos[i];
      const cen2 = U.clonar(cen);
      cen2.solar = cen2.solar || {};
      cen2.solar.ativo = kWp > 0;
      cen2.solar.kWp = kWp;
      const r = avaliarPlanoSerial(cen2, serialOtim);
      let av = r.av;
      if (opc.replanejar !== false) {
        const p = await OT.otimizar(r.inst, r.plano, { iteracoes: opc.iteracoes == null ? 40 : opc.iteracoes });
        av = OT.avaliar(r.inst, new OT.Estado(r.inst, p));
      }
      const f = r.inst.fatorMes;
      linhas.push({
        kWp, conta: av.contaMes,
        geracaoMes: av.kwh.solarDisp * f, aproveitadaMes: av.kwh.solar * f, injetadaMes: av.kwh.injecao * f,
        cortLimMes: av.kwh.cortLim * f, cortVWMes: av.kwh.cortVW * f, autoconsumo: av.autoconsumo,
        aproveitamento: av.aproveitamentoSolar, pico: av.picos.all,
      });
      if (opc.aoProgresso) opc.aoProgresso((i + 1) / tamanhos.length);
      await espera();
    }
    const semSolar = linhas[0].conta;
    for (const l of linhas) {
      l.economiaMes = semSolar - l.conta;
      l.capex = l.kWp * custoKWp;
      const anual = l.economiaMes * 12, omAno = l.capex * om;
      l.payback = anual - omAno > 0 ? l.capex / (anual - omAno) : Infinity;
      let vpl = -l.capex;
      for (let a = 1; a <= anos; a++) vpl += (anual * Math.pow(1 - degr, a - 1) - omAno) / Math.pow(1 + taxa, a);
      l.vpl = l.kWp > 0 ? vpl : 0;
      l.acimaLimite = l.kWp > capKWp;
    }
    const validas = linhas.filter((l) => !l.acimaLimite);
    const recomendado = validas.reduce((a, b) => (b.vpl > a.vpl ? b : a), validas[0]);
    return {
      linhas, recomendado, atual, limiteKW, capKWp, fatorDCAC, grupoA,
      noLimite: recomendado.kWp === capKWp,
      premissas: { custoKWp, taxa, anos, degr, om },
    };
  };

  // ---------------------------------------------------------------- 5) fator de potência
  D.reativos = function (inst, plano, av) {
    const q = OT.reativo(inst, plano);
    const A = av.arr, T = inst.T, dt = inst.dt, fr = 0.92;
    const tanAlvo = Math.tan(Math.acos(0.95)), tan97 = Math.tan(Math.acos(0.97));
    const ft = inst.dem.ft, preco = (+inst.cen.tarifa.teReativo || 0.31696) * ft;
    let eP = 0, eQ = 0, ere = 0, kvarMax = 0, eCarga = 0;
    const req = [];
    for (let t = 0; t < T; t++) {
      const P = A.imp[t], Q = q[t];
      eP += P * dt; eQ += Q * dt; eCarga += A.carga[t] * dt;
      if (Q > kvarMax) kvarMax = Q;
      const S = Math.hypot(P, Q);
      if (S > 0 && P / S < fr) ere += (fr * S - P) * dt;
      if (A.carga[t] > 0) req.push(Math.max(0, Q - P * tanAlvo));
    }
    req.sort((a, b) => a - b);
    const p95 = req.length ? req[Math.min(req.length - 1, Math.floor(req.length * 0.95))] : 0;
    const banco = p95 > 0 ? Math.ceil(p95 / 5) * 5 : 0;
    let ereBanco = 0;
    for (let t = 0; t < T; t++) {
      const P = A.imp[t], Q = q[t];
      const Q2 = Q - Math.min(banco, Math.max(0, Q - P * tan97));
      const S = Math.hypot(P, Q2);
      if (S > 0 && P / S < fr) ereBanco += (fr * S - P) * dt;
    }
    // Mesma conta sem a solar (para mostrar o efeito da geração sobre o fator de potência medido)
    let ePs = 0;
    for (let t = 0; t < T; t++) ePs += A.carga[t] * dt;
    const fpMedio = eP + eQ > 0 ? eP / Math.hypot(eP, eQ) : 1;
    const fpSemSolar = ePs + eQ > 0 ? ePs / Math.hypot(ePs, eQ) : 1;
    const grupoA = TA.grupo(inst.dem.mod) === 'A';
    return {
      grupoA, fpMedio, fpSemSolar, kvarMax, banco,
      custoMes: grupoA ? ere * preco * inst.fatorMes : 0,
      custoMesComBanco: grupoA ? ereBanco * preco * inst.fatorMes : 0,
      kvarhMes: ere * inst.fatorMes,
    };
  };

  /** Recomendações em texto para o painel e o relatório. */
  D.recomendacoes = function (ctx) {
    const r = [];
    const { avBase, avOtim, modalidades, demanda, solar, reat } = ctx;
    if (avBase && avOtim) {
      const eco = avBase.contaMes - avOtim.contaMes;
      if (eco > 1) r.push(`Seguir a agenda planejada: economia estimada de ${U.brl(eco)} por mês (${U.pct(eco / avBase.contaMes, 1)}), com ${avOtim.noPrazo} de ${avOtim.pedidos.length} pedidos no prazo.`);
    }
    if (modalidades && modalidades.melhor && !modalidades.melhor.atual) {
      const atual = modalidades.linhas.find((l) => l.atual);
      const m = modalidades.melhor;
      const v = m.contaReplanejada != null ? m.contaReplanejada : m.contaAgendaAtual;
      const va = atual.contaReplanejada != null ? atual.contaReplanejada : atual.contaAgendaAtual;
      if (va - v > 1) r.push(`Avaliar a troca para a modalidade ${m.nome}: ${U.brl(va - v)} a menos por mês, desde que a agenda acompanhe a nova tarifa.`);
    }
    if (demanda && demanda.aplica) {
      for (const p of demanda.parcelas) {
        if (p.ultrapassagem) r.push(`${p.nome}: a medição (${U.num(p.medida, 0)} kW) passa da contratada (${U.num(p.contratada, 0)} kW) e gera multa de ultrapassagem. Contratar cerca de ${p.recomendada} kW.`);
        else if (p.contratada - p.recomendada >= 5) r.push(`${p.nome}: com a nova agenda o pico fica em ${U.num(p.medida, 0)} kW. Dá para reduzir a demanda contratada de ${U.num(p.contratada, 0)} kW para cerca de ${p.recomendada} kW (${U.brl(p.custoAtual - p.custoRecomendado)} a menos por mês), respeitando os prazos de alteração de contrato da REN 1.000/2021.`);
      }
    }
    if (solar && solar.recomendado) {
      const rec = solar.recomendado, at = solar.linhas.find((l) => l.kWp === solar.atual);
      if (rec.kWp > 0 && (!at || Math.abs(rec.kWp - solar.atual) >= 5)) {
        const corte = rec.cortLimMes + rec.cortVWMes;
        const limite = solar.noLimite
          ? ` Esse tamanho já encosta no limite regulatório (inversores até ${U.num(solar.limiteKW, 0)} kW ${solar.grupoA ? 'de demanda contratada' : 'de microgeração'}).`
          : '';
        r.push(`Geração solar: o melhor retorno está perto de ${rec.kWp} kWp (VPL de ${U.brl(rec.vpl)} em 25 anos, retorno simples de ${U.num(rec.payback, 1)} anos), com ${U.num(corte, 0)} kWh/mês cortados pelo limite de injeção e pelo volt-watt.${limite}`);
        if (demanda && demanda.aplica && solar.grupoA) {
          const recDem = Math.max(...demanda.parcelas.map((p) => p.recomendada));
          const inversor = Math.ceil(rec.kWp / solar.fatorDCAC);
          if (inversor > recDem) r.push(`Atenção ao combinar as duas medidas: a solar de ${rec.kWp} kWp precisa de cerca de ${inversor} kW de inversor, e a demanda contratada não pode ficar abaixo disso. Reduzir a demanda para ${recDem} kW limita a usina a uns ${Math.round(recDem * solar.fatorDCAC)} kWp.`);
        }
      }
    }
    if (reat && reat.grupoA && reat.custoMes > 20) {
      r.push(`Fator de potência: o reativo excedente custa cerca de ${U.brl(reat.custoMes)} por mês. Um banco de capacitores automático de ${reat.banco} kvar reduz esse valor para ${U.brl(reat.custoMesComBanco)}.`);
    }
    return r;
  };
})(typeof window !== 'undefined' ? window : globalThis);
