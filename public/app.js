"use strict";

const STORAGE_KEY = "dayzombi-pagamento-pendente-v3";
const SUPPORTER_NAME_KEY = "dayzombi-nome-apoiador-v1";
const INTERVALO_CONSULTA_MS = 3500;
const INTERVALO_ARRECADACAO_MS = 60000;
const EXPIRACAO_LOCAL_MS = 24 * 60 * 60 * 1000;

const modal = document.querySelector("#checkout-modal");
const modalPanel = document.querySelector("#checkout");
const checkoutTipo = document.querySelector("#checkout-tipo");
const checkoutTitulo = document.querySelector("#checkout-titulo");
const checkoutDescricao = document.querySelector("#checkout-descricao");
const checkoutValor = document.querySelector("#checkout-valor");
const carregando = document.querySelector("#carregando");
const erroConfiguracao = document.querySelector("#erro-configuracao");
const brickContainer = document.querySelector("#paymentBrick_container");
const resultado = document.querySelector("#resultado");
const resultadoTitulo = document.querySelector("#resultado-titulo");
const resultadoMensagem = document.querySelector("#resultado-mensagem");
const detalhesPagamento = document.querySelector("#detalhes-pagamento");
const pixArea = document.querySelector("#pix-area");
const pixQr = document.querySelector("#pix-qr");
const pixCodigo = document.querySelector("#pix-codigo");
const copiarPix = document.querySelector("#copiar-pix");
const pixCopiado = document.querySelector("#pix-copiado");
const novoPagamento = document.querySelector("#novo-pagamento");
const supporterNameArea = document.querySelector("#supporter-name-area");
const supporterNameInput = document.querySelector("#supporter-name-input");
const supporterNameError = document.querySelector("#supporter-name-error");

const valorArrecadado = document.querySelector("#valor-arrecadado");
const barraArrecadacao = document.querySelector("#barra-arrecadacao");
const preenchimentoArrecadacao = document.querySelector("#preenchimento-arrecadacao");
const percentualArrecadacao = document.querySelector("#percentual-arrecadacao");
const metaArrecadacao = document.querySelector("#meta-arrecadacao");
const apoiosRecentesLista = document.querySelector("#apoios-recentes-lista");
const apoiosRecentesStatus = document.querySelector("#apoios-recentes-status");

let paymentBrickController = null;
let timerConsulta = null;
let consultaEmAndamento = false;
let pagamentoAtual = null;
let produtoAtual = null;
let configuracao = null;
let produtos = new Map();

for (const botao of document.querySelectorAll("[data-produto-id]")) {
  botao.addEventListener("click", (event) => {
    event.preventDefault();
    abrirCheckout(botao.dataset.produtoId);
  });
}

for (const botao of document.querySelectorAll("[data-fechar-checkout]")) {
  botao.addEventListener("click", fecharCheckout);
}

copiarPix.addEventListener("click", copiarCodigoPix);
novoPagamento.addEventListener("click", reiniciarCheckout);
supporterNameInput.addEventListener("input", () => {
  limparErroNomeApoiador();
  const nome = normalizarNomeApoiador(supporterNameInput.value);
  if (nome) {
    localStorage.setItem(SUPPORTER_NAME_KEY, nome);
  }
});
window.addEventListener("beforeunload", destruirBrick);
window.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !modal.hidden) {
    fecharCheckout();
  }
});

iniciar();

async function iniciar() {
  supporterNameInput.value = localStorage.getItem(SUPPORTER_NAME_KEY) || "";

  const tarefas = await Promise.allSettled([
    carregarConfiguracao(),
    atualizarArrecadacao()
  ]);

  if (tarefas[0].status === "rejected") {
    configuracao = null;
    console.error(tarefas[0].reason);
  }

  const salvo = carregarPagamentoSalvo();
  if (salvo && configuracao) {
    pagamentoAtual = salvo;
    produtoAtual = produtos.get(salvo.produtoId) || null;
    supporterNameInput.value = salvo.apoiadorNome || supporterNameInput.value;
    abrirModal();
    atualizarCabecalhoCheckout(produtoAtual, salvo.valor);
    mostrarResultadoPendente({
      pagamentoId: salvo.pagamentoId,
      pedidoId: salvo.pedidoId,
      status: salvo.status,
      mensagem: "Retomando a verificação do pagamento...",
      pix: salvo.pix || null
    });
    iniciarMonitoramento();
  }

  window.setInterval(atualizarArrecadacao, INTERVALO_ARRECADACAO_MS);
}

async function carregarConfiguracao() {
  const response = await fetch("/api/configuracao-publica", { cache: "no-store" });
  const data = await response.json();

  if (!response.ok || !data.publicKey || !Array.isArray(data.produtos)) {
    throw new Error(data.erro || "A configuração do pagamento não foi carregada.");
  }

  configuracao = data;
  produtos = new Map(data.produtos.map((produto) => [produto.id, produto]));
  return data;
}

async function abrirCheckout(produtoId) {
  abrirModal();

  try {
    if (!configuracao) {
      await carregarConfiguracao();
    }

    const pagamentoSalvo = carregarPagamentoSalvo();
    if (pagamentoSalvo) {
      pagamentoAtual = pagamentoSalvo;
      produtoAtual = produtos.get(pagamentoSalvo.produtoId) || null;
      supporterNameInput.value = pagamentoSalvo.apoiadorNome || supporterNameInput.value;
      atualizarCabecalhoCheckout(produtoAtual, pagamentoSalvo.valor);
      mostrarResultadoPendente({
        pagamentoId: pagamentoSalvo.pagamentoId,
        status: pagamentoSalvo.status,
        mensagem: "Já existe um pagamento aguardando confirmação.",
        pix: pagamentoSalvo.pix || null
      });
      iniciarMonitoramento();
      return;
    }

    const produto = produtos.get(produtoId);
    if (!produto) {
      throw new Error("Esta opção de apoio não está disponível.");
    }

    produtoAtual = produto;
    pagamentoAtual = null;
    prepararNomeApoiador();
    atualizarCabecalhoCheckout(produto);
    await renderizarBrick();
  } catch (error) {
    mostrarErroConfiguracao(error.message || "Não foi possível abrir o pagamento.");
  }
}

function abrirModal() {
  modal.hidden = false;
  document.body.classList.add("checkout-open");
  window.setTimeout(() => modalPanel.focus?.(), 0);
}

function fecharCheckout() {
  modal.hidden = true;
  document.body.classList.remove("checkout-open");
}

function atualizarCabecalhoCheckout(produto, valorAlternativo = 0) {
  const valor = Number(produto?.valor ?? valorAlternativo ?? 0);
  checkoutTipo.textContent = produto?.tipo === "doacao"
    ? "DOAÇÃO OPCIONAL"
    : "APOIO FUNDADOR";
  checkoutTitulo.textContent = produto?.titulo || "Pagamento DayZombi";
  checkoutDescricao.textContent = produto?.descricao ||
    "Aguarde a confirmação do pagamento.";
  checkoutValor.textContent = formatarMoeda(valor);
}

async function renderizarBrick() {
  pararMonitoramento();
  supporterNameArea.classList.remove("oculto");
  limparErroNomeApoiador();
  carregando.classList.remove("oculto");
  erroConfiguracao.classList.add("oculto");
  resultado.classList.add("oculto");
  brickContainer.classList.remove("oculto");
  brickContainer.innerHTML = "";
  pixArea.classList.add("oculto");

  if (!produtoAtual) {
    throw new Error("Nenhuma opção de apoio foi selecionada.");
  }

  if (typeof MercadoPago !== "function") {
    throw new Error("O formulário do Mercado Pago não foi carregado. Atualize a página.");
  }

  await destruirBrick();

  const mp = new MercadoPago(configuracao.publicKey, { locale: "pt-BR" });
  const bricksBuilder = mp.bricks();

  const settings = {
    initialization: {
      amount: Number(produtoAtual.valor)
    },
    customization: {
      visual: {
        style: { theme: "dark" }
      },
      paymentMethods: {
        creditCard: "all",
        debitCard: "all",
        bankTransfer: ["pix"],
        minInstallments: 1,
        maxInstallments: 1
      }
    },
    callbacks: {
      onReady: () => {
        carregando.classList.add("oculto");
      },
      onSubmit: ({ selectedPaymentMethod, formData }) => {
        return processarPagamento(selectedPaymentMethod, formData);
      },
      onError: (error) => {
        console.error("Erro do Payment Brick:", error);
        mostrarErroConfiguracao(
          "O formulário de pagamento apresentou um erro. Atualize a página e tente novamente."
        );
      }
    }
  };

  paymentBrickController = await bricksBuilder.create(
    "payment",
    "paymentBrick_container",
    settings
  );
}

function processarPagamento(selectedPaymentMethod, formData) {
  return new Promise(async (resolve, reject) => {
    try {
      if (!produtoAtual) {
        throw new Error("A opção de apoio foi perdida. Selecione novamente.");
      }

      const apoiadorNome = validarNomeApoiador();
      if (!apoiadorNome) {
        const error = new Error("Informe seu Nick ou nome no Discord antes de pagar.");
        error.code = "NOME_APOIADOR_INVALIDO";
        throw error;
      }

      localStorage.setItem(SUPPORTER_NAME_KEY, apoiadorNome);

      const response = await fetch("/api/processar-pagamento", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Idempotency-Key": gerarUUID()
        },
        body: JSON.stringify({
          produtoId: produtoAtual.id,
          apoiadorNome,
          selectedPaymentMethod,
          formData
        })
      });

      const data = await response.json();

      if (!response.ok || !data.pagamentoId) {
        throw new Error(data.detalhe || data.erro || "Não foi possível criar o pagamento.");
      }

      pagamentoAtual = {
        pagamentoId: data.pagamentoId,
        pedidoId: data.pedidoId,
        produtoId: data.produtoId || produtoAtual.id,
        apoiadorNome: data.nomeApoiador || apoiadorNome,
        valor: Number(data.valor ?? produtoAtual.valor),
        status: data.status,
        pix: data.pix || null,
        criadoEm: Date.now()
      };

      salvarPagamento(pagamentoAtual);
      await destruirBrick();
      tratarRespostaPagamento(data);
      resolve();
    } catch (error) {
      if (error.code === "NOME_APOIADOR_INVALIDO") {
        mostrarErroNomeApoiador(error.message);
      } else {
        mostrarErroConfiguracao(error.message || "Falha ao processar o pagamento.");
      }
      reject(error);
    }
  });
}

function tratarRespostaPagamento(data) {
  if (data.aprovado) {
    finalizarAprovado(data);
    return;
  }

  if (["pending", "in_process"].includes(data.status)) {
    mostrarResultadoPendente(data);
    iniciarMonitoramento();
    return;
  }

  mostrarResultadoRejeitado(data);
}

function mostrarResultadoPendente(data) {
  supporterNameArea.classList.add("oculto");
  brickContainer.classList.add("oculto");
  carregando.classList.add("oculto");
  erroConfiguracao.classList.add("oculto");
  resultado.className = "checkout-result checkout-result--pending";
  resultadoTitulo.textContent = data.meioPagamento === "pix" || data.pix
    ? "Pix gerado"
    : "Pagamento em processamento";
  resultadoMensagem.textContent = data.mensagem || "Aguardando confirmação do Mercado Pago.";
  detalhesPagamento.textContent = data.pagamentoId
    ? `Pagamento: ${data.pagamentoId}`
    : "";

  const dadosPix = data.pix || pagamentoAtual?.pix;
  if (dadosPix?.qrCode) {
    pixArea.classList.remove("oculto");
    pixCodigo.value = dadosPix.qrCode;

    if (dadosPix.qrCodeBase64) {
      pixQr.src = dadosPix.qrCodeBase64.startsWith("data:")
        ? dadosPix.qrCodeBase64
        : `data:image/png;base64,${dadosPix.qrCodeBase64}`;
      pixQr.classList.remove("oculto");
    } else {
      pixQr.classList.add("oculto");
    }
  } else {
    pixArea.classList.add("oculto");
  }
}

function mostrarResultadoRejeitado(data) {
  pararMonitoramento();
  supporterNameArea.classList.add("oculto");
  limparPagamentoSalvo();
  resultado.className = "checkout-result checkout-result--rejected";
  resultadoTitulo.textContent = "Pagamento não aprovado";
  resultadoMensagem.textContent = data.mensagem || data.erro || "Tente novamente.";
  detalhesPagamento.textContent = data.statusDetalhe
    ? `Motivo: ${data.statusDetalhe}`
    : "";
  pixArea.classList.add("oculto");
}

async function finalizarAprovado(data) {
  pararMonitoramento();
  limparPagamentoSalvo();
  await atualizarArrecadacao();
  const id = data.pagamentoId || pagamentoAtual?.pagamentoId;
  window.location.href = `/sucesso.html?payment_id=${encodeURIComponent(id)}`;
}

function iniciarMonitoramento() {
  pararMonitoramento();
  consultarPagamento();
  timerConsulta = window.setInterval(consultarPagamento, INTERVALO_CONSULTA_MS);
}

function pararMonitoramento() {
  if (timerConsulta) {
    window.clearInterval(timerConsulta);
    timerConsulta = null;
  }
}

async function consultarPagamento() {
  if (!pagamentoAtual?.pagamentoId || consultaEmAndamento) {
    return;
  }

  consultaEmAndamento = true;

  try {
    const response = await fetch(
      `/api/verificar-pagamento?payment_id=${encodeURIComponent(pagamentoAtual.pagamentoId)}`,
      { cache: "no-store" }
    );
    const data = await response.json();

    if (data.aprovado) {
      finalizarAprovado(data);
      return;
    }

    if (["rejected", "cancelled", "refunded", "charged_back"].includes(data.status)) {
      mostrarResultadoRejeitado(data);
      return;
    }

    if (data.pix?.qrCode) {
      pagamentoAtual.pix = data.pix;
      salvarPagamento(pagamentoAtual);
    }

    pagamentoAtual.status = data.status;
    salvarPagamento(pagamentoAtual);
    mostrarResultadoPendente(data);
  } catch {
    resultadoMensagem.textContent = "Não foi possível consultar agora. Tentando novamente...";
  } finally {
    consultaEmAndamento = false;
  }
}

async function atualizarArrecadacao() {
  try {
    const response = await fetch("/api/arrecadacao", { cache: "no-store" });
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.erro || "Arrecadação indisponível.");
    }

    const total = Number(data.total) || 0;
    const meta = Number(data.meta) || 5000;
    const percentualReal = meta > 0 ? (total / meta) * 100 : 0;
    const percentualVisual = Math.min(100, Math.max(0, percentualReal));

    valorArrecadado.textContent = formatarMoeda(total);
    metaArrecadacao.textContent = `Meta: ${formatarMoeda(meta)}`;
    percentualArrecadacao.textContent = `${formatarPercentual(percentualReal)} alcançado`;
    preenchimentoArrecadacao.style.setProperty("--progress", `${percentualVisual}%`);
    barraArrecadacao.setAttribute("aria-valuemax", String(meta));
    barraArrecadacao.setAttribute("aria-valuenow", String(Math.min(total, meta)));
    renderizarApoiosRecentes(data.apoiosRecentes);
  } catch (error) {
    console.warn(error.message);
    if (apoiosRecentesStatus && !apoiosRecentesStatus.classList.contains("oculto")) {
      apoiosRecentesStatus.textContent = "Os apoios recentes estão temporariamente indisponíveis.";
    }
  }
}

function prepararNomeApoiador() {
  supporterNameArea.classList.remove("oculto");
  limparErroNomeApoiador();

  const nomeSalvo = localStorage.getItem(SUPPORTER_NAME_KEY) || "";
  if (!supporterNameInput.value.trim() && nomeSalvo) {
    supporterNameInput.value = nomeSalvo;
  }
}

function validarNomeApoiador() {
  const nome = normalizarNomeApoiador(supporterNameInput.value);

  if (nome.length < 2) {
    mostrarErroNomeApoiador("Digite pelo menos 2 caracteres.");
    return "";
  }

  supporterNameInput.value = nome;
  limparErroNomeApoiador();
  return nome;
}

function normalizarNomeApoiador(valor) {
  return String(valor || "")
    .normalize("NFKC")
    .replace(/[\u0000-\u001F\u007F<>]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 36);
}

function mostrarErroNomeApoiador(texto) {
  supporterNameArea.classList.remove("oculto");
  supporterNameInput.setAttribute("aria-invalid", "true");
  supporterNameError.textContent = texto;
  supporterNameError.classList.remove("oculto");
  supporterNameInput.focus();
  supporterNameArea.scrollIntoView({ behavior: "smooth", block: "center" });
}

function limparErroNomeApoiador() {
  supporterNameInput.removeAttribute("aria-invalid");
  supporterNameError.textContent = "";
  supporterNameError.classList.add("oculto");
}

function renderizarApoiosRecentes(apoios) {
  apoiosRecentesLista.replaceChildren();

  if (!Array.isArray(apoios) || apoios.length === 0) {
    apoiosRecentesLista.classList.add("oculto");
    apoiosRecentesStatus.textContent = "Ainda não há apoios públicos confirmados. Seja o primeiro.";
    apoiosRecentesStatus.classList.remove("oculto");
    return;
  }

  for (const apoio of apoios) {
    const nome = normalizarNomeApoiador(apoio.nome) || "Apoiador";
    const item = document.createElement("li");
    item.className = "supporters-list__item";

    const avatar = document.createElement("span");
    avatar.className = "supporters-list__avatar";
    avatar.textContent = primeiraLetra(nome);
    avatar.setAttribute("aria-hidden", "true");

    const copy = document.createElement("div");
    copy.className = "supporters-list__copy";

    const nomeElemento = document.createElement("strong");
    nomeElemento.textContent = nome;

    const acao = document.createElement("span");
    acao.textContent = apoio.tipoApoio === "compra"
      ? "comprou o acesso aos testes"
      : `doou ${formatarMoeda(apoio.valor)}`;

    const tempo = document.createElement("time");
    tempo.className = "supporters-list__time";
    tempo.dateTime = new Date(Number(apoio.criadoEm) || Date.now()).toISOString();
    tempo.textContent = formatarTempoApoio(apoio.criadoEm);

    copy.append(nomeElemento, acao);
    item.append(avatar, copy, tempo);
    apoiosRecentesLista.append(item);
  }

  apoiosRecentesStatus.classList.add("oculto");
  apoiosRecentesLista.classList.remove("oculto");
}

function primeiraLetra(nome) {
  return Array.from(String(nome || "?").trim())[0]?.toUpperCase() || "?";
}

function formatarTempoApoio(timestamp) {
  const data = Number(timestamp);
  if (!Number.isFinite(data)) return "recente";

  const diferenca = Math.max(0, Date.now() - data);
  const minutos = Math.floor(diferenca / 60000);
  const horas = Math.floor(diferenca / 3600000);
  const dias = Math.floor(diferenca / 86400000);

  if (minutos < 1) return "agora";
  if (minutos < 60) return `há ${minutos} min`;
  if (horas < 24) return `há ${horas} h`;
  if (dias < 7) return `há ${dias} d`;

  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit"
  }).format(new Date(data));
}

async function copiarCodigoPix() {
  const codigo = pixCodigo.value;
  if (!codigo) return;

  try {
    await navigator.clipboard.writeText(codigo);
  } catch {
    pixCodigo.focus();
    pixCodigo.select();
    document.execCommand("copy");
  }

  pixCopiado.classList.remove("oculto");
  window.setTimeout(() => pixCopiado.classList.add("oculto"), 1800);
}

async function reiniciarCheckout() {
  pararMonitoramento();
  limparPagamentoSalvo();
  pagamentoAtual = null;
  pixArea.classList.add("oculto");
  prepararNomeApoiador();
  await destruirBrick();

  if (produtoAtual) {
    await renderizarBrick();
  }
}

async function destruirBrick() {
  if (!paymentBrickController) return;

  try {
    await paymentBrickController.unmount();
  } catch {
    // A instância pode já ter sido removida pelo SDK.
  } finally {
    paymentBrickController = null;
  }
}

function mostrarErroConfiguracao(texto) {
  abrirModal();
  carregando.classList.add("oculto");
  brickContainer.classList.add("oculto");
  resultado.classList.add("oculto");
  erroConfiguracao.textContent = texto;
  erroConfiguracao.classList.remove("oculto");
}

function salvarPagamento(pagamento) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(pagamento));
}

function limparPagamentoSalvo() {
  localStorage.removeItem(STORAGE_KEY);
}

function carregarPagamentoSalvo() {
  try {
    const salvo = JSON.parse(localStorage.getItem(STORAGE_KEY));

    if (
      salvo?.pagamentoId &&
      salvo?.produtoId &&
      Number.isFinite(salvo.criadoEm) &&
      Date.now() - salvo.criadoEm < EXPIRACAO_LOCAL_MS
    ) {
      return salvo;
    }
  } catch {
    // Um valor inválido é removido abaixo.
  }

  limparPagamentoSalvo();
  return null;
}

function formatarMoeda(valor) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL"
  }).format(Number(valor) || 0);
}

function formatarPercentual(valor) {
  const numero = Number(valor) || 0;
  const casas = numero >= 10 || Number.isInteger(numero) ? 0 : 1;
  return `${numero.toFixed(casas).replace(".", ",")}%`;
}

function gerarUUID() {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }

  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (char) => {
    const random = Math.floor(Math.random() * 16);
    const value = char === "x" ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}
