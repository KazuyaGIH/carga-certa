# Carga Certa

**Planejamento de produção que olha a conta de luz.** Protótipo da equipe **T³ch** para o **Hack@Poli 2026**
("Engenharia com propósito: o papel do engenheiro na Agenda 2030"; eixo Inovação e Digitalização da Indústria Nacional; ODS 7, 9 e 12).

Pequenas indústrias pagam energia pelo **horário** (ponta, intermediário, fora de ponta) e, no grupo A, pelo **maior pico de 15 minutos do mês**. O Carga Certa recebe os pedidos, as etapas, as máquinas e a tarifa, e monta a agenda de produção que cumpre os prazos gastando menos. Quando algo acontece na fábrica ("o torno 2 quebrou"), a IA transforma a mensagem em restrições e o plano é refeito. Um diagnóstico de engenharia elétrica completa a análise: modalidade tarifária, demanda contratada, fator de carga, quanto de solar instalar (com corte por limite de injeção e volt-watt) e fator de potência.

Nos exemplos incluídos:

| Cenário | Conta hoje | Conta planejada | Pico | Entregas |
|---|---|---|---|---|
| Metalúrgica (A4 Verde, 60 kWp de solar) | R$ 15.320/mês | **R$ 12.035/mês (−21,4%)** | 108 → 57 kW | 12 de 12 no prazo |
| Padaria industrial (B3 Branca, 12 kWp) | R$ 8.578/mês | **R$ 7.129/mês (−16,9%)** | 49 → 34 kW | 16 de 16 no prazo |

Na metalúrgica, o diagnóstico ainda mostra que dá para baixar a demanda contratada de 100 para 60 kW (mais R$ 983/mês) e que a solar derruba o fator de potência medido (reativo excedente de ~R$ 1.200/mês, resolvido com um banco automático de 35 kvar).

---

## Como abrir

- **Pelo link** (depois de publicado no GitHub Pages): abre em qualquer navegador, no computador ou no celular, sem instalar nada.
- **Sem internet** (bom como reserva no dia da apresentação): baixe a pasta inteira, abra a pasta e dê dois cliques em `index.html`. Tudo funciona, menos a IA na nuvem (Gemini/Claude). A IA local continua funcionando.

Os dados ficam salvos no próprio navegador. Para levar um cenário para outra pessoa, use **Salvar** (baixa um `.json`) e **Abrir**.

## Como usar

1. **Visão geral**: conta do mês antes e depois, pico, energia na ponta, fator de carga, solar aproveitada e entregas no prazo. O gráfico mostra a curva de carga da semana (botões *Planejado*, *Como é hoje* e *Comparar*).
2. **Agenda**: o Gantt das máquinas (semana ou um dia) e a tabela de etapas. Passe o mouse nas barras.
3. **Eventos do dia**: escreva o que aconteceu, como no grupo da fábrica, ou clique num exemplo. Clique em **Interpretar**, confira os campos e clique em **Aplicar e replanejar**. O que já começou antes de "agora" não muda, e o plano só mexe onde vale a pena. Dá para **Desfazer**.
4. **Fábrica** e **Energia e tarifa**: edite máquinas, pedidos, cargas, tarifa e solar. Depois clique em **Otimizar agenda**.
5. **Diagnóstico**: clique em **Comparar tarifas e dimensionar a solar**.
6. **Relatório**: gera o documento para imprimir ou salvar em PDF, com espaço para o engenheiro responsável assinar.

## Inteligência artificial

- **IA local (padrão, sem internet):** classificador Naive Bayes treinado no navegador com frases de exemplo (aprendizado de máquina supervisionado) e extração de máquina, unidade, pedido, datas, horários, durações e quantidades em português. Acerta as 16 frases do teste automático.
- **Gemini (opcional, tem plano gratuito):** crie uma chave em [aistudio.google.com/apikey](https://aistudio.google.com/apikey) e cole na aba *Eventos do dia*. O modelo padrão é `gemini-flash-latest`; se ele não existir, o programa escolhe outro Flash disponível.
- **Claude (opcional, pago por uso):** chave do [console da Anthropic](https://console.anthropic.com/). Usa o SDK oficial `@anthropic-ai/sdk` (1.3.0, carregado do jsDelivr), modelo `claude-opus-5-5`, saída em JSON Schema e fallback de recusa no servidor (`fallbacks: "default"`).

A chave fica **só no navegador de quem usa** (pode marcar "lembrar"). Nunca coloque chaves no repositório. Se a IA na nuvem falhar, o programa avisa e usa a IA local.

## Como funciona (para a banca)

**Modelo.** O horizonte (1 semana) vira 672 intervalos de 15 minutos, o mesmo intervalo da medição de demanda. Cada pedido tem etapas em sequência; cada etapa ocupa uma unidade de máquina por um tempo fixo e puxa a potência da máquina. Restrições: uma etapa por unidade, ordem das etapas, turno das máquinas, paradas, liberação do material e prazo. Cargas flexíveis (empilhadeira, bomba, aquecimento com reservatório) precisam receber uma energia dentro de uma janela.

**Objetivo (R$/mês).** Energia por posto tarifário + demanda faturada + multa de ultrapassagem − créditos da energia injetada + um peso opcional por kW de pico (custo de transformador e cabos) + penalidades de atraso.

**Otimizador.**
1. *Como é hoje:* cada etapa o mais cedo possível, pedidos por ordem de prazo.
2. *Busca em vizinhança grande:* tira um pedido (ou dois, ou uma carga flexível) da agenda e recoloca. Para um pedido, a melhor posição de todas as etapas sai de uma **programação dinâmica no tempo** (prefixos mínimos sobre o fim da etapa anterior, janela deslizante para o pico). A aceitação usa recozimento simulado com semente fixa, e no fim há um polimento guloso.
3. *Replanejamento:* etapas iniciadas antes de "agora" ficam fixas, e mover uma etapa já combinada custa R$ 20/mês. Assim o plano não "chacoalha" à toa.

Nos exemplos, roda no navegador em cerca de 1 segundo.

**Engenharia elétrica.**
- Tarifas de aplicação da Enel SP homologadas pela ANEEL (REH nº 3.596/2026), sem tributos, com tributos "por dentro" configuráveis (padrão 22,5%).
- Ponta 17:30–20:30 em dias úteis; Tarifa Branca com intermediário de 1 h antes e depois; feriados nacionais fora de ponta.
- Demanda faturada = máx(medida, contratada); acima de 105% da contratada, o excedente paga 2× (REN 1.000/2021).
- Solar: posição do Sol (NOAA) + céu claro de Haurwitz × céu previsto do dia. A energia injetada vale a tarifa menos 60% do Fio B (Lei 14.300/2022, regra de 2026) e só compensa o que foi consumido da rede.
- **Curtailment e volt-watt:** ΔV ≈ R·P/V². Acima de V1 o inversor reduz a potência linearmente até zerar em V2; acima do limite de injeção a geração é cortada. A interseção é calculada em forma fechada. Ligar cargas ao meio-dia recupera essa energia.
- Dimensionamento da solar: varre a potência até o limite regulatório (inversores até a demanda contratada no grupo A), replaneja a agenda para cada tamanho e calcula retorno simples e VPL (25 anos, 10% a.a.).
- Fator de potência: reativo excedente horário com referência 0,92 e banco de capacitores automático (alvo 0,95).

## Estrutura dos arquivos

| Arquivo | O que faz |
|---|---|
| `index.html` | A página (abas e textos) |
| `css/estilo.css` | Visual |
| `js/util.js` | Datas, números, horários de funcionamento |
| `js/tarifas.js` | Tarifas da ANEEL, postos, demanda, créditos da solar |
| `js/solar.js` | Geração solar e balanço com limite de injeção e volt-watt |
| `js/modelo.js` | Transforma o cenário em intervalos de 15 min |
| `js/otimizador.js` | Agenda "como é hoje", otimização e avaliação da conta |
| `js/diagnostico.js` | Modalidades, demanda contratada, solar, fator de potência |
| `js/ia-local.js` | IA local (Naive Bayes + extração em português) |
| `js/ia-nuvem.js` | Gemini e Claude (opcionais) |
| `js/eventos.js` | Aplica os eventos no cenário |
| `js/graficos.js` | Gráficos e Gantt |
| `js/app.js` | Liga tudo na tela |
| `dados/exemplos.js` | Os dois cenários de exemplo (empresas fictícias) |
| `vendor/chart.umd.js` | Chart.js 4.4.1 (licença MIT), incluído para funcionar sem internet |
| `testes/testar.js` | Testes automáticos: `node testes/testar.js` |
| `docs/roteiro-da-demo.md` | Roteiro de 3 minutos para o pitch |

Não há etapa de compilação: é HTML, CSS e JavaScript puro.

## Para a equipe editar

- **Pelo site do GitHub:** abra o arquivo, clique no lápis, edite e clique em *Commit changes*. Em um ou dois minutos o link publicado atualiza.
- **No computador:** baixe ou clone o repositório, edite e abra o `index.html` no navegador. Se tiver o Node instalado, rode `node testes/testar.js` antes de enviar.
- Para mudar os exemplos, edite `dados/exemplos.js`. Para trocar o nome do produto, procure por "Carga Certa" no `index.html`.

## Limitações

- A conta mensal é estimada a partir de uma semana; o pico real do mês pode ser maior.
- Não modelamos custo de mão de obra noturna, tempo de preparação entre produtos nem estoques intermediários.
- Tarifas, tributos e regras mudam: confira sempre com a fatura e a distribuidora.

## Fontes

- ANEEL, Dados Abertos: "Tarifas de Aplicação das Distribuidoras de Energia Elétrica" e "Componentes Tarifárias" (Enel SP, REH nº 3.596 de 03/07/2026, vigência 04/07/2026 a 03/07/2027).
- ANEEL, REN nº 1.000/2021 (postos tarifários, demanda, ultrapassagem, reativo excedente).
- Lei nº 14.300/2022 (micro e minigeração distribuída; transição do Fio B).
- NOAA, *General Solar Position Calculations*; B. Haurwitz (1945), modelo de céu claro.
