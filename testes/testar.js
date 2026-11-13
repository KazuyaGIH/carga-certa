/* Testes automáticos do Carga Certa (sem navegador).
 * Rodar na pasta do projeto:   node testes/testar.js
 * Verifica: regras da agenda (máquinas, turnos, ordem das etapas, paradas, cargas flexíveis),
 * se a otimização não piora a conta, se a IA local entende frases de exemplo e a ponte com o
 * engenheiro (pedido em arquivo, fila por impacto, parecer e aviso quando os dados mudam).
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const raiz = path.join(__dirname, '..');
const contexto = { console, setTimeout, clearTimeout };
contexto.globalThis = contexto;
vm.createContext(contexto);
const ARQUIVOS = ['js/util.js', 'js/tarifas.js', 'js/solar.js', 'js/modelo.js', 'js/otimizador.js',
  'js/diagnostico.js', 'js/revisao.js', 'js/ia-local.js', 'js/eventos.js', 'dados/exemplos.js'];
for (const f of ARQUIVOS) {
  const p = path.join(raiz, f);
  if (fs.existsSync(p)) vm.runInContext(fs.readFileSync(p, 'utf8'), contexto, { filename: f });
}
const CC = contexto.CC;
const U = CC.util;

let falhas = 0;
function confere(cond, msg) {
  if (!cond) { falhas++; console.log('  FALHOU: ' + msg); }
}

function validar(inst, plano) {
  const erros = [];
  const occ = new Map();
  inst.ops.forEach((op, o) => {
    const s = plano.ini[o], u = plano.uni[o];
    if (s < 0) { erros.push('etapa sem agenda: ' + op.id); return; }
    const M = inst.maquinas[op.maq];
    if (s + op.dur > inst.T) erros.push('passa do horizonte: ' + op.id);
    for (let t = s; t < s + op.dur; t++) {
      const k = `${op.maq}:${u}:${t}`;
      if (occ.has(k)) erros.push(`sobreposição ${op.id} x ${occ.get(k)}`);
      occ.set(k, op.id);
      if (!M.perm[t]) erros.push(`fora do turno: ${op.id} em ${U.fmtCurto(inst.tempo(t))}`);
      if (M.bloq[u][t]) erros.push(`durante parada: ${op.id}`);
    }
  });
  inst.pedidos.forEach((ped) => {
    let fim = ped.lib;
    ped.ops.forEach((o) => {
      const s = plano.ini[o];
      if (s < 0) return;
      if (s < fim) erros.push('ordem das etapas/liberação: ' + inst.ops[o].id);
      fim = s + inst.ops[o].dur;
    });
  });
  inst.flex.forEach((f, i) => {
    let e = 0;
    plano.flex[i].forEach((x) => { if (x > f.kW + 1e-4 || x < -1e-6) erros.push('carga flexível fora da potência: ' + f.id); e += x * inst.dt; });
    if (Math.abs(e - f.energia) > 1e-2) erros.push(`carga flexível ${f.id}: entregou ${e.toFixed(2)} de ${f.energia.toFixed(2)} kWh`);
  });
  return erros;
}

function resumo(nome, av) {
  return `${nome}: conta ${U.brl(av.contaMes)}/mês | pico ${U.num(av.picos.all, 1)} kW | ponta ${U.num(av.kwh.ponta, 0)} kWh | FC ${U.num(av.fatorCarga, 2)} | solar aproveitada ${U.pct(av.aproveitamentoSolar)} | no prazo ${av.noPrazo}/${av.pedidos.length}`;
}

async function testarCenario(chave) {
  const cen = U.clonar(CC.EXEMPLOS[chave].cenario);
  console.log(`\n=== ${cen.nome} ===`);
  const inst = CC.modelo.construir(cen);
  if (inst.avisos.length) console.log('  avisos:', inst.avisos);
  console.log(`  ${inst.T} intervalos, ${inst.ops.length} etapas, ${inst.pedidos.length} pedidos, ${inst.flex.length} cargas flexíveis`);
  const base = CC.otim.planoASAP(inst);
  const errosBase = validar(inst, base);
  confere(errosBase.length === 0, 'agenda "como é hoje" inválida: ' + errosBase.slice(0, 5).join(' | '));
  const avB = CC.otim.avaliar(inst, new CC.otim.Estado(inst, base));
  const t0 = Date.now();
  const otim = await CC.otim.otimizar(inst, base, {});
  const ms = Date.now() - t0;
  const errosOtim = validar(inst, otim);
  confere(errosOtim.length === 0, 'agenda otimizada inválida: ' + errosOtim.slice(0, 5).join(' | '));
  const avO = CC.otim.avaliar(inst, new CC.otim.Estado(inst, otim));
  console.log('  ' + resumo('hoje      ', avB));
  console.log('  ' + resumo('otimizado ', avO));
  console.log(`  economia ${U.brl(avB.contaMes - avO.contaMes)}/mês (${U.pct((avB.contaMes - avO.contaMes) / avB.contaMes, 1)}), tempo ${ms} ms`);
  confere(avO.objetivo <= avB.objetivo + 1e-6, 'otimização piorou o objetivo');
  confere(avO.naoProg === 0, 'há etapas sem agenda no plano otimizado');
  // Reprodutibilidade
  const otim2 = await CC.otim.otimizar(inst, base, {});
  const avO2 = CC.otim.avaliar(inst, new CC.otim.Estado(inst, otim2));
  confere(Math.abs(avO2.objetivo - avO.objetivo) < 1e-6, 'resultado não é reprodutível');
  // Ida e volta pelo JSON
  const ser = CC.otim.serializar(inst, otim);
  const de = CC.otim.desserializar(inst, JSON.parse(JSON.stringify(ser)));
  const avS = CC.otim.avaliar(inst, new CC.otim.Estado(inst, de));
  confere(Math.abs(avS.objetivo - avO.objetivo) < 1, 'serializar/desserializar mudou o plano');
  const mud = CC.otim.mudancas(inst, base, otim);
  console.log('  principais mudanças:');
  for (const m of mud.slice(0, 5)) console.log(`   - ${m.rotulo}: ${U.fmtCurto(m.antes)} -> ${U.fmtCurto(m.depois)} (${m.motivo})`);
  return { cen, inst, base, otim, avB, avO };
}

function testarIA(cen) {
  console.log('\n=== IA local (frases de teste; agora = Seg 23/11 06:00) ===');
  const casos = [
    ['O torno 2 quebrou e só volta amanhã às 14h', 'maquina_indisponivel', (e) => e.maquina === 'TORNO' && e.unidade === 2 && e.fim === '2026-11-24T14:00'],
    ['Forno em manutenção das 8h às 12h de quinta', 'maquina_indisponivel', (e) => e.maquina === 'FORNO' && e.inicio === '2026-11-26T08:00' && e.fim === '2026-11-26T12:00'],
    ['A serra vai ficar parada por 3 horas', 'maquina_indisponivel', (e) => e.maquina === 'CORTE' && e.fim === '2026-11-23T09:00'],
    ['A fresa voltou a funcionar', 'maquina_disponivel', (e) => e.maquina === 'FRESA'],
    ['O cliente Hidro Bombas antecipou o P107 para quinta às 10h', 'mudar_prazo', (e) => e.pedido === 'P107' && e.prazo === '2026-11-26T10:00'],
    ['Adiaram o P102 para sexta', 'mudar_prazo', (e) => e.pedido === 'P102' && e.prazo === '2026-11-27T17:00'],
    ['Chegou um pedido urgente de 100 eixos para quinta às 14h', 'novo_pedido', (e) => e.quantidade === 100 && e.modelo === 'P101' && e.prazo === '2026-11-26T14:00'],
    ['O P104 aumentou para 120 peças', 'mudar_quantidade', (e) => e.pedido === 'P104' && e.quantidade === 120],
    ['O cliente reduziu o P106 pela metade', 'mudar_quantidade', (e) => e.pedido === 'P106' && e.quantidade === 20],
    ['Cancelaram o P110', 'cancelar_pedido', (e) => e.pedidos.length === 1 && e.pedidos[0] === 'P110'],
    ['Amanhã vai ser nublado', 'previsao_solar', (e) => e.dias[0] === '2026-11-24' && e.fator < 0.5],
    ['Previsão de chuva na quinta e na sexta', 'previsao_solar', (e) => e.dias.length === 2],
    ['A distribuidora pediu para limitar a demanda em 60 kW amanhã das 14h às 17h', 'limite_demanda', (e) => e.limiteKW === 60 && e.inicio === '2026-11-24T14:00' && e.fim === '2026-11-24T17:00'],
    ['Sábado vamos trabalhar das 7h às 16h', 'mudar_turno', (e) => !e.fechado && e.dias[0] === '2026-11-28' && e.inicio === '07:00' && e.fim === '16:00'],
    ['Não haverá expediente na sexta', 'mudar_turno', (e) => e.fechado && e.dias[0] === '2026-11-27'],
    ['Bom dia, pessoal', 'desconhecido', () => true],
  ];
  let ok = 0;
  for (const [frase, tipo, chk] of casos) {
    const evs = CC.iaLocal.interpretar(frase, cen);
    const e = evs[0];
    const bom = e && e.tipo === tipo && chk(e);
    if (bom) ok++;
    console.log(`  ${bom ? 'ok   ' : 'ERRO '} "${frase}" -> ${e ? e.tipo : '-'} (${e ? U.pct(e.confianca) : ''}) ${e ? CC.eventos.descrever(e, cen) : ''}`);
    if (!bom) console.log('        ', JSON.stringify(e));
  }
  confere(ok >= casos.length - 1, `IA local acertou ${ok} de ${casos.length}`);
  // Duas frases numa mensagem
  const duas = CC.iaLocal.interpretar('O torno 1 quebrou. O P103 foi antecipado para amanhã às 12h.', cen);
  confere(duas.length === 2 && duas[0].tipo === 'maquina_indisponivel' && duas[1].tipo === 'mudar_prazo', 'mensagem com duas frases');
}

async function testarEventosEDiagnostico(r) {
  console.log('\n=== Evento aplicado + replanejamento ===');
  const evs = CC.iaLocal.interpretar('O torno 2 quebrou e só volta amanhã às 14h', r.cen);
  const { cen } = CC.eventos.aplicar(r.cen, evs, {});
  const inst = CC.modelo.construir(cen);
  const anterior = CC.otim.desserializar(inst, CC.otim.serializar(r.inst, r.otim));
  const novo = await CC.otim.otimizar(inst, anterior, { referencia: anterior, estabilidade: 20 });
  const erros = validar(inst, novo);
  confere(erros.length === 0, 'replanejamento após quebra inválido: ' + erros.slice(0, 3).join(' | '));
  const av = CC.otim.avaliar(inst, new CC.otim.Estado(inst, novo));
  const mexidas = inst.ops.filter((op, o) => anterior.ini[o] !== novo.ini[o]).length;
  const semEstab = await CC.otim.otimizar(inst, anterior, {});
  const mexidasSem = inst.ops.filter((op, o) => anterior.ini[o] !== semEstab.ini[o]).length;
  console.log(`  depois da quebra: conta ${U.brl(av.contaMes)}/mês, no prazo ${av.noPrazo}/${av.pedidos.length}, etapas mexidas ${mexidas} (sem a penalidade de estabilidade seriam ${mexidasSem})`);
  confere(mexidas <= mexidasSem, 'a estabilidade deveria mexer em menos etapas');

  console.log('\n=== Diagnóstico ===');
  const sB = CC.otim.serializar(r.inst, r.base), sO = CC.otim.serializar(r.inst, r.otim);
  const mods = await CC.diag.compararModalidades(r.cen, sB, sO, { replanejar: true });
  for (const l of mods.linhas) console.log(`  ${l.nome.padEnd(18)} hoje ${U.brl(l.contaHoje).padStart(10)} | agenda atual ${U.brl(l.contaAgendaAtual).padStart(10)} | replanejada ${U.brl(l.contaReplanejada).padStart(10)}${l.mesmoGrupo ? '' : '  (outro grupo)'}`);
  const dem = CC.diag.demandaContratada(r.inst, r.avO);
  if (dem.aplica) for (const p of dem.parcelas) console.log(`  ${p.nome}: medida ${U.num(p.medida, 1)} kW, contratada ${p.contratada}, recomendada ${p.recomendada} (${U.brl(p.custoAtual - p.custoRecomendado)}/mês)`);
  const sol = await CC.diag.dimensionarSolar(r.cen, sO, {});
  for (const l of sol.linhas) console.log(`  ${String(l.kWp).padStart(4)} kWp: conta ${U.brl(l.conta)} | economia ${U.brl(l.economiaMes)} | corte ${U.num(l.cortLimMes + l.cortVWMes, 0)} kWh/mês | payback ${Number.isFinite(l.payback) ? U.num(l.payback, 1) : '-'} a | VPL ${U.brl(l.vpl)}`);
  console.log(`  recomendado: ${sol.recomendado.kWp} kWp`);
  const avD = CC.otim.avaliar(r.inst, new CC.otim.Estado(r.inst, r.otim), true);
  const rea = CC.diag.reativos(r.inst, r.otim, avD);
  console.log(`  FP médio ${U.num(rea.fpMedio, 3)} (sem solar seria ${U.num(rea.fpSemSolar, 3)}), reativo excedente ${U.brl(rea.custoMes)}/mês, banco ${rea.banco} kvar -> ${U.brl(rea.custoMesComBanco)}/mês`);
  const rec = CC.diag.recomendacoes({ avBase: r.avB, avOtim: r.avO, modalidades: mods, demanda: dem, solar: sol, reat: rea });
  for (const x of rec) console.log('  - ' + x);
  return { mods, dem, sol, rea, rec, sB, sO };
}

function testarRevisao(r, d) {
  console.log('\n=== Ponte com o engenheiro (pedido, fila e parecer) ===');
  const RV = CC.revisao;
  const itens = CC.diag.itens({ avBase: r.avB, avOtim: r.avO, modalidades: d.mods, demanda: d.dem, solar: d.sol, reat: d.rea });
  confere(itens.map((i) => i.texto).join('|') === d.rec.join('|'), 'itens e recomendações em texto divergem');
  confere(new Set(itens.map((i) => i.id)).size === itens.length, 'recomendações com id repetido');
  confere(itens.every((i) => RV.AREAS[i.area]), 'recomendação com área desconhecida');
  confere(itens.every((i) => RV.conferir(i.id).length >= 2), 'recomendação sem lista do que conferir');
  confere(itens.every((i) => Number.isFinite(i.economiaMes) && i.economiaMes >= 0), 'economia por recomendação inválida');
  for (const i of itens) console.log(`  [${i.id}] ${RV.AREAS[i.area]}: ${U.brl(i.economiaMes)}/mês${RV.exigeART(i.id) ? ' (exige ART)' : ''}`);
  const eco = RV.economiaPossivel(itens);
  const soma = (a) => itens.filter((i) => i.area === a).reduce((s, i) => s + i.economiaMes, 0);
  const esperado = eco.conflito
    ? soma('planejamento') + soma('tarifa') + soma('qualidade') + Math.max(soma('demanda'), soma('solar'))
    : itens.reduce((s, i) => s + i.economiaMes, 0);
  confere(Math.abs(eco.total - esperado) < 1e-6, 'economia possível somada errado');
  console.log(`  economia possível: ${U.brl(eco.total)}/mês${eco.conflito ? ' (solar e demanda disputam: conta a maior)' : ''}`);

  // Pedido: ida e volta pelo JSON, como num arquivo mandado por e-mail
  const planos = { base: d.sB, otim: d.sO };
  const ped = RV.montarPedido({ cen: r.cen, planos, diag: { modalidades: d.mods, solar: d.sol }, avBase: r.avB, avOtim: r.avO, itens, meta: { cidade: 'São Paulo (SP)', contato: '', mensagem: 'teste' } });
  const j = JSON.parse(JSON.stringify(ped));
  confere(RV.validarPedido(j) === '', 'pedido válido recusado: ' + RV.validarPedido(j));
  confere(RV.validarPedido({ formato: 'outro' }) !== '', 'arquivo qualquer aceito como pedido');
  const mal = U.clonar(j); mal.itens[0].id = '__proto__';
  const mal2 = U.clonar(j); mal2.itens[0].area = '__proto__';
  confere(RV.validarPedido(mal) !== '' && RV.validarPedido(mal2) !== '', 'pedido com nomes internos do JavaScript (__proto__) deveria ser recusado');
  confere(RV.assinaturaDados(j.cenario, j.planos) === ped.assinatura, 'assinatura muda na ida e volta pelo JSON');
  const c2 = U.clonar(j.cenario);
  c2.agora = c2.inicio + 'T10:00';
  confere(RV.assinaturaDados(c2, j.planos) === ped.assinatura, 'mudar só o relógio simulado não deveria invalidar o parecer');
  c2.maquinas[0].potenciaKW += 1;
  confere(RV.assinaturaDados(c2, j.planos) !== ped.assinatura, 'mudar um dado da fábrica deveria mudar a assinatura');
  const diag = RV.restaurarDiag(j.diag);
  confere(diag && diag.modalidades.linhas.includes(diag.modalidades.melhor) && diag.solar.linhas.includes(diag.solar.recomendado), 'diagnóstico restaurado sem as referências');
  confere(diag && diag.solar.recomendado.kWp === d.sol.recomendado.kWp, 'usina sugerida mudou na ida e volta');
  const imp = RV.prepararImportado(j);
  confere(imp.assinatura === ped.assinatura && imp.status === 'aguardando' && Math.abs(imp.economiaMes - ped.economiaMes) < 1e-6, 'pedido importado diferente do original');

  // Parecer
  const eng = { nome: 'Eng. Teste', registro: 'CREA-SP 0000', organizacao: 'Empresa júnior' };
  confere(RV.validarParecer(ped, null, eng).length === itens.length, 'parecer vazio deveria pedir uma decisão por recomendação');
  confere(RV.validarParecer(ped, null, {}).length === itens.length + 1, 'parecer sem nome deveria ser recusado');
  const rasc = { decisoes: {}, observacoes: 'ok' };
  itens.forEach((i) => { rasc.decisoes[i.id] = { decisao: 'aprovada', conferidos: [0, 1, 1, 99] }; });
  rasc.decisoes[itens[0].id] = { decisao: 'ajuste', nota: '' };
  confere(RV.validarParecer(ped, rasc, eng).length === 1, 'ajuste sem explicação deveria ser recusado');
  rasc.decisoes[itens[0].id].nota = 'Contratar 65 kW por causa da partida do compressor.';
  confere(RV.validarParecer(ped, rasc, eng).length === 0, 'parecer completo recusado');
  const par = RV.montarParecer(ped, rasc, eng);
  confere(par.resumo.ajustes === 1 && par.resumo.aprovadas === itens.length - 1 && par.resumo.recusadas === 0, 'contagem do parecer errada');
  confere(par.itens.slice(1).every((i) => i.conferidos.join() === '0,1'), 'itens conferidos não foram limpos');
  confere(par.assinatura === ped.assinatura, 'parecer sem a assinatura do pedido');
  console.log(`  parecer de teste: ${RV.textoResumo(par.resumo)}`);

  // Fila: ordem por economia, por % da conta e por chegada; filtro por especialidade
  const t = (h) => new Date(Date.UTC(2026, 10, 13, h)).toISOString();
  const fila = [
    { id: 'a', economiaMes: 3000, percentual: 0.05, criadoEm: t(10), status: 'aguardando', itens: [{ area: 'solar' }] },
    { id: 'b', economiaMes: 1500, percentual: 0.17, criadoEm: t(8), status: 'revisao', itens: [{ area: 'planejamento' }] },
    { id: 'c', economiaMes: 9000, percentual: 0.30, criadoEm: t(6), status: 'parecer', itens: [{ area: 'tarifa' }] },
  ];
  const ids = (l) => l.map((p) => p.id).join('');
  confere(ids(RV.ordenar(fila, 'reais')) === 'abc', 'ordem por R$ errada: ' + ids(RV.ordenar(fila, 'reais')));
  confere(ids(RV.ordenar(fila, 'percentual')) === 'bac', 'ordem por % errada: ' + ids(RV.ordenar(fila, 'percentual')));
  confere(ids(RV.ordenar(fila, 'antigos')) === 'bac', 'ordem por chegada errada: ' + ids(RV.ordenar(fila, 'antigos')));
  confere(ids(RV.ordenar(fila, 'reais', ['planejamento'], true)) === 'b', 'filtro por especialidade errado');
}

(async () => {
  const r1 = await testarCenario('metalurgica');
  const r2 = await testarCenario('padaria');
  testarIA(r1.cen);
  const d1 = await testarEventosEDiagnostico(r1);
  testarRevisao(r1, d1);
  console.log('\n--- padaria: modalidades ---');
  const m2 = await CC.diag.compararModalidades(r2.cen, CC.otim.serializar(r2.inst, r2.base), CC.otim.serializar(r2.inst, r2.otim), { replanejar: true });
  for (const l of m2.linhas) console.log(`  ${l.nome.padEnd(18)} hoje ${U.brl(l.contaHoje).padStart(10)} | agenda atual ${U.brl(l.contaAgendaAtual).padStart(10)} | replanejada ${U.brl(l.contaReplanejada).padStart(10)}${l.mesmoGrupo ? '' : '  (outro grupo)'}`);
  console.log(falhas ? `\n${falhas} verificação(ões) falharam.` : '\nTodas as verificações passaram.');
  process.exitCode = falhas ? 1 : 0;
})().catch((e) => { console.error(e); process.exitCode = 1; });
