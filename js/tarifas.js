/* Carga Certa — modelo tarifário (Grupo B3 e Grupo A4).
 *
 * Valores padrão: tarifas de aplicação da Enel Distribuição São Paulo homologadas pela ANEEL
 * na Resolução Homologatória nº 3.596, de 03/07/2026 (vigência 04/07/2026 a 03/07/2027),
 * SEM tributos (ICMS, PIS/COFINS) e sem bandeira. Fonte: dadosabertos.aneel.gov.br, conjuntos
 * "Tarifas de Aplicação das Distribuidoras de Energia Elétrica" e "Componentes Tarifárias"
 * (consultados em 13/11/2026). TE + TUSD já somadas, convertidas de R$/MWh para R$/kWh.
 *
 * Regras usadas:
 *  - Posto de ponta: 3 h em dias úteis (Enel SP: 17:30-20:30). Sábados, domingos e feriados
 *    nacionais são fora de ponta (REN ANEEL 1.000/2021).
 *  - Tarifa Branca: intermediário = 1 h antes e 1 h depois da ponta.
 *  - Grupo A: demanda faturada = max(medida, contratada). Se a medida passar de 105% da
 *    contratada, a parcela excedente paga a tarifa de ultrapassagem (2x a tarifa de demanda).
 *  - Energia injetada (geração própria, Lei 14.300/2022, GD II): o crédito vale a tarifa de
 *    energia menos a parcela do Fio B que deixa de ser compensada (60% em 2026).
 */
(function (G) {
  'use strict';
  const CC = G.CC = G.CC || {};
  const U = CC.util;
  const TA = CC.tarifas = {};

  TA.MODALIDADES = {
    B3_convencional: { grupo: 'B', nome: 'B3 Convencional', curta: 'Convencional' },
    B3_branca: { grupo: 'B', nome: 'B3 Branca', curta: 'Branca' },
    A4_verde: { grupo: 'A', nome: 'A4 Horária Verde', curta: 'Verde' },
    A4_azul: { grupo: 'A', nome: 'A4 Horária Azul', curta: 'Azul' },
  };
  TA.grupo = (mod) => (TA.MODALIDADES[mod] ? TA.MODALIDADES[mod].grupo : 'B');

  TA.PRESETS = {
    'enel-sp-2026': {
      nome: 'Enel SP · ANEEL REH nº 3.596/2026 (vigência 04/07/2026 a 03/07/2027)',
      ponta: { inicio: '17:30', fim: '20:30' },
      intermediarioMin: 60,
      precos: {
        B3_convencional: { energia: 0.78938 },                       // TUSD 472,42 + TE 316,96 R$/MWh
        B3_branca: { fp: 0.68501, int: 1.03179, p: 1.55911 },       // FP 383,10+301,91 · Int 729,88+301,91 · P 1076,66+482,45
        A4_verde: { energiaP: 1.40483, energiaFP: 0.45250, demanda: 19.04 },               // R$/kWh e R$/kW
        A4_azul: { energiaP: 0.63304, energiaFP: 0.45250, demandaP: 31.75, demandaFP: 19.04 },
      },
      fioB: { B: 0.21208, A: 0 },   // TUSD Fio B em R$/kWh (no grupo A o Fio B está na demanda, R$ 9,69/kW)
      teReativo: 0.31696,           // R$/kvarh para reativo excedente (TE de referência)
    },
  };

  /** Lei 14.300/2022 — parcela do Fio B não compensada para GD II, por ano. */
  TA.fioBPercentualPadrao = function (ano) {
    const tab = { 2023: 0.15, 2024: 0.30, 2025: 0.45, 2026: 0.60, 2027: 0.75, 2028: 0.90 };
    if (ano in tab) return tab[ano];
    return ano < 2023 ? 0 : 1;
  };

  // ---------------- Feriados nacionais (fora de ponta o dia todo) ----------------
  function pascoa(ano) { // algoritmo de Meeus/Jones/Butcher
    const a = ano % 19, b = Math.floor(ano / 100), c = ano % 100, d = Math.floor(b / 4), e = b % 4;
    const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
    const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
    const mes = Math.floor((h + l - 7 * m + 114) / 31), dia = ((h + l - 7 * m + 114) % 31) + 1;
    return Date.UTC(ano, mes - 1, dia) / 60000;
  }
  const cacheFeriados = {};
  TA.feriados = function (ano) {
    if (cacheFeriados[ano]) return cacheFeriados[ano];
    const s = new Set();
    // REN 1.000/2021 + 20/11 (Lei 14.759/2023). Confira a lista da sua distribuidora.
    for (const md of ['01-01', '04-21', '05-01', '09-07', '10-12', '11-02', '11-15', '11-20', '12-25']) s.add(`${ano}-${md}`);
    const p = pascoa(ano);
    for (const off of [-47, -2, 60]) s.add(U.fmtData(p + off * 1440)); // Carnaval (terça), Paixão, Corpus Christi
    return (cacheFeriados[ano] = s);
  };

  /** Posto tarifário de um instante: 0 = fora de ponta, 1 = intermediário (só Branca), 2 = ponta. */
  TA.posto = function (minAbs, tarifa, modalidade) {
    const mod = modalidade || tarifa.modalidade;
    const p = U.partes(minAbs);
    if (p.dow === 0 || p.dow === 6) return 0;
    if (TA.feriados(p.ano).has(U.fmtData(minAbs))) return 0;
    const ini = U.parseHora(tarifa.ponta.inicio), fim = U.parseHora(tarifa.ponta.fim);
    const m = p.minDia;
    if (m >= ini && m < fim) return 2;
    if (mod === 'B3_branca') {
      const im = tarifa.intermediarioMin == null ? 60 : +tarifa.intermediarioMin;
      if ((m >= ini - im && m < ini) || (m >= fim && m < fim + im)) return 1;
    }
    return 0;
  };

  TA.fatorTributos = (tar) => 1 / (1 - U.clamp(+tar.tributos || 0, 0, 0.6));

  /** R$/kWh sem tributos. */
  TA.precoBase = function (posto, tar, modalidade) {
    const mod = modalidade || tar.modalidade;
    const pr = tar.precos[mod];
    if (!pr) return 0;
    switch (mod) {
      case 'B3_convencional': return +pr.energia;
      case 'B3_branca': return posto === 2 ? +pr.p : posto === 1 ? +pr.int : +pr.fp;
      case 'A4_verde':
      case 'A4_azul': return posto === 2 ? +pr.energiaP : +pr.energiaFP;
      default: return 0;
    }
  };

  /** R$/kWh pago pela energia tirada da rede (com tributos e bandeira). */
  TA.precoEnergia = (posto, tar, mod) => (TA.precoBase(posto, tar, mod) + (+tar.bandeira || 0)) * TA.fatorTributos(tar);

  /** R$/kWh que a energia injetada devolve em créditos (Lei 14.300). */
  TA.precoCredito = function (posto, tar, modalidade) {
    const mod = modalidade || tar.modalidade;
    const g = TA.grupo(mod);
    const fioB = tar.fioB ? +tar.fioB[g] || 0 : 0;
    const pct = tar.fioBPercentual == null ? 0.6 : +tar.fioBPercentual;
    return Math.max(0, TA.precoBase(posto, tar, mod) + (+tar.bandeira || 0) - pct * fioB) * TA.fatorTributos(tar);
  };

  /** Parâmetros de demanda prontos para o otimizador (evita alocar objetos no laço quente). */
  TA.parametrosDemanda = function (tar, modalidade, pesoPico) {
    const mod = modalidade || tar.modalidade;
    const dc = tar.demandaContratada || {};
    const pv = tar.precos.A4_verde || {}, pa = tar.precos.A4_azul || {};
    return {
      mod,
      ft: TA.fatorTributos(tar),
      tol: tar.toleranciaUltrapassagem == null ? 0.05 : +tar.toleranciaUltrapassagem,
      fu: tar.fatorUltrapassagem == null ? 2 : +tar.fatorUltrapassagem,
      D: +pv.demanda || 0, Dc: +dc.unica || 0,
      DP: +pa.demandaP || 0, DcP: +dc.ponta || 0,
      DFP: +pa.demandaFP || 0, DcFP: +dc.foraPonta || 0,
      pesoPico: +pesoPico || 0,
    };
  };

  function parcela(med, con, preco, d) {
    const fat = med > con ? med : con;
    const ultr = med > con * (1 + d.tol) ? med - con : 0;
    return (preco * fat + d.fu * preco * ultr) * d.ft;
  }

  /** Custo mensal de demanda que aparece na conta (R$/mês, com tributos). */
  TA.demandaConta = function (d, all, p, fp) {
    if (d.mod === 'A4_verde') return parcela(all, d.Dc, d.D, d);
    if (d.mod === 'A4_azul') return parcela(p, d.DcP, d.DP, d) + parcela(fp, d.DcFP, d.DFP, d);
    return 0;
  };

  /** Versão detalhada, para telas e relatório. */
  TA.detalheDemanda = function (d, picos) {
    const itens = [];
    function item(nome, med, con, preco) {
      const fat = Math.max(med, con);
      const ultr = med > con * (1 + d.tol) ? med - con : 0;
      itens.push({
        nome, medida: med, contratada: con, faturada: fat, ultrapassagem: ultr, preco,
        valor: preco * fat * d.ft, valorUltrapassagem: d.fu * preco * ultr * d.ft,
      });
    }
    if (d.mod === 'A4_verde') item('Demanda', picos.all, d.Dc, d.D);
    else if (d.mod === 'A4_azul') { item('Demanda na ponta', picos.p, d.DcP, d.DP); item('Demanda fora de ponta', picos.fp, d.DcFP, d.DFP); }
    return itens;
  };
})(typeof window !== 'undefined' ? window : globalThis);
