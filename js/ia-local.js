/* Carga Certa — IA local (funciona sem internet).
 *
 * Duas partes:
 *  1) Classificador de intenção Naive Bayes multinomial, treinado no próprio navegador com as frases
 *     de exemplo abaixo (aprendizado de máquina supervisionado). Nomes de máquinas, clientes, números,
 *     horas e códigos de pedido viram marcadores (_maquina_, _hora_...), então o modelo generaliza para
 *     as máquinas e clientes de qualquer fábrica.
 *  2) Extração de entidades com regras em português: qual máquina/unidade, qual pedido, datas
 *     ("amanhã", "quinta", "25/11"), horários ("14h", "das 8h às 12h", "à tarde"), durações,
 *     quantidades, kW e percentuais.
 * O resultado é uma lista de eventos estruturados que o usuário confere antes de aplicar.
 */
(function (G) {
  'use strict';
  const CC = G.CC = G.CC || {};
  const U = CC.util;
  const IA = CC.iaLocal = {};

  IA.INTENCOES = {
    maquina_indisponivel: 'Máquina parada',
    maquina_disponivel: 'Máquina liberada',
    mudar_prazo: 'Mudança de prazo',
    novo_pedido: 'Pedido novo',
    mudar_quantidade: 'Mudança de quantidade',
    cancelar_pedido: 'Pedido cancelado',
    previsao_solar: 'Previsão do tempo (geração solar)',
    limite_demanda: 'Limite de demanda',
    mudar_turno: 'Mudança de turno',
    desconhecido: 'Não entendi',
  };

  // ------------------------------------------------------------------ dados de treino
  const TREINO = {
    maquina_indisponivel: [
      'o torno 2 quebrou', 'a fresa parou e só volta amanhã às 14h', 'forno em manutenção das 8h às 12h de quinta',
      'a serra vai ficar fora até sexta', 'deu problema na solda 1, sem previsão de volta até amanhã de manhã',
      'a cabine de pintura está em manutenção hoje à tarde', 'o centro de usinagem travou, o técnico chega às 15h',
      'máquina de corte indisponível por 3 horas', 'o compressor da pintura queimou, conserto até amanhã 10h',
      'manutenção preventiva do forno na quarta das 6h às 14h', 'o torno cnc 1 está parado para troca de ferramenta por 2 horas',
      'falta operador para a solda hoje, ela fica parada até as 18h', 'a injetora quebrou', 'quebrou a correia da serra',
      'paramos a fresa para manutenção corretiva', 'o forno desarmou e só religa amanhã', 'a masseira estragou',
      'o motor da embaladora queimou', 'a prensa está com defeito', 'vamos desligar o forno para limpeza das 13h às 15h',
      'o torno está em manutenção', 'pane elétrica na fresa, parada até segunda', 'a solda 2 vai ficar parada a tarde toda',
    ],
    maquina_disponivel: [
      'o torno 2 voltou a funcionar', 'a manutenção do forno terminou', 'a fresa já está liberada', 'consertaram a serra',
      'a solda voltou', 'cabine de pintura liberada para uso', 'o técnico resolveu o problema do torno',
      'o forno já está operando de novo', 'fim da manutenção da fresa', 'pode usar o torno 1 de novo',
      'a máquina de corte voltou antes do previsto', 'o centro de usinagem está ok', 'a masseira já foi consertada',
      'a embaladora voltou a rodar', 'liberaram a prensa',
    ],
    mudar_prazo: [
      'o cliente antecipou o pedido p103 para quarta às 12h', 'p105 agora é para sexta às 10h', 'adiaram o p102 para segunda',
      'a entrega do p107 passou para quinta de manhã', 'a agromáquinas precisa do p101 amanhã às 9h', 'o prazo do p108 mudou para sábado',
      'antecipar o pedido da hidro bombas para terça 16h', 'o p110 pode atrasar até segunda', 'o cliente pediu para entregar o p104 um dia antes',
      'a coleta do p106 vai ser quinta às 14h', 'o caminhão vem buscar o p109 hoje às 17h', 'prorrogaram o prazo do p111 para sábado meio-dia',
      'o pedido p112 ficou urgente, precisa sair até amanhã', 'postergar o p103 em dois dias', 'a entrega do p201 foi adiantada para 6h',
      'o cliente quer receber o p104 dois dias antes', 'mudou a data de entrega do p105', 'novo prazo do p110: sexta 15h',
    ],
    novo_pedido: [
      'chegou um pedido urgente de 100 eixos para quinta às 14h', 'novo pedido igual ao p101 com prazo sexta 16h',
      'entrou pedido de 50 flanges para sábado', 'a usina boa vista pediu mais 200 pinos para quinta',
      'recebemos um pedido novo de 30 grades para sexta', 'pedido extra de 80 buchas para amanhã às 18h',
      'cliente novo quer 40 suportes até sexta', 'inclui um pedido de 120 engrenagens para segunda',
      'fechamos uma venda de 60 mancais para quarta', 'mais um pedido de eixos estriados, 90 peças, para sexta',
      'nova ordem de produção: 25 carcaças para quinta 10h', 'chegou encomenda de 150 chapas soldadas',
      'entrou uma encomenda de 500 pães de forma para amanhã', 'pedido novo de bisnaguinha, 300 unidades, quinta 8h',
      'precisamos produzir mais 100 peças iguais ao p104',
    ],
    mudar_quantidade: [
      'o p104 aumentou para 300 peças', 'o cliente reduziu o p106 pela metade', 'o p101 agora é de 200 unidades',
      'dobraram a quantidade do p108', 'aumentaram o pedido p102 em 20%', 'o p105 caiu para 100 peças', 'o cliente cortou 30% do p110',
      'a quantidade do p107 mudou para 40', 'o pedido da metalsul passou de 200 para 250 buchas', 'vão ser só 50 peças no p112',
      'acrescentar 100 peças no p109', 'diminuir o p111 para 60 unidades', 'o p203 vai ter 800 unidades', 'reduzir a quantidade do p201',
    ],
    cancelar_pedido: [
      'cancelaram o p107', 'o pedido do frigorífico serra foi cancelado', 'o cliente desistiu do p102', 'pode cancelar o p110',
      'o p105 não vai mais ser produzido', 'tira o p103 da programação', 'suspenderam o pedido p108', 'a agromáquinas cancelou a encomenda',
      'remover o pedido p111', 'pedido p104 cancelado pelo cliente', 'o p109 foi suspenso por falta de pagamento', 'excluir o p112 da agenda',
      'cancela o pedido da escola',
    ],
    previsao_solar: [
      'amanhã vai ser nublado', 'previsão de chuva quinta e sexta', 'sol forte no sábado', 'hoje o céu está encoberto',
      'a previsão é de tempo aberto a semana toda', 'vai chover muito na quarta', 'quinta deve ter sol entre nuvens',
      'dia nublado com pancadas de chuva amanhã', 'a geração solar vai ser baixa amanhã por causa das nuvens', 'céu limpo amanhã',
      'previsão de tempestade na sexta', 'fim de semana ensolarado', 'tempo fechado hoje', 'a meteorologia prevê garoa na terça',
      'frente fria com chuva a partir de quinta',
    ],
    limite_demanda: [
      'a distribuidora pediu para reduzir o consumo das 18h às 21h amanhã', 'limitar a demanda em 80 kw na quinta à tarde',
      'não podemos passar de 100 kw hoje', 'a enel avisou de sobrecarga na rede, reduzir 30% entre 17h e 20h',
      'programa de resposta da demanda: cortar carga na quarta das 14h às 17h', 'o transformador está esquentando, segurar a demanda abaixo de 90 kw',
      'manter a potência abaixo de 70 kw amanhã de manhã', 'evitar picos acima de 110 kw na sexta',
      'pedido da concessionária para diminuir a carga no horário de ponta', 'teto de demanda de 60 kw no sábado',
      'reduzir a carga em 20% hoje à noite', 'a rede está instável, limite de 85 kw até amanhã', 'o disjuntor geral está desarmando, limitar a potência',
    ],
    mudar_turno: [
      'sábado vamos trabalhar das 7h às 16h', 'não haverá expediente na sexta', 'turno extra na quinta até 23h',
      'a fábrica vai fechar mais cedo hoje, às 15h', 'amanhã é feriado municipal, sem produção', 'vamos abrir domingo das 8h às 12h',
      'quarta o turno começa às 8h', 'hora extra liberada na terça até meia-noite', 'folga coletiva na segunda', 'sexta o expediente vai até 14h',
      'o segundo turno de quinta foi cancelado', 'trabalharemos no sábado o dia todo', 'a produção vai parar na sexta à tarde para inventário',
    ],
    desconhecido: [
      'bom dia pessoal', 'qual o custo da energia hoje', 'obrigado', 'como está a produção', 'me mostra o gráfico', 'quanto vamos economizar',
      'teste', 'o café acabou', 'reunião às 10h na sala de reuniões', 'quem está de plantão', 'ok', 'tudo certo por aqui', 'qual o pico de ontem',
    ],
  };

  const MAQUINAS_GENERICAS = ['centro de usinagem', 'cabine de pintura', 'serra de fita', 'maquina de corte', 'torno cnc', 'solda mig',
    'torno', 'fresa', 'fresadora', 'forno', 'serra', 'solda', 'pintura', 'injetora', 'prensa', 'compressor', 'masseira', 'modeladora',
    'embaladora', 'fatiadora', 'estufa', 'dobradeira', 'guilhotina', 'retifica', 'caldeira', 'extrusora', 'misturador', 'moinho', 'maquina'];
  const CLIENTES_GENERICOS = ['agromaquinas', 'construtora horizonte', 'hidro bombas', 'metalsul', 'usina boa vista', 'frigorifico serra', 'escola'];
  const SINONIMOS = {
    serra: ['corte'], corte: ['serra'], fresa: ['usinagem', 'fresadora'], usinagem: ['fresa'], fresadora: ['fresa'],
    tempera: ['forno'], forno: ['tempera'], soldagem: ['solda'], solda: ['soldagem'], pintura: ['cabine', 'pintar'], cabine: ['pintura'],
    masseira: ['massa'], modeladora: ['divisora'], divisora: ['modeladora'], embaladora: ['fatiadora', 'embalagem'], fatiadora: ['embaladora'],
    fermentacao: ['camara', 'fermentadora'], camara: ['fermentacao'],
  };

  const STOP = new Set(['de', 'da', 'do', 'das', 'dos', 'o', 'a', 'os', 'as', 'um', 'uma', 'uns', 'umas', 'e', 'em', 'no', 'na', 'nos', 'nas',
    'para', 'pra', 'pro', 'por', 'pelo', 'pela', 'com', 'que', 'se', 'ao', 'aos', 'ja', 'la', 'isso', 'esse', 'essa', 'este', 'esta', 'mas',
    'ou', 'me', 'eh', 'ai', 'tambem', 'muito', 'bem', 'entao', 'gente', 'pessoal']);
  const SUFIXOS = ['amentos', 'amento', 'imentos', 'imento', 'acoes', 'mente', 'aram', 'eram', 'iram', 'avam', 'ando', 'endo', 'indo',
    'adas', 'ados', 'idas', 'idos', 'acao', 'ada', 'ado', 'ida', 'ido', 'ara', 'era', 'ira', 'ou', 'eu', 'iu', 'am', 'ar', 'er', 'ir',
    'as', 'es', 'os', 'a', 'e', 'o', 's'];
  function radical(w) {
    if (w[0] === '_' || w.length <= 4) return w;
    for (const s of SUFIXOS) if (w.length - s.length >= 4 && w.endsWith(s)) return w.slice(0, -s.length);
    return w;
  }
  const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  // ------------------------------------------------------------------ dicionário do cenário
  IA.dicionario = function (cen) {
    const maquinas = [];
    for (const m of (cen && cen.maquinas) || []) {
      const nome = U.normalizar(m.nome), id = U.normalizar(m.id);
      const termos = new Set([nome, id]);
      for (const w of nome.split(/[^a-z0-9]+/)) if (w.length >= 4 && !['maquina', 'centro', 'cabine', 'com', 'para', 'eletrico', 'eletrica'].includes(w)) termos.add(w);
      for (const t of Array.from(termos)) for (const s of SINONIMOS[t] || []) termos.add(s);
      maquinas.push({ id: m.id, unidades: Math.max(1, +m.unidades || 1), termos: Array.from(termos).filter(Boolean).sort((a, b) => b.length - a.length) });
    }
    const clientes = [];
    for (const p of (cen && cen.pedidos) || []) {
      const c = U.normalizar(p.cliente || '').trim();
      if (c && !clientes.includes(c)) clientes.push(c);
    }
    const marcMaq = Array.from(new Set([...MAQUINAS_GENERICAS, ...maquinas.flatMap((m) => m.termos)])).sort((a, b) => b.length - a.length);
    const marcCli = Array.from(new Set([...CLIENTES_GENERICOS, ...clientes])).sort((a, b) => b.length - a.length);
    return { maquinas, clientes, marcMaq, marcCli };
  };

  function caracteristicas(texto, dic) {
    let s = ' ' + U.normalizar(texto) + ' ';
    s = s.replace(/\bp\s?-?\s?\d{2,5}\b/g, ' _pedido_ ');
    s = s.replace(/\b\d{1,2}\/\d{1,2}(\/\d{2,4})?\b/g, ' _data_ ');
    s = s.replace(/\b\d{1,2}\s?(h|:)\s?\d{0,2}\b/g, ' _hora_ ');
    s = s.replace(/\b\d+([.,]\d+)?\s?%/g, ' _pct_ ');
    s = s.replace(/\b\d+([.,]\d+)?\s?kw\b/g, ' _kw_ ');
    s = s.replace(/\b\d+([.,]\d+)?\b/g, ' _num_ ');
    for (const c of dic.marcCli) if (c.length >= 4) s = s.replace(new RegExp('\\b' + escRe(c) + '\\b', 'g'), ' _cliente_ ');
    for (const m of dic.marcMaq) if (m.length >= 3) s = s.replace(new RegExp('\\b' + escRe(m) + '\\b', 'g'), ' _maquina_ ');
    const toks = s.split(/[^a-z_]+/).filter((w) => w && !STOP.has(w)).map(radical);
    const f = toks.slice();
    for (let i = 0; i + 1 < toks.length; i++) f.push(toks[i] + '+' + toks[i + 1]);
    return f;
  }

  // ------------------------------------------------------------------ Naive Bayes
  let modelo = null;
  IA.treinar = function (dic) {
    const m = { classes: Object.keys(TREINO), cont: {}, total: {}, vocab: new Set() };
    for (const c of m.classes) {
      m.cont[c] = new Map(); m.total[c] = 0;
      for (const frase of TREINO[c]) for (const f of caracteristicas(frase, dic)) {
        m.cont[c].set(f, (m.cont[c].get(f) || 0) + 1); m.total[c]++; m.vocab.add(f);
      }
    }
    modelo = m;
    return m;
  };

  IA.classificar = function (texto, dic) {
    if (!modelo) IA.treinar(dic);
    const fs = caracteristicas(texto, dic).filter((f) => modelo.vocab.has(f));
    if (!fs.length) return { intencao: 'desconhecido', confianca: 0, probs: {} };
    const V = modelo.vocab.size, lp = {};
    for (const c of modelo.classes) {
      let s = 0;
      for (const f of fs) s += Math.log(((modelo.cont[c].get(f) || 0) + 1) / (modelo.total[c] + V));
      lp[c] = s;
    }
    const tau = Math.max(1, fs.length / 3); // suaviza o excesso de confiança típico do Naive Bayes
    const mx = Math.max(...Object.values(lp));
    let z = 0; const probs = {};
    for (const c of modelo.classes) { probs[c] = Math.exp((lp[c] - mx) / tau); z += probs[c]; }
    for (const c of modelo.classes) probs[c] /= z;
    const intencao = modelo.classes.reduce((a, b) => (probs[b] > probs[a] ? b : a));
    return { intencao, confianca: probs[intencao], probs };
  };

  // ------------------------------------------------------------------ entidades
  IA.acharMaquina = function (n, dic) {
    let best = null;
    for (const m of dic.maquinas) {
      let score = 0, pos = -1, termo = null;
      for (const t of m.termos) {
        const r = new RegExp('\\b' + escRe(t) + '\\b').exec(n);
        if (r) { score += t.length; if (pos < 0 || r.index < pos) { pos = r.index; termo = t; } }
      }
      if (score > 0 && (!best || score > best.score)) best = { id: m.id, unidades: m.unidades, score, pos, termo };
    }
    if (!best) return null;
    const re = new RegExp('\\b' + escRe(best.termo) + '\\b\\s*(?:n[o°º.]?\\s*|numero\\s*|#\\s*|unidade\\s*)?(\\d{1,2})\\b(?!\\s*(?:h\\b|:|horas?|min|pecas|unidades|kw|%))');
    const r = re.exec(n) || /\bunidade\s*(\d{1,2})\b/.exec(n);
    let unidade = r ? +r[1] : null;
    if (unidade != null && (unidade < 1 || unidade > best.unidades)) unidade = null;
    return { id: best.id, unidade, unidades: best.unidades };
  };

  IA.acharPedidos = function (textoOriginal, cen) {
    const n = U.normalizar(textoOriginal);
    const ids = (cen.pedidos || []).map((p) => String(p.id));
    const achados = [];
    const re = /\bp\s?-?\s?(\d{2,5})\b/g;
    let m;
    while ((m = re.exec(n))) { const id = 'P' + m[1]; if (!achados.includes(id)) achados.push(id); }
    for (const id of ids) {
      const r = new RegExp('\\b' + escRe(U.normalizar(id)) + '\\b');
      if (r.test(n) && !achados.includes(id)) achados.push(id);
    }
    const existentes = achados.map((a) => ids.find((i) => U.normalizar(i) === U.normalizar(a)) || a);
    let cliente = null;
    for (const p of cen.pedidos || []) {
      const c = U.normalizar(p.cliente || '');
      if (!c) continue;
      const primeira = c.split(/\s+/)[0];
      if (new RegExp('\\b' + escRe(c) + '\\b').test(n) || (primeira.length >= 5 && new RegExp('\\b' + escRe(primeira) + '\\b').test(n))) { cliente = p.cliente; break; }
    }
    return { ids: existentes, cliente };
  };

  // ------------------------------------------------------------------ tempo
  const DIAS_SEMANA = { domingo: 0, segunda: 1, terca: 2, quarta: 3, quinta: 4, sexta: 5, sabado: 6 };
  const NUM_PALAVRA = { um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5, seis: 6, meia: 0.5 };
  const valorNum = (s) => (s in NUM_PALAVRA ? NUM_PALAVRA[s] : U.numeroBR(s));

  /** Lê datas, horas, períodos e durações de um texto normalizado. agora = minutos absolutos. */
  IA.extrairTempo = function (n0, agora) {
    let n = n0;
    const hoje = U.inicioDoDia(agora), dowHoje = U.partes(agora).dow;
    const mascarar = (ini, fim) => { n = n.slice(0, ini) + ' '.repeat(fim - ini) + n.slice(fim); };
    const dur = [], marcasDia = [], marcasHora = [], periodos = [];
    let m;

    // Durações e "daqui a"
    const reDur = /\b(por|durante|em|daqui a|dentro de)\s+(?:mais\s+)?(\d+(?:[.,]\d+)?|uma?|duas|dois|tres|quatro|cinco|seis|meia)\s*(h\b|hs\b|hrs?\b|horas?\b|min\b|minutos?\b|dias?\b)/g;
    while ((m = reDur.exec(n))) {
      const v = valorNum(m[2]);
      const mult = /^d/.test(m[3]) ? 1440 : /^min/.test(m[3]) ? 1 : 60;
      dur.push({ pos: m.index, minutos: v * mult, tipo: m[1] });
    }
    for (const d of dur) { const r = new RegExp(reDur.source); const mm = r.exec(n.slice(d.pos)); if (mm) mascarar(d.pos, d.pos + mm[0].length); }

    // Dias
    const addDia = (pos, end, inicio, extra) => marcasDia.push(Object.assign({ pos, end, inicio, usado: false }, extra || {}));
    const reRel = /\b(depois de amanha|amanha|hoje)\b/g;
    while ((m = reRel.exec(n))) addDia(m.index, m.index + m[0].length, hoje + 1440 * (m[1] === 'hoje' ? 0 : m[1] === 'amanha' ? 1 : 2));
    const reSem = /\b(proxima\s+|que\s+vem\s+)?(segunda|terca|quarta|quinta|sexta|sabado|domingo)(?:[- ]feira)?(\s+que\s+vem)?\b/g;
    while ((m = reSem.exec(n))) {
      let delta = (DIAS_SEMANA[m[2]] - dowHoje + 7) % 7;
      if (delta === 0 && (m[1] || m[3])) delta = 7;
      addDia(m.index, m.index + m[0].length, hoje + delta * 1440);
    }
    const reData = /\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/g;
    while ((m = reData.exec(n))) {
      const p = U.partes(agora);
      let ano = m[3] ? +m[3] : p.ano; if (ano < 100) ano += 2000;
      const d = Date.UTC(ano, +m[2] - 1, +m[1]) / 60000;
      if (Number.isFinite(d)) addDia(m.index, m.index + m[0].length, d);
    }
    const reDiaN = /\bdia\s+(\d{1,2})\b/g;
    while ((m = reDiaN.exec(n))) {
      const p = U.partes(agora);
      let d = Date.UTC(p.ano, p.mes - 1, +m[1]) / 60000;
      if (d < hoje) d = Date.UTC(p.ano, p.mes, +m[1]) / 60000;
      addDia(m.index, m.index + m[0].length, d);
    }
    if (/\bfim de semana\b|\bfinal de semana\b/.test(n)) {
      const i = n.search(/\bfi(m|nal) de semana\b/);
      const sab = hoje + ((6 - dowHoje + 7) % 7) * 1440;
      addDia(i, i + 13, sab, { multi: [sab, sab + 1440] });
    }
    const semanaToda = /\b(semana toda|semana inteira|todos os dias|a semana)\b/.test(n);

    // Horários
    const addHora = (pos, end, minutos) => marcasHora.push({ pos, end, minutos });
    const reMeio = /\b(meio[- ]dia|meia[- ]noite)\b/g;
    while ((m = reMeio.exec(n))) { addHora(m.index, m.index + m[0].length, /meio/.test(m[1]) ? 720 : 1440); mascarar(m.index, m.index + m[0].length); }
    const reH = /\b(\d{1,2})\s?(?:h|:|horas?\b)\s?(\d{2})?(?:\s*(?:da|de)\s+(manha|tarde|noite|madrugada))?/g;
    while ((m = reH.exec(n))) {
      let h = +m[1]; const mi = m[2] ? +m[2] : 0;
      if (h > 24 || mi > 59) continue;
      if ((m[3] === 'tarde' || m[3] === 'noite') && h < 12) h += 12;
      addHora(m.index, m.index + m[0].length, h * 60 + mi);
    }
    const reDaTarde = /\b(?:as\s+)?(\d{1,2})\s+(?:da|de)\s+(manha|tarde|noite|madrugada)\b/g;
    while ((m = reDaTarde.exec(n))) {
      if (marcasHora.some((x) => m.index >= x.pos && m.index < x.end)) continue;
      let h = +m[1]; if ((m[2] === 'tarde' || m[2] === 'noite') && h < 12) h += 12;
      if (h <= 24) addHora(m.index, m.index + m[0].length, h * 60);
    }
    const reAs = /\bas\s+(\d{1,2})\b(?!\s*(?:h|:|pecas|unidades|un\b|kw|%|dias?|horas?))/g;
    while ((m = reAs.exec(n))) {
      if (marcasHora.some((x) => m.index + 3 >= x.pos && m.index + 3 < x.end)) continue;
      const h = +m[1]; if (h <= 24) addHora(m.index, m.index + m[0].length, h * 60);
    }
    const reFimDia = /\b(fim|final) do (dia|expediente|turno)\b/g;
    while ((m = reFimDia.exec(n))) addHora(m.index, m.index + m[0].length, 18 * 60);

    // Períodos do dia
    const rePer = /\b(?:de|pela|a|na|durante a|toda a)\s+(manha|tarde|noite|madrugada)\b|\b(manha|tarde|noite) toda\b|\b(horario de ponta|na ponta|hora de ponta)\b|\b(dia todo|dia inteiro)\b/g;
    const FAIXAS = { manha: [360, 720], tarde: [720, 1080], noite: [1080, 1380], madrugada: [0, 360] };
    while ((m = rePer.exec(n))) {
      if (marcasHora.some((x) => m.index >= x.pos && m.index < x.end)) continue;
      const k = m[1] || m[2];
      let faixa = k ? FAIXAS[k] : m[3] ? 'ponta' : [0, 1440];
      periodos.push({ pos: m.index, faixa });
    }

    marcasHora.sort((a, b) => a.pos - b.pos);
    marcasDia.sort((a, b) => a.pos - b.pos);
    const papelAntes = (pos) => {
      const antes = n.slice(Math.max(0, pos - 26), pos);
      if (/(ate|volta(r|ra|m)?|retorna(r|ra)?|religa(r)?|termina(r|ra)?|fim|liberad[oa]|pronto|previsao de volta|chega(ra|r)?|ate as)\s*(a|as|o|ao|na|no|de|do|da|para|pra|la|mais ou menos)?\s*$/.test(antes)) return 'fim';
      if (/(das|desde|a partir d[eoa]s?|a partir|comeca(r|ndo)?|inicia(r|ndo)?|entre|abre|abrir)\s*(as|a|o|hoje|amanha|de)?\s*$/.test(antes)) return 'inicio';
      if (/\bde\s*$/.test(antes)) return 'inicio?';
      return null;
    };

    const instantes = [];
    for (let i = 0; i < marcasHora.length; i++) {
      const h = marcasHora[i];
      let papel = papelAntes(h.pos);
      if (papel === 'inicio?') papel = i + 1 < marcasHora.length ? 'inicio' : null;
      if (!papel && i > 0 && /^\s*(as|a|e|ate)\s*$/.test(n.slice(marcasHora[i - 1].end, h.pos))) papel = 'fim';
      if (!papel && i + 1 < marcasHora.length && /^\s*(as|a|e|ate)\s*$/.test(n.slice(h.end, marcasHora[i + 1].pos))) papel = 'inicio';
      // dia mais próximo: antes (preferência) ou logo depois
      let dia = null;
      for (const d of marcasDia) if (d.pos < h.pos) dia = d;
      if (!dia) for (const d of marcasDia) if (d.pos > h.pos && d.pos - h.end < 30) { dia = d; break; }
      if (dia) dia.usado = true;
      if (!papel && dia && papelAntes(dia.pos) && papelAntes(dia.pos) !== 'inicio?') papel = papelAntes(dia.pos);
      let min = (dia ? dia.inicio : hoje) + h.minutos;
      if (!dia && min < agora - 30) min += 1440; // "volta às 9h" dito à tarde = amanhã
      instantes.push({ min, papel, temHora: true, temDia: !!dia, pos: h.pos });
    }
    for (const d of marcasDia) {
      if (d.usado) continue;
      let papel = papelAntes(d.pos);
      if (papel === 'inicio?') papel = 'inicio';
      instantes.push({ min: d.inicio, papel, temHora: false, temDia: true, pos: d.pos, diaInteiro: true });
    }
    instantes.sort((a, b) => a.pos - b.pos);

    const faixas = periodos.map((p) => {
      let dia = null;
      for (const d of marcasDia) if (Math.abs(d.pos - p.pos) < 40) { dia = d; break; }
      const base = dia ? dia.inicio : hoje;
      if (p.faixa === 'ponta') return { ponta: true, base };
      return { ini: base + p.faixa[0], fim: base + p.faixa[1], base };
    });

    const dias = [];
    for (const d of marcasDia) for (const x of d.multi || [d.inicio]) if (!dias.includes(x)) dias.push(x);
    return { instantes, faixas, duracoes: dur, dias, semanaToda };
  };

  // ------------------------------------------------------------------ números
  function quantidades(n) {
    const limpo = n.replace(/\bp\s?-?\s?\d{2,5}\b/g, ' ').replace(/\b\d{1,2}\s?(h|:)\s?\d{0,2}\b/g, ' ').replace(/\b\d{1,2}\/\d{1,2}(\/\d{2,4})?\b/g, ' ');
    const r = { numeros: [], pct: null, kw: null };
    let m;
    const reK = /\b(\d+(?:[.,]\d+)?)\s?kw\b/g;
    while ((m = reK.exec(limpo))) r.kw = U.numeroBR(m[1]);
    const reP = /\b(\d+(?:[.,]\d+)?)\s?%/g;
    while ((m = reP.exec(limpo))) r.pct = U.numeroBR(m[1]) / 100;
    const reN = /\b(\d+(?:[.,]\d+)?)\b(?!\s?(?:kw|%|dias?|horas?|h\b|min))/g;
    while ((m = reN.exec(limpo))) r.numeros.push({ v: U.numeroBR(m[1]), pos: m.index });
    return r;
  }

  // ------------------------------------------------------------------ montagem do evento
  const fmtHM = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  /** Turno normal do dia (menor abertura e maior fechamento das máquinas que não são 24 h). */
  function turnoPadrao(cen, diaMin, qualquerDia) {
    const dow = U.partes(diaMin).dow;
    let ini = Infinity, fim = -Infinity;
    for (const m of cen.maquinas || []) {
      const { janelas } = U.parseJanela(m.janela);
      if (U.janela24h(janelas)) continue;
      for (const j of janelas) if (qualquerDia || j.dias[dow]) { ini = Math.min(ini, j.ini); fim = Math.max(fim, Math.min(j.fim, 1440)); }
    }
    return Number.isFinite(ini) ? { ini: fmtHM(ini), fim: fmtHM(fim) } : { ini: '06:00', fim: '22:00' };
  }

  function acharPedidoModelo(n, cen, ids) {
    if (ids.length) return ids[0];
    let best = null, bestS = 0;
    for (const p of cen.pedidos || []) {
      const palavras = U.normalizar(p.produto || '').split(/[^a-z]+/).filter((w) => w.length >= 4);
      let s = 0;
      for (const w of palavras) { const raiz = w.slice(0, Math.max(4, w.length - 2)); if (n.includes(raiz)) s += w.length; }
      if (s > bestS) { bestS = s; best = p.id; }
    }
    return best;
  }

  IA.montarEvento = function (tipo, textoOriginal, cen, agora, dic) {
    const n = U.normalizar(textoOriginal);
    const tempo = IA.extrairTempo(n, agora);
    const maq = IA.acharMaquina(n, dic);
    const ped = IA.acharPedidos(textoOriginal, cen);
    const qt = quantidades(n);
    const ev = { tipo, texto: textoOriginal.trim(), avisos: [] };
    const primeiro = (papel) => tempo.instantes.find((i) => i.papel === papel);
    const pedidoDoCliente = () => (ped.cliente ? (cen.pedidos || []).filter((p) => p.cliente === ped.cliente && !p.cancelado).map((p) => p.id) : []);
    const fmt = U.fmtDT;

    switch (tipo) {
      case 'maquina_indisponivel': {
        ev.maquina = maq ? maq.id : null;
        if (!maq) ev.avisos.push('Não identifiquei a máquina. Escolha na lista.');
        ev.unidade = maq ? (maq.unidade || (maq.unidades > 1 ? 1 : null)) : null;
        if (maq && maq.unidades > 1 && !maq.unidade) ev.avisos.push(`A máquina tem ${maq.unidades} unidades; considerei a unidade 1.`);
        const f0 = tempo.faixas.find((f) => !f.ponta);
        let ini = primeiro('inicio') ? primeiro('inicio').min : f0 ? f0.ini : agora;
        if (ini < agora && !primeiro('inicio')) ini = agora;
        let fimI = primeiro('fim');
        if (!fimI) {
          const neutros = tempo.instantes.filter((i) => !i.papel);
          if (neutros.length && /volta|retorn|religa|\bate\b|chega|previs|conserto|so amanha|liberad/.test(n)) fimI = neutros[neutros.length - 1];
        }
        let fim;
        if (fimI) fim = fimI.diaInteiro ? fimI.min + 1440 : fimI.min;
        else if (tempo.duracoes.length && tempo.duracoes[0].tipo !== 'em') fim = ini + tempo.duracoes[0].minutos;
        else if (f0) fim = f0.fim;
        else { fim = ini + 240; ev.avisos.push('Não achei quando a máquina volta; estimei 4 horas.'); }
        if (fim <= ini) fim = ini + 240;
        ev.inicio = fmt(ini); ev.fim = fmt(fim);
        break;
      }
      case 'maquina_disponivel': {
        ev.maquina = maq ? maq.id : null;
        ev.unidade = maq ? maq.unidade : null;
        if (!maq) ev.avisos.push('Não identifiquei a máquina. Escolha na lista.');
        const i = tempo.instantes[0];
        ev.inicio = fmt(i && i.min > agora ? i.min : agora);
        break;
      }
      case 'mudar_prazo': {
        const ids = ped.ids.length ? ped.ids : pedidoDoCliente();
        ev.pedido = ids[0] || null;
        if (!ev.pedido) ev.avisos.push('Não identifiquei o pedido.');
        if (ids.length > 1 && !ped.ids.length) ev.avisos.push(`O cliente tem ${ids.length} pedidos; escolhi ${ids[0]}.`);
        const p = (cen.pedidos || []).find((x) => x.id === ev.pedido);
        const prazoAtual = p ? U.parseDT(p.prazo) : NaN;
        const desl = /\b(\d+|um|uma|dois|duas|tres)\s+dias?\s+(antes|depois|a mais|a menos)\b/.exec(n);
        const emDias = tempo.duracoes.find((d) => d.tipo === 'em' && d.minutos >= 1440);
        const inst = tempo.instantes.length ? tempo.instantes[tempo.instantes.length - 1] : null;
        if (inst) {
          let min = inst.min;
          if (!inst.temHora) min += Number.isFinite(prazoAtual) ? ((prazoAtual % 1440) + 1440) % 1440 : 18 * 60;
          ev.prazo = fmt(min);
        } else if (desl && Number.isFinite(prazoAtual)) {
          const k = valorNum(desl[1]) * 1440;
          ev.prazo = fmt(prazoAtual + (/antes|menos/.test(desl[2]) ? -k : k));
        } else if (emDias && Number.isFinite(prazoAtual)) {
          ev.prazo = fmt(prazoAtual + (/antecip|adiant/.test(n) ? -emDias.minutos : emDias.minutos));
        } else {
          ev.prazo = Number.isFinite(prazoAtual) ? fmt(prazoAtual) : null;
          ev.avisos.push('Não achei a nova data; ajuste o prazo.');
        }
        break;
      }
      case 'novo_pedido': {
        const modeloId = acharPedidoModelo(n, cen, ped.ids);
        const modelo = (cen.pedidos || []).find((p) => p.id === modeloId);
        ev.modelo = modeloId;
        if (!modelo) ev.avisos.push('Não achei um produto parecido para copiar as etapas.');
        const q = qt.numeros.find((x) => x.v >= 1);
        ev.quantidade = q ? q.v : modelo ? modelo.quantidade : null;
        ev.cliente = ped.cliente || (/(cliente novo|novo cliente)/.test(n) ? 'Cliente novo' : modelo ? modelo.cliente : 'Cliente');
        ev.produto = modelo ? modelo.produto : 'Produto';
        const inst = tempo.instantes.length ? tempo.instantes[tempo.instantes.length - 1] : null;
        if (inst) ev.prazo = fmt(inst.temHora ? inst.min : inst.min + 18 * 60);
        else { ev.prazo = fmt(U.inicioDoDia(agora) + 2 * 1440 + 18 * 60); ev.avisos.push('Sem prazo na mensagem; sugeri daqui a 2 dias, 18h.'); }
        break;
      }
      case 'mudar_quantidade': {
        const ids = ped.ids.length ? ped.ids : pedidoDoCliente();
        ev.pedido = ids[0] || null;
        if (!ev.pedido) ev.avisos.push('Não identifiquei o pedido.');
        const p = (cen.pedidos || []).find((x) => x.id === ev.pedido);
        const atual = p ? +p.quantidade : NaN;
        let nova = null;
        if (/metade/.test(n)) nova = atual * 0.5;
        else if (/dobr/.test(n)) nova = atual * 2;
        else if (/triplic/.test(n)) nova = atual * 3;
        else if (qt.pct != null && Number.isFinite(atual)) nova = /reduz|cort|diminu|menos|caiu/.test(n) ? atual * (1 - qt.pct) : atual * (1 + qt.pct);
        else if (/acrescent|mais\s+\d|adicion|somar/.test(n) && qt.numeros.length && Number.isFinite(atual)) nova = atual + qt.numeros[qt.numeros.length - 1].v;
        else if (qt.numeros.length) nova = qt.numeros[qt.numeros.length - 1].v;
        ev.quantidade = nova != null && Number.isFinite(nova) ? Math.round(nova) : null;
        if (ev.quantidade == null) ev.avisos.push('Não achei a nova quantidade.');
        break;
      }
      case 'cancelar_pedido': {
        ev.pedidos = ped.ids.length ? ped.ids : pedidoDoCliente();
        if (!ev.pedidos.length) ev.avisos.push('Não identifiquei o pedido.');
        if (!ped.ids.length && ev.pedidos.length > 1) ev.avisos.push('Marquei todos os pedidos desse cliente; desmarque os que continuam.');
        break;
      }
      case 'previsao_solar': {
        let fator = 0.7;
        if (/tempestade|chuva forte|chover muito|temporal/.test(n)) fator = 0.15;
        else if (/chuv|chove|garoa|pancada|frente fria|fechado/.test(n)) fator = 0.25;
        else if (/sol entre nuvens|parcialmente|algumas nuvens|meio nublado/.test(n)) fator = 0.6;
        else if (/nublad|nuve|encobert/.test(n)) fator = 0.35;
        else if (/sol forte|ensolarad|ceu limpo|ceu aberto|tempo aberto|sol\b|limpo/.test(n)) fator = 1.0;
        ev.fator = fator;
        ev.dias = (tempo.dias.length ? tempo.dias : [U.inicioDoDia(agora)]).map((d) => U.fmtData(d));
        if (/a partir d/.test(n) && tempo.dias.length === 1) ev.aPartir = true;
        if (tempo.semanaToda) ev.semanaToda = true;
        break;
      }
      case 'limite_demanda': {
        ev.limiteKW = qt.kw;
        ev.reducaoPct = qt.kw == null ? (qt.pct != null ? qt.pct : 0.2) : null;
        if (qt.kw == null && qt.pct == null) ev.avisos.push('Sem valor na mensagem; considerei reduzir 20% do pico.');
        const f0 = tempo.faixas[0];
        let ini = primeiro('inicio') ? primeiro('inicio').min : null, fim = primeiro('fim') ? primeiro('fim').min : null;
        const base = tempo.dias.length ? tempo.dias[0] : U.inicioDoDia(agora);
        if (f0 && f0.ponta) {
          const tar = cen.tarifa || { ponta: { inicio: '17:30', fim: '20:30' } };
          ini = f0.base + U.parseHora(tar.ponta.inicio); fim = f0.base + U.parseHora(tar.ponta.fim);
        } else if (ini == null && fim == null && f0) { ini = f0.ini; fim = f0.fim; }
        if (ini == null) ini = fim != null && /\bate\b/.test(n) ? agora : base;
        if (fim == null) fim = tempo.instantes.length === 1 && !tempo.instantes[0].temHora && tempo.instantes[0].papel === 'fim' ? tempo.instantes[0].min + 1440 : U.inicioDoDia(ini) + 1440;
        if (ini < agora && U.inicioDoDia(ini) === U.inicioDoDia(agora)) ini = agora;
        if (fim <= ini) fim = ini + 180;
        ev.inicio = fmt(ini); ev.fim = fmt(fim);
        break;
      }
      case 'mudar_turno': {
        ev.dias = (tempo.dias.length ? tempo.dias : [U.inicioDoDia(agora)]).map((d) => U.fmtData(d));
        ev.fechado = /nao (havera|tera|vai ter|vamos ter|teremos)|sem (expediente|producao|turno)|folga|feriado|fechad|nao vamos trabalhar|parar|inventario|cancelad/.test(n) && !/ate\s+\d|das\s+\d/.test(n);
        if (/fechar mais cedo|vai ate|expediente vai ate/.test(n)) ev.fechado = false;
        const hs = tempo.instantes.filter((i) => i.temHora);
        const ini = hs.find((i) => i.papel === 'inicio'), fim = hs.find((i) => i.papel === 'fim') || (hs.length >= 2 ? hs[1] : null);
        const minDia = (x) => ((x.min % 1440) + 1440) % 1440;
        const padrao = turnoPadrao(cen, U.parseDT(ev.dias[0]));
        if (/dia todo|dia inteiro/.test(n)) { const cheio = turnoPadrao(cen, U.parseDT(ev.dias[0]), true); ev.inicio = cheio.ini; ev.fim = cheio.fim; }
        else {
          ev.inicio = ini ? U.fmtHora(ini.min) : padrao.ini;
          ev.fim = fim ? (minDia(fim) === 0 ? '24:00' : U.fmtHora(fim.min)) : hs.length === 1 && !ini ? U.fmtHora(hs[0].min) : padrao.fim;
          if (/comeca|abre|inicia/.test(n) && hs.length === 1) { ev.inicio = U.fmtHora(hs[0].min); ev.fim = padrao.fim; }
        }
        if (/sexta a tarde|a tarde para|parar .* tarde/.test(n) && ev.fechado) { ev.fechado = false; ev.inicio = padrao.ini; ev.fim = '12:00'; }
        break;
      }
      default: break;
    }
    return ev;
  };

  /** Divide em frases, classifica cada uma e extrai os dados. */
  IA.interpretar = function (texto, cen) {
    const dic = IA.dicionario(cen);
    IA.treinar(dic);
    const agora = U.parseDT(cen.agora || cen.inicio);
    const frases = String(texto || '').split(/[\n;]+|(?<=[.!?])\s+/).map((s) => s.trim()).filter((s) => s.length > 1);
    const eventos = [];
    for (const f of frases) {
      const c = IA.classificar(f, dic);
      const tipo = c.confianca < 0.34 ? 'desconhecido' : c.intencao;
      const ev = IA.montarEvento(tipo, f.replace(/[.!?]+$/, ''), cen, agora, dic);
      ev.confianca = c.confianca;
      ev.origem = 'IA local';
      ev.alternativas = Object.entries(c.probs || {}).sort((a, b) => b[1] - a[1]).slice(0, 3);
      eventos.push(ev);
    }
    return eventos;
  };

  IA._caracteristicas = caracteristicas;
})(typeof window !== 'undefined' ? window : globalThis);
