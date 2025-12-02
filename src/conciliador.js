// src/conciliador.js
import fs from "fs";
import path from "path";
import * as XLSX from "xlsx";
import { fileURLToPath } from "url";
import { openai } from "./openaiClient.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Lê um arquivo de texto (TXT/CSV) em UTF-8.
 * IMPORTANTE: por enquanto estamos usando TEXTO (txt/csv exportado)
 * em vez de PDF, pra não depender do pdf-parse que estava dando erro.
 */
function lerArquivoTexto(caminho) {
  console.log("📄 Lendo arquivo de texto:", caminho);
  if (!fs.existsSync(caminho)) {
    throw new Error(`Arquivo não encontrado: ${caminho}`);
  }
  return fs.readFileSync(caminho, "utf8");
}

/**
 * caminhoExtrato      -> DOC1 (extrato bancário)
 * caminhoControle     -> DOC2 (controle interno)
 * caminhoDuplicatas   -> DOC3 (arquivo de duplicatas / contas a receber) OPCIONAL
 *
 * Mesmo se você não passar o terceiro arquivo, tudo continua funcionando.
 */
export async function rodarConciliacao(
  caminhoExtrato,
  caminhoControle,
  caminhoDuplicatas // pode ser undefined
) {
  console.log("🔄 Iniciando conciliação (versão texto, sem PDF)…");

  // 1) Ler os arquivos (TXT/CSV) como texto
  let extratoText;
  let controleText;
  let duplicatasText = null;

  try {
    extratoText = lerArquivoTexto(caminhoExtrato);
    controleText = lerArquivoTexto(caminhoControle);

    if (caminhoDuplicatas) {
      duplicatasText = lerArquivoTexto(caminhoDuplicatas);
      console.log("📄 Arquivo de duplicatas carregado.");
    } else {
      console.log("ℹ️ Nenhum arquivo de duplicatas enviado (isso é opcional).");
    }
  } catch (err) {
    console.error("❌ Erro ao ler arquivos:", err);
    throw new Error("Erro ao ler arquivos de extrato/controle. " + err.message);
  }

  // 2) Montar o prompt para a IA (versão especificação do Ronaldo)
  const prompt = `
Você é um contador especializado em conciliação bancária.

Você sempre recebe:

- DOC1 = Extrato bancário do mês (lançamentos reais no banco).
- DOC2 = Controle interno do mês (lançamentos esperados pela contabilidade).
- DOC3 = Arquivo de duplicatas / contas a receber (OPCIONAL).

Os conteúdos vêm como texto, já extraído de planilhas ou sistemas.

A seguir estão os documentos:

[DOC1_EXTRATO]
${extratoText}

[DOC2_CONTROLE_INTERNO]
${controleText}

${
  duplicatasText
    ? `[DOC3_DUPLICATAS]
${duplicatasText}`
    : ""
}

Sua tarefa é COMPARAR DOC1 e DOC2 e gerar UMA ÚNICA TABELA em CSV
(com separador ponto-e-vírgula ";") contendo APENAS AS DIVERGÊNCIAS.

Divergência significa:
- lançamento que existe em DOC1 e não existe em DOC2 (mesma data e valor), ou
- lançamento que existe em DOC2 e não existe em DOC1, ou
- lançamentos que existem nos dois, mas com VALOR diferente.

O CSV deve ter EXATAMENTE estas colunas, nesta ordem:

Data;Valor;Descrição Doc1;Descrição Doc2;Documento de Origem

Regras IMPORTANTES:

1) Formato da data:
   - Sempre DD/MM/AAAA (ex: 05/11/2025).

2) Coluna "Valor":
   - Use número com ponto como separador decimal (ex: 1234.56).
   - Valor POSITIVO significa ENTRADA.
   - Valor NEGATIVO significa SAÍDA.

3) Colunas de descrição:
   - "Descrição Doc1": texto da linha correspondente no DOC1 (extrato bancário).
   - "Descrição Doc2": texto da linha correspondente no DOC2 (controle interno).
   - Se o lançamento existir só no DOC1, preencha apenas "Descrição Doc1" e deixe "Descrição Doc2" vazio.
   - Se existir só no DOC2, preencha apenas "Descrição Doc2" e deixe "Descrição Doc1" vazio.
   - Se existir nos dois com valores diferentes, preencha as duas descrições.

4) Coluna "Documento de Origem":
   - Se a divergência vier só do extrato, use exatamente: Extrato
   - Se vier só do controle interno, use exatamente: Controle
   - Se houver diferenças entre os dois para a mesma data/valor, use exatamente: Ambos

5) Uso do DOC3 (duplicatas), quando fornecido:
   - Use esse documento SOMENTE para enriquecer as descrições.
   - Exemplo: incluir número da nota, número da duplicata, parcela e vencimento
     dentro de "Descrição Doc1" ou "Descrição Doc2", quando houver correspondência clara.
   - NÃO crie colunas adicionais no CSV.
   - Se não achar correspondência, apenas ignore o DOC3 para aquele lançamento.

6) MUITO IMPORTANTE:
   - Retorne SOMENTE o CSV.
   - A PRIMEIRA LINHA deve ser obrigatoriamente o cabeçalho, exatamente assim:
     Data;Valor;Descrição Doc1;Descrição Doc2;Documento de Origem
   - Não escreva nenhum texto explicativo antes nem depois.
`;

  // 3) Chamar a OpenAI usando chat.completions (texto puro)
  console.log(
    "🧠 Chamando a IA para gerar o CSV de divergências (formato Ronaldo)…"
  );

  const completion = await openai.chat.completions.create({
    model: "gpt-4.1-mini",
    messages: [
      {
        role: "system",
        content:
          "Você é um contador especialista em conciliação bancária. Sempre responda exatamente no formato CSV especificado.",
      },
      {
        role: "user",
        content: prompt,
      },
    ],
  });

  const csv = completion.choices?.[0]?.message?.content?.trim();

  if (!csv) {
    console.error("❌ A IA não retornou texto de CSV.");
    throw new Error("A IA não retornou CSV.");
  }

  console.log("✅ CSV recebido da IA:");
  console.log(csv);

  // 4) Converter o CSV em matriz (array de arrays),
  // garantindo que o cabeçalho fique 100% igual ao pedido.
  const linhas = csv.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const headerOficial = [
    "Data",
    "Valor",
    "Descrição Doc1",
    "Descrição Doc2",
    "Documento de Origem",
  ];

  const dados = [];
  // Sempre forçamos o cabeçalho correto
  dados.push(headerOficial);

  if (linhas.length > 0) {
    // Verifica se a primeira linha parece ser cabeçalho da IA
    const primeiraCols = linhas[0]
      .split(";")
      .map((c) => c.trim().toLowerCase());

    const ehCabecalhoIa =
      primeiraCols[0]?.includes("data") &&
      primeiraCols[1]?.includes("valor") &&
      primeiraCols.length >= 2;

    const startIndex = ehCabecalhoIa ? 1 : 0;

    for (let i = startIndex; i < linhas.length; i++) {
      const cols = linhas[i].split(";").map((c) => c.trim());
      if (cols.filter((c) => c.length > 0).length === 0) continue; // pula linha vazia
      dados.push(cols);
    }
  }

  // Contagem de divergências (linhas de dados, sem cabeçalho)
  const totalDivergencias = Math.max(dados.length - 1, 0);
  const temDivergencias = totalDivergencias > 0;

  if (!temDivergencias) {
    console.log("ℹ️ Nenhuma divergência encontrada (apenas cabeçalho no Excel).");
  } else {
    console.log(`✅ Foram encontradas ${totalDivergencias} divergência(s).`);
  }

  // 5) Criar a planilha Excel em memória
  const planilha = XLSX.utils.aoa_to_sheet(dados);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, planilha, "Divergencias");

  // 6) Salvar o Excel na pasta uploads
  const outputPath = path.join(
    __dirname,
    "..",
    "uploads",
    "conciliacao_divergencias.xlsx"
  );

  XLSX.writeFile(workbook, outputPath);

  console.log("✅ Excel criado em:", outputPath);

  // 7) Retornar o caminho + info de divergências para o server.js responder
  return {
    outputPath,
    temDivergencias,
    totalDivergencias,
  };
}
