"use strict";

const STORAGE_KEY = "dayzombi-pagamento-pendente-v4";
const SUPPORTER_NAME_KEY = "dayzombi-nome-apoiador-v1";
const LOGIN_INTENT_KEY = "dayzombi-login-intent-v1";
const INTERVALO_CONSULTA_MS = 3500;
const INTERVALO_ARRECADACAO_MS = 60000;
const EXPIRACAO_LOCAL_MS = 24 * 60 * 60 * 1000;

const modal = document.querySelector("#checkout-modal");
const modalPanel = document.querySelector("#checkout");
const checkoutTipo = document.querySelector("#checkout-tipo");
const checkoutTitulo = document.querySelector("#checkout-titulo");
const checkoutDescricao = document.querySelector("#checkout-descricao");
const checkoutValor = document.querySelector("#checkout-valor");
const checkoutAccount = document.querySelector("#checkout-account");
const checkoutAccountEmail = document.querySelector("#checkout-account-email");
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

const accountButton = document.querySelector("#account-button");
const accountLogout = document.querySelector("#account-logout");
const accountAvatar = document.querySelector("#account-avatar");
const accountStatusText = document.querySelector("#account-status-text");
const accessModal = document.querySelector("#access-modal");
const accessPanel = document.querySelector("#access-panel");
const accessUser = document.querySelector("#access-user");
const accessKeyValue = document.querySelector("#access-key-value");
const accessKeyStatus = document.querySelector("#access-key-status");
const copyAccessKey = document.querySelector("#copy-access-key");
const accessCopied = document.querySelector("#access-copied");
const accessTelegram = document.querySelector("#access-telegram");
const accessDownload = document.querySelector("#access-download");
const accessDownloadNote = document.querySelector("#access-download-note");
const accessLogout = document.querySelector("#access-logout");

let paymentBrickController = null;
let timerConsulta = null;
let consultaEmAndamento = false;
let pagamentoAtual = null;
let produtoAtual = null;
let configuracao = null;
let produtos = new Map();
let firebaseAuthClient = null;
let usuarioAtual = null;
let estadoAcesso = { comprado: false };
let autenticacaoPronta = false;

for (const botao of document.querySelectorAll("[data-produto-id]")) {
  botao.addEventListener("click", async (event) => {
    event.preventDefault();
    await abrirCheckout(botao.dataset.produtoId);
  });
}

for (const botao of document.querySelectorAll("[data-fechar-checkout]")) {
  botao.addEventListener("click", fecharCheckout);
}

for (const botao of document.querySelectorAll("[data-fechar-acesso]")) {
  botao.addEventListener("click", fecharAcesso);
}

copiarPix?.addEventListener("click", copiarCodigoPix);
novoPagamento?.addEventListener("click", reiniciarCheckout);
copyAccessKey?.addEventListener("click", copiarChaveAcesso);
accountButton?.addEventListener("click", acaoBotaoConta);
accountLogout?.addEventListener("click", sairDaConta);
accessLogout?.addEventListener("click", sairDaConta);

supporterNameInput?.addEventListener("input", () => {
  limparErroNomeApoiador();
  const nome = normalizarNomeApoiador(supporterNameInput.value);
  if (nome) localStorage.setItem(SUPPORTER_NAME_KEY, nome);
});

window.addEventListener("beforeunload", destruirBrick);
window.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  if (accessModal && !accessModal.hidden) fecharAcesso();
  else if (modal && !modal.hidden) fecharCheckout();
});

iniciar();

async function iniciar() {
  if (supporterNameInput) {
    supporterNameInput.value = localStorage.getItem(SUPPORTER_NAME_KEY) || "";
  }

  try {
    await carregarConfiguracao();
    await iniciarAutenticacao();
  } catch (error) {
    console.error(error);
    mostrarEstadoContaIndisponivel();
  }

  await atualizarArrecadacao();
  await retomarPagamentoPendente();
  await processarIntencaoDepoisDoLogin();
  abrirAcessoSolicitadoNaUrl();

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

async function iniciarAutenticacao() {
  if (
    !configuracao?.autenticacaoDisponivel ||
    !configuracao.firebaseWebConfig ||
    typeof firebase !== "object"
  ) {
    autenticacaoPronta = false;
    mostrarEstadoContaIndisponivel();
    return;
  }

  if (!firebase.apps.length) {
    firebase.initializeApp(configuracao.firebaseWebConfig);
  }

  firebaseAuthClient = firebase.auth();
  try {
    await firebaseAuthClient.setPersistence(firebase.auth.Auth.Persistence.LOCAL);
  } catch (error) {
    console.warn("O navegador não permitiu alterar a persistência do login:", error);
  }

  try {
    await firebaseAuthClient.getRedirectResult();
  } catch (error) {
    console.error("Falha no retorno do login:", error);
  }

  await new Promise((resolve) => {
    let primeiraExecucao = true;
    firebaseAuthClient.onAuthStateChanged(async (usuario) => {
      usuarioAtual = usuario || null;
      autenticacaoPronta = true;
      await atualizarEstadoConta();

      if (primeiraExecucao) {
        primeiraExecucao = false;
        resolve();
      }
    });
  });
}

async function garantirLogin(produtoId = "") {
  if (usuarioAtual) return usuarioAtual;

  if (!firebaseAuthClient) {
    throw new Error(
      "O login com Google ainda não está disponível. Ative o Google no Firebase Authentication."
    );
  }

  if (produtoId) sessionStorage.setItem(LOGIN_INTENT_KEY, produtoId);

  const provider = new firebase.auth.GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });

  const usarRedirecionamento =
    window.matchMedia("(max-width: 720px)").matches ||
    /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

  if (usarRedirecionamento) {
    await firebaseAuthClient.signInWithRedirect(provider);
    return null;
  }

  try {
    const resultadoLogin = await firebaseAuthClient.signInWithPopup(provider);
    usuarioAtual = resultadoLogin.user;
    sessionStorage.removeItem(LOGIN_INTENT_KEY);
    await atualizarEstadoConta();
    return usuarioAtual;
  } catch (error) {
    if (["auth/popup-blocked", "auth/cancelled-popup-request"].includes(error.code)) {
      await firebaseAuthClient.signInWithRedirect(provider);
      return null;
    }

    if (error.code === "auth/unauthorized-domain") {
      throw new Error(
        "Este domínio ainda não foi autorizado no Firebase Authentication."
      );
    }

    if (error.code === "auth/popup-closed-by-user") return null;
    throw new Error("Não foi possível entrar com o Google agora.");
  }
}

async function atualizarEstadoConta() {
  if (!accountButton) return;

  if (!usuarioAtual) {
    estadoAcesso = { comprado: false };
    accountButton.classList.remove("account-button--owned");
    accountButton.classList.remove("account-button--connected");
    accountAvatar.textContent = "G";
    accountStatusText.textContent = "ENTRAR COM GOOGLE";
    accountLogout.hidden = true;
    atualizarBotoesCompra(false);
    return;
  }

  accountAvatar.textContent = primeiraLetra(usuarioAtual.displayName || usuarioAtual.email || "G");
  accountStatusText.textContent = "VERIFICANDO ACESSO...";
  accountLogout.hidden = false;
  accountButton.classList.add("account-button--connected");

  try {
    const token = await usuarioAtual.getIdToken();
    const response = await fetch("/api/meu-acesso", {
      cache: "no-store",
      headers: { Authorization: `Bearer ${token}` }
    });
    const data = await response.json();

    if (response.status === 401) {
      await usuarioAtual.getIdToken(true);
      throw new Error(data.erro || "Sessão expirada.");
    }

    if (!response.ok) throw new Error(data.erro || "Acesso indisponível.");

    estadoAcesso = data;
    if (data.comprado) {
      accountButton.classList.add("account-button--owned");
      accountStatusText.textContent = "✓ ACESSO AOS TESTES JÁ COMPRADO";
      preencherModalAcesso(data);
      atualizarBotoesCompra(true);
    } else {
      accountButton.classList.remove("account-button--owned");
      accountStatusText.textContent = "CONTA CONECTADA — APOIAR";
      atualizarBotoesCompra(false);
    }
  } catch (error) {
    console.warn(error.message);
    estadoAcesso = { comprado: false };
    accountButton.classList.remove("account-button--owned");
    accountStatusText.textContent = "CONTA CONECTADA";
    atualizarBotoesCompra(false);
  }
}

function mostrarEstadoContaIndisponivel() {
  if (!accountButton) return;
  accountButton.classList.remove("account-button--owned", "account-button--connected");
  accountAvatar.textContent = "!";
  accountStatusText.textContent = "LOGIN INDISPONÍVEL";
  accountButton.disabled = true;
  if (accountLogout) accountLogout.hidden = true;
}

async function acaoBotaoConta() {
  if (!autenticacaoPronta || accountButton.disabled) return;

  if (!usuarioAtual) {
    try {
      await garantirLogin();
    } catch (error) {
      window.alert(error.message);
    }
    return;
  }

  if (estadoAcesso.comprado) {
    abrirAcesso();
    return;
  }

  document.querySelector("#comprar")?.scrollIntoView({
    behavior: "smooth",
    block: "center"
  });
}

async function sairDaConta() {
  if (!firebaseAuthClient) return;
  fecharAcesso();
  await firebaseAuthClient.signOut();
}

async function abrirCheckout(produtoId) {
  try {
    if (!configuracao) await carregarConfiguracao();

    const produto = produtos.get(produtoId);
    if (!produto) throw new Error("Esta opção de apoio não está disponível.");

    if (produto.tipo === "compra" && estadoAcesso.comprado) {
      abrirAcesso();
      return;
    }

    if (produto.tipo === "compra" && !usuarioAtual) {
      const usuario = await garantirLogin(produtoId);
      if (!usuario) return;
    }

    abrirModal();

    const pagamentoSalvo = carregarPagamentoSalvo();
    if (pagamentoSalvo) {
      if (
        pagamentoSalvo.firebaseUid &&
        usuarioAtual?.uid &&
        pagamentoSalvo.firebaseUid !== usuarioAtual.uid
      ) {
        limparPagamentoSalvo();
      } else {
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

async function processarIntencaoDepoisDoLogin() {
  const produtoId = sessionStorage.getItem(LOGIN_INTENT_KEY);
  if (!produtoId || !usuarioAtual) return;
  sessionStorage.removeItem(LOGIN_INTENT_KEY);
  await abrirCheckout(produtoId);
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

  if (produto?.tipo === "compra" && usuarioAtual) {
    checkoutAccount.classList.remove("oculto");
    checkoutAccountEmail.textContent = usuarioAtual.email || usuarioAtual.displayName || "Conta Google";
  } else {
    checkoutAccount.classList.add("oculto");
    checkoutAccountEmail.textContent = "";
  }
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

  if (!produtoAtual) throw new Error("Nenhuma opção de apoio foi selecionada.");
  if (typeof MercadoPago !== "function") {
    throw new Error("O formulário do Mercado Pago não foi carregado. Atualize a página.");
  }

  await destruirBrick();
  const mp = new MercadoPago(configuracao.publicKey, { locale: "pt-BR" });
  const bricksBuilder = mp.bricks();

  paymentBrickController = await bricksBuilder.create(
    "payment",
    "paymentBrick_container",
    {
      initialization: { amount: Number(produtoAtual.valor) },
      customization: {
        visual: { style: { theme: "dark" } },
        paymentMethods: {
          creditCard: "all",
          debitCard: "all",
          bankTransfer: ["pix"],
          minInstallments: 1,
          maxInstallments: 1
        }
      },
      callbacks: {
        onReady: () => carregando.classList.add("oculto"),
        onSubmit: ({ selectedPaymentMethod, formData }) =>
          processarPagamento(selectedPaymentMethod, formData),
        onError: (error) => {
          console.error("Erro do Payment Brick:", error);
          mostrarErroConfiguracao(
            "O formulário de pagamento apresentou um erro. Atualize a página e tente novamente."
          );
        }
      }
    }
  );
}

function processarPagamento(selectedPaymentMethod, formData) {
  return new Promise(async (resolve, reject) => {
    try {
      if (!produtoAtual) throw new Error("A opção de apoio foi perdida. Selecione novamente.");

      const apoiadorNome = validarNomeApoiador();
      if (!apoiadorNome) {
        const error = new Error("Informe seu Nick ou nome no Discord antes de pagar.");
        error.code = "NOME_APOIADOR_INVALIDO";
        throw error;
      }

      if (produtoAtual.tipo === "compra" && !usuarioAtual) {
        const error = new Error("Entre com o Google para vincular a compra à sua conta.");
        error.code = "LOGIN_OBRIGATORIO";
        throw error;
      }

      localStorage.setItem(SUPPORTER_NAME_KEY, apoiadorNome);
      const headers = {
        "Content-Type": "application/json",
        "X-Idempotency-Key": gerarUUID()
      };

      if (usuarioAtual) {
        headers.Authorization = `Bearer ${await usuarioAtual.getIdToken()}`;
      }

      const response = await fetch("/api/processar-pagamento", {
        method: "POST",
        headers,
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
        firebaseUid: usuarioAtual?.uid || "",
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
  detalhesPagamento.textContent = data.pagamentoId ? `Pagamento: ${data.pagamentoId}` : "";

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
  detalhesPagamento.textContent = data.statusDetalhe ? `Motivo: ${data.statusDetalhe}` : "";
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
  if (!pagamentoAtual?.pagamentoId || consultaEmAndamento) return;
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

async function retomarPagamentoPendente() {
  const salvo = carregarPagamentoSalvo();
  if (!salvo || !configuracao) return;

  if (salvo.firebaseUid && usuarioAtual?.uid && salvo.firebaseUid !== usuarioAtual.uid) {
    limparPagamentoSalvo();
    return;
  }

  pagamentoAtual = salvo;
  produtoAtual = produtos.get(salvo.produtoId) || null;
  if (supporterNameInput) {
    supporterNameInput.value = salvo.apoiadorNome || supporterNameInput.value;
  }
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

async function atualizarArrecadacao() {
  try {
    const response = await fetch("/api/arrecadacao", { cache: "no-store" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.erro || "Arrecadação indisponível.");

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

function preencherModalAcesso(data) {
  const acesso = data.acesso || {};
  accessUser.textContent = data.usuario?.email || data.usuario?.nome || "Conta Google";
  accessKeyValue.textContent = acesso.chave || "Chave indisponível";
  accessKeyStatus.textContent = acesso.usada
    ? "Esta chave já foi ativada no jogo."
    : "Ainda não ativada. Ela será vinculada no primeiro uso.";

  if (acesso.telegramUrl) {
    accessTelegram.href = acesso.telegramUrl;
    accessTelegram.classList.remove("access-action--disabled");
    accessTelegram.removeAttribute("aria-disabled");
  }

  if (acesso.downloadDisponivel && acesso.downloadUrl) {
    accessDownload.href = acesso.downloadUrl;
    accessDownload.classList.remove("access-action--disabled");
    accessDownload.removeAttribute("aria-disabled");
    accessDownloadNote.textContent = "Baixe a build de teste disponível para sua conta.";
  } else {
    accessDownload.removeAttribute("href");
    accessDownload.classList.add("access-action--disabled");
    accessDownload.setAttribute("aria-disabled", "true");
    accessDownloadNote.textContent = "O link de download ainda não foi configurado pelo desenvolvedor.";
  }
}

function abrirAcesso() {
  if (!estadoAcesso.comprado) return;
  accessModal.hidden = false;
  document.body.classList.add("checkout-open");
  window.setTimeout(() => accessPanel.focus?.(), 0);
}

function fecharAcesso() {
  if (!accessModal) return;
  accessModal.hidden = true;
  if (modal?.hidden !== false) document.body.classList.remove("checkout-open");
}

function abrirAcessoSolicitadoNaUrl() {
  const params = new URLSearchParams(window.location.search);
  if (params.get("abrir-acesso") !== "1") return;

  if (estadoAcesso.comprado) {
    abrirAcesso();
    history.replaceState({}, "", window.location.pathname + window.location.hash);
  }
}

function atualizarBotoesCompra(comprado) {
  for (const botao of document.querySelectorAll('[data-produto-id="apoio-fundador-50"]')) {
    if (!botao.dataset.textoOriginal) botao.dataset.textoOriginal = botao.textContent.trim();
    botao.textContent = comprado ? "Abrir meu acesso →" : botao.dataset.textoOriginal;
    botao.classList.toggle("button--owned", comprado);
  }
}

async function copiarChaveAcesso() {
  const chave = accessKeyValue.textContent.trim();
  if (!chave || chave === "Chave indisponível") return;

  try {
    await navigator.clipboard.writeText(chave);
  } catch {
    const area = document.createElement("textarea");
    area.value = chave;
    document.body.append(area);
    area.select();
    document.execCommand("copy");
    area.remove();
  }

  accessCopied.classList.remove("oculto");
  window.setTimeout(() => accessCopied.classList.add("oculto"), 1800);
}

function prepararNomeApoiador() {
  supporterNameArea.classList.remove("oculto");
  limparErroNomeApoiador();

  const nomeSalvo = localStorage.getItem(SUPPORTER_NAME_KEY) || "";
  const nomeConta = usuarioAtual?.displayName || "";
  if (!supporterNameInput.value.trim()) {
    supporterNameInput.value = nomeSalvo || nomeConta;
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
  return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit" })
    .format(new Date(data));
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
  if (produtoAtual) await renderizarBrick();
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
    ) return salvo;
  } catch {
    // Valor inválido removido abaixo.
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
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (char) => {
    const random = Math.floor(Math.random() * 16);
    const value = char === "x" ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}
