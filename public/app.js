"use strict";

const STORAGE_KEY = "dayzombi-payment-brick-pendente-v1";
const INTERVALO_CONSULTA_MS = 3500;
const EXPIRACAO_LOCAL_MS = 24 * 60 * 60 * 1000;

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

let paymentBrickController = null;
let timerConsulta = null;
let consultaEmAndamento = false;
let pagamentoAtual = null;
let configuracao = null;

copiarPix.addEventListener("click", copiarCodigoPix);
novoPagamento.addEventListener("click", reiniciarCheckout);
window.addEventListener("beforeunload", destruirBrick);

iniciar();

async function iniciar() {
  try {
    configuracao = await carregarConfiguracao();

    const salvo = carregarPagamentoSalvo();
    if (salvo) {
      pagamentoAtual = salvo;
      mostrarResultadoPendente({
        pagamentoId: salvo.pagamentoId,
        pedidoId: salvo.pedidoId,
        status: salvo.status,
        mensagem: "Retomando a verificação do pagamento...",
        pix: salvo.pix || null
      });
      iniciarMonitoramento();
      return;
    }

    await renderizarBrick();
  } catch (error) {
    mostrarErroConfiguracao(error.message || "Não foi possível iniciar o checkout.");
  }
}

async function carregarConfiguracao() {
  const response = await fetch("/api/configuracao-publica", { cache: "no-store" });
  const data = await response.json();

  if (!response.ok || !data.publicKey) {
    throw new Error(data.erro || "A Public Key não foi configurada.");
  }

  return data;
}

async function renderizarBrick() {
  pararMonitoramento();
  carregando.classList.remove("oculto");
  erroConfiguracao.classList.add("oculto");
  resultado.classList.add("oculto");
  brickContainer.classList.remove("oculto");
  brickContainer.innerHTML = "";

  const mp = new MercadoPago(configuracao.publicKey, { locale: "pt-BR" });
  const bricksBuilder = mp.bricks();

  const settings = {
    initialization: {
      amount: Number(configuracao.produto.valor)
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
      const response = await fetch("/api/processar-pagamento", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Idempotency-Key": gerarUUID()
        },
        body: JSON.stringify({ selectedPaymentMethod, formData })
      });

      const data = await response.json();

      if (!response.ok || !data.pagamentoId) {
        throw new Error(data.detalhe || data.erro || "Não foi possível criar o pagamento.");
      }

      pagamentoAtual = {
        pagamentoId: data.pagamentoId,
        pedidoId: data.pedidoId,
        status: data.status,
        pix: data.pix || null,
        criadoEm: Date.now()
      };

      salvarPagamento(pagamentoAtual);
      await destruirBrick();
      tratarRespostaPagamento(data);
      resolve();
    } catch (error) {
      mostrarErroConfiguracao(error.message || "Falha ao processar o pagamento.");
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
  brickContainer.classList.add("oculto");
  carregando.classList.add("oculto");
  erroConfiguracao.classList.add("oculto");
  resultado.className = "resultado pendente";
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
  limparPagamentoSalvo();
  resultado.className = "resultado rejeitado";
  resultadoTitulo.textContent = "Pagamento não aprovado";
  resultadoMensagem.textContent = data.mensagem || data.erro || "Tente novamente.";
  detalhesPagamento.textContent = data.statusDetalhe
    ? `Motivo: ${data.statusDetalhe}`
    : "";
  pixArea.classList.add("oculto");
}

function finalizarAprovado(data) {
  pararMonitoramento();
  limparPagamentoSalvo();
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

    mostrarResultadoPendente(data);
  } catch {
    resultadoMensagem.textContent = "Não foi possível consultar agora. Tentando novamente...";
  } finally {
    consultaEmAndamento = false;
  }
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
  await destruirBrick();
  await renderizarBrick();
}

async function destruirBrick() {
  if (!paymentBrickController) return;

  try {
    await paymentBrickController.unmount();
  } catch {
    // A instância já pode ter sido removida pelo SDK.
  } finally {
    paymentBrickController = null;
  }
}

function mostrarErroConfiguracao(texto) {
  carregando.classList.add("oculto");
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
      Number.isFinite(salvo.criadoEm) &&
      Date.now() - salvo.criadoEm < EXPIRACAO_LOCAL_MS
    ) {
      return salvo;
    }
  } catch {
    // Valor inválido será removido abaixo.
  }

  limparPagamentoSalvo();
  return null;
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
