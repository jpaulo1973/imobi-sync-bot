// Regressão de arquitetura: garante que a decisão Aceitar/Revisão/Descartar
// é IDÊNTICA independentemente do canal de origem (Excel, WhatsApp,
// extractAndMatch, futuros conectores/API/PDF). Todos os canais têm de
// invocar `evaluateSearchAcceptance` de src/lib/search-acceptance.ts —
// nenhum canal pode replicar a lógica.

import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  evaluateSearchAcceptance,
  hasStructuredCriteria,
  type AcceptanceDecision,
  type Finalidade,
} from "./search-acceptance";

// ---------- Adaptadores por canal ----------
// Cada adaptador simula o que o canal faz: pega no seu payload nativo,
// extrai texto + finalidade + estrutura, e delega a decisão ao módulo único.

type ExcelRow = {
  mensagem?: string | null;
  descricao?: string | null;
  finalidade: Finalidade;
  tipologia?: string | null;
  tipo_imovel?: string[] | null;
  zona?: string | null;
  budget_min?: number | null;
  budget_max?: number | null;
  area_min?: number | null;
};
function decideFromExcel(r: ExcelRow): AcceptanceDecision {
  return evaluateSearchAcceptance({
    text: r.mensagem ?? r.descricao ?? null,
    finalidade: r.finalidade,
    hasStructured: hasStructuredCriteria(r),
  });
}

type WhatsappLead = {
  mensagem_original?: string | null;
  resumo?: string | null;
  finalidade: Finalidade;
  tipologia?: string | null;
  tipo_imovel?: string[] | null;
  zona?: string | null;
  budget_min?: number | null;
  budget_max?: number | null;
  area_min?: number | null;
};
function decideFromWhatsapp(l: WhatsappLead): AcceptanceDecision {
  return evaluateSearchAcceptance({
    text: l.mensagem_original ?? l.resumo ?? null,
    finalidade: l.finalidade,
    hasStructured: hasStructuredCriteria(l),
  });
}

type ExtractLead = {
  mensagem_original?: string | null;
  resumo?: string | null;
  finalidade: Finalidade;
  tipologia?: string | null;
  zona?: string | null;
  preco_min?: number | null;
  preco_max?: number | null;
};
function decideFromExtract(l: ExtractLead): AcceptanceDecision {
  return evaluateSearchAcceptance({
    text: l.mensagem_original ?? l.resumo ?? null,
    finalidade: l.finalidade,
    hasStructured: hasStructuredCriteria({
      finalidade: l.finalidade,
      tipologia: l.tipologia,
      zona: l.zona,
      budget_min: l.preco_min ?? null,
      budget_max: l.preco_max ?? null,
    }),
  });
}

// Adaptador de um "futuro conector genérico" (API / PDF / e-mail):
// prova que basta implementar a extração e delegar ao módulo comum.
type GenericPayload = {
  text?: string | null;
  finalidade: Finalidade;
  tipologia?: string | null;
  tipo_imovel?: string[] | null;
  zona?: string | null;
  budget_min?: number | null;
  budget_max?: number | null;
};
function decideFromGeneric(p: GenericPayload): AcceptanceDecision {
  return evaluateSearchAcceptance({
    text: p.text ?? null,
    finalidade: p.finalidade,
    hasStructured: hasStructuredCriteria(p),
  });
}

// ---------- Cenários canónicos ----------

type Scenario = {
  name: string;
  text: string | null;
  finalidade: Finalidade;
  tipologia?: string | null;
  tipo_imovel?: string[] | null;
  zona?: string | null;
  budget_min?: number | null;
  budget_max?: number | null;
  area_min?: number | null;
  expected: AcceptanceDecision["kind"];
};

const SCENARIOS: Scenario[] = [
  {
    name: "Compra + Comprador",
    text: "Tenho comprador aprovado para crédito, T2 em Almada até 300000€",
    finalidade: "venda",
    tipologia: "T2", zona: "Almada", budget_max: 300000,
    expected: "aceite",
  },
  {
    name: "Compra + Investidor",
    text: "Investidor procura projeto aprovado com mais de 80 frações em Lisboa",
    finalidade: "venda",
    tipo_imovel: ["Prédio"], zona: "Lisboa", budget_max: 5000000,
    expected: "aceite",
  },
  {
    name: "Arrendamento + Inquilino",
    text: "Cliente pretende arrendar T2 em Alcochete, 2000€/mês",
    finalidade: "arrendamento",
    tipologia: "T2", zona: "Alcochete", budget_max: 2000,
    expected: "aceite",
  },
  {
    name: "Arrendamento estruturado sem texto",
    text: null,
    finalidade: "arrendamento",
    tipologia: "T2", zona: "Alcochete", budget_max: 2000,
    expected: "aceite",
  },
  {
    name: "Compra + Inquilino (incoerente)",
    text: "Cliente pretende arrendar T1 em Lisboa",
    finalidade: "venda",
    tipologia: "T1", zona: "Lisboa", budget_max: 250000,
    expected: "revisao",
  },
  {
    name: "Arrendamento + Senhorio (oferta)",
    text: "Tenho apartamento para arrendar em Lisboa, procuro inquilino",
    finalidade: "arrendamento",
    tipologia: "T2", zona: "Lisboa", budget_max: 1500,
    expected: "revisao",
  },
  {
    name: "Anúncio de venda",
    text: "Vende-se T3 remodelado, 250000€, agende visita",
    finalidade: "venda",
    tipologia: "T3", zona: "Porto", budget_max: 250000,
    expected: "anuncio",
  },
  {
    name: "Ambíguo sem estrutura",
    text: "Boa tarde, alguém pode ajudar?",
    finalidade: "indefinido",
    expected: "revisao",
  },
];

describe("search-acceptance — decisão determinística e igual em todos os canais", () => {
  for (const sc of SCENARIOS) {
    it(`[${sc.name}] Excel / WhatsApp / extractAndMatch / genérico → mesma decisão (${sc.expected})`, () => {
      const common = {
        finalidade: sc.finalidade,
        tipologia: sc.tipologia ?? null,
        tipo_imovel: sc.tipo_imovel ?? null,
        zona: sc.zona ?? null,
        budget_min: sc.budget_min ?? null,
        budget_max: sc.budget_max ?? null,
        area_min: sc.area_min ?? null,
      };
      const dExcel = decideFromExcel({ ...common, mensagem: sc.text });
      const dWa = decideFromWhatsapp({ ...common, mensagem_original: sc.text });
      const dExtract = decideFromExtract({
        finalidade: sc.finalidade,
        tipologia: sc.tipologia ?? null,
        zona: sc.zona ?? null,
        preco_min: sc.budget_min ?? null,
        preco_max: sc.budget_max ?? null,
        mensagem_original: sc.text,
      });
      const dGeneric = decideFromGeneric({ ...common, text: sc.text });

      expect(dExcel.kind).toBe(sc.expected);
      // Todos os canais têm de coincidir bit a bit (kind + reason).
      expect(dWa).toEqual(dExcel);
      expect(dExtract).toEqual(dExcel);
      expect(dGeneric).toEqual(dExcel);
    });
  }
});

// ---------- Guarda de arquitetura ----------
// Falha o build se algum ficheiro (fora do próprio módulo e testes) redefinir
// classifiers ou o decisor. Impede a re-introdução de lógica paralela.

function walk(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    const p = join(dir, entry);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, acc);
    else if (/\.(ts|tsx)$/.test(entry)) acc.push(p);
  }
  return acc;
}

const ALLOWED = new Set([
  join("src", "lib", "search-acceptance.ts"),
  join("src", "lib", "search-acceptance.test.ts"),
  join("src", "lib", "search-acceptance.cross-channel.test.ts"),
  // Re-exports de compatibilidade (não redefinem lógica).
  join("src", "lib", "excel-import.functions.ts"),
]);

describe("guarda de arquitetura — decisor único", () => {
  it("nenhum outro ficheiro implementa classifyBuyerText/evaluateSearchAcceptance/detectRoleSignal", () => {
    const files = walk("src");
    const offenders: string[] = [];
    for (const f of files) {
      if (ALLOWED.has(f)) continue;
      const src = readFileSync(f, "utf8");
      // Padrão de DEFINIÇÃO (function|const), não de import/uso.
      if (
        /\bfunction\s+(classifyBuyerText|evaluateSearchAcceptance|detectRoleSignal)\b/.test(src) ||
        /\b(const|let)\s+(classifyBuyerText|evaluateSearchAcceptance|detectRoleSignal)\s*=/.test(src)
      ) {
        offenders.push(f);
      }
    }
    expect(offenders).toEqual([]);
  });
});