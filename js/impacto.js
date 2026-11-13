/* Carga Certa — impacto ambiental honesto e acompanhamento das faturas.
 *
 *  1) Impacto: quanto a fábrica tira da rede, quanto disso cai no horário de ponta, quanto da solar
 *     própria é usada, injetada ou cortada, e o CO2 da energia tirada da rede (kWh × fator médio de
 *     emissão do Sistema Interligado Nacional, publicado pelo MCTI).
 *     A agenda muda o HORÁRIO do consumo e quase não muda o total: o CO2 só cai quando cai a energia
 *     tirada da rede (por exemplo, quando a fábrica usa mais da própria solar).
 *  2) Acompanhamento: a fábrica digita as faturas de cada mês e marca quando começou a seguir o plano.
 *     A média antes × depois é comparada com a economia que a simulação previu.
 *
 *  Só lógica, sem tela: pode ser testado no Node.
 */
(function (G) {
  'use strict';
  const CC = G.CC = G.CC || {};
  const U = CC.util;
  const IM = CC.impacto = {};

  /** tCO2/MWh (= kg de CO2 por kWh). Média do SIN em 2023: 38,5 kg de CO2 por MWh gerado (MCTI). */
  IM.FATOR_PADRAO = 0.0385;
  IM.FONTES = {
    fator: { texto: 'MCTI: 38,5 kg de CO₂ por MWh gerado no Sistema Interligado Nacional em 2023 (eixos, 16/02/2024)', url: 'https://eixos.com.br/energia-eletrica/brasil-tem-menor-taxa-de-emissao-de-carbono-na-geracao-eletrica-em-onze-anos/' },
    ponta: { texto: 'ONS: previsão de déficit de cerca de 4 GW no horário de ponta e geração termelétrica maximizada no 2º semestre de 2025 (Movimento Econômico, 03/07/2025)', url: 'https://movimentoeconomico.com.br/economia/energia/2025/07/03/deficit-de-potencia-leva-ons-a-acionar-termicas-com-impacto-na-conta-de-luz/' },
    cortes: { texto: 'Volt Robotics: cerca de 20,6% da energia limpa que poderia ter sido produzida em 2025 foi cortada; os cortes são definidos pelo ONS (Movimento Econômico, 03/01/2026)', url: 'https://movimentoeconomico.com.br/economia/energia/2026/01/03/brasil-desperdica-206-da-energia-limpa-e-perde-r-6-bilhoes-em-2025/' },
  };

  const fin = (v) => (v === null || v === '' || v === undefined ? null : (Number.isFinite(+v) ? +v : null));
  IM.fator = (cen) => {
    const f = cen && cen.impacto ? fin(cen.impacto.fatorEmissao) : null;
    return f != null && f >= 0 ? f : IM.FATOR_PADRAO;
  };

  // ---------------------------------------------------------------- 1) impacto
  /** Números de um plano, por mês. av = avaliação (OT.avaliar) do plano. */
  IM.medir = function (inst, av, fator) {
    const f = inst.fatorMes, k = av.kwh;
    const fe = fin(fator) != null && fin(fator) >= 0 ? +fator : IM.FATOR_PADRAO;
    const redeMes = k.rede * f;
    return {
      consumoMes: k.consumo * f,
      redeMes,
      pontaMes: k.ponta * f,
      foraPontaMes: (k.rede - k.ponta) * f,
      solarGeradaMes: k.solar * f, // produzida pelos módulos, já descontados os cortes
      solarUsadaMes: Math.max(0, k.solar - k.injecao) * f,
      solarInjetadaMes: k.injecao * f,
      solarCortadaMes: (k.cortLim + k.cortVW) * f,
      co2KgMes: redeMes * fe, // kWh × (tCO2/MWh = kg/kWh)
    };
  };

  /** Hoje × planejado. */
  IM.comparar = function (inst, avBase, avOtim, fator) {
    const fe = fin(fator) != null && fin(fator) >= 0 ? +fator : IM.FATOR_PADRAO;
    const hoje = IM.medir(inst, avBase, fe), plano = IM.medir(inst, avOtim, fe);
    return {
      hoje, plano, fator: fe, temSolar: inst.kWp > 0,
      deslocadoPontaMes: hoje.pontaMes - plano.pontaMes,
      difConsumoMes: hoje.consumoMes - plano.consumoMes,
      difRedeMes: hoje.redeMes - plano.redeMes,
      difCo2KgMes: hoje.co2KgMes - plano.co2KgMes,
    };
  };

  /** Frases curtas e honestas sobre o impacto (as mesmas na tela e no relatório). */
  IM.textos = function (c) {
    const t = [];
    const n = (v) => U.num(v, 0);
    const relConsumo = c.hoje.consumoMes > 0 ? Math.abs(c.difConsumoMes) / c.hoje.consumoMes : 0;
    t.push(relConsumo < 0.02
      ? `A agenda muda o horário, não o total: a fábrica continua consumindo cerca de ${n(c.plano.consumoMes)} kWh por mês.`
      : `A agenda muda principalmente o horário: o consumo da fábrica vai de ${n(c.hoje.consumoMes)} para ${n(c.plano.consumoMes)} kWh por mês.`);
    if (c.difCo2KgMes >= 0.5) {
      t.push(`O CO₂ só cai quando cai a energia tirada da rede. ${c.temSolar ? 'Aqui a fábrica passa a usar mais da própria solar e ' : 'Aqui '}a energia da rede cai ${n(c.difRedeMes)} kWh por mês: cerca de ${n(c.difCo2KgMes)} kg de CO₂ a menos por mês (${U.pct(c.difCo2KgMes / Math.max(1e-9, c.hoje.co2KgMes), 1)}).`);
    } else if (c.difCo2KgMes <= -0.5) {
      t.push(`O CO₂ só cai quando cai a energia tirada da rede. Neste plano ela sobe ${n(-c.difRedeMes)} kWh por mês (cerca de ${n(-c.difCo2KgMes)} kg de CO₂ a mais): a economia vem do horário mais barato, não de usar menos energia.`);
    } else {
      t.push(`O CO₂ só cai quando cai a energia tirada da rede. Como o total quase não muda, o CO₂ fica praticamente igual (cerca de ${n(c.plano.co2KgMes)} kg por mês): a economia vem do horário mais barato.`);
    }
    if (c.deslocadoPontaMes >= 1) {
      t.push(`Tirar ${n(c.deslocadoPontaMes)} kWh por mês do horário de ponta alivia o sistema no fim da tarde, justamente quando o ONS precisa acionar termelétricas (em julho de 2025 o ONS previa falta de cerca de 4 GW de potência nesse horário).`);
    }
    t.push('Usar energia no meio do dia ajuda a aproveitar a solar e a eólica que hoje são desperdiçadas: cerca de 20,6% da energia limpa que poderia ter sido produzida em 2025 foi cortada.');
    return t;
  };

  IM.notaFator = (fe) => `CO₂ calculado com ${U.num(fe * 1000, 1)} kg por MWh tirado da rede (média do Sistema Interligado Nacional em 2023, segundo o MCTI). A energia que a solar injeta na rede não entra nesta conta.`;

  // ---------------------------------------------------------------- 2) acompanhamento das faturas
  IM.MES = /^\d{4}-(0[1-9]|1[0-2])$/;
  const NOMES_MES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  IM.fmtMes = (m) => (IM.MES.test(String(m || '')) ? `${NOMES_MES[+m.slice(5, 7) - 1]}/${m.slice(0, 4)}` : '—');
  /** Aceita "2026-08", "2026-8", "08/2026" e "8/2026"; devolve "2026-08" ou '' se não entender. */
  IM.lerMes = function (txt) {
    const s = String(txt == null ? '' : txt).trim();
    let m = /^(\d{4})[-/.](\d{1,2})$/.exec(s), a, b;
    if (m) { a = m[1]; b = m[2]; } else {
      m = /^(\d{1,2})[-/.](\d{4})$/.exec(s);
      if (!m) return '';
      a = m[2]; b = m[1];
    }
    const r = `${a}-${String(+b).padStart(2, '0')}`;
    return IM.MES.test(r) ? r : '';
  };
  IM.mesSeguinte = function (m) {
    if (!IM.MES.test(String(m || ''))) return '';
    let a = +m.slice(0, 4), b = +m.slice(5, 7) + 1;
    if (b > 12) { b = 1; a++; }
    return `${a}-${String(b).padStart(2, '0')}`;
  };

  /** Deixa o acompanhamento num formato conhecido (dados de arquivo podem vir de qualquer jeito). */
  IM.normalizarAcomp = function (a) {
    a = a && typeof a === 'object' ? a : {};
    const faturas = (Array.isArray(a.faturas) ? a.faturas : []).filter((x) => x && typeof x === 'object').slice(0, 120).map((x) => ({
      mes: IM.lerMes(x.mes),
      kWh: fin(x.kWh), demandaKW: fin(x.demandaKW), valor: fin(x.valor),
    }));
    return { inicioPlano: IM.lerMes(a.inicioPlano), faturas, exemplo: !!a.exemplo };
  };

  /** O que a simulação prometeu (para comparar com as faturas). */
  IM.previsto = function (inst, avBase, avOtim) {
    const d = inst.dem;
    const contratada = d.mod === 'A4_verde' ? +d.Dc || 0 : d.mod === 'A4_azul' ? Math.max(+d.DcFP || 0, +d.DcP || 0) : 0;
    const eco = avBase.contaMes - avOtim.contaMes;
    return {
      contaHoje: avBase.contaMes, contaPlanejada: avOtim.contaMes, economiaMes: eco,
      economiaPct: avBase.contaMes > 0 ? eco / avBase.contaMes : 0,
      picoPlanejado: avOtim.picos.all, contratada, tolerancia: d.tol == null ? 0.05 : d.tol,
    };
  };

  const media = (lista, campo) => {
    const v = lista.map((f) => f[campo]).filter((x) => Number.isFinite(x) && x >= 0);
    return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null;
  };

  /**
   * Compara a média das faturas antes e depois do mês em que a fábrica começou a seguir o plano.
   * estado: 'sem-faturas' | 'sem-inicio' | 'faltam-dados' | 'ok' | 'abaixo' | 'sem-economia'
   */
  IM.acompanhar = function (acomp, prev) {
    const a = IM.normalizarAcomp(acomp);
    const validas = a.faturas.filter((f) => f.mes).sort((x, y) => (x.mes < y.mes ? -1 : x.mes > y.mes ? 1 : 0));
    const vistos = new Set(), repetidos = [];
    for (const f of validas) { if (vistos.has(f.mes) && !repetidos.includes(f.mes)) repetidos.push(f.mes); vistos.add(f.mes); }
    const r = { faturas: validas, inicio: a.inicioPlano, repetidos, antes: [], depois: [], mediaAntes: null, mediaDepois: null, economiaMes: null, economiaPct: null, previsto: prev || null, ultrapassagens: [] };
    if (!validas.length) { r.estado = 'sem-faturas'; return r; }
    if (!a.inicioPlano) { r.estado = 'sem-inicio'; return r; }
    r.antes = validas.filter((f) => f.mes < a.inicioPlano);
    r.depois = validas.filter((f) => f.mes >= a.inicioPlano);
    const medias = (l) => ({ kWh: media(l, 'kWh'), demandaKW: media(l, 'demandaKW'), valor: media(l, 'valor'), meses: l.length });
    r.mediaAntes = medias(r.antes); r.mediaDepois = medias(r.depois);
    if (prev && prev.contratada > 0) {
      const lim = prev.contratada * (1 + (prev.tolerancia == null ? 0.05 : prev.tolerancia));
      r.ultrapassagens = validas.filter((f) => Number.isFinite(f.demandaKW) && f.demandaKW > lim).map((f) => f.mes);
    }
    if (r.mediaAntes.valor == null || r.mediaDepois.valor == null || r.mediaAntes.valor <= 0) { r.estado = 'faltam-dados'; return r; }
    r.economiaMes = r.mediaAntes.valor - r.mediaDepois.valor;
    r.economiaPct = r.economiaMes / r.mediaAntes.valor;
    const alvo = prev ? Math.max(0, prev.economiaPct) : 0;
    if (r.economiaPct <= 0) r.estado = 'sem-economia';
    else if (alvo <= 0.005 || r.economiaPct >= 0.8 * alvo) r.estado = 'ok';
    else r.estado = 'abaixo';
    return r;
  };

  /** Mensagem principal do acompanhamento (tela e relatório). */
  IM.textoAcomp = function (r) {
    const p = r.previsto;
    switch (r.estado) {
      case 'sem-faturas': return { classe: '', texto: 'Ainda não há faturas. Digite pelo menos um mês antes e um mês depois de começar a seguir o plano.' };
      case 'sem-inicio': return { classe: '', texto: 'Marque o mês em que a fábrica começou a seguir o plano para separar as faturas de antes e de depois.' };
      case 'faltam-dados': return { classe: '', texto: `Faltam faturas com valor ${!r.antes.length || r.mediaAntes.valor == null ? 'antes' : 'depois'} de ${IM.fmtMes(r.inicio)} para comparar.` };
      case 'ok': return { classe: 'ok', texto: `A economia real (${U.pct(r.economiaPct, 1)}, cerca de ${U.brl(r.economiaMes)} por mês) está perto da prevista pela simulação (${U.pct(p ? p.economiaPct : 0, 1)}). Continue acompanhando todo mês.` };
      case 'abaixo': return { classe: 'alerta', texto: `A economia real (${U.pct(r.economiaPct, 1)}) ficou abaixo da prevista (${U.pct(p ? p.economiaPct : 0, 1)}). Conferir com o engenheiro: a agenda está sendo seguida? A produção ou a tarifa mudaram?` };
      default: return { classe: 'erro', texto: `As faturas depois de ${IM.fmtMes(r.inicio)} não mostram economia. Conferir com o engenheiro e com o encarregado se a agenda está sendo seguida e se algo mudou na produção ou na tarifa.` };
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);
