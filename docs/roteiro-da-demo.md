# Roteiro da demonstração (3 minutos)

Antes de começar: abra o link (ou o `index.html` da pasta, se a internet falhar) e deixe carregado o exemplo da **Metalúrgica**. Se alguém mexeu nos dados, use *Trocar de cenário… → Metalúrgica*.

## 1. O problema (30 s)
"Uma pequena metalúrgica paga energia pelo horário e pelo maior pico de 15 minutos do mês. Hoje as máquinas ligam todas juntas no fim da tarde, bem no horário de ponta, e o pico passa da demanda contratada: tem multa."

Mostre na **Visão geral**, botão **Como é hoje**: os picos e as faixas vermelhas (ponta).

## 2. A solução (45 s)
Clique em **Planejado** e depois em **Comparar**.
"O Carga Certa reorganiza a produção respeitando todos os prazos: o forno passa a rodar à noite ou no meio do dia, quando há sol; a pintura e a usinagem saem da ponta; e a recarga das empilhadeiras começa às 20h30. A conta cai de R$ 15.320 para R$ 12.035 por mês, 21% a menos, e o pico cai de 108 para 57 kW, sem atrasar nenhuma entrega."

Aponte a lista **O que o planejador mudou** e a tabela da conta (a multa de ultrapassagem some).

## 3. O dia a dia com IA (45 s)
Aba **Eventos do dia**. Clique nos exemplos "O torno 2 quebrou e só volta amanhã às 14h" e "O cliente Hidro Bombas antecipou o P107 para quinta às 10h". Clique em **Interpretar**.
"O encarregado escreve como fala no grupo da fábrica. A IA entende qual máquina, qual pedido e até quando, e uma pessoa confere antes de aplicar."
Clique em **Aplicar e replanejar** e mostre o **Impacto**: as entregas continuam no prazo e só o necessário mudou.

## 4. A engenharia por trás (45 s)
Aba **Diagnóstico** → **Comparar tarifas e dimensionar a solar**.
- "Com a agenda nova, dá para baixar a demanda contratada de 100 para 60 kW: mais R$ 983 por mês."
- "No dimensionamento da solar consideramos o que um engenheiro olha e uma planilha não: o limite de injeção da distribuidora e o controle volt-watt do inversor, que cortam geração quando a tensão sobe. Também mostramos que a solar derruba o fator de potência medido e dimensionamos o banco de capacitores."
- Clique em **Relatório**: "Sai um diagnóstico pronto para o engenheiro responsável assinar."

## 5. Fechamento (15 s)
"ODS 7: mais energia solar aproveitada. ODS 9: digitalização da pequena indústria. ODS 12: menos picos e instalações sem superdimensionamento. O Carga Certa leva conhecimento de engenharia elétrica para quem não tem um engenheiro de energia na equipe."

---

## Perguntas que a banca pode fazer

**De onde vêm as tarifas?** Dos dados abertos da ANEEL: tarifas de aplicação da Enel SP homologadas na REH nº 3.596/2026, somando TUSD e TE. Os tributos entram como percentual configurável.

**Como vocês otimizam?** Programação dinâmica no tempo para recolocar todas as etapas de um pedido de uma vez, dentro de uma busca em vizinhança grande com recozimento simulado. Escolhemos isso em vez de um solver MILP porque roda no navegador, em cerca de 1 segundo, sem servidor e sem internet.

**Onde está a IA?** O classificador de intenção é um Naive Bayes treinado no navegador (aprendizado de máquina). A extração de máquinas, pedidos e horários usa regras em português. Para mensagens mais livres dá para ligar o Gemini (plano grátis) ou o Claude. Em todos os casos uma pessoa confere antes de aplicar.

**E se a mensagem estiver errada?** O cartão mostra o que a IA entendeu, com campos editáveis, e dá para desfazer o último evento.

**Isso vale para baixa tensão?** Vale. O exemplo da padaria (grupo B3) mostra a Tarifa Branca: trocar de tarifa sem mudar a agenda deixa a conta 19% mais cara; replanejando, ela fica mais barata que a Convencional.

**Quais as limitações?** A conta é estimada a partir de uma semana, não modelamos custo de mão de obra noturna nem tempo de preparação entre produtos, e as recomendações precisam ser validadas por um engenheiro com medições reais.
