// tests/gerarPdfsTeste.js
import PDFDocument from "pdfkit";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function criaPdf(nomeArquivo, linhas) {
  const doc = new PDFDocument();
  const filePath = path.join(__dirname, nomeArquivo);
  const stream = fs.createWriteStream(filePath);

  doc.pipe(stream);

  doc.fontSize(16).text("Arquivo de teste - " + nomeArquivo, {
    underline: true,
  });
  doc.moveDown();

  linhas.forEach((linha) => {
    doc.fontSize(12).text(linha);
  });

  doc.end();

  stream.on("finish", () => {
    console.log("✅ PDF criado:", filePath);
  });
}

criaPdf("extrato_bancario_teste.pdf", [
  "01/11/2025; DEPOSITO; 1000.00",
  "02/11/2025; PAGAMENTO BOLETO; -250.00",
  "03/11/2025; PIX RECEBIDO; 300.00",
]);

criaPdf("controle_interno_teste.pdf", [
  "01/11/2025; DEPOSITO; 1000.00",
  "02/11/2025; PAGAMENTO BOLETO; -200.00", // valor diferente
  "04/11/2025; MENSALIDADE; -150.00",     // só no controle
]);
