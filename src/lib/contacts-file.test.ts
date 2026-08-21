import { describe, expect, it } from "vitest";
import {
  NAME_MATCH_THRESHOLD,
  buildSuggestions,
  nameSimilarity,
  parseContactsCsvRows,
  parseVcf,
  summarizeSuggestions,
} from "./contacts-file";
import { DUPLICATE_SIM_THRESHOLD } from "./duplicates.server";

describe("parseVcf", () => {
  it("lê um bloco simples com FN e TEL", () => {
    const r = parseVcf(
      "BEGIN:VCARD\nVERSION:3.0\nFN:Ana Sá\nTEL;TYPE=CELL:+351 912 345 678\nEND:VCARD\n",
    );
    expect(r.contactos).toEqual([{ nome: "Ana Sá", telefones: ["912345678"] }]);
    expect(r.ignorados).toBe(0);
  });

  it("desdobra linhas continuadas", () => {
    const r = parseVcf("BEGIN:VCARD\nFN:Maria Joao\n  Ferreira\nTEL:912345678\nEND:VCARD");
    expect(r.contactos[0]!.nome).toBe("Maria Joao Ferreira");
  });

  it("compõe o nome de N: quando não há FN", () => {
    const r = parseVcf("BEGIN:VCARD\nN:Ferreira;Flávio;;;\nTEL:+351913861684\nEND:VCARD");
    expect(r.contactos[0]!.nome).toBe("Flávio Ferreira");
  });

  it("acumula vários TEL e ignora números inválidos", () => {
    const r = parseVcf(
      "BEGIN:VCARD\nFN:Tania Caratao\nTEL;TYPE=CELL:912345678\nTEL;TYPE=WORK:00351211112222\nTEL:1234\nEND:VCARD",
    );
    expect(r.contactos[0]!.telefones).toEqual(["912345678", "211112222"]);
  });

  it("conta como ignorado o contacto sem telefone e devolve vazio para texto vazio", () => {
    const r = parseVcf("BEGIN:VCARD\nFN:Sem Numero\nEND:VCARD");
    expect(r.contactos).toHaveLength(0);
    expect(r.ignorados).toBe(1);
    expect(parseVcf("").contactos).toHaveLength(0);
  });

  it("junta o mesmo nome repetido em blocos diferentes", () => {
    const r = parseVcf(
      "BEGIN:VCARD\nFN:Joao Dores\nTEL:912345678\nEND:VCARD\nBEGIN:VCARD\nFN:joao dores\nTEL:913333333\nEND:VCARD",
    );
    expect(r.contactos).toHaveLength(1);
    expect(r.contactos[0]!.telefones).toEqual(["912345678", "913333333"]);
  });
});

describe("parseContactsCsvRows", () => {
  it("mapeia nome composto e Phone 1/2 - Value", () => {
    const r = parseContactsCsvRows([
      {
        "First Name": "Manuela",
        "Middle Name": "Rodrigues",
        "Last Name": "da Silva",
        "Phone 1 - Value": "+351 911 022 838",
        "Phone 2 - Value": "211 111 111 ::: 912345678",
      },
    ]);
    expect(r.contactos[0]!.nome).toBe("Manuela Rodrigues da Silva");
    expect(r.contactos[0]!.telefones).toEqual(["911022838", "211111111", "912345678"]);
  });

  it("usa Name como fallback e ignora linhas sem telefone", () => {
    const r = parseContactsCsvRows([
      { Name: "Comprarcasa Rede", "Phone 1 - Value": "912345678" },
      { Name: "Sem Numero", "Phone 1 - Value": "" },
    ]);
    expect(r.contactos).toHaveLength(1);
    expect(r.contactos[0]!.nome).toBe("Comprarcasa Rede");
    expect(r.ignorados).toBe(1);
  });
});

describe("nameSimilarity", () => {
  it("usa o mesmo limiar dos Duplicados", () => {
    expect(NAME_MATCH_THRESHOLD).toBe(DUPLICATE_SIM_THRESHOLD);
    expect(NAME_MATCH_THRESHOLD).toBe(0.8);
  });

  it("nome idêntico dá 1, ignorando acentos e maiúsculas", () => {
    expect(nameSimilarity("Flávio Ferreira", "flavio ferreira")).toBe(1);
    expect(nameSimilarity("JOÃO DORES", "joao dores")).toBe(1);
  });

  it("nomes curtos não colapsam para 0", () => {
    expect(nameSimilarity("Ana Sá", "Ana Sá")).toBe(1);
    expect(nameSimilarity("Rui Pó", "Rui Pó")).toBe(1);
  });

  it("nomes diferentes ficam abaixo do limiar", () => {
    expect(nameSimilarity("Isabel Santos", "Sandra de Sousa Alves")).toBeLessThan(0.8);
    expect(nameSimilarity("Flávio Ferreira", "Flávio Gomes")).toBeLessThan(0.8);
    expect(nameSimilarity("Ana Sá", "")).toBe(0);
  });
});

describe("buildSuggestions", () => {
  const grupos = [
    { key: "flavio ferreira", nome: "Flávio Ferreira", procuras_afetadas: 3 },
    { key: "isabel santos", nome: "Isabel Santos", procuras_afetadas: 1 },
  ];

  it("sugere exato e deixa sem sugestão quem não tem contacto", () => {
    const s = buildSuggestions(grupos, [{ nome: "flavio ferreira", telefones: ["912345678"] }]);
    expect(s[0]).toMatchObject({
      status: "exato",
      telefone: "912345678",
      score: 1,
      procuras_afetadas: 3,
    });
    expect(s[1]!.status).toBe("sem_sugestao");
    expect(summarizeSuggestions(s)).toEqual({
      exatos: 1,
      parecidos: 0,
      ambiguos: 0,
      sem_sugestao: 1,
    });
  });

  it("marca ambíguo quando o contacto tem dois telefones — sem pré-preencher", () => {
    const s = buildSuggestions(grupos, [
      { nome: "Flávio Ferreira", telefones: ["912345678", "913333333"] },
    ]);
    expect(s[0]!.status).toBe("ambiguo");
    expect(s[0]!.telefone).toBeNull();
    expect(s[0]!.candidatos).toEqual(["912345678", "913333333"]);
  });

  it("marca ambíguo quando dois contactos empatam no melhor score", () => {
    const s = buildSuggestions([grupos[0]!], [
      { nome: "Flavio Ferreira", telefones: ["912345678"] },
      { nome: "Flávio Ferreira", telefones: ["913333333"] },
    ]);
    expect(s[0]!.status).toBe("ambiguo");
    expect(s[0]!.telefone).toBeNull();
  });

  it("marca ambíguo quando duas procuras competem pelo mesmo contacto", () => {
    const s = buildSuggestions(
      [
        { key: "a", nome: "Flávio Ferreira", procuras_afetadas: 1 },
        { key: "b", nome: "Flavio Ferreira", procuras_afetadas: 2 },
      ],
      [{ nome: "Flávio Ferreira", telefones: ["912345678"] }],
    );
    expect(s.map((x) => x.status)).toEqual(["ambiguo", "ambiguo"]);
    expect(s.every((x) => x.telefone === null)).toBe(true);
  });
});
