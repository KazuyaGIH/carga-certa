/* Carga Certa — geração solar e balanço elétrico no ponto de conexão.
 *
 * 1) Irradiância de céu claro: posição do Sol (equações da NOAA) + modelo de Haurwitz.
 *    Geração = kWp x PR x GHI/1000 x fator de céu do dia (1 = céu limpo, 0,3 = nublado).
 *
 * 2) Balanço de um intervalo (closed form, sem iteração), com duas limitações reais da geração distribuída:
 *    - Limite de injeção (kW): a distribuidora pode limitar a exportação (ex.: risco de inversão de fluxo).
 *      O que passa do limite é cortado (curtailment).
 *    - Controle volt-watt do inversor: a tensão no ponto de conexão sobe quando a fábrica exporta
 *      (dV ≈ R·P/V²). Acima de V1 o inversor reduz a potência linearmente até zero em V2.
 *    Consumir no próprio local a energia do meio-dia reduz a exportação, a subida de tensão e o corte.
 */
(function (G) {
  'use strict';
  const CC = G.CC = G.CC || {};
  const U = CC.util;
  const SO = CC.solar = {};

  /** Irradiância global horizontal de céu claro (W/m²) num instante (minutos absolutos, horário local). */
  SO.ghiCeuClaro = function (minAbs, lat, lon, fuso) {
    const doy = U.diaDoAno(minAbs);
    const minDia = ((minAbs % 1440) + 1440) % 1440;
    const hora = minDia / 60;
    const g = (2 * Math.PI / 365) * (doy - 1 + (hora - 12) / 24);
    const eqt = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
    const decl = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g)
      + 0.000907 * Math.sin(2 * g) - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
    const tst = minDia + eqt + 4 * lon - 60 * (fuso == null ? -3 : fuso);
    const ha = (tst / 4 - 180) * Math.PI / 180;
    const la = lat * Math.PI / 180;
    const cz = Math.sin(la) * Math.sin(decl) + Math.cos(la) * Math.cos(decl) * Math.cos(ha);
    if (cz <= 0.01) return 0;
    return 1098 * cz * Math.exp(-0.057 / cz);
  };

  /**
   * Balanço do intervalo t com carga L (kW). Escreve em `out`:
   *  pv  = geração aproveitada (kW)      imp = potência tirada da rede (kW)
   *  exp = potência injetada (kW)        cl  = corte pelo limite de injeção (kW)
   *  cv  = corte pelo volt-watt (kW)     v   = tensão no ponto de conexão (pu)
   */
  SO.balanco = function (inst, t, L, out) {
    const pvA = inst.pvDisp[t];
    const v0 = inst.v0[t];
    if (!(pvA > 0)) { out.pv = 0; out.imp = L; out.exp = 0; out.cl = 0; out.cv = 0; out.v = v0; return out; }
    const vw = inst.vw, a = inst.sensV;
    let f0 = 1;
    if (vw.ativo) {
      f0 = (vw.v2 - v0) / (vw.v2 - vw.v1);
      if (f0 > 1) f0 = 1; else if (f0 < 0) f0 = 0;
    }
    const pvMax0 = pvA * f0;
    if (pvMax0 <= L) { // tudo consumido na fábrica, sem exportação
      out.pv = pvMax0; out.imp = L - pvMax0; out.exp = 0; out.cl = 0; out.cv = pvA - pvMax0; out.v = v0;
      return out;
    }
    const eLivre = pvA - L;
    let e = eLivre;
    if (vw.ativo && v0 + a * eLivre > vw.v1) {
      // Interseção da reta do volt-watt com a subida de tensão causada pela exportação.
      const k = pvA / (vw.v2 - vw.v1);
      const eVW = (k * (vw.v2 - v0) - L) / (1 + k * a);
      if (eVW < e) e = eVW > 0 ? eVW : 0;
    }
    const cv = eLivre - e;
    let cl = 0;
    if (e > inst.limInj) { cl = e - inst.limInj; e = inst.limInj; }
    out.pv = L + e; out.imp = 0; out.exp = e; out.cl = cl; out.cv = cv; out.v = v0 + a * e;
    return out;
  };
})(typeof window !== 'undefined' ? window : globalThis);
