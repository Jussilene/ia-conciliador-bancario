// public/agente.js

// ====== ELEMENTOS DO DOM ======
const chatToggle = document.getElementById("chatToggle");
const chatWindow = document.getElementById("chatWindow");
const chatClose = document.getElementById("chatClose");
const chatMessages = document.getElementById("chatMessages");
const chatInput = document.getElementById("chatInput");
const chatSend = document.getElementById("chatSend");
const quickButtons = document.querySelectorAll(".chat-quick");

// Endpoint que o backend expõe para falar com a OpenAI
const CHAT_API_URL = "/chat-ia";

// ====== ABRIR / FECHAR CHAT ======
if (chatToggle && chatWindow && chatClose) {
  chatToggle.addEventListener("click", () => {
    chatWindow.classList.toggle("hidden");
    if (!chatWindow.classList.contains("hidden") && chatInput) {
      chatInput.focus();
    }
  });

  chatClose.addEventListener("click", () => {
    chatWindow.classList.add("hidden");
  });
}

// ====== BOLHA DE MENSAGEM ======
function addMessage(text, sender = "bot") {
  if (!chatMessages) return;

  const wrapper = document.createElement("div");
  wrapper.classList.add("flex", "w-full");

  const bubble = document.createElement("div");
  bubble.classList.add(
    "px-3",
    "py-2",
    "rounded-2xl",
    "text-xs",
    "sm:text-sm",
    "max-w-[90%]",
    "leading-relaxed"
  );

  if (sender === "user") {
    wrapper.classList.add("justify-end");
    bubble.classList.add(
      "bg-sky-500",
      "text-slate-950",
      "rounded-br-sm",
      "shadow",
      "shadow-sky-500/30"
    );
  } else {
    wrapper.classList.add("justify-start");
    bubble.classList.add(
      "bg-slate-800/90",
      "text-slate-50",
      "border",
      "border-slate-700",
      "rounded-bl-sm"
    );
  }

  bubble.innerHTML = text.replace(/\n/g, "<br />");
  wrapper.appendChild(bubble);
  chatMessages.appendChild(wrapper);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

// ====== TEXTOS FIXOS DA IA ======
const mensagensIA = {
  inicial: `
Sou a <strong>IA Conciliador Bancário</strong>. 😊

Para iniciar a conciliação, você deve enviar <strong>exatamente dois arquivos</strong> principais usando o formulário da página:

1. <strong>Extrato bancário (DOC1)</strong> – PDF ou TXT/CSV exportado do banco, com:
   • Data de cada lançamento  
   • Descrição  
   • Valor  
   • Tipo (entrada/saída – pode ser pelo sinal ou coluna do extrato)

2. <strong>Controle interno (DOC2)</strong> – PDF ou TXT/CSV gerado de planilha, ERP ou sistema interno, com:
   • Data da operação  
   • Descrição ou histórico  
   • Valor  
   • Indicação de entrada/saída (ou sinal do valor)

Opcionalmente, você pode enviar também:

3. <strong>Arquivo de duplicatas (DOC3)</strong> – PDF ou TXT/CSV com número da nota, número da duplicata, valor das parcelas e vencimentos.  
Eu uso esse arquivo apenas para <strong>enriquecer as descrições</strong> das divergências (não cria colunas novas).

Depois de enviar os arquivos e clicar em <em>“Iniciar conciliação bancária”</em>, o sistema vai gerar o Excel <strong>conciliacao_divergencias.xlsx</strong> só com as diferenças entre DOC1 e DOC2.
`,

  como_enviar: `
Para a conciliação funcionar bem, envie:

<strong>DOC1 – Extrato bancário (obrigatório)</strong>  
• Formato: PDF ou TXT/CSV  
• Origem: baixado direto do internet banking / app do banco  
• Precisa permitir leitura de texto (não pode ser foto borrada)  
• Deve conter, no mínimo:
  – Data  
  – Descrição  
  – Valor  
  – Tipo de lançamento (entrada/saída, pelo sinal ou coluna específica)

<strong>DOC2 – Controle interno (obrigatório)</strong>  
• Formato: PDF ou TXT/CSV  
• Gerado de planilha, ERP ou sistema interno  
• Também precisa ser texto legível (não apenas imagem)  
• Deve conter:
  – Data  
  – Descrição / histórico  
  – Valor  
  – Indicação de entrada/saída (ou sinal do valor)

<strong>DOC3 – Arquivo de duplicatas (opcional)</strong>  
• Formato: PDF ou TXT/CSV  
• Com:
  – Número da nota  
  – Número da duplicata  
  – Valor das parcelas  
  – Vencimentos  
• Eu uso DOC3 apenas para deixar as descrições das divergências mais completas.

Basta selecionar esses arquivos nos campos:
<strong>Extrato bancário</strong>, <strong>Controle interno</strong> e, se quiser, <strong>Arquivo de duplicatas</strong>, e clicar em <em>“Iniciar conciliação bancária”</em>.
`,

  resultado: `
Depois de processar os dois PDFs/TXT/CSV, você recebe um arquivo:

<strong>conciliacao_divergencias.xlsx</strong>

Essa planilha contém apenas as <strong>divergências</strong> entre o extrato bancário (DOC1) e o controle interno (DOC2).

<strong>Colunas da planilha:</strong>
• Data (DD/MM/AAAA)  
• Valor (positivo para entrada, negativo para saída)  
• Descrição Doc1 (texto vindo do extrato, quando aplicável)  
• Descrição Doc2 (texto vindo do controle interno, quando aplicável)  
• Documento de Origem:
  – <em>Extrato</em>, se a linha existir só no DOC1  
  – <em>Controle</em>, se existir só no DOC2  
  – <em>Ambos</em>, se houver diferença entre os dois

<strong>O que aparece:</strong>
• Lançamentos que existem no extrato mas não existem no controle interno  
• Lançamentos que existem no controle interno mas não existem no extrato  
• Lançamentos presentes nos dois, mas com <strong>valores diferentes</strong>

<strong>O que NÃO aparece:</strong>
• Nada que esteja perfeitamente conciliado (mesma data e valor nos dois documentos)  
• Nenhum resumo ou linha duplicada

A planilha é ordenada por <strong>data crescente</strong> e, dentro da mesma data, por <strong>valor crescente</strong>.
`,

  duplicatas: `
O <strong>arquivo de duplicatas (DOC3)</strong> é <strong>opcional</strong>, mas ajuda bastante o contador.

Ele costuma conter:
• Número da nota  
• Número da duplicata  
• Valor das parcelas  
• Vencimentos  
• Situação dos títulos

Eu uso o DOC3 assim:
• Quando encontro uma divergência, posso enriquecer a descrição com:
  – nº da nota  
  – nº da duplicata  
  – parcela  
  – vencimento

Regras importantes:
• Eu <strong>não</strong> crio colunas novas por causa do DOC3  
• O DOC3 é usado apenas para <strong>deixar as descrições Doc1/Doc2 mais completas</strong>  
• Se não encontrar correspondência segura com a duplicata, simplesmente ignoro o DOC3 naquela linha
`,

  resumo: `
<strong>Resumo simples da experiência ideal:</strong>

1. Você envia:
   • Extrato bancário (DOC1) – PDF ou TXT/CSV  
   • Controle interno (DOC2) – PDF ou TXT/CSV  
   • Opcional: arquivo de duplicatas (DOC3)

2. Eu faço:
   • Extraio data, descrição, valor e tipo de cada documento  
   • Padronizo tudo internamente  
   • Comparo DOC1 x DOC2 lançamento a lançamento  
   • Uso DOC3 apenas para enriquecer as descrições, se existir

3. Você recebe:
   • Um arquivo Excel: <strong>conciliacao_divergencias.xlsx</strong>  
   • Contendo <strong>apenas as diferenças</strong> entre DOC1 e DOC2  
   • Sem nada conciliado, sem resumo, sem repetições  
   • Organizado por data e valor, pronto para ajuste contábil

A ideia é: <em>subiu os dois PDFs/TXT → baixou o Excel pronto de divergências</em>.
`,

  detalhes_tecnicos: `
<strong>Visão de interface e fluxo ideal (como o Ronaldo desenhou):</strong>

Assim que o usuário abre a ferramenta, eu já deixo claro:

<em>
“Envie dois arquivos em PDF (ou TXT/CSV):  
1) Extrato bancário do mês  
2) Controle interno do mês  
Com base nesses documentos, vou gerar uma planilha Excel contendo apenas as divergências encontradas entre os dois.”
</em>

<strong>Fluxo de mensagens sugerido:</strong>

1) <u>Tela inicial</u>  
Mensagem automática:
<em>
“Para iniciar a conciliação bancária, envie exatamente dois arquivos em PDF ou TXT/CSV:  
1. Extrato bancário do mês  
2. Controle interno do mês  
Assim que você enviar, vou extrair os lançamentos, comparar e gerar uma planilha com todas as divergências.”
</em>

2) <u>Depois que o usuário envia os arquivos</u>  
Mensagem automática:
<em>
“Arquivos recebidos. Vou extrair Data, Valor, Descrição e Tipo de entrada/saída dos dois documentos, padronizar tudo e comparar lançamento por lançamento.”
</em>

3) <u>Ao finalizar o processamento</u>  
Mensagem automática:
<em>
“Conciliação concluída.  
Aqui está seu arquivo: conciliacao_divergencias.xlsx  
A planilha contém apenas os lançamentos que estão em um arquivo e não estão no outro, organizados por data e valor.”
</em>

Dessa forma, o usuário não precisa perguntar “como usar”.  
A própria IA explica:
• o que subir  
• como precisa estar o formato  
• o que ela faz com os arquivos  
• o que ele recebe no final
`,

  generica: `
Eu sou a IA de interface do Conciliador Bancário. 💼

Posso:
• Explicar <strong>o que você precisa enviar</strong>  
• Detalhar <strong>como o Excel de divergências é montado</strong>  
• Tirar dúvidas sobre <strong>DOC1, DOC2 e DOC3 (duplicatas)</strong>  

O processamento dos arquivos é feito pelo <strong>formulário principal da página</strong>  
(“Extrato bancário”, “Controle interno” e “Arquivo de duplicatas” → botão <em>“Iniciar conciliação bancária”</em>).

Use o chat como se fosse o “manual inteligente” da ferramenta. 🙂
`,
};

const mensagemLivreGenerica = `
Entendi sua pergunta. 💡

Eu posso te orientar sobre:
• Como preparar e enviar os arquivos de extrato, controle e duplicatas  
• O que exatamente vai aparecer na planilha de divergências  
• Como interpretar o resultado

Lembrando: o processamento real dos arquivos acontece pelo <strong>formulário da página</strong>.  
Envie os PDFs/TXT/CSV ali em cima e clique em <em>“Iniciar conciliação bancária”</em> para gerar o Excel.

Se quiser, clique em um dos botões abaixo:
<strong>“Como enviar os PDFs?”</strong>, <strong>“O que eu recebo?”</strong>, <strong>“E o arquivo de duplicatas?”</strong> ou <strong>“Resumo rápido”</strong>.
`;

// ====== CHAMADA PARA O BACKEND (/chat-ia) ======
async function perguntarIA(pergunta) {
  try {
    const resp = await fetch(CHAT_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ pergunta }),
    });

    if (!resp.ok) {
      throw new Error("HTTP " + resp.status);
    }

    const data = await resp.json();
    return data.reply || data.resposta || null;
  } catch (err) {
    console.error("Erro ao chamar /chat-ia:", err);
    return null;
  }
}

// ====== BOTÕES RÁPIDOS ======
function responderChave(key) {
  const texto = mensagensIA[key];
  if (!texto) return;
  addMessage(texto, "bot");
}

// ====== ENVIO DE MENSAGEM LIVRE ======
async function handleUserMessage() {
  const texto = chatInput && chatInput.value ? chatInput.value.trim() : "";
  if (!texto) return;

  // Mensagem do usuário
  addMessage(texto, "user");
  if (chatInput) chatInput.value = "";

  // bolha "Digitando..."
  const typingWrapper = document.createElement("div");
  typingWrapper.classList.add("flex", "w-full", "justify-start");
  const typingBubble = document.createElement("div");
  typingBubble.classList.add(
    "px-3",
    "py-2",
    "rounded-2xl",
    "text-xs",
    "sm:text-sm",
    "bg-slate-800/60",
    "text-slate-400",
    "border",
    "border-slate-700"
  );
  typingBubble.textContent = "Digitando...";
  typingWrapper.appendChild(typingBubble);
  chatMessages.appendChild(typingWrapper);
  chatMessages.scrollTop = chatMessages.scrollHeight;

  const respostaIA = await perguntarIA(texto);

  typingWrapper.remove();

  if (respostaIA) {
    addMessage(respostaIA, "bot");
  } else {
    addMessage(mensagemLivreGenerica, "bot");
  }
}

// ====== EVENTOS ======
if (chatSend && chatInput) {
  chatSend.addEventListener("click", () => {
    handleUserMessage();
  });

  chatInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleUserMessage();
    }
  });
}

if (quickButtons && quickButtons.length > 0) {
  quickButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const key = btn.getAttribute("data-key");
      if (!key) return;
      responderChave(key);
    });
  });
}

// Mensagem inicial ao carregar a página
window.addEventListener("load", () => {
  responderChave("inicial");
});
