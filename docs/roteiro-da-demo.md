# Roteiro da demonstração (3 minutos)

## Antes de começar (5 minutos antes)

1. Abra o link (ou o `index.html` da pasta, se a internet falhar) e deixe carregado o exemplo da **Metalúrgica**. Se alguém mexeu nos dados, use *Trocar de cenário… → Metalúrgica*.
2. Aba **Diagnóstico**: no campo *Recado para o engenheiro*, escreva "Pagamos multa de ultrapassagem em alguns meses e queremos saber se vale aumentar a usina solar."
3. Aba **Engenheiros**: preencha o perfil com o nome de quem vai fazer o papel do engenheiro, marque uma ou duas especialidades e clique em **Carregar pedidos de exemplo** (leva alguns segundos). Entra o pedido da padaria; a metalúrgica, que está na tela, fica de fora porque vai ser mandada ao vivo.
4. Volte para a **Visão geral**.

## 1. O problema (25 s)
"Uma pequena metalúrgica paga energia pelo horário e pelo maior pico de 15 minutos do mês. Hoje as máquinas ligam todas juntas no fim da tarde, bem no horário de ponta, e o pico passa da demanda contratada: tem multa."

Mostre na **Visão geral**, botão **Como é hoje**: os picos e as faixas vermelhas (ponta).

## 2. A solução (40 s)
Clique em **Planejado** e depois em **Comparar**.
"O Carga Certa reorganiza a produção respeitando todos os prazos: o forno passa a rodar à noite ou no meio do dia, quando há sol; a pintura e a usinagem saem da ponta; e a recarga das empilhadeiras começa às 20h30. A conta cai de R$ 15.320 para R$ 12.035 por mês, 21% a menos, e o pico cai de 108 para 57 kW, sem atrasar nenhuma entrega."

## 3. O dia a dia com IA (35 s)
Aba **Eventos do dia**. Clique no exemplo "O torno 2 quebrou e só volta amanhã às 14h" e em **Interpretar**.
"O encarregado escreve como fala no grupo da fábrica. A IA entende qual máquina e até quando, e uma pessoa confere antes de aplicar."
Clique em **Aplicar e replanejar** e mostre o **Impacto**: as entregas continuam no prazo e só o necessário mudou.

## 4. A ponte com o engenheiro (60 s)
Aba **Diagnóstico**.
"A ferramenta também sugere baixar a demanda contratada de 100 para 60 kW, aumentar a solar considerando o corte por limite de injeção e volt-watt, e instalar um banco de capacitores. Mas mudar contrato ou comprar equipamento precisa de um engenheiro, e a pequena indústria não tem um."

Clique em **Pedir avaliação**. Leva alguns segundos, porque o diagnóstico é refeito com o torno parado: "O pedido sai com a situação de agora." Vá para a aba **Engenheiros**.
"Do outro lado, engenheiros voluntários, empresas juniores e consultores veem a fila de pedidos ordenada pela economia possível, com destaque para a especialidade de cada um. Dá para ordenar pela porcentagem da conta, que dá prioridade aos negócios menores."

Clique em **Abrir e revisar** na Metalúrgica e role até o item do fator de potência.
"A análise já está pronta. O engenheiro confere em campo só o que a ferramenta não sabe: faturas, placa das máquinas, medição de harmônicas antes dos capacitores. O sistema avisa onde é preciso ART."
Marque **Aprovar** nos itens, menos na demanda: nela, marque **Não aprovar** e escreva "Manter 100 kW: a usina de 120 kWp precisa de 100 kW de inversor." Clique em **Emitir parecer**.
"A ferramenta avisou que reduzir a demanda e aumentar a solar disputam o mesmo limite. Quem decide é o engenheiro: aqui ele ficou com a solar, que economiza mais."

Volte à aba **Diagnóstico**: o parecer aparece com o nome do engenheiro, e cada recomendação mostra a decisão. Clique em **Relatório**: "O documento sai com o parecer e o nome dele na assinatura."

## 5. Fechamento (20 s)
(Se der tempo, mostre na **Visão geral** o bloco "Impacto na rede e no clima": 2.119 kWh por mês saem da ponta; o CO₂ cai pouco, e a tela diz isso.)
"ODS 7: mais energia solar aproveitada e mais eficiência, que é a meta 7.3. ODS 9: indústria mais eficiente e digital, meta 9.4. ODS 12: menos picos e instalações sem superdimensionamento. O Carga Certa faz a primeira análise, que uma pequena indústria não conseguiria pagar, e leva o caso pronto ao engenheiro que pode validar. O tempo dele vai para onde a economia é maior."

---

## Perguntas que a banca pode fazer

**Onde o projeto conecta engenheiros a um setor carente?** Na aba Engenheiros. A pequena indústria não tem engenheiro de energia e não paga uma consultoria completa. Ela manda o pedido com os dados e o diagnóstico prontos. O engenheiro escolhe na fila onde ajudar, confere em campo o que a ferramenta não sabe e devolve um parecer com nome e registro.

**Por que um engenheiro entraria nessa rede?** Empresas juniores e projetos de extensão ganham casos reais, com alunos aprendendo sob supervisão. Consultores recebem clientes que já sabem quanto podem economizar. Voluntários escolhem onde o impacto é maior. Em todos os casos, a parte repetitiva da análise já vem feita.

**A rede existe de verdade?** No protótipo, a fila fica no navegador e o pedido vai por arquivo (e-mail ou WhatsApp). Numa versão completa, a fila seria compartilhada, com cadastro dos engenheiros e conferência do registro no CREA.

**De onde vêm as tarifas?** Dos dados abertos da ANEEL: tarifas de aplicação da Enel SP homologadas na REH nº 3.596/2026, somando TUSD e TE. Os tributos entram como percentual configurável.

**Como vocês otimizam?** Programação dinâmica no tempo para recolocar todas as etapas de um pedido de uma vez, dentro de uma busca em vizinhança grande com recozimento simulado. Escolhemos isso em vez de um solver MILP porque roda no navegador, em cerca de 1 segundo, sem servidor e sem internet.

**Onde está a IA?** O classificador de intenção é um Naive Bayes treinado no navegador (aprendizado de máquina). A extração de máquinas, pedidos e horários usa regras em português. Para mensagens mais livres dá para ligar o Gemini (plano grátis) ou o Claude. Em todos os casos uma pessoa confere antes de aplicar.

**E se a mensagem estiver errada?** O cartão mostra o que a IA entendeu, com campos editáveis, e dá para desfazer o último evento.

**Isso vale para baixa tensão?** Vale. O exemplo da padaria (grupo B3) mostra a Tarifa Branca: trocar de tarifa sem mudar a agenda deixa a conta 19% mais cara; replanejando, ela fica mais barata que a Convencional.

**Gastar menos é o mesmo que poluir menos?** Não, e a ferramenta mostra a diferença (Visão geral, bloco "Impacto na rede e no clima"; tabela completa no fim do Diagnóstico). A agenda muda o horário, quase não muda o total: na metalúrgica o consumo continua em 22.078 kWh/mês. O CO₂ só cai quando cai a energia tirada da rede, aqui porque a fábrica usa mais da própria solar: 15.331 → 14.778 kWh/mês da rede, 590 → 569 kg de CO₂ por mês (fator médio do SIN, 38,5 kg/MWh em 2023, MCTI). O ganho maior é no horário: 2.119 kWh/mês saem da ponta, quando o ONS aciona termelétricas (em julho de 2025 previa déficit de cerca de 4 GW nesse horário), e o consumo vai para o meio do dia, quando sobra solar e eólica (cerca de 20,6% da energia limpa que poderia ter sido gerada em 2025 foi cortada, segundo a Volt Robotics).

**Quem implementa as mudanças? O engenheiro faz tudo sozinho?** Não. Cada recomendação no Diagnóstico tem a linha "quem faz o quê": o dono decide; o encarregado aplica a agenda; eletricista ou instaladora executam; o engenheiro valida e assina a ART; a distribuidora aprova mudança de contrato e conexão da solar. Também mostra o entrave típico: adicional noturno (CLT art. 73), prazos do contrato, investimento da solar, harmônicas antes dos capacitores.

**Quem acompanha depois?** A aba Acompanhamento. A fábrica digita as faturas de cada mês e marca quando começou a seguir o plano; a ferramenta compara a economia real com a prevista e avisa quando é hora de chamar o engenheiro de novo. Na metalúrgica há faturas de exemplo (fictícias): 18,3% real contra 21,4% previsto, e os meses com multa de ultrapassagem aparecem destacados. As faturas vão junto no pedido ao engenheiro.

**Quais as limitações?** A conta é estimada a partir de uma semana, não modelamos custo de mão de obra noturna nem tempo de preparação entre produtos, e as recomendações precisam ser validadas por um engenheiro com medições reais. É justamente para isso que existe a aba Engenheiros.
