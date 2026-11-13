/* Carga Certa — eventos do dia a dia: descrição, campos editáveis e aplicação no cenário.
 * O mesmo formato de evento serve para a IA local, o Gemini e o Claude.
 */
(function (G) {
  'use strict';
  const CC = G.CC = G.CC || {};
  const U = CC.util;
  const E = CC.eventos = {};

  E.ROTULOS = {
    maquina_indisponivel: 'Máquina parada',
    maquina_disponivel: 'Máquina liberada',
    mudar_prazo: 'Mudança de prazo',
    novo_pedido: 'Pedido novo',
    mudar_quantidade: 'Mudança de quantidade',
    cancelar_pedido: 'Pedido cancelado',
    previsao_solar: 'Previsão do tempo (solar)',
    limite_demanda: 'Limite de demanda',
    mudar_turno: 'Mudança de turno',
    desconhecido: 'Não entendi',
  };
  E.TIPOS = Object.keys(E.ROTULOS);

  /** Campos que o usuário pode corrigir no cartão de confirmação. */
  E.CAMPOS = {
    maquina_indisponivel: [['maquina', 'Máquina', 'maquina'], ['unidade', 'Unidade', 'unidade'], ['inicio', 'Início', 'datahora'], ['fim', 'Volta em', 'datahora']],
    maquina_disponivel: [['maquina', 'Máquina', 'maquina'], ['unidade', 'Unidade', 'unidade'], ['inicio', 'Liberada em', 'datahora']],
    mudar_prazo: [['pedido', 'Pedido', 'pedido'], ['prazo', 'Novo prazo', 'datahora']],
    novo_pedido: [['modelo', 'Igual ao pedido', 'pedido'], ['quantidade', 'Quantidade', 'numero'], ['cliente', 'Cliente', 'texto'], ['prazo', 'Prazo', 'datahora']],
    mudar_quantidade: [['pedido', 'Pedido', 'pedido'], ['quantidade', 'Nova quantidade', 'numero']],
    cancelar_pedido: [['pedidos', 'Pedidos', 'pedidos']],
    previsao_solar: [['dias', 'Dias', 'dias'], ['fator', 'Geração (% do céu limpo)', 'fator']],
    limite_demanda: [['limiteKW', 'Limite (kW)', 'numero'], ['reducaoPct', 'ou reduzir o pico em', 'pct'], ['inicio', 'De', 'datahora'], ['fim', 'Até', 'datahora']],
    mudar_turno: [['dias', 'Dias', 'dias'], ['fechado', 'Sem expediente', 'bool'], ['inicio', 'Abre', 'hora'], ['fim', 'Fecha', 'hora']],
    desconhecido: [],
  };

  const nomeMaq = (cen, id) => { const m = (cen.maquinas || []).find((x) => x.id === id); return m ? m.nome : id || '?'; };
  const unidadesMaq = (cen, id) => { const m = (cen.maquinas || []).find((x) => x.id === id); return m ? Math.max(1, +m.unidades || 1) : 1; };
  const curto = (s) => { const m = U.parseDT(s); return Number.isFinite(m) ? U.fmtCurto(m) : '?'; };
  const dia = (s) => { const m = U.parseDT(s); return Number.isFinite(m) ? U.fmtDia(m) : '?'; };

  E.descrever = function (ev, cen) {
    switch (ev.tipo) {
      case 'maquina_indisponivel': {
        const un = unidadesMaq(cen, ev.maquina) > 1 && ev.unidade ? ` (unidade ${ev.unidade})` : '';
        return `${nomeMaq(cen, ev.maquina)}${un} parada de ${curto(ev.inicio)} até ${curto(ev.fim)}.`;
      }
      case 'maquina_disponivel': return `${nomeMaq(cen, ev.maquina)}${ev.unidade ? ` (unidade ${ev.unidade})` : ''} liberada a partir de ${curto(ev.inicio)}.`;
      case 'mudar_prazo': {
        const p = (cen.pedidos || []).find((x) => x.id === ev.pedido);
        return `${ev.pedido || '?'}: prazo passa para ${curto(ev.prazo)}${p ? ` (era ${curto(p.prazo)})` : ''}.`;
      }
      case 'novo_pedido': {
        const m = (cen.pedidos || []).find((x) => x.id === ev.modelo);
        return `Pedido novo: ${U.num(ev.quantidade || 0)} × ${m ? m.produto : ev.produto || 'produto'} para ${ev.cliente || 'cliente'}, prazo ${curto(ev.prazo)}${m ? ` (etapas copiadas do ${m.id})` : ''}.`;
      }
      case 'mudar_quantidade': {
        const p = (cen.pedidos || []).find((x) => x.id === ev.pedido);
        return `${ev.pedido || '?'}: quantidade ${p ? U.num(+p.quantidade) : '?'} → ${U.num(ev.quantidade || 0)}. As etapas que não começaram mudam de duração na mesma proporção.`;
      }
      case 'cancelar_pedido': return `Cancelar ${(ev.pedidos || []).join(', ') || '?'}.`;
      case 'previsao_solar': return `Geração solar em ${(ev.dias || []).map(dia).join(', ')}${ev.aPartir || ev.semanaToda ? ' em diante' : ''}: ${U.pct(ev.fator || 0)} da geração de céu limpo.`;
      case 'limite_demanda': {
        const lim = ev.limiteKW ? `no máximo ${U.num(ev.limiteKW)} kW` : `reduzir o pico em ${U.pct(ev.reducaoPct || 0)}`;
        return `Limite de demanda: ${lim} de ${curto(ev.inicio)} até ${curto(ev.fim)}.`;
      }
      case 'mudar_turno': return `${(ev.dias || []).map(dia).join(', ')}: ${ev.fechado ? 'sem expediente' : `turno das ${ev.inicio} às ${ev.fim}`}.`;
      default: return 'Não entendi esta frase. Experimente citar a máquina, o número do pedido ou o horário.';
    }
  };

  /** Problemas que impedem aplicar o evento. */
  E.problemas = function (ev, cen) {
    const p = [];
    const temPed = (id) => (cen.pedidos || []).some((x) => x.id === id && !x.cancelado);
    switch (ev.tipo) {
      case 'maquina_indisponivel': case 'maquina_disponivel':
        if (!(cen.maquinas || []).some((m) => m.id === ev.maquina)) p.push('Escolha a máquina.');
        if (ev.tipo === 'maquina_indisponivel' && !(U.parseDT(ev.fim) > U.parseDT(ev.inicio))) p.push('O fim precisa ser depois do início.');
        break;
      case 'mudar_prazo': if (!temPed(ev.pedido)) p.push('Escolha o pedido.'); if (!Number.isFinite(U.parseDT(ev.prazo))) p.push('Informe o prazo.'); break;
      case 'novo_pedido': if (!(cen.pedidos || []).some((x) => x.id === ev.modelo)) p.push('Escolha um pedido parecido para copiar as etapas.'); if (!(ev.quantidade > 0)) p.push('Informe a quantidade.'); if (!Number.isFinite(U.parseDT(ev.prazo))) p.push('Informe o prazo.'); break;
      case 'mudar_quantidade': if (!temPed(ev.pedido)) p.push('Escolha o pedido.'); if (!(ev.quantidade > 0)) p.push('Informe a quantidade.'); break;
      case 'cancelar_pedido': if (!(ev.pedidos || []).length) p.push('Escolha o pedido.'); break;
      case 'previsao_solar': if (!(ev.dias || []).length) p.push('Escolha o dia.'); break;
      case 'limite_demanda': if (!(ev.limiteKW > 0) && !(ev.reducaoPct > 0)) p.push('Informe o limite em kW ou a redução.'); if (!(U.parseDT(ev.fim) > U.parseDT(ev.inicio))) p.push('O fim precisa ser depois do início.'); break;
      case 'mudar_turno': if (!(ev.dias || []).length) p.push('Escolha o dia.'); break;
      case 'desconhecido': p.push('Evento não reconhecido.'); break;
      default: break;
    }
    return p;
  };

  function proximoId(cen) {
    let max = 0, prefixo = 'P';
    for (const p of cen.pedidos || []) {
      const m = /^([A-Za-z]*)(\d+)$/.exec(String(p.id));
      if (m && +m[2] > max) { max = +m[2]; prefixo = m[1] || 'P'; }
    }
    return prefixo + (max + 1);
  }
  E.proximoId = proximoId;

  /**
   * Aplica eventos e devolve um cenário novo (o original não muda).
   * ctx.iniciadas: Set com ids de etapas já iniciadas ("P101#1") — não mudam de duração.
   * ctx.picoJanela(iniMin, fimMin): maior potência da rede prevista na janela (para "reduzir 20%").
   */
  E.aplicar = function (cen0, eventos, ctx) {
    ctx = ctx || {};
    const cen = U.clonar(cen0);
    cen.indisponibilidades = cen.indisponibilidades || [];
    cen.limitesDemanda = cen.limitesDemanda || [];
    cen.excecoesTurno = cen.excecoesTurno || [];
    const notas = [];
    const t0 = U.parseDT(String(cen.inicio).slice(0, 10));
    let seq = Date.now() % 100000;
    for (const ev of eventos) {
      const prob = E.problemas(ev, cen);
      if (prob.length) { notas.push(`Ignorado (${E.ROTULOS[ev.tipo]}): ${prob.join(' ')}`); continue; }
      switch (ev.tipo) {
        case 'maquina_indisponivel':
          cen.indisponibilidades.push({ id: 'PARADA-' + (seq++), maquina: ev.maquina, unidade: +ev.unidade || 0, inicio: ev.inicio, fim: ev.fim, motivo: ev.texto || '' });
          break;
        case 'maquina_disponivel': {
          const t = U.parseDT(ev.inicio);
          cen.indisponibilidades = cen.indisponibilidades.filter((ind) => {
            if (ind.maquina !== ev.maquina) return true;
            if (ev.unidade && ind.unidade && +ind.unidade !== +ev.unidade) return true;
            const a = U.parseDT(ind.inicio), b = U.parseDT(ind.fim);
            if (b <= t) return true;
            if (a >= t) return false;
            ind.fim = U.fmtDT(t);
            return true;
          });
          break;
        }
        case 'mudar_prazo': {
          const p = cen.pedidos.find((x) => x.id === ev.pedido);
          p.prazo = ev.prazo;
          break;
        }
        case 'novo_pedido': {
          const m = cen.pedidos.find((x) => x.id === ev.modelo);
          const razao = (+ev.quantidade || +m.quantidade || 1) / Math.max(1, +m.quantidade || 1);
          const id = ev.id && !cen.pedidos.some((x) => x.id === ev.id) ? ev.id : proximoId(cen);
          cen.pedidos.push({
            id, cliente: ev.cliente || m.cliente, produto: m.produto, quantidade: +ev.quantidade || +m.quantidade,
            liberacao: cen.agora || cen.inicio, prazo: ev.prazo,
            etapas: m.etapas.map((e) => ({ maquina: e.maquina, horas: Math.max(0.25, Math.round(U.numeroBR(e.horas) * razao * 4) / 4) })),
          });
          notas.push(`Pedido ${id} criado.`);
          break;
        }
        case 'mudar_quantidade': {
          const p = cen.pedidos.find((x) => x.id === ev.pedido);
          const razao = (+ev.quantidade) / Math.max(1, +p.quantidade || 1);
          p.etapas.forEach((e, j) => {
            if (ctx.iniciadas && ctx.iniciadas.has(`${p.id}#${j + 1}`)) return;
            e.horas = Math.max(0.25, Math.round(U.numeroBR(e.horas) * razao * 4) / 4);
          });
          p.quantidade = +ev.quantidade;
          break;
        }
        case 'cancelar_pedido':
          for (const id of ev.pedidos) { const p = cen.pedidos.find((x) => x.id === id); if (p) p.cancelado = true; }
          break;
        case 'previsao_solar': {
          cen.solar = cen.solar || {};
          const neb = cen.solar.nebulosidade = (cen.solar.nebulosidade || []).slice();
          while (neb.length < cen.dias) neb.push(1);
          let idxs = ev.dias.map((d) => Math.round((U.parseDT(d) - t0) / 1440)).filter((i) => i >= 0 && i < cen.dias);
          if ((ev.aPartir || ev.semanaToda) && idxs.length) { const a = Math.min(...idxs); idxs = []; for (let i = a; i < cen.dias; i++) idxs.push(i); }
          for (const i of idxs) neb[i] = U.clamp(+ev.fator, 0, 1);
          break;
        }
        case 'limite_demanda': {
          let kw = +ev.limiteKW;
          if (!(kw > 0)) {
            const pico = ctx.picoJanela ? ctx.picoJanela(U.parseDT(ev.inicio), U.parseDT(ev.fim)) : NaN;
            kw = Number.isFinite(pico) && pico > 0 ? Math.round(pico * (1 - (+ev.reducaoPct || 0.2))) : NaN;
          }
          if (!(kw > 0)) { notas.push('Limite de demanda ignorado: não deu para calcular o valor.'); break; }
          cen.limitesDemanda.push({ id: 'LIM-' + (seq++), inicio: ev.inicio, fim: ev.fim, kW: kw, motivo: ev.texto || '' });
          notas.push(`Limite de ${kw} kW registrado.`);
          break;
        }
        case 'mudar_turno':
          for (const d of ev.dias) {
            const data = String(d).slice(0, 10);
            cen.excecoesTurno = cen.excecoesTurno.filter((x) => x.data !== data);
            cen.excecoesTurno.push({ data, fechado: !!ev.fechado, inicio: ev.inicio || '06:00', fim: ev.fim || '22:00' });
          }
          break;
        default: break;
      }
    }
    return { cen, notas };
  };
})(typeof window !== 'undefined' ? window : globalThis);
