/* Carga Certa — ponte com o engenheiro: pedido de avaliação, fila por impacto e parecer.
 *
 *  1) A fábrica monta um pedido com o cenário, a agenda e o diagnóstico prontos.
 *  2) O engenheiro vê a fila ordenada pela economia possível (em R$ ou em % da conta) e destacada
 *     pela especialidade dele, e escolhe onde ajudar.
 *  3) Para cada recomendação, ele segue a lista do que conferir em campo (o que a ferramenta não sabe
 *     sozinha) e decide: aprovar, aprovar com ajuste ou não aprovar.
 *  4) O parecer volta para a fábrica com nome e registro do engenheiro. Uma "impressão digital" dos dados
 *     mostra se o cenário mudou depois do parecer.
 *
 *  Só lógica, sem tela: pode ser testado no Node.
 */
(function (G) {
  'use strict';
  const CC = G.CC = G.CC || {};
  const U = CC.util;
  const R = CC.revisao = {};

  R.AREAS = {
    planejamento: 'Planejamento da produção',
    tarifa: 'Tarifa',
    demanda: 'Demanda contratada',
    solar: 'Geração solar',
    qualidade: 'Fator de potência',
  };

  R.DECISOES = {
    aprovada: { rotulo: 'Aprovar', tag: 'aprovada', classe: 'ok' },
    ajuste: { rotulo: 'Aprovar com ajuste', tag: 'aprovada com ajuste', classe: 'alerta' },
    recusada: { rotulo: 'Não aprovar', tag: 'não aprovada', classe: 'ruim' },
  };

  R.STATUS = {
    aguardando: { texto: 'aguardando', classe: '' },
    revisao: { texto: 'em revisão', classe: 'alerta' },
    parecer: { texto: 'parecer emitido', classe: 'ok' },
  };

  // O que o engenheiro confere antes de assinar: o que só dá para saber com fatura, placa, medição ou vistoria.
  const CONFERIR = {
    agenda: [
      'Confirmar com o encarregado se a nova sequência é viável: troca de ferramenta, preparação das máquinas e pessoas em cada turno.',
      'Conferir a potência real das máquinas (placa ou medição com alicate amperímetro) e as horas de cada etapa.',
      'Ver se algum horário novo cria custo que a conta de luz não mostra, como hora extra ou adicional noturno.',
    ],
    modalidade: [
      'Pedir as 12 últimas faturas e refazer a comparação mês a mês, não só com a semana analisada.',
      'Confirmar com a distribuidora as condições da troca: medidor, prazos e quando é possível voltar.',
      'Combinar com a fábrica a disciplina de horário que a nova tarifa exige; sem ela, a conta pode subir.',
    ],
    demanda: [
      'Conferir nas 12 últimas faturas a demanda medida de cada mês. Se algum mês passar de 105% do novo valor, haverá multa.',
      'Considerar o crescimento previsto da produção e a partida de motores grandes.',
      'Confirmar com a distribuidora os prazos e as condições para alterar o contrato (REN 1.000/2021).',
    ],
    solar: [
      'Vistoriar o telhado: área útil, orientação, sombreamento e se a estrutura aguenta o peso dos módulos.',
      'Consultar a distribuidora sobre a conexão e o limite de injeção no ponto de entrega.',
      'Medir a tensão no ponto de conexão ao longo do dia para confirmar o corte por volt-watt previsto.',
      'Refazer o retorno do investimento com orçamentos reais de módulos, inversores e instalação.',
    ],
    'solar-demanda': [
      'Decidir com a fábrica entre reduzir a demanda contratada e ter uma usina maior: no grupo A, a potência dos inversores fica limitada à demanda contratada.',
      'Comparar as duas opções com a fatura real antes de mexer no contrato.',
    ],
    reativo: [
      'Medir com analisador de energia por pelo menos 7 dias: kW, kvar, fator de potência e harmônicas.',
      'Checar harmônicas antes de instalar capacitores: inversores de frequência e os da solar podem causar ressonância (pode ser preciso reator de dessintonia).',
      'Definir o ponto de instalação e o controlador automático por estágios.',
    ],
  };
  const ART = { solar: true, reativo: true };

  // Quem faz o quê depois do parecer: o engenheiro valida, mas outras pessoas decidem, executam e aprovam.
  const QUEM_FAZ = {
    agenda: {
      decide: 'dono ou gerente da fábrica',
      executa: 'encarregado de produção, que segue a agenda e avisa os imprevistos na aba Eventos do dia',
      aprova: 'não depende de aprovação de fora',
      atencao: 'turno da noite custa mais (adicional noturno de pelo menos 20%, CLT art. 73) e a equipe precisa aceitar a mudança de horário',
    },
    modalidade: {
      decide: 'dono da fábrica, depois da conferência do engenheiro',
      executa: 'pedido de troca de modalidade à distribuidora',
      aprova: 'distribuidora, que pode precisar trocar o medidor',
      atencao: 'sem disciplina de horário a conta pode subir; confirmar com a distribuidora as regras para voltar',
    },
    demanda: {
      decide: 'dono, com a validação do engenheiro',
      executa: 'pedido de alteração do contrato à distribuidora',
      aprova: 'distribuidora',
      atencao: 'respeitar os prazos e a carência para alterar o contrato (REN 1.000/2021); se a produção crescer, a multa de ultrapassagem volta',
    },
    solar: {
      decide: 'dono, com o retorno refeito a partir de orçamentos reais',
      executa: 'empresa instaladora',
      aprova: 'engenheiro assina o projeto (ART) e a distribuidora aprova a conexão',
      atencao: 'o investimento inicial é alto (há linhas de crédito para geração solar) e o limite de injeção é a distribuidora que define',
    },
    'solar-demanda': {
      decide: 'dono e engenheiro, juntos: usina maior ou demanda contratada menor',
      executa: 'depende da escolha: instaladora ou pedido à distribuidora',
      aprova: 'engenheiro',
      atencao: 'as duas medidas disputam o mesmo limite de potência',
    },
    reativo: {
      decide: 'dono da fábrica',
      executa: 'eletricista instala o banco de capacitores, depois da medição de harmônicas',
      aprova: 'engenheiro, com projeto e ART',
      atencao: 'harmônicas de inversores podem exigir reator de dessintonia, o que encarece o banco',
    },
  };
  R.QUEM_FAZ_ROTULOS = [['decide', 'Decide'], ['executa', 'Executa'], ['aprova', 'Aprova'], ['atencao', 'Atenção']];

  /** Lê uma chave só se ela for do próprio objeto (dados de arquivo não alcançam __proto__ e afins). */
  R.de = (obj, k) => (typeof k === 'string' && Object.prototype.hasOwnProperty.call(obj, k) ? obj[k] : null);
  const ID_ITEM = /^[a-z][a-z0-9-]{0,39}$/;

  const tipo = (id) => String(id).replace(/-\d+$/, ''); // 'demanda-1' → 'demanda'
  R.conferir = (id) => (R.de(CONFERIR, tipo(id)) || []).slice();
  R.exigeART = (id) => !!R.de(ART, tipo(id));
  /** { decide, executa, aprova, atencao } da recomendação, ou null. */
  R.quemFaz = (id) => { const q = R.de(QUEM_FAZ, tipo(id)); return q ? Object.assign({}, q) : null; };
  /** "Decide: …; executa: …; aprova: …; atenção: …" numa linha (relatório e resumo em texto). */
  R.quemFazTexto = function (id) {
    const q = R.quemFaz(id);
    if (!q) return '';
    return R.QUEM_FAZ_ROTULOS.map(([k, r], i) => `${i ? r.toLowerCase() : r}: ${q[k]}`).join('; ') + '.';
  };

  const txt = (v, max) => String(v == null ? '' : v).trim().slice(0, max || 200);
  const numero = (v) => (Number.isFinite(+v) ? +v : 0);

  /** Economia possível de um conjunto de recomendações. Se a solar disputa a demanda contratada, vale só a maior. */
  R.economiaPossivel = function (itens) {
    const porArea = {};
    for (const i of itens || []) porArea[i.area] = (porArea[i.area] || 0) + Math.max(0, numero(i.economiaMes));
    const conflito = (itens || []).some((i) => i.conflito);
    let total = 0;
    for (const [a, v] of Object.entries(porArea)) if (!conflito || (a !== 'demanda' && a !== 'solar')) total += v;
    if (conflito) total += Math.max(porArea.demanda || 0, porArea.solar || 0);
    return { total, porArea, conflito };
  };

  // ---------------------------------------------------------------- impressão digital dos dados
  function estavel(v) {
    if (Array.isArray(v)) return '[' + v.map((x) => estavel(x === undefined ? null : x)).join(',') + ']';
    if (v && typeof v === 'object') {
      return '{' + Object.keys(v).sort().filter((k) => v[k] !== undefined && typeof v[k] !== 'function')
        .map((k) => JSON.stringify(k) + ':' + estavel(v[k])).join(',') + '}';
    }
    const s = JSON.stringify(v);
    return s === undefined ? 'null' : s;
  }
  function fnv1a(s) {
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return ('0000000' + h.toString(16)).slice(-8);
  }
  /**
   * Muda se qualquer dado da fábrica ou da agenda mudar. Ignora a parte de revisão (pedido e parecer),
   * o relógio simulado ("agora"), as faturas do acompanhamento e o fator de emissão do CO2:
   * nenhum deles muda as recomendações.
   */
  R.assinaturaDados = function (cen, planos) {
    const c = Object.assign({}, cen);
    delete c.revisao; delete c.agora; delete c.acompanhamento; delete c.impacto;
    return fnv1a(estavel({ c, b: planos ? planos.base : null, o: planos ? planos.otim : null }));
  };

  // ---------------------------------------------------------------- diagnóstico em JSON
  R.serializarDiag = function (diag) {
    if (!diag || !diag.modalidades || !diag.solar) return null;
    return U.clonar(diag); // retorno simples infinito vira null
  };
  /** Refaz as referências (melhor modalidade e usina sugerida apontam para linhas da tabela). */
  R.restaurarDiag = function (d) {
    if (!d || !d.modalidades || !d.solar || !Array.isArray(d.modalidades.linhas) || !Array.isArray(d.solar.linhas)) return null;
    const diag = U.clonar(d);
    const m = diag.modalidades, s = diag.solar;
    m.melhor = m.melhor ? m.linhas.find((l) => l.mod === m.melhor.mod) || null : null;
    s.recomendado = s.recomendado ? s.linhas.find((l) => l.kWp === s.recomendado.kWp) || null : null;
    for (const l of s.linhas) if (l.payback == null) l.payback = Infinity;
    if (!m.melhor || !s.recomendado) return null;
    return diag;
  };

  // ---------------------------------------------------------------- pedido
  R.novoId = () => 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  /**
   * Pedido de avaliação. o = { cen, planos, diag, avBase, avOtim, itens, meta: { id?, cidade, contato, mensagem }, agora? }
   * O cenário vai junto (com a agenda e o diagnóstico) para o engenheiro abrir o caso sem recalcular nada.
   */
  R.montarPedido = function (o) {
    const meta = o.meta || {};
    const eco = R.economiaPossivel(o.itens);
    const id = meta.id || R.novoId();
    const criadoEm = (o.agora || new Date()).toISOString();
    const dados = { id, criadoEm, cidade: txt(meta.cidade, 80), contato: txt(meta.contato, 120), mensagem: txt(meta.mensagem, 600) };
    const cenario = U.clonar(o.cen);
    cenario.revisao = { pedido: dados };
    return {
      formato: 'carga-certa-pedido', versao: 1,
      id, criadoEm, empresa: txt(o.cen.nome, 120), cidade: dados.cidade, contato: dados.contato, mensagem: dados.mensagem,
      modalidade: o.cen.tarifa.modalidade,
      contaHoje: o.avBase.contaMes, contaPlanejada: o.avOtim.contaMes,
      economiaMes: eco.total, percentual: o.avBase.contaMes > 0 ? eco.total / o.avBase.contaMes : 0,
      porArea: eco.porArea, conflito: eco.conflito,
      itens: o.itens.map((i) => ({ id: i.id, area: i.area, texto: i.texto, economiaMes: numero(i.economiaMes), investimento: numero(i.investimento), valor: i.valor == null ? null : i.valor, conflito: !!i.conflito })),
      assinatura: R.assinaturaDados(o.cen, o.planos),
      cenario, planos: U.clonar(o.planos), diag: R.serializarDiag(o.diag),
      status: 'aguardando', rascunho: null, parecer: null,
    };
  };

  /** Confere um pedido vindo de arquivo. Devolve a mensagem de erro, ou '' se estiver bom. */
  R.validarPedido = function (j) {
    if (!j || j.formato !== 'carga-certa-pedido') return 'Esse arquivo não é um pedido de avaliação do Carga Certa.';
    if (!j.cenario || !Array.isArray(j.cenario.maquinas) || !j.cenario.tarifa) return 'O pedido não tem os dados da fábrica.';
    if (!j.planos || !j.planos.base || !j.planos.otim) return 'O pedido não tem a agenda planejada.';
    if (!Array.isArray(j.itens) || !j.itens.length || j.itens.length > 20) return 'O pedido não tem recomendações para avaliar.';
    if (j.itens.some((i) => !i || !ID_ITEM.test(i.id) || !R.de(R.AREAS, i.area))) return 'As recomendações do pedido estão num formato desconhecido.';
    if (new Set(j.itens.map((i) => i.id)).size !== j.itens.length) return 'O pedido tem recomendações repetidas.';
    return '';
  };

  /** Limpa um pedido importado: textos com tamanho máximo, números válidos, rascunho local zerado. */
  R.prepararImportado = function (j) {
    const p = U.clonar(j);
    p.id = typeof p.id === 'string' && /^[\w-]{1,40}$/.test(p.id) ? p.id : R.novoId();
    p.criadoEm = Number.isFinite(Date.parse(p.criadoEm)) ? p.criadoEm : new Date().toISOString();
    for (const k of ['empresa', 'cidade', 'contato']) p[k] = txt(p[k], 120);
    p.mensagem = txt(p.mensagem, 600);
    for (const k of ['contaHoje', 'contaPlanejada']) p[k] = numero(p[k]);
    p.itens = p.itens.map((i) => ({ id: txt(i.id, 40), area: i.area, texto: txt(i.texto, 800), economiaMes: numero(i.economiaMes), investimento: numero(i.investimento), valor: i.valor == null ? null : numero(i.valor), conflito: !!i.conflito }));
    const eco = R.economiaPossivel(p.itens);
    p.economiaMes = eco.total; p.porArea = eco.porArea; p.conflito = eco.conflito;
    p.percentual = p.contaHoje > 0 ? eco.total / p.contaHoje : 0;
    p.cenario.revisao = { pedido: { id: p.id, criadoEm: p.criadoEm, cidade: p.cidade, contato: p.contato, mensagem: p.mensagem } };
    p.assinatura = R.assinaturaDados(p.cenario, p.planos); // recalculada aqui: não confia na do arquivo
    p.status = 'aguardando'; p.rascunho = null; p.parecer = null;
    return p;
  };

  // ---------------------------------------------------------------- fila
  R.areasDoPedido = (p) => Array.from(new Set((p.itens || []).map((i) => i.area)));
  /** Quantas áreas do pedido combinam com as especialidades do engenheiro. */
  R.combina = function (p, especialidades) {
    const s = especialidades instanceof Set ? especialidades : new Set(especialidades || []);
    return R.areasDoPedido(p).filter((a) => s.has(a)).length;
  };
  /**
   * Ordena a fila. criterio: 'reais' (economia por mês), 'percentual' (economia em % da conta,
   * prioriza negócios menores) ou 'antigos' (ordem de chegada). Pedidos com parecer vão para o fim.
   */
  R.ordenar = function (fila, criterio, especialidades, soCombina) {
    const esp = new Set(especialidades || []);
    let lista = (fila || []).slice();
    if (soCombina && esp.size) lista = lista.filter((p) => R.combina(p, esp) > 0);
    const chaves = {
      reais: (p) => -numero(p.economiaMes),
      percentual: (p) => -numero(p.percentual),
      antigos: (p) => Date.parse(p.criadoEm) || 0,
    };
    const chave = chaves[criterio] || chaves.reais;
    return lista.sort((a, b) => ((a.status === 'parecer') - (b.status === 'parecer')) || (chave(a) - chave(b)));
  };

  // ---------------------------------------------------------------- parecer
  /** Problemas que impedem emitir o parecer (lista vazia = pode emitir). */
  R.validarParecer = function (pedido, rascunho, engenheiro) {
    const prob = [];
    const dec = (rascunho && rascunho.decisoes) || {};
    pedido.itens.forEach((it, i) => {
      const d = R.de(dec, it.id);
      if (!d || !R.de(R.DECISOES, d.decisao)) prob.push(`Escolha uma decisão para a recomendação ${i + 1}.`);
      else if (d.decisao !== 'aprovada' && txt(d.nota, 2000).length < 5) prob.push(`Explique ${d.decisao === 'ajuste' ? 'o ajuste' : 'o motivo'} na recomendação ${i + 1}.`);
    });
    if (!engenheiro || txt(engenheiro.nome).length < 3) prob.push('Preencha seu nome no perfil (no alto desta aba).');
    return prob;
  };

  R.montarParecer = function (pedido, rascunho, engenheiro, agora) {
    const dec = (rascunho && rascunho.decisoes) || {};
    const itens = pedido.itens.map((it) => {
      const d = R.de(dec, it.id) || {};
      const total = R.conferir(it.id).length;
      const conferidos = Array.from(new Set((d.conferidos || []).filter((k) => Number.isInteger(k) && k >= 0 && k < total))).sort((a, b) => a - b);
      return { id: it.id, area: it.area, texto: it.texto, economiaMes: it.economiaMes, decisao: R.de(R.DECISOES, d.decisao) ? d.decisao : null, nota: txt(d.nota, 1000), conferidos, totalConferir: total };
    });
    const conta = (k) => itens.filter((i) => i.decisao === k).length;
    return {
      emitidoEm: (agora || new Date()).toISOString(),
      engenheiro: { nome: txt(engenheiro.nome, 80), registro: txt(engenheiro.registro, 40), organizacao: txt(engenheiro.organizacao, 80) },
      itens, observacoes: txt(rascunho && rascunho.observacoes, 1500),
      resumo: { aprovadas: conta('aprovada'), ajustes: conta('ajuste'), recusadas: conta('recusada') },
      assinatura: pedido.assinatura, pedidoId: pedido.id,
    };
  };

  /** "2 aprovadas, 1 com ajuste e 1 não aprovada" */
  R.textoResumo = function (r) {
    const partes = [];
    if (r.aprovadas) partes.push(`${r.aprovadas} aprovada${r.aprovadas > 1 ? 's' : ''}`);
    if (r.ajustes) partes.push(`${r.ajustes} com ajuste`);
    if (r.recusadas) partes.push(`${r.recusadas} não aprovada${r.recusadas > 1 ? 's' : ''}`);
    if (!partes.length) return 'nenhuma recomendação avaliada';
    const ult = partes.pop();
    return partes.length ? `${partes.join(', ')} e ${ult}` : ult;
  };
})(typeof window !== 'undefined' ? window : globalThis);
