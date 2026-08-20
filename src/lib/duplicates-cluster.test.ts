import { describe, expect, it } from "vitest";
import { clusterByTextSimilarity, DUPLICATE_SIM_THRESHOLD, textJaccardForTest } from "./duplicates.server";

// Release 1.2.17 — subagrupamento por ligação completa dentro do mesmo telefone.
// Antes, a média de similaridade de todo o grupo mascarava duplicados idênticos
// quando o mesmo consultor tinha também procuras legítimas diferentes.

type M = { id: string; texto_original: string; completeness?: number };
const m = (id: string, texto_original: string, completeness = 10): M => ({ id, texto_original, completeness });

const dup = (texto: string, n: number, prefix: string) =>
  Array.from({ length: n }, (_, i) => m(`${prefix}${i + 1}`, texto));

const OUTRAS = [
  m("x1", "Procuro terreno para construcao de edificio para estudantes na zona do polo universitario do Porto"),
  m("x2", "Procuro quinta ou herdade para alojamento local ate 400 mil euros em Penafiel ou Marco de Canaveses"),
];

describe("clusterByTextSimilarity — 4 grupos reais confirmados", () => {
  const casos: Array<{ nome: string; texto: string; copias: number }> = [
    {
      nome: "Comprarcasa Rede Servicos Imobiliarios",
      texto:
        "Boa Tarde. Procuro moradia na zona da Maia, trofa, Areosa, para cliente ate 360K. Procuro ainda na zona da Maia, Matosinhos, Lavra, Leca da Palmeira moradia recente com piscina ate 860K. Quem tiver e possa partilhar agradeco. Muito obrigado.",
      copias: 5,
    },
    {
      nome: "Flavio Ferreira",
      texto:
        "Bom dia colegas. Cliente meu procura apartamento T3 com garagem em Gondomar ou Rio Tinto ate 250 mil euros. Quem tiver para partilha agradeco.",
      copias: 4,
    },
    {
      nome: "Manuela Rodrigues da Silva Imobiliaria",
      texto:
        "Boa tarde. Tenho cliente com capitais proprios para moradia em Vila Nova de Gaia ate 400 mil euros, com quintal e lugar de garagem. Obrigada.",
      copias: 4,
    },
    {
      nome: "Tania Caratao",
      texto:
        "Bom dia. Procuro apartamento em Odivelas ou Sintra ate 250 mil euros para cliente com credito aprovado, de preferencia com elevador e garagem.",
      copias: 4,
    },
  ];

  for (const c of casos) {
    it(`${c.nome}: texto idêntico repetido forma um grupo apesar de procuras legítimas diferentes`, () => {
      const membros = [...dup(c.texto, c.copias, "d"), ...OUTRAS];
      const clusters = clusterByTextSimilarity(membros);
      const grande = clusters.filter((g) => g.membros.length >= 2);
      expect(grande).toHaveLength(1);
      expect(grande[0].membros.map((x) => x.id).sort()).toEqual(
        dup(c.texto, c.copias, "d").map((x) => x.id).sort(),
      );
      expect(grande[0].similaridade_minima).toBe(1);
      // Procuras legítimas divergentes ficam de fora.
      expect(grande[0].membros.some((x) => x.id.startsWith("x"))).toBe(false);
    });
  }
});

describe("não-regressão: grupos legítimos não são agrupados", () => {
  it("Isabel Santos (consultora, 3 procuras distintas) não forma cluster", () => {
    const clusters = clusterByTextSimilarity([
      m("a", "Procuro T2 em Matosinhos ate 250 mil euros com garagem"),
      m("b", "Cliente quer T4 moradia em Gondomar ate 500 mil euros com jardim"),
      m("c", "Compro apartamento T1 no Porto Baixa ate 180 mil para investimento"),
    ]);
    expect(clusters.filter((g) => g.membros.length >= 2)).toHaveLength(0);
  });

  it("Sandra de Sousa Alves (mesmo telefone, necessidades diferentes) não forma cluster", () => {
    const clusters = clusterByTextSimilarity([
      m("s1", "Bom dia, procuro loja com armazem no centro de Braga para arrendamento ate 1500 euros mensais"),
      m("s2", "Boa tarde, tenho cliente para moradia isolada em Esposende com piscina ate 600 mil euros"),
      m("s3", "Procuro terreno agricola em Barcelos com poco proprio ate 90 mil euros para investimento"),
    ]);
    expect(clusters.filter((g) => g.membros.length >= 2)).toHaveLength(0);
  });
});

describe("ligação completa (não cadeia)", () => {
  it("A~B e B~C acima do limiar mas A~C abaixo não juntam os três", () => {
    // Construção controlada: tokens partilhados por pares, A e C bastante distintos.
    const A = m("A", "alpha bravo charlie delta echo foxtrot golf hotel india juliett");
    const B = m("B", "alpha bravo charlie delta echo foxtrot golf hotel india kilo");
    const C = m("C", "alpha bravo charlie delta echo foxtrot golf hotel kilo lima mike november oscar papa quebec romeo sierra tango uniform victor");

    const ab = textJaccardForTest(A.texto_original, B.texto_original);
    const bc = textJaccardForTest(B.texto_original, C.texto_original);
    const ac = textJaccardForTest(A.texto_original, C.texto_original);
    expect(ab).toBeGreaterThanOrEqual(DUPLICATE_SIM_THRESHOLD);
    expect(bc).toBeLessThan(DUPLICATE_SIM_THRESHOLD);
    expect(ac).toBeLessThan(DUPLICATE_SIM_THRESHOLD);

    const clusters = clusterByTextSimilarity([A, B, C]).filter((g) => g.membros.length >= 2);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].membros).toHaveLength(2);
    expect(clusters[0].membros.map((x) => x.id).sort()).toEqual(["A", "B"]);
  });
});
