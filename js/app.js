/* Carga Certa — interface: estado, telas, edição dos dados, eventos com IA, diagnóstico e relatório. */
(function () {
  'use strict';
  const CC = window.CC;
  const U = CC.util, TA = CC.tarifas, MO = CC.modelo, OT = CC.otim, DG = CC.diag, IA = CC.iaLocal, NV = CC.iaNuvem, EV = CC.eventos, GR = CC.graficos, RV = CC.revisao, IM = CC.impacto;
  const $ = (s, el) => (el || document).querySelector(s);
  const $$ = (s, el) => Array.from((el || document).querySelectorAll(s));
  const esc = U.esc;
  const LS = 'cargaCerta.v1';
  const LS_CHAVE = (m) => 'cargaCerta.chave.' + m;
  const LS_FILA = 'cargaCerta.fila.v1';
  const LS_ENG = 'cargaCerta.engenheiro.v1';
  const SITE = /^https?:$/.test(location.protocol) ? location.origin + location.pathname.replace(/index\.html$/, '') : 'https://kazuyagih.github.io/carga-certa/';
  const lsGet = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const lsSet = (k, v) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { /* navegação privada */ } };

  const S = {
    cen: null, inst: null, planoBase: null, planoOtim: null, avBase: null, avOtim: null,
    serialBase: null, serialOtim: null, diagRapido: null, diag: null,
    aba: 'visao', visao: 'otim', ganttPlano: 'otim', ganttDia: -1,
    historico: [], pendentes: null, impacto: null,
    ocupado: false, sujo: false, execucao: 0,
    motor: 'local', chaves: {}, modeloGemini: NV.MODELO_GEMINI,
    // ponte com o engenheiro
    fila: [], perfil: { nome: '', registro: '', organizacao: '', especialidades: [] }, casoId: null, ordemFila: 'reais', soCombina: false,
  };

  // ================================================================== utilidades da tela
  let timerToast = null;
  function toast(msg, tipo) {
    const el = $('#toast');
    el.textContent = msg; el.className = 'toast' + (tipo ? ' ' + tipo : ''); el.hidden = false;
    clearTimeout(timerToast);
    timerToast = setTimeout(() => { el.hidden = true; }, tipo === 'erro' ? 8000 : 3500);
  }
  function confirmar(msg, textoSim) {
    return new Promise((res) => {
      const box = $('#confirmacao');
      $('#confirmacaoTexto').textContent = msg;
      $('#confirmacaoSim').textContent = textoSim || 'Continuar';
      box.hidden = false;
      const fim = (v) => { box.hidden = true; $('#confirmacaoSim').onclick = null; $('#confirmacaoNao').onclick = null; res(v); };
      $('#confirmacaoSim').onclick = () => fim(true);
      $('#confirmacaoNao').onclick = () => fim(false);
    });
  }
  function progresso(f) {
    const bar = $('#barraProgresso');
    if (f == null) { bar.hidden = true; return; }
    bar.hidden = false;
    bar.firstElementChild.style.width = Math.round(U.clamp(f, 0, 1) * 100) + '%';
  }
  function ocupado(v) {
    S.ocupado = v;
    // Enquanto o plano é refeito, nada que mude o cenário pode ser clicado.
    for (const id of ['btnOtimizar', 'btnOtimizar2', 'btnAplicar', 'btnDescartar', 'btnDiag', 'btnRelatorio', 'btnRelatorio2',
      'btnDesfazer', 'selExemplo', 'btnAbrir', 'btnInterpretar', 'inpAgora',
      'btnPedir', 'btnBaixarPedido', 'btnExemplosFila', 'btnImportarPedido']) { const b = $('#' + id); if (b) b.disabled = v; }
    $$('[data-avanca]').forEach((b) => { b.disabled = v; });
    if (!v) $('#btnDesfazer').disabled = !S.historico.length;
    $('#btnOtimizar').textContent = v ? 'Otimizando…' : 'Otimizar agenda';
  }
  const pegar = (obj, caminho) => caminho.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
  function por(obj, caminho, v) {
    const ks = caminho.split('.');
    let o = obj;
    for (let i = 0; i < ks.length - 1; i++) { if (o[ks[i]] == null || typeof o[ks[i]] !== 'object') o[ks[i]] = {}; o = o[ks[i]]; }
    o[ks[ks.length - 1]] = v;
  }
  const slug = (s) => U.normalizar(s).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'cenario';
  function marcarSegmento(sel, botao) { $$(sel + ' button').forEach((b) => b.classList.toggle('ativo', b === botao)); }

  // ================================================================== dados
  function normalizarCenario(c) {
    const cen = U.clonar(c);
    const preset = TA.PRESETS['enel-sp-2026'];
    cen.versao = 1;
    cen.nome = cen.nome || 'Minha fábrica';
    cen.dias = Math.max(1, Math.min(14, Math.round(+cen.dias || 7)));
    cen.passoMin = [15, 30, 60].includes(+cen.passoMin) ? +cen.passoMin : 15;
    cen.inicio = String(cen.inicio || '').slice(0, 10);
    if (!Number.isFinite(U.parseDT(cen.inicio))) cen.inicio = U.fmtData(Math.floor(Date.now() / 60000));
    const t0 = U.parseDT(cen.inicio), ag = U.parseDT(cen.agora);
    if (!(ag >= t0 && ag <= t0 + cen.dias * 1440)) cen.agora = `${cen.inicio}T06:00`; // "agora" sempre dentro da semana
    cen.objetivo = Object.assign({ pesoPico: 5 }, cen.objetivo);
    const ano = +cen.inicio.slice(0, 4);
    cen.tarifa = Object.assign({
      modalidade: 'B3_convencional', ponta: U.clonar(preset.ponta), intermediarioMin: 60,
      demandaContratada: { unica: 0, ponta: 0, foraPonta: 0 }, toleranciaUltrapassagem: 0.05, fatorUltrapassagem: 2,
      tributos: 0.225, bandeira: 0, fioB: U.clonar(preset.fioB), fioBPercentual: TA.fioBPercentualPadrao(ano), teReativo: preset.teReativo,
    }, cen.tarifa);
    cen.tarifa.precos = Object.assign(U.clonar(preset.precos), cen.tarifa.precos || {});
    cen.tarifa.demandaContratada = Object.assign({ unica: 0, ponta: 0, foraPonta: 0 }, cen.tarifa.demandaContratada);
    cen.solar = Object.assign({
      ativo: false, kWp: 0, pr: 0.8, latitude: -23.55, longitude: -46.63, nebulosidade: [], limiteInjecaoKW: '',
      voltWatt: { ativo: false, v1: 1.05, v2: 1.10 }, rede: { tensaoV: 380, resistenciaOhm: 0.05, tensaoBase: 1.0, elevacaoMeioDia: 0.02 }, custoKWp: 3600,
    }, cen.solar);
    cen.solar.voltWatt = Object.assign({ ativo: false, v1: 1.05, v2: 1.10 }, cen.solar.voltWatt);
    cen.solar.rede = Object.assign({ tensaoV: 380, resistenciaOhm: 0.05, tensaoBase: 1.0, elevacaoMeioDia: 0.02 }, cen.solar.rede);
    if (!Array.isArray(cen.solar.nebulosidade)) cen.solar.nebulosidade = [];
    while (cen.solar.nebulosidade.length < cen.dias) cen.solar.nebulosidade.push(1);
    for (const k of ['maquinas', 'pedidos', 'cargasFixas', 'cargasFlexiveis', 'indisponibilidades', 'limitesDemanda', 'excecoesTurno']) if (!Array.isArray(cen[k])) cen[k] = [];
    // Fator de emissão do CO2 e faturas do acompanhamento: não mudam a agenda nem a assinatura do parecer.
    cen.impacto = { fatorEmissao: IM.fator(cen) };
    cen.acompanhamento = IM.normalizarAcomp(cen.acompanhamento);
    return cen;
  }

  function salvarLocal() {
    lsSet(LS, JSON.stringify({
      cen: S.cen, base: S.serialBase, otim: S.serialOtim, motor: S.motor, modeloGemini: S.modeloGemini,
      diag: RV.serializarDiag(S.diag), casoId: S.casoId,
    }));
  }
  function carregarLocal() {
    const t = lsGet(LS);
    if (!t) return null;
    try { const j = JSON.parse(t); return j && j.cen && Array.isArray(j.cen.maquinas) ? j : null; } catch (e) { return null; }
  }

  function definirCenario(cen, planos) {
    S.cen = normalizarCenario(cen);
    S.serialBase = planos && planos.base ? planos.base : null;
    S.serialOtim = planos && planos.otim ? planos.otim : null;
    S.historico = []; S.impacto = null; S.pendentes = null; S.diag = null; S.sujo = false; S.casoId = null;
    S.versao = (S.versao || 0) + 1;
    renderFormularios(); renderCartoes(); renderChips(); renderPedidoCampos();
  }

  function marcarSujo() {
    S.sujo = true;
    S.versao = (S.versao || 0) + 1; // conta edições, para saber se algo mudou durante um cálculo
    S.diag = null;
    $('#avisoSujo').hidden = false;
    salvarLocal();
  }

  /** Ajusta o cenário no próprio objeto quando o início ou os dias da semana mudam. */
  function ajustarHorizonte() {
    const c = S.cen;
    c.dias = Math.max(1, Math.min(14, Math.round(+c.dias || 7)));
    c.inicio = String(c.inicio || '').slice(0, 10);
    if (!Number.isFinite(U.parseDT(c.inicio))) c.inicio = U.fmtData(Math.floor(Date.now() / 60000));
    while (c.solar.nebulosidade.length < c.dias) c.solar.nebulosidade.push(1);
    const t0 = U.parseDT(c.inicio), ag = U.parseDT(c.agora);
    if (!(ag >= t0 && ag <= t0 + c.dias * 1440)) c.agora = `${c.inicio}T06:00`;
  }

  // ================================================================== planejamento
  async function planejar(opc) {
    opc = opc || {};
    if (!S.cen || S.ocupado) return false;
    const exec = ++S.execucao;
    const versao = S.versao || 0;
    ocupado(true); progresso(0.03);
    await new Promise((r) => setTimeout(r, 0));
    try {
      const fresco = opc.zerar || !S.serialOtim;
      // Sem plano anterior, a semana é planejada desde o começo (como se fosse segunda de manhã).
      const cenPlano = fresco ? Object.assign({}, S.cen, { agora: `${S.cen.inicio}T00:00` }) : S.cen;
      const inst = MO.construir(cenPlano);
      const base = OT.planoASAP(inst, fresco ? null : OT.desserializar(inst, S.serialBase));
      const inicial = fresco ? base : OT.desserializar(inst, S.serialOtim);
      const otim = await OT.otimizar(inst, inicial, {
        // Ao replanejar, mexer numa etapa já combinada "custa" R$ 20/mês: o plano só muda onde vale a pena.
        referencia: fresco ? null : inicial, estabilidade: fresco ? 0 : 20,
        aoProgresso: (f) => { if (exec === S.execucao) progresso(0.05 + 0.9 * f); },
        cancelado: () => exec !== S.execucao,
      });
      if (exec !== S.execucao) return false;
      S.serialBase = OT.serializar(inst, base);
      S.serialOtim = OT.serializar(inst, otim);
      S.sujo = (S.versao || 0) !== versao; // alguém editou os dados durante o cálculo
      S.diag = null;
      avaliarAtual();
      salvarLocal();
      return true;
    } catch (e) {
      console.error(e);
      toast('Não consegui planejar: ' + e.message, 'erro');
      return false;
    } finally {
      if (exec === S.execucao) { ocupado(false); progresso(null); }
    }
  }

  function avaliarAtual() {
    try {
      const inst = MO.construir(S.cen);
      const eb = new OT.Estado(inst, OT.desserializar(inst, S.serialBase));
      const eo = new OT.Estado(inst, OT.desserializar(inst, S.serialOtim));
      S.inst = inst;
      S.planoBase = eb.exportar();
      S.planoOtim = eo.exportar();
      S.avBase = OT.avaliar(inst, eb, true);
      S.avOtim = OT.avaliar(inst, eo, true);
      S.diagRapido = {
        demanda: DG.demandaContratada(inst, S.avOtim),
        reat: DG.reativos(inst, S.planoOtim, S.avOtim),
      };
    } catch (e) {
      console.error(e);
      toast('Não consegui montar o modelo com estes dados: ' + e.message, 'erro');
      return false;
    }
    renderizar();
    return true;
  }

  // ================================================================== renderização
  function renderizar() {
    if (!S.inst) return;
    renderCabecalho(); renderKPIs(); renderFrase(); renderConta(); renderMudancas(); renderAvisos();
    renderDias(); renderTabelaEtapas(); renderEventosLado(); renderRelogio();
    renderRecomendacoes(); renderDiagTextos(); renderImpacto();
    renderPedido(); renderFila(); renderRevisao(); renderAcompResultado();
    $('#avisoSujo').hidden = !S.sujo;
    renderGraficosDaAba();
  }
  function renderGraficosDaAba() {
    if (!S.inst) return;
    if (S.aba === 'visao') renderCurva();
    else if (S.aba === 'agenda') renderGantt();
    else if (S.aba === 'diagnostico') renderDiagGraficos();
    else if (S.aba === 'acompanhamento') renderGraficoAcomp();
  }

  function renderCabecalho() {
    $('#nomeCenario').textContent = S.cen.nome;
    const t0 = U.parseDT(S.cen.inicio);
    $('#descCenario').textContent = `${S.cen.descricao ? S.cen.descricao + ' ' : ''}Semana de ${U.fmtDia(t0)} a ${U.fmtDia(t0 + (S.cen.dias - 1) * 1440)} · tarifa ${TA.MODALIDADES[S.cen.tarifa.modalidade].nome}.`;
    document.title = `Carga Certa · ${S.cen.nome}`;
  }

  function kpi(rot, val, antes, delta, classe) {
    return `<div class="kpi"><div class="rot">${rot}</div><div class="val">${val}</div><div class="antes">${antes}</div>${delta ? `<div class="delta ${classe || ''}">${delta}</div>` : ''}</div>`;
  }
  function renderKPIs() {
    const b = S.avBase, o = S.avOtim, inst = S.inst;
    const eco = b.contaMes - o.contaMes;
    const dPico = b.picos.all - o.picos.all, dPonta = b.kwh.ponta - o.kwh.ponta, dFC = o.fatorCarga - b.fatorCarga;
    const h = [
      kpi('Conta de energia por mês', U.brl(o.contaMes), `hoje ${U.brl(b.contaMes)}`,
        eco > 0.5 ? `${U.brl(eco)} a menos (${U.pct(eco / b.contaMes, 1)})` : eco < -0.5 ? `${U.brl(-eco)} a mais` : 'sem diferença', eco > 0.5 ? 'bom' : eco < -0.5 ? 'ruim' : ''),
      kpi('Pico puxado da rede', `${U.num(o.picos.all)} kW`, `hoje ${U.num(b.picos.all)} kW`,
        Math.abs(dPico) >= 0.5 ? `${dPico > 0 ? '−' : '+'}${U.num(Math.abs(dPico))} kW` : '', dPico > 0 ? 'bom' : 'ruim'),
      kpi('Energia no horário de ponta', `${U.num(o.kwh.ponta)} kWh`, `hoje ${U.num(b.kwh.ponta)} kWh por semana`,
        Math.abs(dPonta) >= 1 ? `${dPonta > 0 ? '−' : '+'}${U.num(Math.abs(dPonta))} kWh` : '', dPonta > 0 ? 'bom' : 'ruim'),
      kpi('Fator de carga', U.num(o.fatorCarga, 2), `hoje ${U.num(b.fatorCarga, 2)}`,
        Math.abs(dFC) >= 0.005 ? `${dFC > 0 ? '+' : '−'}${U.num(Math.abs(dFC), 2)}` : '', dFC > 0 ? 'bom' : 'ruim'),
      inst.kWp > 0
        ? kpi('Energia solar aproveitada', U.pct(o.aproveitamentoSolar), `hoje ${U.pct(b.aproveitamentoSolar)}`, `${U.num(o.kwh.cortLim + o.kwh.cortVW)} kWh cortados na semana`, '')
        : kpi('Energia solar', '—', 'sem geração própria', '', ''),
      kpi('Entregas no prazo', o.pedidos.length ? `${o.noPrazo} de ${o.pedidos.length}` : '—', `hoje ${b.noPrazo} de ${b.pedidos.length}`,
        o.pedidos.length ? (o.noPrazo === o.pedidos.length ? 'todas no prazo' : `${o.pedidos.length - o.noPrazo} atrasam`) : '', o.noPrazo === o.pedidos.length ? 'bom' : 'ruim'),
    ];
    $('#kpis').innerHTML = h.join('');
  }

  function fraseResumo() {
    const b = S.avBase, o = S.avOtim;
    const eco = b.contaMes - o.contaMes;
    let f = eco > 1
      ? `Com a agenda planejada, a conta estimada cai de <strong>${U.brl(b.contaMes)}</strong> para <strong>${U.brl(o.contaMes)}</strong> por mês (${U.pct(eco / b.contaMes, 1)} a menos).`
      : `A conta estimada fica em <strong>${U.brl(o.contaMes)}</strong> por mês. Nesta tarifa, mudar os horários quase não muda a conta; veja o diagnóstico para outras modalidades.`;
    const partes = [];
    if (b.picos.all - o.picos.all >= 1) partes.push(`o pico puxado da rede vai de ${U.num(b.picos.all)} para ${U.num(o.picos.all)} kW`);
    const sai = b.kwh.ponta - o.kwh.ponta;
    if (sai >= 1) partes.push(`${U.num(sai)} kWh por semana saem do horário de ponta`);
    const prazo = o.pedidos.length ? (o.noPrazo === o.pedidos.length ? `todas as ${o.pedidos.length} entregas ficam no prazo` : `${o.pedidos.length - o.noPrazo} pedido(s) atrasam (veja a aba Agenda)`) : '';
    if (prazo) partes.push(prazo);
    if (partes.length) {
      const ultima = partes.pop();
      const texto = partes.length ? `${partes.join(', ')} e ${ultima}` : ultima;
      f += ' ' + texto.charAt(0).toUpperCase() + texto.slice(1) + '.';
    }
    return f;
  }
  function renderFrase() { $('#frase').innerHTML = fraseResumo(); }

  function decomporConta(inst, av) {
    const itens = TA.detalheDemanda(inst.dem, av.picos);
    return {
      energia: av.custoImportacaoMes, creditos: av.creditoUsadoMes, sobraKWh: av.creditoSobraKWh, itens,
      demanda: itens.reduce((s, d) => s + d.valor, 0), ultrapassagem: itens.reduce((s, d) => s + d.valorUltrapassagem, 0), total: av.contaMes,
    };
  }
  function renderConta() {
    const inst = S.inst, b = decomporConta(inst, S.avBase), o = decomporConta(inst, S.avOtim);
    const linha = (rot, vb, vo, cls) => `<tr${cls ? ` class="${cls}"` : ''}><td>${rot}</td><td class="num">${U.brl(vb)}</td><td class="num">${U.brl(vo)}</td><td class="num">${U.sinal(vo - vb, (v) => U.brl(v))}</td></tr>`;
    let h = '<thead><tr><th></th><th class="num">Como é hoje</th><th class="num">Planejado</th><th class="num">Diferença</th></tr></thead><tbody>';
    h += linha('Energia tirada da rede', b.energia, o.energia);
    if (inst.kWp > 0) h += linha('Créditos da energia injetada', -b.creditos, -o.creditos);
    b.itens.forEach((it, i) => {
      const io = o.itens[i];
      h += linha(`${it.nome} (faturada: ${U.num(it.faturada)} → ${U.num(io.faturada)} kW)`, it.valor, io.valor);
      if (it.valorUltrapassagem > 0 || io.valorUltrapassagem > 0) h += linha('Multa de ultrapassagem', it.valorUltrapassagem, io.valorUltrapassagem);
    });
    h += linha('Total estimado', b.total, o.total, 'total');
    $('#tabConta').innerHTML = h + '</tbody>';
    const tar = S.cen.tarifa;
    const sobra = o.sobraKWh > 1 ? ` A solar injeta mais do que a fábrica consome da rede: sobram cerca de ${U.num(o.sobraKWh)} kWh de créditos por mês, que só abatem contas futuras (Lei 14.300).` : '';
    $('#notaConta').textContent = `Mês estimado = semana planejada × ${U.num(inst.fatorMes, 2)}. Tarifas da Enel SP (ANEEL REH nº 3.596/2026) com ${U.pct(+tar.tributos || 0, 1)} de tributos${+tar.bandeira ? ` e bandeira de ${U.brl(+tar.bandeira, true)}/kWh` : ', sem bandeira'}. Confira com a sua fatura.${sobra}`;
  }

  function renderMudancas() {
    const lista = OT.mudancas(S.inst, S.planoBase, S.planoOtim).slice(0, 8);
    $('#listaMudancas').innerHTML = lista.length
      ? lista.map((m) => `<li><strong>${esc(m.rotulo)}</strong> <span class="quando">${U.fmtCurto(m.antes)} → ${U.fmtCurto(m.depois)}</span><span class="motivo">${esc(m.motivo)}</span></li>`).join('')
      : '<li class="vazio">Nada mudou: a agenda de hoje já é a melhor para esta tarifa.</li>';
  }

  function renderAvisos() {
    const a = [];
    for (const x of S.inst.avisos) a.push(['', x]);
    const o = S.avOtim;
    for (const p of o.pedidos) {
      if (!p.programado) a.push(['erro', `${p.id}: não coube na agenda desta semana (turnos, paradas ou prazo).`]);
      else if (p.atrasoH > 0) a.push(['erro', `${p.id} atrasa ${U.fmtDuracao(p.atrasoH)} no plano. Vale considerar hora extra, outra máquina ou negociar o prazo.`]);
    }
    if (o.faltaFlex > 0.5) a.push(['', `Faltam ${U.num(o.faltaFlex, 1)} kWh para as cargas flexíveis dentro das janelas.`]);
    if (o.excessoLim > 0.5) a.push(['erro', `O limite de demanda pedido é ultrapassado em até ${U.num(o.excessoLim, 1)} kW: cargas fixas e etapas já iniciadas não deixam baixar mais.`]);
    $('#avisos').innerHTML = a.map(([c, t]) => `<div class="aviso ${c}">${esc(t)}</div>`).join('');
  }

  // ---------------------------------------------------------------- impacto ambiental (Visão geral e Diagnóstico)
  function impactoAtual() { return IM.comparar(S.inst, S.avBase, S.avOtim, IM.fator(S.cen)); }
  const linkFonte = (f, rot) => `<a href="${esc(f.url)}" target="_blank" rel="noopener" title="${esc(f.texto)}">${esc(rot)}</a>`;
  function htmlFontesImpacto() {
    return `Fontes: ${linkFonte(IM.FONTES.fator, 'fator de emissão (MCTI)')}, ${linkFonte(IM.FONTES.ponta, 'déficit na ponta (ONS)')}, ${linkFonte(IM.FONTES.cortes, 'cortes de renováveis em 2025')}.`;
  }
  function renderImpacto() {
    const c = impactoAtual(), h = c.hoje, p = c.plano, n = (v) => U.num(v, 0);
    const caixa = (rot, val, sub) => `<div><span>${rot}</span><strong>${val}</strong><small>${sub}</small></div>`;
    const caixas = [
      caixa('Energia tirada da rede', `${n(p.redeMes)} kWh/mês`, `hoje ${n(h.redeMes)} kWh/mês`),
      caixa('No horário de ponta', `${n(p.pontaMes)} kWh/mês`, c.deslocadoPontaMes >= 1 ? `hoje ${n(h.pontaMes)} · ${n(c.deslocadoPontaMes)} kWh/mês saem da ponta` : `hoje ${n(h.pontaMes)} kWh/mês`),
      c.temSolar
        ? caixa('Solar própria usada na fábrica', `${n(p.solarUsadaMes)} kWh/mês`, `hoje ${n(h.solarUsadaMes)} · ${n(p.solarCortadaMes)} kWh/mês cortados`)
        : caixa('Solar própria', '—', 'sem geração própria'),
      caixa('CO₂ da energia da rede', `${n(p.co2KgMes)} kg/mês`, `hoje ${n(h.co2KgMes)} kg/mês`),
    ];
    const textos = `<ul class="impacto-textos">${IM.textos(c).map((t) => `<li>${esc(t)}</li>`).join('')}</ul>`;
    $('#impactoVisao').innerHTML = `<div class="numeros">${caixas.join('')}</div>${textos}<p class="nota">${esc(IM.notaFator(c.fator))} <button type="button" class="link" data-ir="diagnostico">Ver a tabela completa no Diagnóstico</button></p>`;
    const linha = (rot, vb, vo, un) => `<tr><td>${rot}</td><td class="num">${n(vb)} ${un}</td><td class="num">${n(vo)} ${un}</td><td class="num">${U.sinal(Math.round(vo - vb), (v) => n(v))} ${un}</td></tr>`;
    let t = '<thead><tr><th>Por mês</th><th class="num">Como é hoje</th><th class="num">Planejado</th><th class="num">Diferença</th></tr></thead><tbody>';
    t += linha('Consumo total da fábrica', h.consumoMes, p.consumoMes, 'kWh');
    t += linha('Energia tirada da rede', h.redeMes, p.redeMes, 'kWh');
    t += linha('&nbsp;&nbsp;no horário de ponta', h.pontaMes, p.pontaMes, 'kWh');
    t += linha('&nbsp;&nbsp;fora da ponta', h.foraPontaMes, p.foraPontaMes, 'kWh');
    if (c.temSolar) {
      t += linha('Solar própria usada na fábrica', h.solarUsadaMes, p.solarUsadaMes, 'kWh');
      t += linha('Solar injetada na rede', h.solarInjetadaMes, p.solarInjetadaMes, 'kWh');
      t += linha('Solar cortada (limite de injeção e volt-watt)', h.solarCortadaMes, p.solarCortadaMes, 'kWh');
    }
    t += `<tr class="total"><td>CO₂ da energia tirada da rede</td><td class="num">${n(h.co2KgMes)} kg</td><td class="num">${n(p.co2KgMes)} kg</td><td class="num">${U.sinal(Math.round(p.co2KgMes - h.co2KgMes), (v) => n(v))} kg</td></tr>`;
    $('#impactoDiag').innerHTML = `<div class="tabela-rolagem"><table class="tabela">${t}</tbody></table></div>${textos}<p class="nota">${esc(IM.notaFator(c.fator))} O fator pode ser trocado na aba Energia e tarifa. ${htmlFontesImpacto()}</p>`;
  }

  // ---------------------------------------------------------------- quem faz o quê
  function htmlQuemFaz(id) {
    const q = RV.quemFaz(id);
    if (!q) return '';
    return `<div class="quem-faz">${RV.QUEM_FAZ_ROTULOS.map(([k, r]) => `<span class="qf-${k}"><b>${r}:</b> ${esc(q[k])}</span>`).join('')}</div>`;
  }

  // ---------------------------------------------------------------- acompanhamento das faturas
  function exemploAcompDoCenario() {
    const e = Object.values(CC.EXEMPLOS).find((x) => x.acompanhamentoExemplo && x.cenario.nome === S.cen.nome);
    return e ? e.acompanhamentoExemplo : null;
  }
  function renderAcompEditor() {
    const a = S.cen.acompanhamento;
    $('#acInicio').value = a.inicioPlano || '';
    editor($('#edFaturas'), a.faturas, [
      { campo: 'mes', titulo: 'Mês', tipo: 'mes', largura: '150px', erro: 'Mês não entendido. Use, por exemplo, 2026-08 ou 08/2026.',
        ler: (el, l) => { const m = IM.lerMes(el.value); l.mes = m || ''; if (m && el.value !== m) el.value = m; return !!m || !el.value.trim(); } },
      { campo: 'kWh', titulo: 'Energia (kWh)', tipo: 'numero', vazio: true, largura: '120px' },
      { campo: 'demandaKW', titulo: 'Demanda medida (kW)', tipo: 'numero', vazio: true, largura: '130px' },
      { campo: 'valor', titulo: 'Valor total (R$)', tipo: 'numero', vazio: true, largura: '130px' },
    ], () => {
      const ult = a.faturas.map((f) => f.mes).filter(Boolean).sort().pop();
      return { mes: ult ? IM.mesSeguinte(ult) : '', kWh: null, demandaKW: null, valor: null };
    }, { aoMudar: acompMudou, rotuloNovo: '+ Adicionar mês' });
    $('#btnAcExemplo').hidden = !exemploAcompDoCenario();
    $('#avisoExemploAcomp').innerHTML = a.exemplo
      ? '<p class="faixa-exemplo">Exemplo: estas faturas são fictícias, só para mostrar como o acompanhamento funciona. Apague e digite as da sua fábrica.</p>'
      : '';
  }
  function acompMudou() {
    salvarLocal();
    renderAcompResultado();
    if (S.aba === 'acompanhamento') renderGraficoAcomp();
  }
  function acompAtual() {
    return IM.acompanhar(S.cen.acompanhamento, S.inst && S.avBase && S.avOtim ? IM.previsto(S.inst, S.avBase, S.avOtim) : null);
  }
  function renderAcompResultado() {
    if (!S.cen) return;
    const r = acompAtual(), m = IM.textoAcomp(r), a = r.mediaAntes, d = r.mediaDepois;
    let h = `<div class="aviso-acomp ${m.classe}">${esc(m.texto)}</div>`;
    if (a && d && (a.meses || d.meses)) {
      const v = (x, fmt) => (x == null ? '—' : fmt(x));
      const kwh = (x) => `${U.num(x, 0)} kWh`, kw = (x) => `${U.num(x, 0)} kW`;
      h += `<div class="numeros">
        <div><span>Média antes (${a.meses} ${a.meses === 1 ? 'mês' : 'meses'})</span><strong>${v(a.valor, U.brl)}</strong><small>${v(a.kWh, kwh)} · ${v(a.demandaKW, kw)}</small></div>
        <div><span>Média depois (${d.meses} ${d.meses === 1 ? 'mês' : 'meses'})</span><strong>${v(d.valor, U.brl)}</strong><small>${v(d.kWh, kwh)} · ${v(d.demandaKW, kw)}</small></div>
        <div><span>Economia real por mês</span><strong>${r.economiaMes == null ? '—' : `${U.brl(r.economiaMes)} (${U.pct(r.economiaPct, 1)})`}</strong><small>média depois × média antes</small></div>
        <div><span>Prevista pela simulação</span><strong>${r.previsto ? U.pct(r.previsto.economiaPct, 1) : '—'}</strong><small>${r.previsto ? `${U.brl(r.previsto.economiaMes)} por mês, estimados pela semana analisada` : 'otimize a agenda primeiro'}</small></div>
      </div>`;
    }
    if (r.ultrapassagens.length) h += `<p class="cartao-aviso">Demanda medida acima de 105% da contratada (${U.num(r.previsto.contratada, 0)} kW) em ${r.ultrapassagens.map(IM.fmtMes).join(', ')}: nesses meses houve multa de ultrapassagem.</p>`;
    if (r.repetidos.length) h += `<p class="cartao-aviso">Mês digitado mais de uma vez: ${r.repetidos.map(IM.fmtMes).join(', ')}. As duas faturas entram na média.</p>`;
    h += '<p class="nota">A simulação estima a conta a partir de uma semana; por isso a comparação usa a porcentagem de economia. Se a produção mudou muito de um mês para outro, compare também a energia (kWh).</p>';
    $('#resAcomp').innerHTML = h;
  }
  function renderGraficoAcomp() {
    const r = acompAtual();
    const tem = r.faturas.some((f) => Number.isFinite(f.valor));
    $('#gAcomp').parentElement.hidden = !tem;
    $('#notaGAcomp').hidden = !tem;
    if (tem) GR.barrasFaturas($('#gAcomp'), r); else GR.destruir($('#gAcomp'));
  }
  async function carregarAcompExemplo() {
    const ex = exemploAcompDoCenario();
    if (!ex) return;
    const a = S.cen.acompanhamento;
    if (a.faturas.length && !a.exemplo && !(await confirmar('Trocar as faturas digitadas pelas do exemplo?', 'Trocar'))) return;
    S.cen.acompanhamento = IM.normalizarAcomp(U.clonar(ex));
    renderAcompEditor(); acompMudou();
    toast('Faturas de exemplo carregadas. São fictícias, só para mostrar o acompanhamento.');
  }
  async function limparAcomp() {
    const a = S.cen.acompanhamento;
    if (!a.faturas.length && !a.inicioPlano) return;
    if (!(await confirmar('Apagar todas as faturas e o mês de início?', 'Apagar'))) return;
    S.cen.acompanhamento = IM.normalizarAcomp(null);
    renderAcompEditor(); acompMudou();
  }
  /** Uma linha sobre o acompanhamento, para o resumo e a revisão do engenheiro ('' se não houver dados). */
  function linhaAcomp(acomp, prev) {
    const r = IM.acompanhar(acomp, prev);
    if (r.economiaPct == null) return '';
    return `Faturas registradas pela fábrica: ${r.mediaAntes.meses} ${r.mediaAntes.meses === 1 ? 'mês' : 'meses'} antes e ${r.mediaDepois.meses} depois de ${IM.fmtMes(r.inicio)}; economia real de ${U.pct(r.economiaPct, 1)}${prev ? `, prevista ${U.pct(prev.economiaPct, 1)}` : ''}${acomp && acomp.exemplo ? '. São faturas de exemplo, fictícias' : ''}.`;
  }

  function renderCurva() {
    const inst = S.inst, d = inst.dem, ref = [];
    if (d.mod === 'A4_verde' && d.Dc > 0) ref.push({ valor: d.Dc, rotulo: `demanda contratada ${U.num(d.Dc)} kW`, cor: GR.CORES.contratada });
    if (d.mod === 'A4_azul') {
      if (d.DcFP > 0) ref.push({ valor: d.DcFP, rotulo: `contratada fora de ponta ${U.num(d.DcFP)} kW`, cor: GR.CORES.contratada });
      if (d.DcP > 0) ref.push({ valor: d.DcP, rotulo: `contratada na ponta ${U.num(d.DcP)} kW`, cor: '#e04f2f' });
    }
    const av = S.visao === 'base' ? S.avBase : S.avOtim;
    GR.curvaCarga($('#gCurva'), inst, av, { avBase: S.visao === 'comparar' ? S.avBase : null, contratadas: ref, agora: inst.agoraSlot });
  }

  // ---------------------------------------------------------------- agenda
  function renderDias() {
    const inst = S.inst;
    if (S.ganttDia >= inst.dias) S.ganttDia = -1;
    let h = `<button data-d="-1"${S.ganttDia < 0 ? ' class="ativo"' : ''}>Semana</button>`;
    for (let d = 0; d < inst.dias; d++) h += `<button data-d="${d}"${S.ganttDia === d ? ' class="ativo"' : ''}>${U.fmtDia(inst.t0 + d * 1440)}</button>`;
    $('#segDias').innerHTML = h;
  }
  function planoGantt() { return S.ganttPlano === 'base' ? S.planoBase : S.planoOtim; }
  function renderGantt() { GR.gantt($('#gantt'), S.inst, planoGantt(), { dia: S.ganttDia }); }
  function renderTabelaEtapas() {
    const inst = S.inst, plano = planoGantt();
    const fimPed = inst.pedidos.map((p) => Math.max(...p.ops.map((o) => (plano.ini[o] >= 0 ? plano.ini[o] + inst.ops[o].dur : -1))));
    const linhas = inst.ops.map((op, o) => ({ op, o, s: plano.ini[o] })).filter((x) => x.s >= 0).sort((a, b) => a.s - b.s || a.o - b.o);
    let h = '<thead><tr><th>Início</th><th>Fim</th><th>Máquina</th><th>Pedido</th><th>Cliente e produto</th><th class="num">kW</th><th class="num">Na ponta</th><th>Entrega</th></tr></thead><tbody>';
    for (const { op, o, s } of linhas) {
      const M = inst.maquinas[op.maq], ped = inst.pedidos[op.pedido];
      let ponta = 0;
      for (let t = s; t < s + op.dur; t++) if (inst.posto[t] === 2) ponta++;
      const atrasa = fimPed[ped.idx] > ped.prazo;
      const ini = inst.tempo(s), fim = inst.tempo(s + op.dur);
      h += `<tr${atrasa ? ' class="atrasa"' : ''}><td>${U.fmtCurto(ini)}</td><td>${U.inicioDoDia(ini) === U.inicioDoDia(fim - 1) ? U.fmtHora(fim) : U.fmtCurto(fim)}</td>`
        + `<td>${esc(M.nome)}${M.unidades > 1 ? ` ${plano.uni[o] + 1}` : ''}</td><td>${esc(ped.id)} · ${op.etapa + 1}/${ped.ops.length}</td>`
        + `<td>${esc(ped.cliente)} · ${esc(ped.produto)}</td><td class="num">${U.num(op.kW, 1)}</td><td class="num">${ponta ? U.fmtDuracao(ponta * inst.dt) : '—'}</td>`
        + `<td>${atrasa ? '<span class="tag ruim">atrasa</span>' : '<span class="tag ok">no prazo</span>'} ${U.fmtCurto(ped.prazoMin)}</td></tr>`;
    }
    if (!linhas.length) h += '<tr><td colspan="8" class="vazio">Nenhuma etapa na agenda.</td></tr>';
    $('#tabEtapas').innerHTML = h + '</tbody>';
  }

  // ---------------------------------------------------------------- eventos
  function renderRelogio() { $('#inpAgora').value = S.cen.agora; }
  function exemplosGenericos() {
    const m = S.cen.maquinas[0], p = S.cen.pedidos.find((x) => !x.cancelado);
    const r = [];
    if (m) r.push(`${m.nome} quebrou e só volta amanhã às 14h`);
    if (p) r.push(`O cliente antecipou o ${p.id} para amanhã às 12h`);
    r.push('Amanhã vai ser nublado', 'A distribuidora pediu para limitar a demanda em 50 kW amanhã das 17h às 20h');
    return r;
  }
  function renderChips() {
    const ex = S.cen && Array.isArray(S.cen.exemplosEventos) && S.cen.exemplosEventos.length ? S.cen.exemplosEventos : exemplosGenericos();
    $('#chipsExemplos').innerHTML = ex.map((t) => `<button class="chip" data-chip="${esc(t)}">${esc(t)}</button>`).join('');
  }

  function renderMotor() {
    $$('input[name="motor"]').forEach((r) => { r.checked = r.value === S.motor; });
    const box = $('#boxChave');
    box.hidden = S.motor === 'local';
    if (S.motor === 'local') return;
    $('#inpChave').value = S.chaves[S.motor] || lsGet(LS_CHAVE(S.motor)) || '';
    $('#chkLembrar').checked = !!lsGet(LS_CHAVE(S.motor));
    $('#rotModelo').hidden = S.motor !== 'gemini';
    $('#inpModelo').value = S.modeloGemini;
    $('#notaChave').innerHTML = S.motor === 'gemini'
      ? 'Crie uma chave grátis em <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">aistudio.google.com/apikey</a>. A mensagem e a lista de máquinas e pedidos vão para o Google. A chave fica só neste navegador.'
      : `Use uma chave do <a href="https://console.anthropic.com/" target="_blank" rel="noopener">console da Anthropic</a> (pago por uso, centavos por mensagem). Modelo ${esc(NV.MODELO_CLAUDE)}. A mensagem e a lista de máquinas e pedidos vão para a Anthropic. A chave fica só neste navegador.`;
  }
  function chaveAtual() { return (S.chaves[S.motor] || $('#inpChave').value.trim() || lsGet(LS_CHAVE(S.motor)) || '').trim(); }

  async function interpretar() {
    const texto = $('#txtEvento').value.trim();
    if (!texto) { toast('Escreva o que aconteceu na fábrica.'); return; }
    const btn = $('#btnInterpretar');
    btn.disabled = true; btn.textContent = 'Interpretando…';
    try {
      let evs;
      if (S.motor === 'local') evs = IA.interpretar(texto, S.cen);
      else {
        try {
          const r = S.motor === 'gemini' ? await NV.gemini(texto, S.cen, chaveAtual(), S.modeloGemini) : await NV.claude(texto, S.cen, chaveAtual());
          evs = r.eventos;
          if (S.motor === 'gemini' && r.modelo && r.modelo !== S.modeloGemini) { S.modeloGemini = r.modelo; $('#inpModelo').value = r.modelo; salvarLocal(); }
        } catch (e) {
          console.warn(e);
          toast(`${e.message} Usei a IA local no lugar.`, 'erro');
          evs = IA.interpretar(texto, S.cen);
        }
      }
      if (!evs.length) { toast('Não encontrei nenhum evento na mensagem.'); return; }
      S.pendentes = evs.map((e) => Object.assign({ _usar: e.tipo !== 'desconhecido' }, e));
      renderCartoes();
    } finally {
      btn.disabled = false; btn.textContent = 'Interpretar';
    }
  }

  function pedidosAtivos() { return S.cen.pedidos.filter((p) => !p.cancelado); }
  function diasHorizonte() { const t0 = U.parseDT(S.cen.inicio); return Array.from({ length: S.cen.dias }, (_, d) => U.fmtData(t0 + d * 1440)); }
  function campoCartao(ev, c, rot, tipo) {
    const v = ev[c], a = `data-k="${c}" data-t="${tipo}"`;
    const opcoesPedidos = (sel) => pedidosAtivos().map((p) => `<option value="${esc(p.id)}"${p.id === sel ? ' selected' : ''}>${esc(p.id)} · ${esc(p.produto)}</option>`).join('');
    switch (tipo) {
      case 'maquina':
        return `<label>${rot}<select ${a}><option value="">escolha…</option>${S.cen.maquinas.map((m) => `<option value="${esc(m.id)}"${m.id === v ? ' selected' : ''}>${esc(m.nome)}</option>`).join('')}</select></label>`;
      case 'unidade': {
        const m = S.cen.maquinas.find((x) => x.id === ev.maquina), n = m ? Math.max(1, +m.unidades || 1) : 1;
        if (n === 1) return '';
        return `<label>${rot}<select ${a}><option value="0"${!v ? ' selected' : ''}>todas</option>${Array.from({ length: n }, (_, k) => `<option value="${k + 1}"${+v === k + 1 ? ' selected' : ''}>${k + 1}</option>`).join('')}</select></label>`;
      }
      case 'pedido': return `<label>${rot}<select ${a}><option value="">escolha…</option>${opcoesPedidos(v)}</select></label>`;
      case 'pedidos':
        return `<div><span class="nota">${rot}</span><div class="lista-check">${pedidosAtivos().map((p) => `<label><input type="checkbox" ${a} value="${esc(p.id)}"${(v || []).includes(p.id) ? ' checked' : ''}> ${esc(p.id)}</label>`).join('')}</div></div>`;
      case 'dias':
        return `<div><span class="nota">${rot}</span><div class="lista-check">${diasHorizonte().map((d) => `<label><input type="checkbox" ${a} value="${d}"${(v || []).includes(d) ? ' checked' : ''}> ${U.fmtDia(U.parseDT(d))}</label>`).join('')}</div></div>`;
      case 'datahora': return `<label>${rot}<input type="datetime-local" ${a} value="${esc(v || '')}"></label>`;
      case 'hora': return `<label>${rot}<input type="time" ${a} value="${esc(v || '')}"></label>`;
      case 'numero': return `<label>${rot}<input type="number" step="any" min="0" ${a} value="${v == null ? '' : v}"></label>`;
      case 'pct': return `<label>${rot} (%)<input type="number" step="1" min="0" max="100" ${a} value="${v == null ? '' : Math.round(v * 100)}"></label>`;
      case 'fator': return `<label>${rot}: ${Math.round((v || 0) * 100)}%<input type="range" min="0" max="100" step="5" ${a} value="${Math.round((v || 0) * 100)}"></label>`;
      case 'bool': return `<label class="lista-check"><span><input type="checkbox" ${a}${v ? ' checked' : ''}> ${rot}</span></label>`;
      default: return `<label>${rot}<input type="text" ${a} value="${esc(v || '')}"></label>`;
    }
  }
  function cartaoHTML(ev, i) {
    const probs = ev.tipo === 'desconhecido' ? [] : EV.problemas(ev, S.cen);
    const conf = [ev.confianca != null ? `confiança ${U.pct(ev.confianca)}` : '', ev.origem || ''].filter(Boolean).join(' · ');
    const tipos = EV.TIPOS.map((t) => `<option value="${t}"${t === ev.tipo ? ' selected' : ''}>${esc(EV.ROTULOS[t])}</option>`).join('');
    const campos = (EV.CAMPOS[ev.tipo] || []).map(([c, rot, tipo]) => campoCartao(ev, c, rot, tipo)).join('');
    const avisos = [...(ev.avisos || []), ...(ev.explicacao ? [ev.explicacao] : []), ...probs];
    return `<div class="cartao${probs.length ? ' problema' : ''}${ev._usar === false ? ' desligado' : ''}" data-i="${i}">`
      + `<div class="cartao-cab"><input type="checkbox" data-k="_usar"${ev._usar !== false ? ' checked' : ''} title="Aplicar este evento" aria-label="Aplicar este evento"><select data-k="tipo" aria-label="Tipo de evento">${tipos}</select><span class="conf">${esc(conf)}</span></div>`
      + `<p class="cartao-desc">${esc(EV.descrever(ev, S.cen))}</p>`
      + (campos ? `<div class="cartao-campos">${campos}</div>` : '')
      + (avisos.length ? `<p class="cartao-aviso">${esc(avisos.join(' '))}</p>` : '')
      + (ev.texto ? `<p class="cartao-texto">“${esc(ev.texto)}”</p>` : '')
      + '</div>';
  }
  function renderCartoes() {
    const cont = $('#cartoes');
    if (!S.pendentes || !S.pendentes.length) { cont.innerHTML = ''; $('#acoesCartoes').hidden = true; return; }
    cont.innerHTML = S.pendentes.map(cartaoHTML).join('');
    $('#acoesCartoes').hidden = false;
  }
  function editarCartao(e) {
    const card = e.target.closest('.cartao');
    if (!card || !S.pendentes) return;
    const i = +card.dataset.i, ev = S.pendentes[i], el = e.target, k = el.dataset.k, t = el.dataset.t;
    if (!k) return;
    if (k === '_usar') ev._usar = el.checked;
    else if (k === 'tipo') {
      const novo = IA.montarEvento(el.value, ev.texto || '', S.cen, U.parseDT(S.cen.agora), IA.dicionario(S.cen));
      S.pendentes[i] = Object.assign(novo, { _usar: true, confianca: null, origem: 'tipo corrigido à mão' });
    } else if (t === 'pedidos' || t === 'dias') ev[k] = $$(`input[data-k="${k}"]`, card).filter((x) => x.checked).map((x) => x.value);
    else if (t === 'numero') ev[k] = el.value === '' ? null : U.numeroBR(el.value);
    else if (t === 'pct') ev[k] = el.value === '' ? null : U.numeroBR(el.value) / 100;
    else if (t === 'fator') ev[k] = +el.value / 100;
    else if (t === 'unidade') ev[k] = +el.value || null;
    else if (t === 'bool') ev[k] = el.checked;
    else ev[k] = el.value || null;
    if (k === 'maquina') ev.unidade = null;
    card.outerHTML = cartaoHTML(S.pendentes[i], i);
  }

  function diffPlanos(a, b) {
    const lista = [], inst = S.inst;
    const nome = (id) => { const op = inst.ops.find((x) => x.id === id); return op ? `${id.split('#')[0]} · ${inst.maquinas[op.maq].nome}` : id.replace('#', ' · etapa '); };
    for (const [id, vb] of Object.entries(b.ops)) {
      const va = a && a.ops ? a.ops[id] : null;
      if (!va) lista.push({ rot: nome(id), texto: `entrou na agenda: ${U.fmtCurto(vb[0])}` });
      else if (va[0] !== vb[0]) lista.push({ rot: nome(id), texto: `${U.fmtCurto(va[0])} → ${U.fmtCurto(vb[0])}` });
      else if (va[1] !== vb[1]) lista.push({ rot: nome(id), texto: `trocou para a unidade ${vb[1] + 1}` });
    }
    for (const id of Object.keys((a && a.ops) || {})) if (!b.ops[id]) lista.push({ rot: id.replace('#', ' · etapa '), texto: 'saiu da agenda' });
    return lista;
  }

  async function aplicarEventos() {
    if (!S.pendentes || S.ocupado) return;
    const evs = S.pendentes.filter((e) => e._usar !== false && e.tipo !== 'desconhecido');
    if (!evs.length) { toast('Nenhum evento marcado para aplicar.'); return; }
    const probs = evs.flatMap((e) => EV.problemas(e, S.cen).map((p) => `${EV.ROTULOS[e.tipo]}: ${p}`));
    if (probs.length) { toast(probs.join(' '), 'erro'); return; }
    const antes = {
      cen: U.clonar(S.cen), serialBase: S.serialBase, serialOtim: S.serialOtim,
      conta: S.avOtim.contaMes, pico: S.avOtim.picos.all, noPrazo: S.avOtim.noPrazo, total: S.avOtim.pedidos.length,
    };
    const iniciadas = new Set();
    S.inst.ops.forEach((op, o) => { const s = S.planoOtim.ini[o]; if (s >= 0 && s < S.inst.agoraSlot) iniciadas.add(op.id); });
    const inst = S.inst, imp = S.avOtim.arr.imp;
    const picoJanela = (a, b) => {
      let m = 0;
      const i0 = Math.max(0, Math.floor((a - inst.t0) / inst.passo)), i1 = Math.min(inst.T, Math.ceil((b - inst.t0) / inst.passo));
      for (let t = i0; t < i1; t++) if (imp[t] > m) m = imp[t];
      return m;
    };
    const { cen, notas } = EV.aplicar(S.cen, evs, { iniciadas, picoJanela });
    const versaoAntes = S.versao || 0;
    S.cen = cen;
    S.versao = versaoAntes + 1;
    const ok = await planejar({});
    if (!ok) {
      S.cen = antes.cen; S.serialBase = antes.serialBase; S.serialOtim = antes.serialOtim;
      S.versao = versaoAntes;
      avaliarAtual(); renderFormularios(); renderChips();
      return;
    }
    S.historico.push({ agora: antes.cen.agora, texto: $('#txtEvento').value.trim(), descricoes: evs.map((e) => EV.descrever(e, antes.cen)), antes, versaoAntes, versaoDepois: S.versao || 0 });
    S.impacto = { antes, notas, mudancas: diffPlanos(antes.serialOtim, S.serialOtim) };
    S.pendentes = null;
    $('#txtEvento').value = '';
    renderCartoes(); renderFormularios(); renderEventosLado(); renderChips();
    toast('Plano refeito com os eventos.');
  }

  function renderEventosLado() {
    const im = S.impacto, el = $('#impacto');
    if (!im) el.innerHTML = '<p class="vazio">Nenhum evento aplicado ainda.</p>';
    else {
      const o = S.avOtim, dConta = o.contaMes - im.antes.conta;
      const muds = im.mudancas.slice(0, 12).map((m) => `<li><strong>${esc(m.rot)}</strong>: ${esc(m.texto)}</li>`).join('');
      el.innerHTML = `<dl class="impacto-linhas"><dt>Conta estimada</dt><dd>${U.brl(im.antes.conta)} → ${U.brl(o.contaMes)} (${Math.abs(dConta) < 1 ? 'sem mudança' : `${U.sinal(dConta, (v) => U.brl(v))} por mês`})</dd>`
        + `<dt>Pico da rede</dt><dd>${U.num(im.antes.pico)} → ${U.num(o.picos.all)} kW</dd>`
        + `<dt>Entregas no prazo</dt><dd>${im.antes.noPrazo} de ${im.antes.total} → ${o.noPrazo} de ${o.pedidos.length}</dd></dl>`
        + (im.notas.length ? `<p class="nota">${esc(im.notas.join(' '))}</p>` : '')
        + (muds ? `<h4>O que mudou na agenda (${im.mudancas.length})</h4><ul class="lista-mudancas">${muds}</ul>${im.mudancas.length > 12 ? `<p class="nota">e mais ${im.mudancas.length - 12}.</p>` : ''}` : '<p class="nota">A agenda não precisou mudar.</p>');
    }
    $('#historico').innerHTML = S.historico.length
      ? S.historico.slice().reverse().map((h) => `<li>${esc(h.descricoes.join(' '))}<small>${U.fmtCurto(U.parseDT(h.agora))}${h.texto ? ` · “${esc(h.texto)}”` : ''}</small></li>`).join('')
      : '<li class="vazio">Sem eventos.</li>';
    $('#btnDesfazer').disabled = !S.historico.length;
  }

  async function desfazer() {
    if (S.ocupado || !S.historico.length) return;
    const h = S.historico[S.historico.length - 1];
    if ((S.versao || 0) !== h.versaoDepois
      && !(await confirmar('Depois desse evento você mudou dados da fábrica ou da tarifa. Desfazer o evento também desfaz essas mudanças.', 'Desfazer mesmo assim'))) return;
    S.historico.pop();
    const acomp = S.cen.acompanhamento, imp = S.cen.impacto; // faturas e fator de CO2 não fazem parte do evento
    S.cen = h.antes.cen; S.serialBase = h.antes.serialBase; S.serialOtim = h.antes.serialOtim;
    S.cen.acompanhamento = acomp; S.cen.impacto = imp;
    S.impacto = null; S.diag = null; S.sujo = false;
    S.versao = h.versaoAntes || 0;
    avaliarAtual(); renderFormularios(); renderChips(); renderEventosLado(); salvarLocal();
    toast('Último evento desfeito.');
  }

  function mudarAgora(min) {
    if (S.ocupado) return;
    const t0 = U.parseDT(S.cen.inicio), fim = t0 + S.cen.dias * 1440;
    S.cen.agora = U.fmtDT(U.clamp(Math.round(min / S.cen.passoMin) * S.cen.passoMin, t0, fim));
    avaliarAtual();
    salvarLocal();
  }

  // ================================================================== formulários (Fábrica e Energia)
  function campoEditor(c, linha, i) {
    const v = c.mostrar ? c.mostrar(linha) : linha[c.campo];
    const a = `data-i="${i}" data-c="${c.campo}"`;
    switch (c.tipo) {
      case 'numero': return `<input type="number" step="${c.passo || 'any'}"${c.min != null ? ` min="${c.min}"` : ''} value="${v == null ? '' : v}" ${a}>`;
      case 'datahora': return `<input type="datetime-local" value="${esc(v || '')}" ${a}>`;
      case 'data': return `<input type="date" value="${esc(v || '')}" ${a}>`;
      case 'hora': return `<input type="time" value="${esc(v || '')}" ${a}>`;
      case 'check': return `<input type="checkbox"${v ? ' checked' : ''} ${a}>`;
      case 'mes': return `<input type="month" placeholder="aaaa-mm" value="${esc(v || '')}" ${a}>`;
      case 'select': return `<select ${a}>${c.opcoes().map(([val, rot]) => `<option value="${esc(val)}"${String(val) === String(v) ? ' selected' : ''}>${esc(rot)}</option>`).join('')}</select>`;
      default: return `<input type="text" value="${esc(v == null ? '' : v)}" ${a}${c.placeholder ? ` placeholder="${esc(c.placeholder)}"` : ''}>`;
    }
  }
  function lerEditor(c, el, linha) {
    if (c.ler) return c.ler(el, linha);
    switch (c.tipo) {
      case 'check': linha[c.campo] = el.checked; return true;
      case 'numero': {
        if (c.vazio && !el.value.trim()) { linha[c.campo] = null; return true; }
        let v = U.numeroBR(el.value);
        if (!Number.isFinite(v)) return false;
        if (c.inteiro) { v = Math.max(c.min == null ? 0 : c.min, Math.round(v)); el.value = v; }
        linha[c.campo] = v;
        return true;
      }
      case 'janela': { linha[c.campo] = el.value; return U.parseJanela(el.value).erros.length === 0; }
      default: linha[c.campo] = el.value; return true;
    }
  }
  /** Tabela editável. opc.aoMudar troca o "dados mudaram, otimize de novo" por outra ação (faturas, por exemplo). */
  function editor(cont, lista, colunas, novo, opc) {
    opc = opc || {};
    const mudou = () => (opc.aoMudar ? opc.aoMudar() : marcarSujo());
    const desenhar = () => {
      let h = '<div class="tabela-rolagem"><table class="tabela editor"><thead><tr>';
      for (const c of colunas) h += `<th${c.largura ? ` style="min-width:${c.largura}"` : ''}>${esc(c.titulo)}</th>`;
      h += '<th class="col-acao"></th></tr></thead><tbody>';
      lista.forEach((linha, i) => {
        h += '<tr>' + colunas.map((c) => `<td>${campoEditor(c, linha, i)}</td>`).join('') + `<td class="col-acao"><button class="remover" data-rem="${i}" title="Remover" aria-label="Remover">×</button></td></tr>`;
      });
      if (!lista.length) h += `<tr><td colspan="${colunas.length + 1}" class="vazio">Nenhum item.</td></tr>`;
      h += `</tbody></table></div><div class="linha-botoes"><button class="btn mini" data-add>${esc(opc.rotuloNovo || '+ Adicionar')}</button></div>`;
      cont.innerHTML = h;
    };
    cont.onchange = (e) => {
      const el = e.target, i = +el.dataset.i, c = colunas.find((x) => x.campo === el.dataset.c);
      if (!c || !lista[i]) return;
      const ok = lerEditor(c, el, lista[i]);
      el.classList.toggle('invalido', ok === false);
      if (ok === false) toast(c.erro || 'Valor não entendido nesta célula.', 'erro');
      mudou();
    };
    cont.onclick = (e) => {
      const r = e.target.closest('[data-rem]');
      if (r) { lista.splice(+r.dataset.rem, 1); desenhar(); mudou(); return; }
      if (e.target.closest('[data-add]')) { lista.push(novo()); desenhar(); mudou(); }
    };
    desenhar();
  }

  const etapasTexto = (p) => (p.etapas || []).map((e) => `${e.maquina} ${String(e.horas).replace('.', ',')}`).join(' > ');
  function lerEtapas(el, p) {
    const partes = el.value.split(/>|;|→/).map((s) => s.trim()).filter(Boolean);
    const etapas = [];
    for (const s of partes) {
      const m = /^(\S+)\s+([\d.,]+)\s*h?$/i.exec(s);
      if (!m) return false;
      const maq = S.cen.maquinas.find((x) => U.normalizar(x.id) === U.normalizar(m[1]));
      const h = U.numeroBR(m[2]);
      if (!maq || !(h > 0)) return false;
      etapas.push({ maquina: maq.id, horas: h });
    }
    if (!etapas.length) return false;
    p.etapas = etapas;
    return true;
  }

  function campoForm(caminho, rotulo, tipo, opc) {
    opc = opc || {};
    const v = pegar(S.cen, caminho);
    const id = 'f_' + caminho.replace(/\./g, '_');
    const a = `id="${id}" data-caminho="${caminho}" data-tipo="${tipo}"`;
    let input;
    switch (tipo) {
      case 'select': input = `<select ${a}>${opc.opcoes.map(([val, rot]) => `<option value="${esc(val)}"${String(val) === String(v) ? ' selected' : ''}>${esc(rot)}</option>`).join('')}</select>`; break;
      case 'check': return `<label class="check"><input type="checkbox" ${a}${v ? ' checked' : ''}> ${esc(rotulo)}</label>`;
      case 'pct': input = `<input type="number" step="0.1" ${a} value="${v == null || v === '' ? '' : Math.round(v * 1000) / 10}">`; break;
      case 'numero': input = `<input type="number" step="${opc.passo || 'any'}" ${a} value="${v == null ? '' : v}"${opc.vazio ? ' placeholder="sem limite" data-vazio="1"' : ''}>`; break;
      case 'data': input = `<input type="date" ${a} value="${esc(v || '')}">`; break;
      case 'hora': input = `<input type="time" ${a} value="${esc(v || '')}">`; break;
      default: input = `<input type="text" ${a} value="${esc(v == null ? '' : v)}">`;
    }
    return `<label for="${id}">${esc(rotulo)}${input}${opc.dica ? `<span class="dica-campo">${esc(opc.dica)}</span>` : ''}</label>`;
  }
  function ligarForm(cont, aoMudar) {
    cont.onchange = (e) => {
      const el = e.target, c = el.dataset.caminho;
      if (!c) return;
      let v;
      switch (el.dataset.tipo) {
        case 'check': v = el.checked; break;
        case 'pct': v = U.numeroBR(el.value) / 100; if (!Number.isFinite(v)) { toast('Número inválido.', 'erro'); return; } break;
        case 'numero':
          if (el.value === '' && el.dataset.vazio) v = '';
          else { v = U.numeroBR(el.value); if (!Number.isFinite(v)) { toast('Número inválido.', 'erro'); return; } }
          break;
        default: v = el.value;
      }
      por(S.cen, c, v);
      if (aoMudar) aoMudar(c, v);
      marcarSujo();
    };
  }

  function renderNeb() {
    const c = S.cen, t0 = U.parseDT(c.inicio);
    while (c.solar.nebulosidade.length < c.dias) c.solar.nebulosidade.push(1);
    $('#formNeb').innerHTML = c.solar.nebulosidade.slice(0, c.dias).map((v, i) => `<label><span>${U.fmtDia(t0 + i * 1440)}: <b>${Math.round(v * 100)}%</b></span><input type="range" min="0" max="100" step="5" value="${Math.round(v * 100)}" data-neb="${i}" aria-label="Céu em ${U.fmtDia(t0 + i * 1440)}"></label>`).join('');
  }

  function tabelaPrecos() {
    const linhas = [
      ['B3 Convencional', [['tarifa.precos.B3_convencional.energia', 'Energia (R$/kWh)']]],
      ['B3 Branca', [['tarifa.precos.B3_branca.fp', 'Fora de ponta (R$/kWh)'], ['tarifa.precos.B3_branca.int', 'Intermediário (R$/kWh)'], ['tarifa.precos.B3_branca.p', 'Ponta (R$/kWh)']]],
      ['A4 Verde', [['tarifa.precos.A4_verde.energiaFP', 'Energia fora de ponta (R$/kWh)'], ['tarifa.precos.A4_verde.energiaP', 'Energia na ponta (R$/kWh)'], ['tarifa.precos.A4_verde.demanda', 'Demanda (R$/kW)']]],
      ['A4 Azul', [['tarifa.precos.A4_azul.energiaFP', 'Energia fora de ponta (R$/kWh)'], ['tarifa.precos.A4_azul.energiaP', 'Energia na ponta (R$/kWh)'], ['tarifa.precos.A4_azul.demandaFP', 'Demanda fora de ponta (R$/kW)'], ['tarifa.precos.A4_azul.demandaP', 'Demanda na ponta (R$/kW)']]],
    ];
    return `<h4>Preços sem tributos</h4><table class="tabela"><tbody>${linhas.map(([nome, campos]) => `<tr><td style="width:120px"><strong>${nome}</strong></td><td><div class="form">${campos.map(([c, r]) => campoForm(c, r, 'numero', { passo: 0.00001 })).join('')}</div></td></tr>`).join('')}</tbody></table>`
      + '<p class="nota">Padrão: Enel SP, ANEEL REH nº 3.596/2026 (TUSD + TE). <button class="link" id="btnRestaurarTarifa">Restaurar os valores da Enel SP</button></p>';
  }

  function renderFormularios() {
    const c = S.cen;
    if (!c) return;
    $('#formGeral').innerHTML = [
      campoForm('nome', 'Nome da empresa', 'texto'),
      campoForm('descricao', 'Descrição', 'texto'),
      campoForm('inicio', 'Início da semana planejada', 'data'),
      campoForm('dias', 'Dias no horizonte (1 a 14)', 'numero', { passo: 1 }),
    ].join('');
    ligarForm($('#formGeral'), (caminho) => {
      if (caminho === 'inicio' || caminho === 'dias') {
        ajustarHorizonte(); // mexe no próprio objeto: as tabelas continuam ligadas a ele
        S.serialBase = S.serialOtim = null;
        renderNeb(); renderRelogio();
      }
      if (caminho === 'nome' || caminho === 'descricao') renderCabecalho();
    });

    editor($('#edMaquinas'), c.maquinas, [
      { campo: 'id', titulo: 'ID', largura: '100px' },
      { campo: 'nome', titulo: 'Nome', largura: '170px' },
      { campo: 'unidades', titulo: 'Unidades', tipo: 'numero', passo: 1, min: 1, inteiro: true, largura: '80px' },
      { campo: 'potenciaKW', titulo: 'Potência (kW)', tipo: 'numero', largura: '100px' },
      { campo: 'fp', titulo: 'Fator de potência', tipo: 'numero', passo: 0.01, largura: '100px' },
      { campo: 'janela', titulo: 'Horário de funcionamento', tipo: 'janela', largura: '260px', erro: 'Horário não entendido. Use, por exemplo, seg-sex 06:00-22:00; sab 06:00-14:00' },
    ], () => ({ id: 'MAQ' + (c.maquinas.length + 1), nome: 'Nova máquina', unidades: 1, potenciaKW: 5, fp: 0.85, janela: 'seg-sex 06:00-22:00' }));

    editor($('#edPedidos'), c.pedidos, [
      { campo: 'id', titulo: 'ID', largura: '70px' },
      { campo: 'cliente', titulo: 'Cliente', largura: '140px' },
      { campo: 'produto', titulo: 'Produto', largura: '150px' },
      { campo: 'quantidade', titulo: 'Qtd.', tipo: 'numero', largura: '70px' },
      { campo: 'liberacao', titulo: 'Material disponível', tipo: 'datahora', largura: '180px' },
      { campo: 'prazo', titulo: 'Prazo de entrega', tipo: 'datahora', largura: '180px' },
      { campo: 'etapas', titulo: 'Etapas (máquina horas)', largura: '260px', mostrar: etapasTexto, ler: lerEtapas, erro: 'Etapas não entendidas. Use o ID da máquina e as horas: CORTE 2 > TORNO 6' },
      { campo: 'cancelado', titulo: 'Cancelado', tipo: 'check', largura: '70px' },
    ], () => ({
      id: EV.proximoId(c), cliente: 'Cliente', produto: 'Produto', quantidade: 1, liberacao: c.agora,
      prazo: U.fmtDT(U.inicioDoDia(U.parseDT(c.agora)) + 2 * 1440 + 17 * 60), etapas: c.maquinas[0] ? [{ maquina: c.maquinas[0].id, horas: 1 }] : [],
    }));

    editor($('#edFixas'), c.cargasFixas, [
      { campo: 'nome', titulo: 'Carga', largura: '220px' },
      { campo: 'kW', titulo: 'Potência (kW)', tipo: 'numero', largura: '100px' },
      { campo: 'fp', titulo: 'Fator de potência', tipo: 'numero', passo: 0.01, largura: '100px' },
      { campo: 'janela', titulo: 'Horário', tipo: 'janela', largura: '260px', erro: 'Horário não entendido.' },
    ], () => ({ nome: 'Nova carga', kW: 1, fp: 0.92, janela: 'seg-sex 08:00-18:00' }));

    editor($('#edFlex'), c.cargasFlexiveis, [
      { campo: 'id', titulo: 'ID', largura: '80px' },
      { campo: 'nome', titulo: 'Carga', largura: '200px' },
      { campo: 'energiaKWh', titulo: 'Energia por dia (kWh)', tipo: 'numero', largura: '110px' },
      { campo: 'potenciaMaxKW', titulo: 'Potência (kW)', tipo: 'numero', largura: '100px' },
      { campo: 'janela', titulo: 'Janela', largura: '120px', placeholder: '16:00-06:00', ler: (el, l) => { l.janela = el.value; return U.parseJanela(`todos ${el.value}`).erros.length === 0; } },
      { campo: 'dias', titulo: 'Dias', largura: '90px', placeholder: 'seg-sex', ler: (el, l) => { l.dias = el.value; return U.parseJanela(`${el.value || 'todos'} 00:00-01:00`).erros.length === 0; } },
      { campo: 'continua', titulo: 'Contínua', tipo: 'check', largura: '70px' },
    ], () => ({ id: 'FLEX' + (c.cargasFlexiveis.length + 1), nome: 'Nova carga flexível', energiaKWh: 10, potenciaMaxKW: 5, janela: '00:00-24:00', dias: 'todos', continua: false, fp: 0.95 }));

    const opMaq = () => c.maquinas.map((m) => [m.id, m.nome]);
    editor($('#edParadas'), c.indisponibilidades, [
      { campo: 'maquina', titulo: 'Máquina', tipo: 'select', opcoes: opMaq, largura: '170px' },
      { campo: 'unidade', titulo: 'Unidade (0 = todas)', tipo: 'numero', passo: 1, min: 0, inteiro: true, largura: '90px' },
      { campo: 'inicio', titulo: 'Início', tipo: 'datahora', largura: '180px' },
      { campo: 'fim', titulo: 'Fim', tipo: 'datahora', largura: '180px' },
      { campo: 'motivo', titulo: 'Motivo', largura: '200px' },
    ], () => ({ maquina: c.maquinas[0] ? c.maquinas[0].id : '', unidade: 0, inicio: c.agora, fim: U.fmtDT(U.parseDT(c.agora) + 240), motivo: 'Manutenção' }));

    editor($('#edLimites'), c.limitesDemanda, [
      { campo: 'inicio', titulo: 'Início', tipo: 'datahora', largura: '180px' },
      { campo: 'fim', titulo: 'Fim', tipo: 'datahora', largura: '180px' },
      { campo: 'kW', titulo: 'Máximo (kW)', tipo: 'numero', largura: '90px' },
      { campo: 'motivo', titulo: 'Motivo', largura: '160px' },
    ], () => ({ inicio: c.agora, fim: U.fmtDT(U.parseDT(c.agora) + 180), kW: 50, motivo: 'Pedido da distribuidora' }));

    editor($('#edTurnos'), c.excecoesTurno, [
      { campo: 'data', titulo: 'Dia', tipo: 'data', largura: '150px' },
      { campo: 'fechado', titulo: 'Sem expediente', tipo: 'check', largura: '90px' },
      { campo: 'inicio', titulo: 'Abre', tipo: 'hora', largura: '100px' },
      { campo: 'fim', titulo: 'Fecha', tipo: 'hora', largura: '100px' },
    ], () => ({ data: c.inicio, fechado: false, inicio: '06:00', fim: '22:00' }));

    $('#formTarifa').innerHTML = [
      campoForm('tarifa.modalidade', 'Modalidade', 'select', { opcoes: Object.entries(TA.MODALIDADES).map(([k, v]) => [k, v.nome]) }),
      campoForm('tarifa.ponta.inicio', 'Ponta começa', 'hora'),
      campoForm('tarifa.ponta.fim', 'Ponta termina', 'hora'),
      campoForm('tarifa.tributos', 'Tributos (ICMS + PIS/COFINS), %', 'pct', { dica: 'Percentual "por dentro". Use 0 para ver os valores da ANEEL sem tributos.' }),
      campoForm('tarifa.bandeira', 'Bandeira (R$/kWh a mais)', 'numero', { passo: 0.001 }),
      campoForm('tarifa.demandaContratada.unica', 'Demanda contratada, Verde (kW)', 'numero'),
      campoForm('tarifa.demandaContratada.foraPonta', 'Demanda fora de ponta, Azul (kW)', 'numero'),
      campoForm('tarifa.demandaContratada.ponta', 'Demanda na ponta, Azul (kW)', 'numero'),
      campoForm('tarifa.fioBPercentual', 'Fio B não compensado na injeção, %', 'pct', { dica: 'Lei 14.300/2022: 60% em 2026, 75% em 2027.' }),
    ].join('');
    ligarForm($('#formTarifa'), (caminho) => { if (caminho === 'tarifa.modalidade') renderCabecalho(); });
    $('#tabPrecos').innerHTML = tabelaPrecos();
    ligarForm($('#tabPrecos'));

    $('#formSolar').innerHTML = [
      campoForm('solar.ativo', 'Tem geração solar própria', 'check'),
      campoForm('solar.kWp', 'Potência dos módulos (kWp)', 'numero'),
      campoForm('solar.pr', 'Desempenho global (PR)', 'numero', { passo: 0.01, dica: 'Perdas por temperatura, sujeira e inversor. Típico: 0,75 a 0,85.' }),
      campoForm('solar.limiteInjecaoKW', 'Limite de injeção na rede (kW)', 'numero', { vazio: true, dica: 'Deixe vazio se a distribuidora não limitar a exportação.' }),
      campoForm('solar.custoKWp', 'Custo instalado (R$/kWp)', 'numero'),
      campoForm('solar.voltWatt.ativo', 'Inversor com controle volt-watt', 'check'),
      campoForm('solar.voltWatt.v1', 'Volt-watt começa a reduzir em (pu)', 'numero', { passo: 0.005 }),
      campoForm('solar.voltWatt.v2', 'Volt-watt zera a geração em (pu)', 'numero', { passo: 0.005 }),
      campoForm('solar.rede.tensaoV', 'Tensão de fornecimento entre fases (V)', 'numero'),
      campoForm('solar.rede.resistenciaOhm', 'Resistência equivalente da rede (Ω)', 'numero', { passo: 0.005, dica: 'Quanto maior, mais a tensão sobe quando a fábrica exporta.' }),
      campoForm('solar.rede.tensaoBase', 'Tensão sem a fábrica, à noite (pu)', 'numero', { passo: 0.005 }),
      campoForm('solar.rede.elevacaoMeioDia', 'Subida da tensão ao meio-dia pela solar dos vizinhos (pu)', 'numero', { passo: 0.005 }),
    ].join('');
    ligarForm($('#formSolar'));
    renderNeb();

    $('#formObjetivo').innerHTML = campoForm('objetivo.pesoPico', 'Peso extra para picos (R$ por kW de pico, por mês)', 'numero', {
      dica: 'Além da conta, quanto vale reduzir 1 kW de pico (transformador, cabos, disjuntores). Use 0 para olhar só a conta.',
    });
    ligarForm($('#formObjetivo'));

    // O fator de emissão só muda o CO2 mostrado: não pede para otimizar de novo.
    $('#formImpacto').innerHTML = campoForm('impacto.fatorEmissao', 'Fator de emissão da rede (tCO₂/MWh)', 'numero', {
      passo: 0.0001, dica: 'Padrão 0,0385: média do Sistema Interligado Nacional em 2023, segundo o MCTI. Use o fator do mês da sua fatura, se tiver.',
    });
    $('#formImpacto').onchange = (e) => {
      if (e.target.dataset.caminho !== 'impacto.fatorEmissao') return;
      const v = U.numeroBR(e.target.value);
      if (!(Number.isFinite(v) && v >= 0 && v < 2)) { toast('Número inválido.', 'erro'); e.target.value = IM.fator(S.cen); return; }
      S.cen.impacto.fatorEmissao = v;
      salvarLocal();
      if (S.inst) renderImpacto();
    };
    renderAcompEditor();
  }

  // ================================================================== diagnóstico
  function renderRecomendacoes() {
    // Com um parecer válido, cada recomendação mostra a decisão do engenheiro.
    const pa = parecerAtual();
    const par = pa && pa.valido ? pa.p : null;
    const h = itensAtuais().map((it) => {
      const pi = par && par.itens.find((x) => x.id === it.id);
      return `<li>${esc(it.texto)}${pi ? ' ' + tagDecisao(pi.decisao) : ''}${pi && pi.nota ? `<span class="rec-nota">Engenheiro: ${esc(pi.nota)}</span>` : ''}${htmlQuemFaz(it.id)}</li>`;
    });
    if (!S.diag) h.push('<li>Para completar o diagnóstico (modalidade tarifária e tamanho da usina solar), clique em "Comparar tarifas e dimensionar a solar". Leva alguns segundos.</li>');
    $('#listaRecom').innerHTML = h.join('');
  }

  function renderDiagTextos() {
    const d = S.diagRapido.demanda, b = S.avBase, o = S.avOtim, r = S.diagRapido.reat;
    $('#txtDemanda').innerHTML = !d.aplica
      ? `<p>No grupo B não existe cobrança de demanda. Mesmo assim, o pico planejado cai de <strong>${U.num(b.picos.all)} kW</strong> para <strong>${U.num(o.picos.all)} kW</strong>, o que alivia transformador, cabos e disjuntores e evita reforços na instalação.</p>`
      : d.parcelas.map((p) => `<div class="numeros"><div><span>${esc(p.nome)}: pico planejado</span><strong>${U.num(p.medida)} kW</strong></div><div><span>Contratada hoje</span><strong>${U.num(p.contratada)} kW</strong></div><div><span>Sugerida</span><strong>${p.recomendada} kW</strong></div><div><span>Custo por mês</span><strong>${U.brl(p.custoAtual)} → ${U.brl(p.custoRecomendado)}</strong></div></div>${p.ultrapassagem ? '<p class="cartao-aviso">A medição passa de 105% da contratada: há multa de ultrapassagem.</p>' : ''}`).join('')
        + '<p class="nota">Demanda faturada = maior valor entre a medida e a contratada. Acima de 105% da contratada, o excedente paga o dobro (REN 1.000/2021). A sugestão deixa 5% de folga e respeita o mínimo de 30 kW.</p>';
    $('#txtFC').innerHTML = `<div class="numeros">
        <div><span>Fator de carga hoje</span><strong>${U.num(b.fatorCarga, 2)}</strong></div>
        <div><span>Fator de carga planejado</span><strong>${U.num(o.fatorCarga, 2)}</strong></div>
        <div><span>Custo médio do kWh hoje</span><strong>${U.brl(b.custoMedioKWh, true)}</strong></div>
        <div><span>Custo médio planejado</span><strong>${U.brl(o.custoMedioKWh, true)}</strong></div>
      </div>
      <p>Fator de carga = energia tirada da rede ÷ (pico × horas). Quanto mais perto de 1, melhor a fábrica usa a capacidade pela qual paga.</p>
      <div class="numeros">
        <div><span>Fator de potência médio${S.inst.kWp > 0 ? ' (com solar)' : ''}</span><strong>${U.num(r.fpMedio, 2)}</strong></div>
        ${S.inst.kWp > 0 ? `<div><span>Sem a solar seria</span><strong>${U.num(r.fpSemSolar, 2)}</strong></div>` : ''}
        <div><span>Reativo excedente por mês</span><strong>${r.grupoA ? U.brl(r.custoMes) : 'não cobrado no grupo B'}</strong></div>
        <div><span>Banco de capacitores automático</span><strong>${r.banco ? `${r.banco} kvar` : 'não precisa'}</strong></div>
      </div>
      <p>${S.inst.kWp > 0 ? 'Com a solar, a fábrica puxa menos kW da rede, mas continua puxando os mesmos kvar dos motores, então o fator de potência medido cai. ' : ''}${r.grupoA ? `No grupo A, abaixo de 0,92 há cobrança de reativo excedente; com o banco sugerido o custo estimado cai para ${U.brl(r.custoMesComBanco)} por mês.` : 'No grupo B não há cobrança de reativo, mas corrigir o fator de potência reduz perdas e aquecimento dos cabos.'}</p>`;

    if (!S.diag) {
      $('#tabModal').innerHTML = ''; $('#tabSolar').innerHTML = '';
      $('#notaModal').textContent = 'Clique em "Comparar tarifas e dimensionar a solar" para calcular.';
      $('#notaSolar').textContent = 'Clique em "Comparar tarifas e dimensionar a solar" para calcular.';
      return;
    }
    const m = S.diag.modalidades;
    $('#tabModal').innerHTML = '<thead><tr><th>Modalidade</th><th class="num">Agenda de hoje</th><th class="num">Agenda planejada</th><th class="num">Replanejada para a tarifa</th></tr></thead><tbody>'
      + m.linhas.map((l) => `<tr class="${l === m.melhor ? 'destaque' : ''}"><td>${esc(l.nome)}${l.atual ? ' <span class="tag">atual</span>' : ''}${l === m.melhor ? ' <span class="tag ok">melhor</span>' : ''}${l.mesmoGrupo ? '' : ' <span class="tag">outro grupo</span>'}</td><td class="num">${U.brl(l.contaHoje)}</td><td class="num">${U.brl(l.contaAgendaAtual)}</td><td class="num">${U.brl(l.contaReplanejada)}</td></tr>`).join('')
      + '</tbody>';
    $('#notaModal').textContent = 'Valores por mês, com tributos. A coluna da direita refaz a agenda para cada tarifa. Mudar de grupo (A para B ou o contrário) depende do tipo de ligação e das regras da REN 1.000/2021.';
    const s = S.diag.solar;
    $('#tabSolar').innerHTML = '<thead><tr><th>Usina</th><th class="num">Economia por mês</th><th class="num">Cortado (kWh/mês)</th><th class="num">Autoconsumo</th><th class="num">Retorno simples</th><th class="num">VPL 25 anos</th></tr></thead><tbody>'
      + s.linhas.map((l) => `<tr class="${l === s.recomendado ? 'destaque' : ''}"><td>${l.kWp} kWp${l.kWp === s.atual ? ' <span class="tag">atual</span>' : ''}${l === s.recomendado ? ' <span class="tag ok">sugerida</span>' : ''}</td><td class="num">${U.brl(l.economiaMes)}</td><td class="num">${U.num(l.cortLimMes + l.cortVWMes)}</td><td class="num">${l.kWp ? U.pct(l.autoconsumo) : '—'}</td><td class="num">${l.kWp && Number.isFinite(l.payback) ? U.num(l.payback, 1) + ' anos' : '—'}</td><td class="num">${l.kWp ? U.brl(l.vpl) : '—'}</td></tr>`).join('')
      + '</tbody>';
    $('#notaSolar').textContent = `A agenda é replanejada para cada tamanho. Premissas: ${U.brl(s.premissas.custoKWp)} por kWp instalado, 25 anos, taxa de 10% ao ano, perda de 0,5% ao ano e manutenção de 1% do investimento por ano. Teto: inversores até ${U.num(s.limiteKW)} kW (${s.grupoA ? 'demanda contratada' : 'limite da microgeração'}), com módulos até 20% acima disso.`;
  }

  function renderDiagGraficos() {
    const d = S.diagRapido.demanda;
    $('#gDemanda').parentElement.hidden = !d.aplica;
    $('#gModal').parentElement.hidden = !S.diag;
    $('#gSolar').parentElement.hidden = !S.diag;
    if (d.aplica) GR.curvaDemanda($('#gDemanda'), d.parcelas[d.parcelas.length - 1]); else GR.destruir($('#gDemanda'));
    if (S.diag) { GR.barrasModalidades($('#gModal'), S.diag.modalidades.linhas); GR.curvaSolar($('#gSolar'), S.diag.solar); }
    else { GR.destruir($('#gModal')); GR.destruir($('#gSolar')); }
  }

  async function rodarDiagnostico() {
    if (S.ocupado || !S.serialOtim) return false;
    ocupado(true); progresso(0.02);
    // Trabalha sobre uma foto do cenário; se algo mudar no meio, o resultado é descartado.
    const cen0 = S.cen, versao = S.versao || 0, sB = S.serialBase, sO = S.serialOtim, foto = U.clonar(S.cen);
    try {
      const modalidades = await DG.compararModalidades(foto, sB, sO, { replanejar: true, aoProgresso: (f) => progresso(0.02 + 0.45 * f) });
      const solar = await DG.dimensionarSolar(foto, sO, { aoProgresso: (f) => progresso(0.5 + 0.48 * f) });
      if (S.cen !== cen0 || (S.versao || 0) !== versao || S.serialOtim !== sO) {
        toast('Os dados mudaram durante o diagnóstico. Rode de novo.', 'erro');
        return false;
      }
      S.diag = { modalidades, solar };
      renderRecomendacoes(); renderDiagTextos();
      if (S.aba === 'diagnostico') renderDiagGraficos();
      salvarLocal();
      return true;
    } catch (e) {
      console.error(e);
      toast('O diagnóstico falhou: ' + e.message, 'erro');
      return false;
    } finally { ocupado(false); progresso(null); }
  }

  // ================================================================== relatório
  async function gerarRelatorio() {
    if (S.ocupado) return;
    if (!S.diag) { toast('Calculando o diagnóstico completo para o relatório…'); await rodarDiagnostico(); }
    const inst = S.inst, b = S.avBase, o = S.avOtim, cen = S.cen;
    let img = '';
    if (window.Chart) {
      const c = document.createElement('canvas');
      c.width = 1100; c.height = 340;
      c.style.cssText = 'position:fixed;left:-10000px;top:0;width:1100px;height:340px';
      document.body.appendChild(c);
      try {
        const g = GR.curvaCarga(c, inst, o, { avBase: b, estatico: true, agora: 0, contratadas: inst.dem.mod === 'A4_verde' && inst.dem.Dc ? [{ valor: inst.dem.Dc, rotulo: `demanda contratada ${U.num(inst.dem.Dc)} kW`, cor: GR.CORES.contratada }] : [] });
        if (g) { img = g.toBase64Image('image/png', 1); g.destroy(); }
      } finally { c.remove(); }
    }
    const t0 = U.parseDT(cen.inicio);
    const itensRec = itensAtuais();
    const imp = impactoAtual(), n0 = (v) => U.num(v, 0);
    const ka = [
      ['Conta estimada por mês', U.brl(b.contaMes), U.brl(o.contaMes)],
      ['Pico puxado da rede', `${U.num(b.picos.all)} kW`, `${U.num(o.picos.all)} kW`],
      ['Energia no horário de ponta (semana)', `${U.num(b.kwh.ponta)} kWh`, `${U.num(o.kwh.ponta)} kWh`],
      ['Energia tirada da rede (mês)', `${n0(imp.hoje.redeMes)} kWh`, `${n0(imp.plano.redeMes)} kWh`],
      ['CO₂ da energia tirada da rede (mês)', `${n0(imp.hoje.co2KgMes)} kg`, `${n0(imp.plano.co2KgMes)} kg`],
      ['Fator de carga', U.num(b.fatorCarga, 2), U.num(o.fatorCarga, 2)],
      ['Custo médio do kWh', U.brl(b.custoMedioKWh, true), U.brl(o.custoMedioKWh, true)],
      ['Energia solar aproveitada', inst.kWp ? U.pct(b.aproveitamentoSolar) : '—', inst.kWp ? U.pct(o.aproveitamentoSolar) : '—'],
      ['Entregas no prazo', `${b.noPrazo} de ${b.pedidos.length}`, `${o.noPrazo} de ${o.pedidos.length}`],
    ];
    const muds = OT.mudancas(inst, S.planoBase, S.planoOtim).slice(0, 12);
    let num = 0;
    const sec = (titulo) => `<h2>${++num}. ${titulo}</h2>`;
    let h = `<h1>Diagnóstico energético e plano de produção</h1>
      <p class="sutil">${esc(cen.nome)} · semana de ${U.fmtDia(t0)} a ${U.fmtDia(t0 + (cen.dias - 1) * 1440)} · tarifa ${esc(TA.MODALIDADES[cen.tarifa.modalidade].nome)} · gerado em ${new Date().toLocaleDateString('pt-BR')} pelo Carga Certa (equipe T³ch)</p>
      <section>${sec('Resumo')}<p>${fraseResumo()}</p>
      <table><thead><tr><th>Indicador</th><th class="num">Como é hoje</th><th class="num">Planejado</th></tr></thead><tbody>${ka.map((k) => `<tr><td>${k[0]}</td><td class="num">${k[1]}</td><td class="num">${k[2]}</td></tr>`).join('')}</tbody></table></section>`;
    if (img) h += `<section>${sec('Curva de carga planejada')}<img src="${img}" alt="Curva de carga"><p class="sutil">Áreas: cargas fixas, máquinas e cargas flexíveis. Linha escura: potência puxada da rede no plano; tracejada: como é hoje. Faixas: horário de ponta.</p></section>`;
    h += `<section>${sec('Recomendações e quem faz o quê')}<ol>${itensRec.map((i) => `<li>${esc(i.texto)}${RV.quemFaz(i.id) ? `<br><span class="sutil">${esc(RV.quemFazTexto(i.id))}</span>` : ''}</li>`).join('')}</ol></section>`;
    h += `<section>${sec('Impacto ambiental e na rede (por mês)')}<table><thead><tr><th></th><th class="num">Como é hoje</th><th class="num">Planejado</th></tr></thead><tbody>`
      + [['Consumo total da fábrica', imp.hoje.consumoMes, imp.plano.consumoMes, 'kWh'], ['Energia tirada da rede', imp.hoje.redeMes, imp.plano.redeMes, 'kWh'], ['No horário de ponta', imp.hoje.pontaMes, imp.plano.pontaMes, 'kWh']]
        .concat(imp.temSolar ? [['Solar própria usada na fábrica', imp.hoje.solarUsadaMes, imp.plano.solarUsadaMes, 'kWh'], ['Solar injetada na rede', imp.hoje.solarInjetadaMes, imp.plano.solarInjetadaMes, 'kWh'], ['Solar cortada', imp.hoje.solarCortadaMes, imp.plano.solarCortadaMes, 'kWh']] : [])
        .concat([['CO₂ da energia tirada da rede', imp.hoje.co2KgMes, imp.plano.co2KgMes, 'kg']])
        .map(([r, x, y, un]) => `<tr><td>${r}</td><td class="num">${n0(x)} ${un}</td><td class="num">${n0(y)} ${un}</td></tr>`).join('')
      + `</tbody></table><ul>${IM.textos(imp).map((t) => `<li>${esc(t)}</li>`).join('')}</ul><p class="sutil">${esc(IM.notaFator(imp.fator))} Fontes: ${Object.values(IM.FONTES).map((f) => esc(f.texto)).join('; ')}.</p></section>`;
    h += `<section>${sec('Principais mudanças na agenda')}${muds.length ? `<table><thead><tr><th>Etapa</th><th>Hoje</th><th>Planejado</th><th>Motivo</th></tr></thead><tbody>${muds.map((m) => `<tr><td>${esc(m.rotulo)}</td><td>${U.fmtCurto(m.antes)}</td><td>${U.fmtCurto(m.depois)}</td><td>${esc(m.motivo)}</td></tr>`).join('')}</tbody></table>` : '<p>Sem mudanças.</p>'}</section>`;
    if (S.diag) {
      const m = S.diag.modalidades, s = S.diag.solar;
      h += `<section>${sec('Modalidade tarifária (R$ por mês)')}<table><thead><tr><th>Modalidade</th><th class="num">Agenda de hoje</th><th class="num">Replanejada</th></tr></thead><tbody>${m.linhas.map((l) => `<tr><td>${esc(l.nome)}${l.atual ? ' (atual)' : ''}${l.mesmoGrupo ? '' : ' (outro grupo)'}</td><td class="num">${U.brl(l.contaHoje)}</td><td class="num">${U.brl(l.contaReplanejada)}</td></tr>`).join('')}</tbody></table></section>`;
      h += `<section>${sec('Geração solar')}<table><thead><tr><th>Usina</th><th class="num">Economia/mês</th><th class="num">Cortado kWh/mês</th><th class="num">Retorno</th><th class="num">VPL 25 anos</th></tr></thead><tbody>${s.linhas.map((l) => `<tr><td>${l.kWp} kWp${l === s.recomendado ? ' (sugerida)' : ''}${l.kWp === s.atual ? ' (atual)' : ''}</td><td class="num">${U.brl(l.economiaMes)}</td><td class="num">${U.num(l.cortLimMes + l.cortVWMes)}</td><td class="num">${l.kWp && Number.isFinite(l.payback) ? U.num(l.payback, 1) + ' anos' : '—'}</td><td class="num">${l.kWp ? U.brl(l.vpl) : '—'}</td></tr>`).join('')}</tbody></table></section>`;
    }
    const ac = acompAtual();
    if (ac.faturas.length) {
      const msg = IM.textoAcomp(ac);
      h += `<section>${sec('Acompanhamento das faturas')}${cen.acompanhamento.exemplo ? '<p class="sutil">Faturas de exemplo (fictícias).</p>' : ''}<p>${esc(msg.texto)}</p>
        <table><thead><tr><th>Mês</th><th class="num">Energia</th><th class="num">Demanda medida</th><th class="num">Valor</th><th>Período</th></tr></thead><tbody>${ac.faturas.map((f) => `<tr><td>${IM.fmtMes(f.mes)}</td><td class="num">${f.kWh == null ? '—' : n0(f.kWh) + ' kWh'}</td><td class="num">${f.demandaKW == null ? '—' : n0(f.demandaKW) + ' kW'}</td><td class="num">${f.valor == null ? '—' : U.brl(f.valor)}</td><td>${!ac.inicio ? '' : f.mes >= ac.inicio ? 'seguindo o plano' : 'antes do plano'}</td></tr>`).join('')}</tbody></table>
        ${ac.economiaPct != null ? `<p class="sutil">Média antes: ${U.brl(ac.mediaAntes.valor)} por mês; média depois: ${U.brl(ac.mediaDepois.valor)}; economia real ${U.pct(ac.economiaPct, 1)}${ac.previsto ? `, prevista ${U.pct(ac.previsto.economiaPct, 1)}` : ''}.</p>` : ''}</section>`;
    }
    let assinatura = '<div class="assinatura"><div>Engenheiro(a) responsável · CREA</div><div>Data e assinatura</div></div>';
    const pa = parecerAtual();
    if (pa && pa.valido) {
      const p = pa.p, e = p.engenheiro || {};
      const quem = `${esc(e.nome)}${e.registro ? ` · ${esc(e.registro)}` : ''}`;
      h += `<section>${sec('Parecer do engenheiro')}
        <p>${quem}${e.organizacao ? ` · ${esc(e.organizacao)}` : ''} · emitido em ${esc(dataHora(p.emitidoEm))}: ${esc(RV.textoResumo(p.resumo || {}))}.</p>
        <table><thead><tr><th>Recomendação</th><th>Decisão</th><th>Ajuste ou observação</th></tr></thead><tbody>${p.itens.map((i) => `<tr><td>${esc(i.texto)}</td><td>${esc((RV.de(RV.DECISOES, i.decisao) || {}).tag || '')}</td><td>${esc(i.nota || '')}${i.totalConferir ? `<br><span class="sutil">Conferido em campo: ${Array.isArray(i.conferidos) ? i.conferidos.length : 0} de ${+i.totalConferir} itens</span>` : ''}</td></tr>`).join('')}</tbody></table>
        ${p.observacoes ? `<p><strong>Observações:</strong> ${esc(p.observacoes)}</p>` : ''}</section>`;
      assinatura = `<div class="assinatura"><div>${quem}</div><div>Data e assinatura</div></div>`;
    } else if (pa) {
      h += `<section><h2>Parecer do engenheiro</h2><p class="sutil">Há um parecer de ${esc(dataHora(pa.p.emitidoEm))}, mas os dados da fábrica mudaram depois dele. É preciso pedir uma nova avaliação.</p></section>`;
    }
    h += `<section>${sec('Premissas')}<p class="sutil">Tarifas de aplicação da Enel SP homologadas pela ANEEL (REH nº 3.596/2026), com ${U.pct(+cen.tarifa.tributos || 0, 1)} de tributos. Mês estimado a partir da semana planejada (× ${U.num(inst.fatorMes, 2)}). Energia injetada valorada pela Lei 14.300/2022 (${U.pct(+cen.tarifa.fioBPercentual || 0)} do Fio B não compensado). Geração solar por modelo de céu claro ajustado pelo céu previsto de cada dia. Os valores são estimativas e devem ser conferidos com medições e faturas reais.</p></section>${assinatura}`;
    $('#relatorio').innerHTML = h;
    setTimeout(() => window.print(), 50);
  }

  // ================================================================== ponte com o engenheiro
  function resumoParaEngenheiro() {
    const b = S.avBase, o = S.avOtim, cen = S.cen, t0 = U.parseDT(cen.inicio);
    const rec = DG.recomendacoes({
      avBase: b, avOtim: o, modalidades: S.diag && S.diag.modalidades,
      demanda: S.diagRapido.demanda, solar: S.diag && S.diag.solar, reat: S.diagRapido.reat,
    });
    const c = lerContato();
    const imp = impactoAtual();
    const la = linhaAcomp(cen.acompanhamento, IM.previsto(S.inst, b, o));
    return [
      `Empresa: ${cen.nome}${c.cidade ? ` (${c.cidade})` : ''}`,
      ...(c.contato ? [`Contato: ${c.contato}`] : []),
      ...(c.mensagem ? [`Recado: ${c.mensagem}`] : []),
      `Tarifa: ${TA.MODALIDADES[cen.tarifa.modalidade].nome} (Enel SP, ANEEL REH nº 3.596/2026)`,
      `Semana analisada: ${U.fmtDia(t0)} a ${U.fmtDia(t0 + (cen.dias - 1) * 1440)}`,
      '',
      `Conta estimada: ${U.brl(b.contaMes)} hoje, ${U.brl(o.contaMes)} com a agenda planejada (por mês)`,
      `Pico puxado da rede: ${U.num(b.picos.all)} kW hoje, ${U.num(o.picos.all)} kW planejado`,
      `Fator de carga: ${U.num(b.fatorCarga, 2)} hoje, ${U.num(o.fatorCarga, 2)} planejado`,
      `Energia tirada da rede: ${U.num(imp.hoje.redeMes)} kWh/mês hoje, ${U.num(imp.plano.redeMes)} planejado (${U.num(imp.deslocadoPontaMes)} kWh/mês saem da ponta; CO₂ ${U.num(imp.hoje.co2KgMes)} → ${U.num(imp.plano.co2KgMes)} kg/mês)`,
      `Entregas no prazo: ${o.noPrazo} de ${o.pedidos.length}`,
      ...(la ? [la] : []),
      '',
      'Recomendações para validar:',
      ...rec.map((r, i) => `${i + 1}. ${r}`),
      '',
      `Para revisar no Carga Certa: abra ${SITE} , aba Engenheiros, "Importar pedido", e escolha o arquivo do pedido (botão "Baixar pedido").`,
    ].join('\n');
  }
  function emailEngenheiro() {
    const para = $('#inpEngenheiro').value.trim();
    const assunto = `Pedido de avaliação: diagnóstico energético de ${S.cen.nome}`;
    let corpo = `Olá,\n\nVocê poderia avaliar o diagnóstico energético abaixo? Vou anexar o pedido (arquivo .json) e, se quiser, o relatório em PDF.\n\n${resumoParaEngenheiro()}\n\nObrigado!`;
    if (corpo.length > 1800) corpo = corpo.slice(0, 1790) + '…';
    const dest = encodeURIComponent(para).replace(/%40/g, '@');
    window.location.href = `mailto:${dest}?subject=${encodeURIComponent(assunto)}&body=${encodeURIComponent(corpo)}`;
  }
  async function copiarResumo() {
    const texto = resumoParaEngenheiro();
    try { await navigator.clipboard.writeText(texto); toast('Resumo copiado. Cole no e-mail ou no WhatsApp.'); return; } catch (e) { /* segue para o plano B */ }
    const ta = document.createElement('textarea');
    ta.value = texto; ta.style.cssText = 'position:fixed;left:-9999px;top:0';
    document.body.appendChild(ta); ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    ta.remove();
    toast(ok ? 'Resumo copiado. Cole no e-mail ou no WhatsApp.' : 'Não consegui copiar automaticamente neste navegador.', ok ? '' : 'erro');
  }

  // ================================================================== avaliação por engenheiro: lado da fábrica
  function planosAtuais() { return { base: S.serialBase, otim: S.serialOtim }; }
  function assinaturaAtual() { return RV.assinaturaDados(S.cen, planosAtuais()); }
  function itensAtuais() {
    return DG.itens({
      avBase: S.avBase, avOtim: S.avOtim, modalidades: S.diag && S.diag.modalidades,
      demanda: S.diagRapido.demanda, solar: S.diag && S.diag.solar, reat: S.diagRapido.reat,
    });
  }
  /** Parecer guardado no cenário da tela e se ele ainda vale (os dados não mudaram depois dele). */
  function parecerAtual() {
    const p = S.cen && S.cen.revisao && S.cen.revisao.parecer;
    if (!p || typeof p !== 'object' || !Array.isArray(p.itens)) return null;
    const limpo = Object.assign({}, p, { itens: p.itens.filter((i) => i && typeof i === 'object') });
    return { p: limpo, valido: !!S.serialOtim && p.assinatura === assinaturaAtual() };
  }
  function dataHora(iso) {
    const d = new Date(iso);
    return Number.isFinite(d.getTime()) ? d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
  }
  const nomeModalidade = (m) => (TA.MODALIDADES[m] ? TA.MODALIDADES[m].nome : String(m || ''));
  function tagDecisao(d) { const x = RV.de(RV.DECISOES, d); return x ? `<span class="tag ${x.classe}">${x.tag}</span>` : ''; }
  function revisaoDoCenario() {
    if (!S.cen.revisao || typeof S.cen.revisao !== 'object') S.cen.revisao = {};
    return S.cen.revisao;
  }

  function renderPedidoCampos() {
    const rv = (S.cen && S.cen.revisao) || {};
    const c = rv.contato || rv.pedido || {};
    $('#pedCidade').value = c.cidade || '';
    $('#pedContato').value = c.contato || '';
    $('#pedMensagem').value = c.mensagem || '';
  }
  function lerContato() {
    return { cidade: $('#pedCidade').value.trim().slice(0, 80), contato: $('#pedContato').value.trim().slice(0, 120), mensagem: $('#pedMensagem').value.trim().slice(0, 600) };
  }
  function salvarContato() { revisaoDoCenario().contato = lerContato(); salvarLocal(); }

  /** Confere se a agenda e o diagnóstico estão em dia e monta o pedido com os dados da tela. */
  async function prepararPedido() {
    if (S.ocupado || !S.inst) return null;
    if (S.sujo) { toast('Os dados mudaram desde o último planejamento. Clique em "Otimizar agenda" antes de pedir a avaliação.', 'erro'); return null; }
    const pa = parecerAtual();
    if (pa && pa.valido && !(await confirmar('Já existe um parecer para estes dados. Pedir outra avaliação tira esse parecer da tela.', 'Pedir outra avaliação'))) return null;
    if (!S.diag) {
      toast('Calculando o diagnóstico completo para o pedido…');
      if (!(await rodarDiagnostico())) return null;
    }
    if (S.ocupado || S.sujo || !S.diag) return null;
    const itens = itensAtuais();
    if (!itens.length) { toast('O diagnóstico não encontrou recomendações para um engenheiro avaliar.', 'erro'); return null; }
    const planos = planosAtuais();
    const assin = RV.assinaturaDados(S.cen, planos);
    // O mesmo pedido mandado de novo (mesmos dados, ainda sem parecer) é atualizado, não duplicado.
    const igual = S.fila.find((x) => x.assinatura === assin && x.status !== 'parecer');
    return RV.montarPedido({
      cen: S.cen, planos, diag: S.diag, avBase: S.avBase, avOtim: S.avOtim, itens,
      meta: Object.assign(lerContato(), { id: igual ? igual.id : null }),
    });
  }
  function registrarPedidoNoCenario(p) {
    const rv = revisaoDoCenario();
    rv.contato = lerContato();
    rv.pedido = U.clonar(p.cenario.revisao.pedido);
    delete rv.parecer; // o parecer anterior não vale para o pedido novo
    salvarLocal();
  }
  async function pedirAvaliacao() {
    const p = await prepararPedido();
    if (!p) return;
    const i = S.fila.findIndex((x) => x.id === p.id);
    const comecado = i >= 0 && S.fila[i].status === 'revisao';
    if (i >= 0) { p.rascunho = S.fila[i].rascunho; p.status = S.fila[i].status; S.fila[i] = p; } else S.fila.push(p);
    gravarFila();
    registrarPedidoNoCenario(p);
    renderPedido(); renderRecomendacoes(); renderFila(); renderRevisao();
    toast(comecado ? 'Pedido atualizado na fila; o engenheiro já tinha começado a revisar.' : 'Pedido enviado. Veja na aba Engenheiros como ele chega para o engenheiro.');
  }
  async function baixarPedido() {
    const p = await prepararPedido();
    if (!p) return;
    const arq = Object.assign({}, p);
    delete arq.status; delete arq.rascunho; delete arq.parecer;
    baixarJSON(arq, `pedido-${slug(S.cen.nome)}.json`);
    registrarPedidoNoCenario(p);
    renderPedido(); renderRecomendacoes();
    toast('Pedido baixado. Mande o arquivo ao engenheiro; ele abre na aba Engenheiros, em "Importar pedido".');
  }

  function renderPedido() {
    const el = $('#estadoPedido');
    if (!S.cen) { el.innerHTML = ''; return; }
    const rv = S.cen.revisao || {};
    const pa = parecerAtual();
    if (pa) {
      const p = pa.p, e = p.engenheiro || {};
      el.innerHTML = `<div class="parecer${pa.valido ? '' : ' desatualizado'}">
        <p><strong>Parecer de ${esc(e.nome || 'engenheiro(a)')}</strong>${e.registro ? ` (${esc(e.registro)})` : ''}${e.organizacao ? `, ${esc(e.organizacao)}` : ''}, em ${esc(dataHora(p.emitidoEm))}: ${esc(RV.textoResumo(p.resumo || {}))}.</p>
        ${pa.valido ? '' : '<p class="cartao-aviso">Os dados da fábrica mudaram depois deste parecer. Ele vale para os dados de quando foi emitido; peça uma nova avaliação.</p>'}
        <ol class="parecer-itens">${p.itens.map((i) => `<li>${tagDecisao(i.decisao)} ${esc(i.texto)}${i.nota ? `<span class="rec-nota">Engenheiro: ${esc(i.nota)}</span>` : ''}</li>`).join('')}</ol>
        ${p.observacoes ? `<p class="parecer-obs"><strong>Observações:</strong> ${esc(p.observacoes)}</p>` : ''}
      </div>`;
    } else if (rv.pedido && typeof rv.pedido === 'object') {
      const naFila = S.fila.some((x) => x.id === rv.pedido.id);
      el.innerHTML = `<p class="estado-pedido">Pedido enviado em ${esc(dataHora(rv.pedido.criadoEm))}. Aguardando o parecer do engenheiro.${naFila ? ' <button type="button" class="link" data-ir="engenheiros">Ver como o engenheiro recebe</button>' : ''}</p>`;
    } else el.innerHTML = '';
  }

  // ================================================================== avaliação por engenheiro: lado do engenheiro
  function lerFila() {
    try {
      const j = JSON.parse(lsGet(LS_FILA) || '[]');
      return Array.isArray(j) ? j.filter((p) => p && typeof p.id === 'string' && p.cenario && Array.isArray(p.itens)) : [];
    } catch (e) { return []; }
  }
  let avisouFilaCheia = false;
  let timerFila = null;
  function gravarFila() {
    clearTimeout(timerFila);
    try { localStorage.setItem(LS_FILA, JSON.stringify(S.fila)); return true; } catch (e) {
      if (!avisouFilaCheia) { avisouFilaCheia = true; toast('Não consegui guardar a fila neste navegador (sem espaço ou navegação privada). Ela vale até você fechar a página.', 'erro'); }
      return false;
    }
  }
  function gravarFilaDepois() { clearTimeout(timerFila); timerFila = setTimeout(gravarFila, 400); }
  function lerPreferenciasEng() {
    try { const j = JSON.parse(lsGet(LS_ENG) || 'null'); return j && typeof j === 'object' ? j : {}; } catch (e) { return {}; }
  }
  function gravarPreferenciasEng() { lsSet(LS_ENG, JSON.stringify({ perfil: S.perfil, ordemFila: S.ordemFila, soCombina: S.soCombina })); }

  function renderPerfil() {
    const p = S.perfil;
    $('#engNome').value = p.nome || ''; $('#engRegistro').value = p.registro || ''; $('#engOrg').value = p.organizacao || '';
    $$('#engEsp input').forEach((c) => { c.checked = p.especialidades.includes(c.value); });
    $('#selOrdem').value = S.ordemFila; $('#chkCombina').checked = S.soCombina;
  }
  function htmlAssinaComo() {
    const e = S.perfil;
    return e.nome
      ? `O parecer sai em nome de <strong>${esc(e.nome)}</strong>${e.registro ? `, ${esc(e.registro)}` : ''}${e.organizacao ? `, ${esc(e.organizacao)}` : ''}.`
      : 'Preencha seu nome no perfil, no alto desta aba, para emitir o parecer.';
  }
  function salvarPerfil() {
    S.perfil = {
      nome: $('#engNome').value.trim().slice(0, 80), registro: $('#engRegistro').value.trim().slice(0, 40),
      organizacao: $('#engOrg').value.trim().slice(0, 80), especialidades: $$('#engEsp input:checked').map((c) => c.value),
    };
    gravarPreferenciasEng();
    const a = $('#assinaComo');
    if (a) a.innerHTML = htmlAssinaComo();
  }

  function renderFila() {
    const el = $('#fila');
    if (!S.fila.length) {
      el.innerHTML = '<li class="vazio">Nenhum pedido ainda. Clique em "Carregar pedidos de exemplo" ou mande o cenário atual pela aba Diagnóstico, em "Pedir avaliação".</li>';
      return;
    }
    const esp = S.perfil.especialidades;
    const lista = RV.ordenar(S.fila, S.ordemFila, esp, S.soCombina);
    if (!lista.length) { el.innerHTML = '<li class="vazio">Nenhum pedido combina com as especialidades marcadas no seu perfil.</li>'; return; }
    el.innerHTML = lista.map((p) => {
      const st = RV.de(RV.STATUS, p.status) || RV.STATUS.aguardando;
      const aberto = p.id === S.casoId;
      const combina = esp.length > 0 && RV.combina(p, esp) > 0;
      const areas = RV.areasDoPedido(p).map((a) => {
        const v = (p.porArea && +p.porArea[a]) || 0;
        const inv = p.itens.filter((i) => i.area === a).reduce((s, i) => s + (+i.investimento || 0), 0);
        return `<span class="tag${esp.includes(a) ? ' ok' : ''}"${inv > 0 ? ` data-dica="${esc(`Exige investimento de cerca de ${U.brl(inv)}.`)}"` : ''}>${esc(RV.de(RV.AREAS, a) || a)}${v > 0.5 ? ` · ${U.brl(v)}` : ''}</span>`;
      }).join('');
      const acao = aberto ? 'Ir para a revisão' : p.status === 'parecer' ? 'Ver o parecer' : 'Abrir e revisar';
      const invTotal = p.itens.reduce((s, i) => s + (+i.investimento || 0), 0);
      const ecoSolar = (p.porArea && +p.porArea.solar) || 0;
      return `<li class="pedido${combina ? ' combina' : ''}${aberto ? ' aberto' : ''}">
        <div class="pedido-cab"><strong>${esc(p.empresa)}</strong><span class="tag ${st.classe}">${st.texto}</span></div>
        <p class="pedido-sub">${esc(p.cidade || 'cidade não informada')} · ${esc(nomeModalidade(p.modalidade))} · pedido em ${esc(dataHora(p.criadoEm))}</p>
        <p class="pedido-num">Conta hoje ${U.brl(+p.contaHoje)} por mês · economia possível <strong>${U.brl(+p.economiaMes)} por mês (${U.pct(+p.percentual || 0)} da conta)</strong></p>
        ${invTotal > 0 ? `<p class="pedido-sub">A usina solar (até ${U.brl(ecoSolar)} por mês) exige investimento de cerca de ${U.brl(invTotal)}.</p>` : ''}
        <div class="pedido-areas">${areas}</div>
        ${p.mensagem ? `<p class="pedido-msg">“${esc(p.mensagem)}”</p>` : ''}
        <div class="linha-botoes"><button type="button" class="btn mini primario" data-abrir="${esc(p.id)}">${acao}</button><button type="button" class="btn mini" data-remover="${esc(p.id)}">Remover</button></div>
      </li>`;
    }).join('');
  }

  function casoAberto() { return S.casoId ? S.fila.find((x) => x.id === S.casoId) || null : null; }

  /** Abre o caso na tela (dados, agenda e diagnóstico do pedido) para o engenheiro revisar. */
  async function abrirCaso(id) {
    if (S.ocupado) return;
    const p = S.fila.find((x) => x.id === id);
    if (!p) return;
    const mesmos = !!S.serialOtim && assinaturaAtual() === p.assinatura;
    if (!mesmos) {
      if ((S.historico.length || S.sujo) && !(await confirmar('Abrir o caso troca os dados que estão na tela pelos do pedido. Para guardar o que fez, use "Salvar" antes.', 'Abrir o caso'))) return;
      if (S.ocupado) return;
      try { definirCenario(p.cenario, p.planos); } catch (e) { console.error(e); toast('Não consegui abrir este pedido: ' + e.message, 'erro'); return; }
      S.diag = RV.restaurarDiag(p.diag);
      if (!avaliarAtual()) return;
    } else if (!S.diag && p.diag) {
      S.diag = RV.restaurarDiag(p.diag);
    }
    // O cenário na tela passa a ser o deste pedido, com o parecer, se já houver.
    const rv = revisaoDoCenario();
    rv.pedido = U.clonar((p.cenario.revisao && p.cenario.revisao.pedido) || { id: p.id, criadoEm: p.criadoEm });
    if (p.parecer) rv.parecer = U.clonar(p.parecer); else delete rv.parecer;
    S.casoId = p.id;
    if (p.status === 'aguardando') { p.status = 'revisao'; gravarFila(); }
    salvarLocal();
    renderizar();
    const painel = $('#painelRevisao');
    if (!painel.hidden && S.aba === 'engenheiros') painel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  const ROTULO_NOTA = { aprovada: 'Observação (opcional)', ajuste: 'Qual é o ajuste', recusada: 'Por que não aprovar' };
  function renderRevisao() {
    const painel = $('#painelRevisao');
    const p = casoAberto();
    if (!p) { painel.hidden = true; painel.innerHTML = ''; return; }
    painel.hidden = false;
    const r = p.rascunho || {}, dec = r.decisoes || {};
    const st = RV.de(RV.STATUS, p.status) || RV.STATUS.aguardando;
    const mesmos = !!S.serialOtim && assinaturaAtual() === p.assinatura;
    const ch = +p.contaHoje || 0, cp = +p.contaPlanejada || 0;
    const acompPedido = linhaAcomp(p.cenario && p.cenario.acompanhamento, ch > 0 ? { economiaPct: (ch - cp) / ch, economiaMes: ch - cp } : null);
    const itens = p.itens.map((it, i) => {
      const d = RV.de(dec, it.id) || {};
      const conf = RV.conferir(it.id);
      const marcados = new Set(Array.isArray(d.conferidos) ? d.conferidos : []);
      return `<li class="item-rev" data-item="${esc(it.id)}">
        <div class="item-cab"><span class="item-num">${i + 1}.</span><span class="tag">${esc(RV.de(RV.AREAS, it.area) || it.area)}</span>${+it.economiaMes > 0.5 ? `<span class="item-eco">${U.brl(+it.economiaMes)} por mês</span>` : ''}${RV.exigeART(it.id) ? '<span class="tag alerta" data-dica="Projeto e instalação com Anotação de Responsabilidade Técnica (ART) registrada no CREA.">exige ART</span>' : ''}</div>
        <p class="item-texto">${esc(it.texto)}</p>
        ${htmlQuemFaz(it.id)}
        ${conf.length ? `<div class="conferir"><p class="conferir-tit">O que conferir <span data-conta>${marcados.size} de ${conf.length}</span></p>${conf.map((c, k) => `<label class="check"><input type="checkbox" data-conf="${k}"${marcados.has(k) ? ' checked' : ''}><span>${esc(c)}</span></label>`).join('')}</div>` : ''}
        <div class="seg decisao" role="group" aria-label="Decisão sobre a recomendação ${i + 1}">${Object.entries(RV.DECISOES).map(([k, x]) => `<button type="button" data-dec="${k}" class="dec-${k}${d.decisao === k ? ' ativo' : ''}" aria-pressed="${d.decisao === k}">${x.rotulo}</button>`).join('')}</div>
        <label class="campo"><span data-rotulo>${RV.de(ROTULO_NOTA, d.decisao) || ROTULO_NOTA.aprovada}</span><textarea data-nota rows="2" placeholder="O que muda e por quê">${esc(d.nota || '')}</textarea></label>
      </li>`;
    }).join('');
    painel.innerHTML = `
      <div class="painel-cab"><h3>Revisão: ${esc(p.empresa)}</h3><span class="tag ${st.classe}">${st.texto}</span></div>
      <p class="nota">${esc(p.cidade || 'cidade não informada')} · ${esc(nomeModalidade(p.modalidade))} · pedido em ${esc(dataHora(p.criadoEm))}${p.contato ? ` · contato: ${esc(p.contato)}` : ''}</p>
      ${p.mensagem ? `<blockquote class="recado">${esc(p.mensagem)}</blockquote>` : ''}
      ${acompPedido ? `<p class="estado-pedido">${esc(acompPedido)}</p>` : ''}
      ${mesmos ? '' : '<p class="cartao-aviso">Os dados na tela não são mais os deste pedido; a revisão vale para os dados do pedido. <button type="button" class="link" data-recarregar>Voltar aos dados do pedido</button></p>'}
      <p>Os números deste caso estão nas abas Visão geral, Agenda, Energia e tarifa e Diagnóstico. Para cada recomendação, marque o que conferiu e decida.</p>
      <ol class="itens-rev">${itens}</ol>
      <label class="campo">Observações gerais para a fábrica<textarea id="revObs" rows="3" placeholder="Ex.: próximos passos, medições a fazer, documentos a pedir">${esc(r.observacoes || '')}</textarea></label>
      <p class="nota" id="assinaComo">${htmlAssinaComo()}</p>
      <div id="revProblemas" class="avisos"></div>
      <div class="linha-botoes">
        <button type="button" class="btn primario" id="btnEmitir">${p.parecer ? 'Atualizar parecer' : 'Emitir parecer'}</button>
        <button type="button" class="btn" id="btnBaixarParecer"${p.parecer ? '' : ' disabled'}>Baixar parecer para a fábrica</button>
        <button type="button" class="btn" id="btnRelatorioParecer"${p.parecer ? '' : ' disabled'}>Relatório com o parecer</button>
        <button type="button" class="btn" id="btnFecharCaso">Fechar caso</button>
      </div>
      ${p.parecer ? `<p class="nota">Parecer emitido em ${esc(dataHora(p.parecer.emitidoEm))}. Neste navegador, a fábrica já vê o resultado na aba Diagnóstico. Para mandar a ela, baixe o parecer e envie o arquivo; ela abre com o botão "Abrir", no alto.</p>` : ''}`;
  }

  function rascunhoDe(p) {
    if (!p.rascunho || typeof p.rascunho !== 'object') p.rascunho = { decisoes: {}, observacoes: '' };
    if (!p.rascunho.decisoes || typeof p.rascunho.decisoes !== 'object') p.rascunho.decisoes = {};
    return p.rascunho;
  }
  function decisaoDe(p, id) {
    const d = rascunhoDe(p).decisoes;
    const atual = RV.de(d, id);
    if (!atual || typeof atual !== 'object') d[id] = {};
    return d[id];
  }
  function cliqueRevisao(e) {
    const p = casoAberto();
    const b = e.target.closest('button');
    if (!p || !b) return;
    if (b.dataset.dec) {
      const li = b.closest('[data-item]');
      const d = decisaoDe(p, li.dataset.item);
      d.decisao = b.dataset.dec;
      $$('[data-dec]', li).forEach((x) => { const on = x.dataset.dec === d.decisao; x.classList.toggle('ativo', on); x.setAttribute('aria-pressed', String(on)); });
      $('[data-rotulo]', li).textContent = ROTULO_NOTA[d.decisao];
      if (p.status === 'aguardando') p.status = 'revisao';
      gravarFila();
      $('#revProblemas').innerHTML = '';
      return;
    }
    if (b.hasAttribute('data-recarregar')) abrirCaso(p.id);
    else if (b.id === 'btnEmitir') emitirParecer();
    else if (b.id === 'btnBaixarParecer') baixarParecer();
    else if (b.id === 'btnRelatorioParecer') relatorioDoCaso();
    else if (b.id === 'btnFecharCaso') { S.casoId = null; salvarLocal(); renderFila(); renderRevisao(); }
  }
  function marcarConferido(e) {
    const p = casoAberto(), t = e.target;
    if (!p || t.dataset.conf == null) return;
    const li = t.closest('[data-item]');
    const d = decisaoDe(p, li.dataset.item);
    const s = new Set(Array.isArray(d.conferidos) ? d.conferidos : []);
    if (t.checked) s.add(+t.dataset.conf); else s.delete(+t.dataset.conf);
    d.conferidos = Array.from(s).sort((a, b) => a - b);
    const c = $('[data-conta]', li);
    if (c) c.textContent = `${s.size} de ${RV.conferir(li.dataset.item).length}`;
    gravarFila();
  }
  function digitarRevisao(e) {
    const p = casoAberto(), t = e.target;
    if (!p) return;
    if (t.hasAttribute('data-nota')) { decisaoDe(p, t.closest('[data-item]').dataset.item).nota = t.value.slice(0, 1000); gravarFilaDepois(); }
    else if (t.id === 'revObs') { rascunhoDe(p).observacoes = t.value.slice(0, 1500); gravarFilaDepois(); }
  }

  function emitirParecer() {
    const p = casoAberto();
    if (!p) return;
    const r = rascunhoDe(p);
    const prob = RV.validarParecer(p, r, S.perfil);
    const box = $('#revProblemas');
    if (prob.length) {
      gravarFila();
      box.innerHTML = prob.map((x) => `<div class="aviso">${esc(x)}</div>`).join('');
      box.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    p.parecer = RV.montarParecer(p, r, S.perfil);
    p.status = 'parecer';
    gravarFila();
    // Com os dados do pedido na tela, a fábrica (neste navegador) vê o parecer na hora.
    if (S.serialOtim && assinaturaAtual() === p.assinatura) {
      const rv = revisaoDoCenario();
      rv.pedido = U.clonar((p.cenario.revisao && p.cenario.revisao.pedido) || { id: p.id, criadoEm: p.criadoEm });
      rv.parecer = U.clonar(p.parecer);
      salvarLocal();
    }
    renderPedido(); renderRecomendacoes(); renderFila(); renderRevisao();
    toast('Parecer emitido. A fábrica vê o resultado na aba Diagnóstico; para mandar a ela, use "Baixar parecer para a fábrica".');
  }
  function baixarParecer() {
    const p = casoAberto();
    if (!p || !p.parecer) return;
    const cenario = U.clonar(p.cenario);
    cenario.revisao = { pedido: U.clonar((p.cenario.revisao && p.cenario.revisao.pedido) || { id: p.id, criadoEm: p.criadoEm }), parecer: U.clonar(p.parecer) };
    baixarJSON({ formato: 'carga-certa', versao: 1, salvoEm: new Date().toISOString(), cenario, planos: p.planos, diag: p.diag }, `parecer-${slug(p.empresa)}.json`);
    toast('Parecer baixado. Mande o arquivo à fábrica; ela abre com o botão "Abrir", no alto.');
  }
  async function relatorioDoCaso() {
    const p = casoAberto();
    if (!p) return;
    if (!S.serialOtim || assinaturaAtual() !== p.assinatura) {
      await abrirCaso(p.id);
      if (!S.serialOtim || assinaturaAtual() !== p.assinatura) return;
    }
    gerarRelatorio();
  }

  const PEDIDOS_EXEMPLO = {
    metalurgica: { cidade: 'São Paulo (SP)', horasAtras: 30, mensagem: 'Pagamos multa de ultrapassagem de demanda em alguns meses e queremos saber se vale aumentar a usina solar.' },
    padaria: { cidade: 'São Paulo (SP)', horasAtras: 4, mensagem: 'Mudamos para a Tarifa Branca e a conta subiu. Vale voltar para a convencional?' },
  };
  /** Planeja e diagnostica um exemplo do zero, sem mexer no que está na tela, e monta o pedido dele. */
  async function montarPedidoExemplo(chave, aoProgresso, pular) {
    const ex = CC.EXEMPLOS[chave], meta = PEDIDOS_EXEMPLO[chave] || { cidade: '', horasAtras: 1, mensagem: '' };
    const cen = normalizarCenario(ex.cenario);
    const instP = MO.construir(Object.assign({}, cen, { agora: `${cen.inicio}T00:00` }));
    const base = OT.planoASAP(instP);
    const otim = await OT.otimizar(instP, base, { referencia: null, estabilidade: 0, aoProgresso: (f) => aoProgresso(0.3 * f) });
    const planos = { base: OT.serializar(instP, base), otim: OT.serializar(instP, otim) };
    if (pular && pular(RV.assinaturaDados(cen, planos))) return null; // antes do diagnóstico, que é a parte demorada
    const inst = MO.construir(cen);
    const eb = new OT.Estado(inst, OT.desserializar(inst, planos.base));
    const eo = new OT.Estado(inst, OT.desserializar(inst, planos.otim));
    const avBase = OT.avaliar(inst, eb, true), avOtim = OT.avaliar(inst, eo, true);
    const modalidades = await DG.compararModalidades(U.clonar(cen), planos.base, planos.otim, { replanejar: true, aoProgresso: (f) => aoProgresso(0.3 + 0.3 * f) });
    const solar = await DG.dimensionarSolar(U.clonar(cen), planos.otim, { aoProgresso: (f) => aoProgresso(0.6 + 0.4 * f) });
    const itens = DG.itens({ avBase, avOtim, modalidades, demanda: DG.demandaContratada(inst, avOtim), solar, reat: DG.reativos(inst, eo.exportar(), avOtim) });
    const p = RV.montarPedido({
      cen, planos, diag: { modalidades, solar }, avBase, avOtim, itens,
      meta: { cidade: meta.cidade, contato: '', mensagem: meta.mensagem }, agora: new Date(Date.now() - meta.horasAtras * 3600e3),
    });
    p.exemplo = chave;
    return p;
  }
  async function carregarPedidosExemplo() {
    if (S.ocupado) return;
    const faltam = Object.keys(CC.EXEMPLOS).filter((k) => !S.fila.some((x) => x.exemplo === k));
    if (!faltam.length) { toast('Os pedidos de exemplo já estão na fila. Para recomeçar um deles, remova e carregue de novo.'); return; }
    ocupado(true); progresso(0.02);
    try {
      // O cenário que está na tela é "a sua fábrica": ele entra pela aba Diagnóstico, não como exemplo.
      const naTela = S.serialOtim ? assinaturaAtual() : null;
      let novos = 0, pulouTela = false;
      for (let i = 0; i < faltam.length; i++) {
        const p = await montarPedidoExemplo(faltam[i], (f) => progresso(0.02 + 0.96 * (i + f) / faltam.length), (a) => {
          if (S.fila.some((x) => x.assinatura === a)) return true; // a fábrica já mandou este mesmo caso
          if (a === naTela) { pulouTela = true; return true; }
          return false;
        });
        if (p) { S.fila.push(p); novos++; }
      }
      gravarFila(); renderFila(); renderPedido();
      toast((novos ? (novos > 1 ? 'Pedidos de exemplo carregados na fila.' : 'Pedido de exemplo carregado na fila.') : 'Nenhum pedido novo para carregar.')
        + (pulouTela ? ' O cenário que está na tela ficou de fora: para mandá-lo, use "Pedir avaliação" na aba Diagnóstico.' : ''));
    } catch (e) {
      console.error(e);
      toast('Não consegui montar os pedidos de exemplo: ' + e.message, 'erro');
    } finally { ocupado(false); progresso(null); }
  }

  async function importarPedido(j) {
    const erro = RV.validarPedido(j);
    if (erro) { toast(erro, 'erro'); return false; }
    let p;
    try { p = RV.prepararImportado(j); } catch (e) { console.error(e); toast('Não consegui ler este pedido: ' + e.message, 'erro'); return false; }
    const i = S.fila.findIndex((x) => x.id === p.id);
    if (i >= 0) {
      if (!(await confirmar(`O pedido de ${p.empresa} já está na fila. Trocar pelo do arquivo? A revisão feita nele será perdida.`, 'Trocar'))) return false;
      S.fila[i] = p;
    } else S.fila.push(p);
    gravarFila();
    irPara('engenheiros');
    renderFila(); renderRevisao(); renderPedido();
    toast(`Pedido de ${p.empresa} adicionado à fila.`);
    return true;
  }
  async function importarPedidoArquivo(arq) {
    let j;
    try { j = JSON.parse(await arq.text()); } catch (e) { toast('Esse arquivo não é um JSON válido.', 'erro'); return; }
    await importarPedido(j);
  }
  async function removerPedido(id) {
    const p = S.fila.find((x) => x.id === id);
    if (!p) return;
    const revisado = p.parecer || (p.rascunho && p.rascunho.decisoes && Object.keys(p.rascunho.decisoes).length);
    if (!(await confirmar(`Remover o pedido de ${p.empresa} da fila?${revisado ? ' A revisão feita nele será perdida.' : ''}`, 'Remover'))) return;
    S.fila = S.fila.filter((x) => x.id !== id);
    if (S.casoId === id) S.casoId = null;
    gravarFila(); salvarLocal();
    renderFila(); renderRevisao(); renderPedido();
  }

  // ================================================================== arquivos
  function baixarJSON(dados, nome) {
    const blob = new Blob([JSON.stringify(dados, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = nome;
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
  }
  function salvarArquivo() {
    baixarJSON({
      formato: 'carga-certa', versao: 1, salvoEm: new Date().toISOString(), cenario: S.cen,
      planos: { base: S.serialBase, otim: S.serialOtim }, diag: RV.serializarDiag(S.diag),
    }, `carga-certa-${slug(S.cen.nome)}.json`);
    toast('Arquivo salvo na pasta de downloads.');
  }
  async function abrirArquivo(arq) {
    if (S.ocupado) return;
    let j;
    try { j = JSON.parse(await arq.text()); } catch (e) { toast('Esse arquivo não é um JSON válido.', 'erro'); return; }
    if (j && j.formato === 'carga-certa-pedido') { await importarPedido(j); return; }
    const cen = j && (j.cenario || j.cen || j);
    if (!cen || !Array.isArray(cen.maquinas) || !cen.tarifa) { toast('Esse arquivo não parece um cenário do Carga Certa.', 'erro'); return; }
    definirCenario(cen, j.planos || null);
    if (S.serialOtim) { S.diag = RV.restaurarDiag(j.diag); avaliarAtual(); salvarLocal(); } else await planejar({ zerar: true });
    const pa = parecerAtual();
    if (pa) {
      irPara('diagnostico');
      const quem = (pa.p.engenheiro && pa.p.engenheiro.nome) || 'um engenheiro';
      toast(pa.valido ? `Cenário aberto com o parecer de ${quem}. Veja abaixo, em "Avaliação por um engenheiro".` : 'Cenário aberto. Ele tem um parecer, mas os dados mudaram depois dele.');
    } else toast('Cenário aberto.');
  }
  async function carregarExemplo(k) {
    const ex = CC.EXEMPLOS[k];
    if (!ex || S.ocupado) { $('#selExemplo').value = ''; return; }
    if ((S.historico.length || S.sujo) && !(await confirmar('Carregar o exemplo substitui os dados atuais. Para guardar o que fez, use "Salvar" antes.', 'Carregar exemplo'))) { $('#selExemplo').value = ''; return; }
    definirCenario(ex.cenario, null);
    $('#selExemplo').value = '';
    await planejar({ zerar: true });
  }

  // ================================================================== ligações
  const ABAS = ['visao', 'agenda', 'eventos', 'fabrica', 'energia', 'diagnostico', 'engenheiros', 'acompanhamento', 'sobre'];
  function irPara(aba) {
    if (!ABAS.includes(aba)) aba = 'visao';
    S.aba = aba;
    $$('.abas button').forEach((b) => b.classList.toggle('ativa', b.dataset.aba === aba));
    $$('.aba').forEach((s) => s.classList.toggle('ativa', s.id === 'aba-' + aba));
    try { history.replaceState(null, '', aba === 'visao' ? location.pathname + location.search : '#' + aba); } catch (e) { /* file:// em alguns navegadores */ }
    renderGraficosDaAba();
  }

  function ligar() {
    $$('.abas button').forEach((b) => { b.onclick = () => irPara(b.dataset.aba); });
    $('#btnOtimizar').onclick = () => planejar({});
    $('#btnOtimizar2').onclick = () => planejar({});
    $('#selExemplo').onchange = (e) => { if (e.target.value) carregarExemplo(e.target.value); };
    $('#btnAbrir').onclick = () => $('#arquivo').click();
    $('#arquivo').onchange = (e) => { const f = e.target.files[0]; if (f) abrirArquivo(f); e.target.value = ''; };
    $('#btnSalvar').onclick = salvarArquivo;
    $('#btnRelatorio').onclick = gerarRelatorio;

    $('#segVisao').onclick = (e) => { const b = e.target.closest('button[data-v]'); if (!b) return; S.visao = b.dataset.v; marcarSegmento('#segVisao', b); renderCurva(); };
    $('#segGanttPlano').onclick = (e) => { const b = e.target.closest('button[data-p]'); if (!b) return; S.ganttPlano = b.dataset.p; marcarSegmento('#segGanttPlano', b); renderGantt(); renderTabelaEtapas(); };
    $('#segDias').onclick = (e) => { const b = e.target.closest('button[data-d]'); if (!b) return; S.ganttDia = +b.dataset.d; marcarSegmento('#segDias', b); renderGantt(); };

    $('#btnInterpretar').onclick = interpretar;
    $('#txtEvento').addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) interpretar(); });
    $('#chipsExemplos').onclick = (e) => {
      const b = e.target.closest('[data-chip]');
      if (!b) return;
      const ta = $('#txtEvento');
      ta.value = ta.value.trim() ? `${ta.value.trim()}\n${b.dataset.chip}` : b.dataset.chip;
      ta.focus();
    };
    $('#cartoes').addEventListener('change', editarCartao);
    $('#btnAplicar').onclick = aplicarEventos;
    $('#btnDescartar').onclick = () => { S.pendentes = null; renderCartoes(); };
    $('#btnDesfazer').onclick = desfazer;
    $('#inpAgora').onchange = (e) => { const v = U.parseDT(e.target.value); if (Number.isFinite(v)) mudarAgora(v); };
    $$('[data-avanca]').forEach((b) => { b.onclick = () => mudarAgora(U.parseDT(S.cen.agora) + +b.dataset.avanca); });
    $$('input[name="motor"]').forEach((r) => { r.onchange = () => { S.motor = r.value; renderMotor(); salvarLocal(); }; });
    $('#inpChave').onchange = (e) => { S.chaves[S.motor] = e.target.value.trim(); if ($('#chkLembrar').checked) lsSet(LS_CHAVE(S.motor), S.chaves[S.motor]); };
    $('#chkLembrar').onchange = (e) => { lsSet(LS_CHAVE(S.motor), e.target.checked ? (S.chaves[S.motor] || $('#inpChave').value.trim()) : null); };
    $('#inpModelo').onchange = (e) => { S.modeloGemini = e.target.value.trim() || NV.MODELO_GEMINI; salvarLocal(); };

    $('#formNeb').addEventListener('input', (e) => {
      const i = e.target.dataset.neb;
      if (i == null) return;
      S.cen.solar.nebulosidade[+i] = +e.target.value / 100;
      const rot = e.target.previousElementSibling && e.target.previousElementSibling.querySelector('b');
      if (rot) rot.textContent = e.target.value + '%';
    });
    $('#formNeb').addEventListener('change', (e) => { if (e.target.dataset.neb != null) marcarSujo(); });
    $('#tabPrecos').addEventListener('click', (e) => {
      if (e.target.id !== 'btnRestaurarTarifa') return;
      const p = TA.PRESETS['enel-sp-2026'];
      S.cen.tarifa.precos = U.clonar(p.precos); S.cen.tarifa.ponta = U.clonar(p.ponta); S.cen.tarifa.fioB = U.clonar(p.fioB); S.cen.tarifa.teReativo = p.teReativo;
      renderFormularios(); marcarSujo(); toast('Valores da Enel SP restaurados.');
    });
    $('#btnDiag').onclick = rodarDiagnostico;
    $('#btnRelatorio2').onclick = gerarRelatorio;
    $('#btnEmailEng').onclick = emailEngenheiro;
    $('#btnCopiarResumo').onclick = copiarResumo;

    // avaliação por engenheiro: lado da fábrica
    $('#btnPedir').onclick = pedirAvaliacao;
    $('#btnBaixarPedido').onclick = baixarPedido;
    ['#pedCidade', '#pedContato', '#pedMensagem'].forEach((s) => $(s).addEventListener('change', salvarContato));
    $('#estadoPedido').addEventListener('click', (e) => { const b = e.target.closest('[data-ir]'); if (b) irPara(b.dataset.ir); });
    // lado do engenheiro
    ['#engNome', '#engRegistro', '#engOrg'].forEach((s) => $(s).addEventListener('input', salvarPerfil));
    $('#engEsp').addEventListener('change', () => { salvarPerfil(); renderFila(); });
    $('#selOrdem').onchange = (e) => { S.ordemFila = e.target.value; gravarPreferenciasEng(); renderFila(); };
    $('#chkCombina').onchange = (e) => { S.soCombina = e.target.checked; gravarPreferenciasEng(); renderFila(); };
    $('#fila').addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.abrir) abrirCaso(b.dataset.abrir);
      else if (b.dataset.remover) removerPedido(b.dataset.remover);
    });
    $('#btnImportarPedido').onclick = () => $('#arquivoPedido').click();
    $('#arquivoPedido').onchange = (e) => { const f = e.target.files[0]; if (f) importarPedidoArquivo(f); e.target.value = ''; };
    $('#btnExemplosFila').onclick = carregarPedidosExemplo;
    // impacto e acompanhamento
    $('#impactoVisao').addEventListener('click', (e) => { const b = e.target.closest('[data-ir]'); if (b) irPara(b.dataset.ir); });
    $('#acInicio').onchange = (e) => {
      const m = IM.lerMes(e.target.value);
      if (e.target.value.trim() && !m) { toast('Mês não entendido. Use, por exemplo, 2026-08 ou 08/2026.', 'erro'); return; }
      S.cen.acompanhamento.inicioPlano = m;
      if (m && e.target.value !== m) e.target.value = m;
      acompMudou();
    };
    $('#btnAcExemplo').onclick = carregarAcompExemplo;
    $('#btnAcLimpar').onclick = limparAcomp;
    const rev = $('#painelRevisao');
    rev.addEventListener('click', cliqueRevisao);
    rev.addEventListener('change', marcarConferido);
    rev.addEventListener('input', digitarRevisao);

    const dica = $('#dica');
    const posicionar = (e) => {
      const w = dica.offsetWidth, h = dica.offsetHeight;
      let x = e.clientX + 14, y = e.clientY + 14;
      if (x + w > window.innerWidth - 8) x = e.clientX - w - 14;
      if (y + h > window.innerHeight - 8) y = e.clientY - h - 14;
      dica.style.left = Math.max(4, x) + 'px'; dica.style.top = Math.max(4, y) + 'px';
    };
    document.addEventListener('mouseover', (e) => {
      const el = e.target.closest && e.target.closest('[data-dica]');
      if (!el) { dica.hidden = true; return; }
      dica.textContent = el.dataset.dica; dica.hidden = false; posicionar(e);
    });
    document.addEventListener('mousemove', (e) => { if (!dica.hidden) posicionar(e); });
  }

  function iniciar() {
    $('#selExemplo').innerHTML = '<option value="">Trocar de cenário…</option>' + Object.entries(CC.EXEMPLOS).map(([k, v]) => `<option value="${k}">${esc(v.titulo)}</option>`).join('');
    $('#engEsp').insertAdjacentHTML('beforeend', Object.entries(RV.AREAS).map(([k, v]) => `<label><input type="checkbox" value="${k}"> ${esc(v)}</label>`).join(''));
    // Lado do engenheiro: fila de pedidos e perfil ficam neste navegador.
    S.fila = lerFila();
    const pref = lerPreferenciasEng(), perfil = pref.perfil && typeof pref.perfil === 'object' ? pref.perfil : {};
    S.perfil = {
      nome: String(perfil.nome || ''), registro: String(perfil.registro || ''), organizacao: String(perfil.organizacao || ''),
      especialidades: Array.isArray(perfil.especialidades) ? perfil.especialidades.filter((a) => RV.de(RV.AREAS, a)) : [],
    };
    S.ordemFila = ['reais', 'percentual', 'antigos'].includes(pref.ordemFila) ? pref.ordemFila : 'reais';
    S.soCombina = !!pref.soCombina;
    renderPerfil();
    ligar();
    const salvo = carregarLocal();
    if (salvo) {
      S.motor = ['local', 'gemini', 'claude'].includes(salvo.motor) ? salvo.motor : 'local';
      S.modeloGemini = salvo.modeloGemini || NV.MODELO_GEMINI;
      definirCenario(salvo.cen, salvo.base && salvo.otim ? { base: salvo.base, otim: salvo.otim } : null);
      if (S.serialOtim) S.diag = RV.restaurarDiag(salvo.diag);
      S.casoId = S.fila.some((p) => p.id === salvo.casoId) ? salvo.casoId : null;
    } else {
      definirCenario(CC.EXEMPLOS.metalurgica.cenario, null);
    }
    renderMotor();
    const abaInicial = location.hash.slice(1);
    if (ABAS.includes(abaInicial)) irPara(abaInicial);
    window.addEventListener('hashchange', () => { const a = location.hash.slice(1); if (ABAS.includes(a) && a !== S.aba) irPara(a); });
    renderFila();
    if (!window.Chart) toast('A biblioteca de gráficos não carregou; os números continuam valendo.', 'erro');
    if (S.serialOtim) {
      try { avaliarAtual(); } catch (e) { console.error(e); planejar({ zerar: true }); }
    } else planejar({ zerar: true });
  }

  CC.app = {
    estado: S, planejar, avaliarAtual, interpretar, aplicarEventos, rodarDiagnostico, gerarRelatorio, irPara,
    pedirAvaliacao, abrirCaso, emitirParecer, carregarPedidosExemplo, importarPedido, removerPedido, parecerAtual,
    carregarAcompExemplo, acompAtual, impactoAtual,
  };
  iniciar();
})();
