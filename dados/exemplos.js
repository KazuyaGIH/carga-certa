/* Carga Certa — cenários de exemplo (empresas fictícias, números plausíveis).
 * Para criar o seu: edite na aba "Fábrica" e use "Salvar" para baixar o arquivo .json.
 */
(function (G) {
  'use strict';
  const CC = G.CC = G.CC || {};

  const TARIFA_ENEL_SP_2026 = {
    preset: 'enel-sp-2026',
    modalidade: 'A4_verde',
    ponta: { inicio: '17:30', fim: '20:30' },
    intermediarioMin: 60,
    precos: {
      B3_convencional: { energia: 0.78938 },
      B3_branca: { fp: 0.68501, int: 1.03179, p: 1.55911 },
      A4_verde: { energiaP: 1.40483, energiaFP: 0.45250, demanda: 19.04 },
      A4_azul: { energiaP: 0.63304, energiaFP: 0.45250, demandaP: 31.75, demandaFP: 19.04 },
    },
    demandaContratada: { unica: 100, ponta: 70, foraPonta: 100 },
    toleranciaUltrapassagem: 0.05,
    fatorUltrapassagem: 2,
    tributos: 0.225,
    bandeira: 0,
    fioB: { B: 0.21208, A: 0 },
    fioBPercentual: 0.6,
    teReativo: 0.31696,
  };
  const copia = (o) => JSON.parse(JSON.stringify(o));
  const TURNO = 'seg-sex 06:00-22:00; sab 06:00-14:00';

  const metalurgica = {
    versao: 1,
    nome: 'Metalúrgica Vale do Tietê (exemplo)',
    descricao: 'Usinagem, tratamento térmico, solda e pintura. Grupo A4 (média tensão), tarifa Verde, 60 kWp de geração solar com injeção limitada a 15 kW pela distribuidora.',
    exemplosEventos: [
      'O torno 2 quebrou e só volta amanhã às 14h',
      'O cliente Hidro Bombas antecipou o P107 para quinta às 10h',
      'Amanhã vai ser nublado',
      'A distribuidora pediu para limitar a demanda em 60 kW amanhã das 14h às 17h',
      'Chegou um pedido urgente de 100 eixos para quinta às 14h',
      'Não haverá expediente na sexta',
    ],
    cidade: 'São Paulo - SP',
    inicio: '2026-11-23',
    dias: 7,
    passoMin: 15,
    agora: '2026-11-23T06:00',
    objetivo: { pesoPico: 5 },
    tarifa: copia(TARIFA_ENEL_SP_2026),
    solar: {
      ativo: true, kWp: 60, pr: 0.8, latitude: -23.55, longitude: -46.63,
      nebulosidade: [0.95, 0.8, 0.35, 0.7, 0.9, 0.6, 0.85],
      limiteInjecaoKW: 15,
      voltWatt: { ativo: true, v1: 1.05, v2: 1.10 },
      rede: { tensaoV: 380, resistenciaOhm: 0.08, tensaoBase: 1.0, elevacaoMeioDia: 0.035 },
      custoKWp: 3600,
    },
    maquinas: [
      { id: 'CORTE', nome: 'Serra de fita', unidades: 1, potenciaKW: 5.5, fp: 0.82, janela: TURNO },
      { id: 'TORNO', nome: 'Torno CNC', unidades: 2, potenciaKW: 15, fp: 0.85, janela: TURNO },
      { id: 'FRESA', nome: 'Centro de usinagem', unidades: 1, potenciaKW: 18, fp: 0.85, janela: TURNO },
      { id: 'FORNO', nome: 'Forno de têmpera', unidades: 1, potenciaKW: 45, fp: 0.98, janela: 'todos 00:00-24:00' },
      { id: 'SOLDA', nome: 'Solda MIG', unidades: 2, potenciaKW: 9, fp: 0.7, janela: 'seg-sex 06:00-22:00' },
      { id: 'PINTURA', nome: 'Cabine de pintura com estufa', unidades: 1, potenciaKW: 24, fp: 0.95, janela: 'seg-sex 06:00-22:00' },
    ],
    pedidos: [
      { id: 'P101', cliente: 'AgroMáquinas', produto: 'Eixo de transmissão', quantidade: 120, liberacao: '2026-11-23T06:00', prazo: '2026-11-25T12:00', etapas: [{ maquina: 'CORTE', horas: 2 }, { maquina: 'TORNO', horas: 6 }, { maquina: 'FORNO', horas: 4 }] },
      { id: 'P102', cliente: 'Construtora Horizonte', produto: 'Suporte metálico soldado', quantidade: 300, liberacao: '2026-11-23T06:00', prazo: '2026-11-26T17:00', etapas: [{ maquina: 'CORTE', horas: 3 }, { maquina: 'SOLDA', horas: 8 }, { maquina: 'PINTURA', horas: 4 }] },
      { id: 'P103', cliente: 'Hidro Bombas', produto: 'Flange usinada', quantidade: 80, liberacao: '2026-11-23T06:00', prazo: '2026-11-24T18:00', etapas: [{ maquina: 'CORTE', horas: 1.5 }, { maquina: 'FRESA', horas: 5 }, { maquina: 'TORNO', horas: 3 }] },
      { id: 'P104', cliente: 'AgroMáquinas', produto: 'Engrenagem temperada', quantidade: 60, liberacao: '2026-11-23T06:00', prazo: '2026-11-27T12:00', etapas: [{ maquina: 'FRESA', horas: 6 }, { maquina: 'FORNO', horas: 5 }, { maquina: 'TORNO', horas: 2 }] },
      { id: 'P105', cliente: 'MetalSul', produto: 'Bucha usinada', quantidade: 200, liberacao: '2026-11-23T06:00', prazo: '2026-11-25T18:00', etapas: [{ maquina: 'CORTE', horas: 1 }, { maquina: 'TORNO', horas: 7 }] },
      { id: 'P106', cliente: 'Construtora Horizonte', produto: 'Grade de proteção', quantidade: 40, liberacao: '2026-11-24T08:00', prazo: '2026-11-27T17:00', etapas: [{ maquina: 'CORTE', horas: 2 }, { maquina: 'SOLDA', horas: 6 }, { maquina: 'PINTURA', horas: 3 }] },
      { id: 'P107', cliente: 'Hidro Bombas', produto: 'Carcaça de bomba', quantidade: 25, liberacao: '2026-11-23T06:00', prazo: '2026-11-28T12:00', etapas: [{ maquina: 'FRESA', horas: 8 }, { maquina: 'PINTURA', horas: 2.5 }] },
      { id: 'P108', cliente: 'Usina Boa Vista', produto: 'Pino temperado', quantidade: 500, liberacao: '2026-11-23T06:00', prazo: '2026-11-26T12:00', etapas: [{ maquina: 'CORTE', horas: 2 }, { maquina: 'TORNO', horas: 5 }, { maquina: 'FORNO', horas: 6 }] },
      { id: 'P109', cliente: 'MetalSul', produto: 'Chapa dobrada soldada', quantidade: 150, liberacao: '2026-11-23T06:00', prazo: '2026-11-24T20:00', etapas: [{ maquina: 'CORTE', horas: 2.5 }, { maquina: 'SOLDA', horas: 5 }] },
      { id: 'P110', cliente: 'Frigorífico Serra', produto: 'Estrutura em inox', quantidade: 10, liberacao: '2026-11-24T08:00', prazo: '2026-11-28T13:00', etapas: [{ maquina: 'CORTE', horas: 3 }, { maquina: 'SOLDA', horas: 10 }, { maquina: 'PINTURA', horas: 3 }] },
      { id: 'P111', cliente: 'AgroMáquinas', produto: 'Eixo estriado', quantidade: 90, liberacao: '2026-11-25T06:00', prazo: '2026-11-27T18:00', etapas: [{ maquina: 'TORNO', horas: 5 }, { maquina: 'FRESA', horas: 4 }, { maquina: 'FORNO', horas: 4 }] },
      { id: 'P112', cliente: 'Usina Boa Vista', produto: 'Mancal', quantidade: 40, liberacao: '2026-11-23T06:00', prazo: '2026-11-26T18:00', etapas: [{ maquina: 'TORNO', horas: 4 }, { maquina: 'FRESA', horas: 3 }] },
    ],
    cargasFixas: [
      { nome: 'Iluminação do galpão (LED)', kW: 6, fp: 0.95, janela: TURNO },
      { nome: 'Compressor de ar (carga de base)', kW: 7.5, fp: 0.85, janela: TURNO },
      { nome: 'Ventilação e exaustão (conforto térmico)', kW: 4, fp: 0.85, janela: TURNO },
      { nome: 'Escritório e ar-condicionado', kW: 8, fp: 0.9, janela: 'seg-sex 08:00-18:00' },
      { nome: 'Cargas 24 h (TI, segurança, bebedouros)', kW: 2, fp: 0.9, janela: 'todos 00:00-24:00' },
    ],
    cargasFlexiveis: [
      { id: 'EMPILH', nome: 'Recarga das empilhadeiras', energiaKWh: 36, potenciaMaxKW: 6, janela: '16:00-06:00', dias: 'seg-sex', continua: true, fp: 0.95 },
      { id: 'BOMBA', nome: 'Bombeamento para a caixa d’água', energiaKWh: 12, potenciaMaxKW: 4, janela: '00:00-24:00', dias: 'todos', continua: false, fp: 0.85 },
      { id: 'BANHO', nome: 'Aquecimento do banho de pré-tratamento', energiaKWh: 16, potenciaMaxKW: 8, janela: '06:00-13:00', dias: 'seg-sex', continua: true, fp: 1 },
    ],
    indisponibilidades: [],
    limitesDemanda: [],
    excecoesTurno: [],
  };

  // ---------------- Padaria industrial (Grupo B3) ----------------
  function pedidosPadaria() {
    const dias = ['2026-11-23', '2026-11-24', '2026-11-25', '2026-11-26', '2026-11-27', '2026-11-28'];
    const seg = (d) => dias[dias.indexOf(d) + 1] || '2026-11-29';
    const lista = [];
    let n = 201;
    for (const d of dias.slice(0, 5)) {
      lista.push({ id: 'P' + n++, cliente: 'Rede Bom Preço', produto: 'Pão de forma', quantidade: 400, liberacao: `${d}T14:00`, prazo: `${seg(d)}T10:30`,
        etapas: [{ maquina: 'MASSEIRA', horas: 1 }, { maquina: 'MODELADORA', horas: 1 }, { maquina: 'FERMENTACAO', horas: 2 }, { maquina: 'FORNO', horas: 1.5 }, { maquina: 'EMBALAGEM', horas: 1.5 }] });
      lista.push({ id: 'P' + n++, cliente: 'Escola Municipal', produto: 'Bisnaguinha', quantidade: 600, liberacao: `${d}T14:00`, prazo: `${seg(d)}T11:00`,
        etapas: [{ maquina: 'MASSEIRA', horas: 0.75 }, { maquina: 'MODELADORA', horas: 0.75 }, { maquina: 'FERMENTACAO', horas: 1.5 }, { maquina: 'FORNO', horas: 1 }, { maquina: 'EMBALAGEM', horas: 1 }] });
      lista.push({ id: 'P' + n++, cliente: 'Loja própria', produto: 'Pão francês (fornada da tarde)', quantidade: 900, liberacao: `${d}T08:00`, prazo: `${d}T15:30`,
        etapas: [{ maquina: 'MASSEIRA', horas: 0.5 }, { maquina: 'MODELADORA', horas: 0.5 }, { maquina: 'FERMENTACAO', horas: 1.5 }, { maquina: 'FORNO', horas: 1 }] });
    }
    lista.push({ id: 'P' + n++, cliente: 'Buffet Estrela', produto: 'Mini pães para evento', quantidade: 1200, liberacao: '2026-11-27T12:00', prazo: '2026-11-28T11:00',
      etapas: [{ maquina: 'MASSEIRA', horas: 1 }, { maquina: 'MODELADORA', horas: 1.5 }, { maquina: 'FERMENTACAO', horas: 2 }, { maquina: 'FORNO', horas: 2 }, { maquina: 'EMBALAGEM', horas: 1 }] });
    return lista;
  }
  const tarifaPadaria = copia(TARIFA_ENEL_SP_2026);
  tarifaPadaria.modalidade = 'B3_branca';
  tarifaPadaria.demandaContratada = { unica: 0, ponta: 0, foraPonta: 0 };

  const padaria = {
    versao: 1,
    nome: 'Panificadora Pão da Vila (exemplo)',
    descricao: 'Padaria industrial em baixa tensão (Grupo B3) que passou para a Tarifa Branca, com 12 kWp de solar. Mostra como replanejar a produção para fugir do horário caro (16h30 às 21h30).',
    exemplosEventos: [
      'O forno 1 está em manutenção das 3h às 9h de terça',
      'A Escola Municipal pediu mais 300 bisnaguinhas para quarta às 9h',
      'Cancelaram o P216',
      'Previsão de chuva na quinta e na sexta',
      'O boiler e as câmaras não podem passar de 30 kW hoje à noite',
      'Sábado vamos trabalhar só até 12h',
    ],
    cidade: 'São Paulo - SP',
    inicio: '2026-11-23',
    dias: 7,
    passoMin: 15,
    agora: '2026-11-23T00:00',
    objetivo: { pesoPico: 5 },
    tarifa: tarifaPadaria,
    solar: {
      ativo: true, kWp: 12, pr: 0.8, latitude: -23.55, longitude: -46.63,
      nebulosidade: [0.95, 0.8, 0.35, 0.7, 0.9, 0.6, 0.85],
      limiteInjecaoKW: '',
      voltWatt: { ativo: false, v1: 1.05, v2: 1.10 },
      rede: { tensaoV: 220, resistenciaOhm: 0.02, tensaoBase: 1.0, elevacaoMeioDia: 0.02 },
      custoKWp: 4200,
    },
    maquinas: [
      { id: 'MASSEIRA', nome: 'Masseira espiral', unidades: 1, potenciaKW: 7.5, fp: 0.82, janela: 'seg-sab 03:00-22:00' },
      { id: 'MODELADORA', nome: 'Divisora e modeladora', unidades: 1, potenciaKW: 3, fp: 0.8, janela: 'seg-sab 03:00-22:00' },
      { id: 'FERMENTACAO', nome: 'Câmara de fermentação', unidades: 2, potenciaKW: 2.5, fp: 0.9, janela: 'todos 00:00-24:00' },
      { id: 'FORNO', nome: 'Forno turbo elétrico', unidades: 2, potenciaKW: 18, fp: 0.99, janela: 'seg-sab 03:00-22:00' },
      { id: 'EMBALAGEM', nome: 'Fatiadora e embaladora', unidades: 1, potenciaKW: 2.2, fp: 0.8, janela: 'seg-sab 03:00-22:00' },
    ],
    pedidos: pedidosPadaria(),
    cargasFixas: [
      { nome: 'Câmaras frias e freezers', kW: 4, fp: 0.85, janela: 'todos 00:00-24:00' },
      { nome: 'Iluminação da produção', kW: 1.5, fp: 0.95, janela: 'seg-sab 03:00-22:00' },
      { nome: 'Exaustão e climatização da produção', kW: 3, fp: 0.85, janela: 'seg-sab 03:00-22:00' },
      { nome: 'Loja e escritório', kW: 2.5, fp: 0.9, janela: 'seg-sab 07:00-19:00' },
    ],
    cargasFlexiveis: [
      { id: 'BOILER', nome: 'Aquecedor de água (boiler)', energiaKWh: 14, potenciaMaxKW: 4, janela: '00:00-24:00', dias: 'todos', continua: false, fp: 1 },
    ],
    indisponibilidades: [],
    limitesDemanda: [],
    excecoesTurno: [],
  };

  CC.EXEMPLOS = {
    metalurgica: { titulo: 'Metalúrgica (A4 Verde, com solar)', cenario: metalurgica },
    padaria: { titulo: 'Padaria industrial (B3, baixa tensão)', cenario: padaria },
  };
})(typeof window !== 'undefined' ? window : globalThis);
