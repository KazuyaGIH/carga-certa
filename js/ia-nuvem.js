/* Carga Certa — interpretação de eventos com IA na nuvem (opcional).
 *
 *  - Gemini (Google AI Studio, tem plano gratuito): chamada REST direta do navegador.
 *  - Claude (Anthropic): SDK oficial @anthropic-ai/sdk carregado do CDN como módulo ES, com
 *    saída estruturada (JSON Schema) e fallback de recusa no servidor.
 * A chave é digitada pelo usuário e fica só no navegador dele (nunca vai para o repositório).
 * Qualquer resposta passa pela mesma normalização da IA local e o usuário confirma antes de aplicar.
 */
(function (G) {
  'use strict';
  const CC = G.CC = G.CC || {};
  const U = CC.util;
  const N = CC.iaNuvem = {};

  N.SDK_ANTHROPIC = 'https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk@1.3.0/+esm';
  N.MODELO_CLAUDE = 'claude-opus-5-5';
  N.MODELO_GEMINI = 'gemini-flash-latest';

  const TIPOS = ['maquina_indisponivel', 'maquina_disponivel', 'mudar_prazo', 'novo_pedido', 'mudar_quantidade', 'cancelar_pedido',
    'previsao_solar', 'limite_demanda', 'mudar_turno', 'desconhecido'];

  const CAMPOS_EVENTO = {
    tipo: { type: 'string', enum: TIPOS },
    texto: { type: 'string', description: 'Trecho da mensagem que gerou o evento.' },
    maquina: { type: 'string', description: 'ID da máquina, ou vazio.' },
    unidade: { type: 'integer', description: 'Número da unidade da máquina; 0 se não foi dito.' },
    pedido: { type: 'string', description: 'ID do pedido, ou vazio.' },
    pedidos: { type: 'array', items: { type: 'string' }, description: 'IDs dos pedidos (cancelamento).' },
    inicio: { type: 'string', description: 'AAAA-MM-DDTHH:MM (ou HH:MM em mudar_turno), ou vazio.' },
    fim: { type: 'string', description: 'AAAA-MM-DDTHH:MM (ou HH:MM em mudar_turno), ou vazio.' },
    prazo: { type: 'string', description: 'AAAA-MM-DDTHH:MM, ou vazio.' },
    quantidade: { type: 'number', description: 'Quantidade total; 0 se não se aplica.' },
    modelo: { type: 'string', description: 'ID do pedido existente mais parecido (para copiar as etapas de um pedido novo), ou vazio.' },
    cliente: { type: 'string' },
    dias: { type: 'array', items: { type: 'string' }, description: 'Datas AAAA-MM-DD.' },
    fator: { type: 'number', description: 'Geração solar em relação ao céu limpo, de 0 a 1; 0 se não se aplica.' },
    limiteKW: { type: 'number', description: 'Limite de potência em kW; 0 se não foi dito.' },
    reducaoPct: { type: 'number', description: 'Redução pedida, de 0 a 1; 0 se não se aplica.' },
    fechado: { type: 'boolean', description: 'true se não houver expediente no dia.' },
    explicacao: { type: 'string', description: 'Uma frase curta com as suposições feitas.' },
  };
  N.ESQUEMA = {
    type: 'object',
    properties: {
      eventos: {
        type: 'array',
        items: { type: 'object', properties: CAMPOS_EVENTO, required: Object.keys(CAMPOS_EVENTO), additionalProperties: false },
      },
    },
    required: ['eventos'],
    additionalProperties: false,
  };

  const INSTRUCOES = `Você ajuda o planejamento de produção de uma pequena indústria brasileira. Converta a mensagem do usuário (português do Brasil, linguagem de chão de fábrica) em eventos estruturados para o planejador.

Tipos de evento e campos usados por cada um:
- maquina_indisponivel: máquina quebrou, parou ou entrou em manutenção. Campos: maquina, unidade, inicio, fim (quando volta; se a mensagem não disser, estime e explique).
- maquina_disponivel: máquina voltou a funcionar. Campos: maquina, unidade, inicio (a partir de quando).
- mudar_prazo: o prazo de entrega mudou. Campos: pedido, prazo (se só o dia mudou, mantenha a hora do prazo atual).
- novo_pedido: chegou um pedido novo. Campos: modelo (ID do pedido existente com o produto mais parecido), quantidade, cliente, prazo.
- mudar_quantidade: a quantidade de um pedido mudou. Campos: pedido, quantidade (nova quantidade total).
- cancelar_pedido: pedido cancelado. Campo: pedidos (lista de IDs).
- previsao_solar: previsão do tempo que afeta a geração solar. Campos: dias, fator (1 = céu limpo, 0,6 = sol entre nuvens, 0,35 = nublado, 0,2 = chuva).
- limite_demanda: pedido para limitar ou reduzir a potência puxada da rede. Campos: limiteKW ou reducaoPct, inicio, fim.
- mudar_turno: expediente diferente em algum dia. Campos: dias, fechado, inicio e fim no formato HH:MM.
- desconhecido: a frase não descreve um evento.

Regras:
- Datas e horas no formato AAAA-MM-DDTHH:MM, no horário local da fábrica. "Hoje", "amanhã", "quinta", "à tarde" são relativos ao "Agora" informado abaixo.
- Use somente IDs de máquinas e pedidos que aparecem nas listas abaixo.
- Uma mensagem pode ter vários eventos: um por fato.
- Campos que não se aplicam ao tipo: texto vazio "", número 0, lista vazia [] e false.
- Em "texto", copie o trecho da mensagem que gerou o evento. Em "explicacao", diga numa frase curta qualquer suposição que fez.
Responda somente com o objeto JSON {"eventos": [...]}.`;

  function contextoFabrica(cen) {
    const agora = U.parseDT(cen.agora || cen.inicio);
    const t0 = U.parseDT(String(cen.inicio).slice(0, 10));
    const l = [];
    l.push(`Agora: ${U.fmtDT(agora)} (${U.DIAS_LONGOS[U.partes(agora).dow]}).`);
    l.push(`Semana planejada: ${U.fmtData(t0)} a ${U.fmtData(t0 + ((+cen.dias || 7) - 1) * 1440)}.`);
    l.push(`Horário de ponta da distribuidora: ${cen.tarifa.ponta.inicio} às ${cen.tarifa.ponta.fim}, dias úteis.`);
    l.push('Máquinas (ID | nome | unidades):');
    for (const m of cen.maquinas || []) l.push(`- ${m.id} | ${m.nome} | ${m.unidades}`);
    l.push('Pedidos (ID | cliente | produto | quantidade | prazo atual):');
    for (const p of (cen.pedidos || []).filter((x) => !x.cancelado)) l.push(`- ${p.id} | ${p.cliente} | ${p.produto} | ${p.quantidade} | ${p.prazo}`);
    return l.join('\n');
  }

  function extrairJSON(txt) {
    const s = String(txt || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
    const a = s.indexOf('{'), b = s.lastIndexOf('}');
    if (a < 0 || b <= a) throw new Error('A IA não devolveu JSON.');
    return JSON.parse(s.slice(a, b + 1));
  }

  /** Converte a resposta de qualquer IA para o formato interno de evento e valida IDs. */
  N.normalizar = function (ev, cen, origem) {
    const s = (x) => (typeof x === 'string' && x.trim() ? x.trim() : null);
    const n = (x) => { const v = typeof x === 'string' ? U.numeroBR(x) : +x; return Number.isFinite(v) && v !== 0 ? v : null; };
    const dt = (x) => { const v = s(x); if (!v) return null; const m = U.parseDT(v); return Number.isFinite(m) ? U.fmtDT(m) : null; };
    const hora = (x) => { const v = s(x); if (!v) return null; const m = /(\d{1,2}):(\d{2})\s*$/.exec(v); return m ? `${m[1].padStart(2, '0')}:${m[2]}` : null; };
    const idMaq = (x) => { const v = s(x); if (!v) return null; const m = (cen.maquinas || []).find((q) => U.normalizar(q.id) === U.normalizar(v) || U.normalizar(q.nome) === U.normalizar(v)); return m ? m.id : null; };
    const idPed = (x) => { const v = s(x); if (!v) return null; const p = (cen.pedidos || []).find((q) => U.normalizar(q.id) === U.normalizar(v)); return p ? p.id : null; };
    const agora = U.parseDT(cen.agora || cen.inicio);
    const tipo = TIPOS.includes(ev && ev.tipo) ? ev.tipo : 'desconhecido';
    const out = { tipo, texto: s(ev && ev.texto) || '', origem, confianca: null, avisos: [] };
    if (s(ev && ev.explicacao)) out.explicacao = s(ev.explicacao);
    const unidades = (id) => { const m = (cen.maquinas || []).find((q) => q.id === id); return m ? Math.max(1, +m.unidades || 1) : 1; };
    switch (tipo) {
      case 'maquina_indisponivel':
      case 'maquina_disponivel':
        out.maquina = idMaq(ev.maquina);
        if (!out.maquina) out.avisos.push('Máquina não reconhecida; escolha na lista.');
        out.unidade = n(ev.unidade);
        if (out.maquina && !out.unidade && unidades(out.maquina) > 1 && tipo === 'maquina_indisponivel') { out.unidade = 1; out.avisos.push('Unidade não informada; considerei a 1.'); }
        out.inicio = dt(ev.inicio) || U.fmtDT(agora);
        if (tipo === 'maquina_indisponivel') out.fim = dt(ev.fim) || U.fmtDT(U.parseDT(out.inicio) + 240);
        break;
      case 'mudar_prazo': out.pedido = idPed(ev.pedido); out.prazo = dt(ev.prazo); break;
      case 'novo_pedido': {
        out.modelo = idPed(ev.modelo); out.quantidade = n(ev.quantidade); out.cliente = s(ev.cliente); out.prazo = dt(ev.prazo);
        const m = (cen.pedidos || []).find((p) => p.id === out.modelo);
        out.produto = m ? m.produto : null;
        break;
      }
      case 'mudar_quantidade': out.pedido = idPed(ev.pedido); out.quantidade = n(ev.quantidade); break;
      case 'cancelar_pedido': {
        const lista = Array.isArray(ev.pedidos) && ev.pedidos.length ? ev.pedidos : [ev.pedido];
        out.pedidos = lista.map(idPed).filter(Boolean);
        break;
      }
      case 'previsao_solar':
        out.dias = (Array.isArray(ev.dias) ? ev.dias : []).map((d) => (s(d) || '').slice(0, 10)).filter((d) => Number.isFinite(U.parseDT(d)));
        if (!out.dias.length) out.dias = [U.fmtData(agora)];
        out.fator = U.clamp(Number.isFinite(+ev.fator) && +ev.fator > 0 ? +ev.fator : 0.5, 0, 1);
        break;
      case 'limite_demanda': {
        out.limiteKW = n(ev.limiteKW);
        let r = n(ev.reducaoPct); if (r > 1) r /= 100;
        out.reducaoPct = out.limiteKW ? null : (r || 0.2);
        out.inicio = dt(ev.inicio) || U.fmtDT(agora);
        out.fim = dt(ev.fim) || U.fmtDT(U.inicioDoDia(U.parseDT(out.inicio)) + 1440);
        break;
      }
      case 'mudar_turno':
        out.dias = (Array.isArray(ev.dias) ? ev.dias : []).map((d) => (s(d) || '').slice(0, 10)).filter((d) => Number.isFinite(U.parseDT(d)));
        if (!out.dias.length) out.dias = [U.fmtData(agora)];
        out.fechado = !!ev.fechado;
        out.inicio = hora(ev.inicio) || '06:00';
        out.fim = hora(ev.fim) || '22:00';
        break;
      default: break;
    }
    return out;
  };

  // ------------------------------------------------------------------ Gemini
  async function chamarGemini(modelo, corpo, chave) {
    let resp;
    try {
      resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelo)}:generateContent`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': chave }, body: JSON.stringify(corpo),
      });
    } catch (e) {
      throw new Error('Sem conexão com o Google. Verifique a internet ou use a IA local.');
    }
    let json = null;
    try { json = await resp.json(); } catch (e) { /* corpo vazio */ }
    return { ok: resp.ok, status: resp.status, json, msg: (json && json.error && json.error.message) || resp.statusText };
  }

  async function escolherModeloGemini(chave) {
    try {
      const r = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=200', { headers: { 'x-goog-api-key': chave } });
      const j = await r.json();
      const nomes = (j.models || []).filter((m) => (m.supportedGenerationMethods || []).includes('generateContent')).map((m) => m.name.replace(/^models\//, ''));
      const versao = (n) => { const m = /gemini-(\d+(?:\.\d+)?)/.exec(n); return m ? parseFloat(m[1]) : 0; };
      const flash = nomes.filter((n) => /^gemini-[\d.]+-flash$/.test(n)).sort((a, b) => versao(b) - versao(a));
      return flash[0] || nomes.find((n) => /flash/.test(n) && !/(image|tts|live|audio|exp)/.test(n)) || null;
    } catch (e) { return null; }
  }

  N.gemini = async function (texto, cen, chave, modelo) {
    if (!chave) throw new Error('Cole a chave do Gemini (Google AI Studio).');
    const corpo = {
      systemInstruction: { parts: [{ text: `${INSTRUCOES}\n\nFormato de cada evento (todos os campos sempre presentes): ${JSON.stringify(Object.keys(CAMPOS_EVENTO))}\n\n${contextoFabrica(cen)}` }] },
      contents: [{ role: 'user', parts: [{ text: texto }] }],
      generationConfig: { responseMimeType: 'application/json', temperature: 0.1 },
    };
    let m = (modelo || N.MODELO_GEMINI).trim();
    let r = await chamarGemini(m, corpo, chave);
    if (!r.ok && (r.status === 404 || (r.status === 400 && /model/i.test(r.msg)))) {
      const alt = await escolherModeloGemini(chave);
      if (alt && alt !== m) { m = alt; r = await chamarGemini(m, corpo, chave); }
    }
    if (!r.ok) {
      if (r.status === 400 && /api key/i.test(r.msg)) throw new Error('Chave do Gemini inválida.');
      if (r.status === 403) throw new Error('A chave do Gemini não tem permissão para este modelo.');
      if (r.status === 429) throw new Error('Limite do plano gratuito do Gemini atingido. Espere um minuto ou use a IA local.');
      throw new Error(`Erro do Gemini (${r.status}): ${r.msg}`);
    }
    const partes = (((r.json || {}).candidates || [])[0] || {}).content;
    const txt = partes && partes.parts ? partes.parts.map((p) => p.text || '').join('') : '';
    const obj = extrairJSON(txt);
    return { eventos: (obj.eventos || []).map((e) => N.normalizar(e, cen, `Gemini (${m})`)), modelo: m };
  };

  // ------------------------------------------------------------------ Claude (SDK oficial)
  let sdk = null;
  async function carregarSDK() {
    if (sdk) return sdk;
    try { sdk = await import(N.SDK_ANTHROPIC); } catch (e) { throw new Error('Não consegui carregar o SDK da Anthropic (precisa de internet).'); }
    return sdk;
  }

  N.claude = async function (texto, cen, chave) {
    if (!chave) throw new Error('Cole a chave da API da Anthropic.');
    const mod = await carregarSDK();
    const Anthropic = mod.default || mod.Anthropic;
    const client = new Anthropic({ apiKey: chave, dangerouslyAllowBrowser: true });
    let resp;
    try {
      resp = await client.beta.messages.create({
        model: N.MODELO_CLAUDE,
        max_tokens: 16000,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        output_config: { effort: 'low', format: { type: 'json_schema', schema: N.ESQUEMA } },
        system: `${INSTRUCOES}\n\n${contextoFabrica(cen)}`,
        messages: [{ role: 'user', content: texto }],
      });
    } catch (e) {
      if (e instanceof Anthropic.AuthenticationError) throw new Error('Chave da Anthropic inválida.');
      if (e instanceof Anthropic.PermissionDeniedError) throw new Error('A chave da Anthropic não tem permissão para este modelo.');
      if (e instanceof Anthropic.RateLimitError) throw new Error('Limite de uso da API da Anthropic atingido. Tente de novo em instantes.');
      if (e instanceof Anthropic.BadRequestError) throw new Error(`Pedido recusado pela API da Anthropic: ${e.message}`);
      if (e instanceof Anthropic.InternalServerError) throw new Error('A API da Anthropic está instável agora. Tente de novo ou use a IA local.');
      if (e instanceof Anthropic.APIConnectionError) throw new Error('Sem conexão com a API da Anthropic.');
      if (e instanceof Anthropic.APIError) throw new Error(`Erro da API da Anthropic (${e.status || '?'}): ${e.message}`);
      throw e;
    }
    if (resp.stop_reason === 'refusal') throw new Error('O modelo não quis processar esta mensagem. Reescreva ou use a IA local.');
    if (resp.stop_reason === 'max_tokens') throw new Error('A resposta veio cortada. Tente uma mensagem mais curta.');
    const txt = resp.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
    const obj = extrairJSON(txt);
    return { eventos: (obj.eventos || []).map((e) => N.normalizar(e, cen, `Claude (${resp.model})`)), modelo: resp.model };
  };
})(typeof window !== 'undefined' ? window : globalThis);
