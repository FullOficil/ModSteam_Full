require("dotenv").config();

const crypto = require("crypto");
const express = require("express");
const path = require("path");
const {
  MercadoPagoConfig,
  Payment,
  WebhookSignatureValidator,
  InvalidWebhookSignatureError
} = require("mercadopago");

const app = express();
app.disable("x-powered-by");

const PORT = Number(process.env.PORT) || 3000;
const ACCESS_TOKEN = String(process.env.MP_ACCESS_TOKEN || "").trim();
const PUBLIC_KEY = String(process.env.MP_PUBLIC_KEY || "").trim();
const WEBHOOK_SECRET = String(process.env.MP_WEBHOOK_SECRET || "").trim();
const PUBLIC_URL = normalizarUrlPublica(process.env.PUBLIC_URL || "");

const PRODUTO = Object.freeze({
  id: "acesso-dayzombi",
  titulo: "Acesso DayZombi",
  descricao: "Acesso ao DayZombi",
  moeda: "BRL",
  valor: 0.5
});

const tokenConfigurado =
  ACCESS_TOKEN.length > 20 && !ACCESS_TOKEN.includes("COLE_AQUI");

const publicKeyConfigurada =
  PUBLIC_KEY.length > 20 && !PUBLIC_KEY.includes("COLE_AQUI");

const webhookSecretConfigurado =
  WEBHOOK_SECRET.length >= 16 && !WEBHOOK_SECRET.includes("COLE_AQUI");

let paymentClient = null;

if (tokenConfigurado) {
  const client = new MercadoPagoConfig({
    accessToken: ACCESS_TOKEN,
    options: { timeout: 12000 }
  });

  paymentClient = new Payment(client);
}

app.use(express.json({ limit: "150kb" }));
app.use(express.static(path.join(__dirname, "public"), {
  etag: true,
  maxAge: "5m"
}));

app.get("/api/saude", (_req, res) => {
  res.set("Cache-Control", "no-store");
  res.json({
    online: true,
    tokenConfigurado,
    publicKeyConfigurada,
    webhookSecretConfigurado,
    urlPublicaConfigurada: Boolean(PUBLIC_URL),
    checkoutIncorporado: true,
    valor: PRODUTO.valor,
    moeda: PRODUTO.moeda
  });
});

// A Public Key é pública por definição e pode ser utilizada no navegador.
// O Access Token nunca é enviado ao frontend.
app.get("/api/configuracao-publica", (_req, res) => {
  res.set("Cache-Control", "no-store");

  if (!publicKeyConfigurada) {
    return res.status(500).json({
      erro: "Configure MP_PUBLIC_KEY nas variáveis de ambiente do Render."
    });
  }

  return res.json({
    publicKey: PUBLIC_KEY,
    produto: {
      titulo: PRODUTO.titulo,
      descricao: PRODUTO.descricao,
      valor: PRODUTO.valor,
      moeda: PRODUTO.moeda
    }
  });
});

// Recebe os dados tokenizados pelo Payment Brick e cria o pagamento.
// O valor, a descrição e a referência do pedido são definidos exclusivamente
// pelo backend, sem confiar nos valores enviados pelo navegador.
app.post("/api/processar-pagamento", async (req, res) => {
  res.set("Cache-Control", "no-store");

  if (!paymentClient) {
    return res.status(500).json({
      erro: "Configure MP_ACCESS_TOKEN nas variáveis de ambiente do Render."
    });
  }

  const formData = req.body?.formData || req.body || {};
  const paymentMethodId = limparTexto(formData.payment_method_id, 60).toLowerCase();
  const tokenCartao = limparTexto(formData.token, 300);
  const pagador = sanitizarPagador(formData.payer);

  if (!paymentMethodId) {
    return res.status(400).json({ erro: "Meio de pagamento não informado." });
  }

  const pagamentoPix = paymentMethodId === "pix";

  // Somente Pix ou cartão tokenizado são aceitos. Assim, boleto, Conta Mercado
  // Pago e outros meios não podem ser ativados por uma requisição adulterada.
  if (!pagamentoPix && !tokenCartao) {
    return res.status(400).json({
      erro: "O pagamento com cartão não trouxe um token válido."
    });
  }

  if (!pagador.email) {
    return res.status(400).json({
      erro: "Informe um e-mail válido para realizar o pagamento."
    });
  }

  const pedidoId = `dayzombi-${crypto.randomUUID()}`;
  const idempotencyKey = extrairChaveIdempotencia(
    req.headers["x-idempotency-key"]
  ) || crypto.randomUUID();

  const body = {
    transaction_amount: PRODUTO.valor,
    description: PRODUTO.descricao,
    payment_method_id: paymentMethodId,
    payer: pagador,
    external_reference: pedidoId,
    statement_descriptor: "DAYZOMBI",
    metadata: {
      produto_id: PRODUTO.id,
      pedido_id: pedidoId,
      checkout: "payment_brick"
    }
  };

  if (!pagamentoPix) {
    body.token = tokenCartao;
    body.installments = 1;

    const issuerId = limparTexto(formData.issuer_id, 40);
    if (issuerId) {
      body.issuer_id = issuerId;
    }
  }

  if (PUBLIC_URL) {
    body.notification_url = `${PUBLIC_URL}/api/webhook`;
  }

  try {
    const pagamento = await paymentClient.create({
      body,
      requestOptions: { idempotencyKey }
    });

    console.log("Pagamento criado:", {
      pagamentoId: pagamento.id,
      pedidoId,
      status: pagamento.status,
      meio: pagamento.payment_method_id,
      tipo: pagamento.payment_type_id,
      valor: pagamento.transaction_amount
    });

    return res.status(201).json(resumirPagamentoParaCliente(pagamento));
  } catch (error) {
    console.error("Erro ao criar pagamento:", resumirErro(error));

    return res.status(extrairStatusErro(error)).json({
      erro: mensagemAmigavelDoErro(error),
      detalhe: extrairDetalheSeguro(error)
    });
  }
});

// Consulta sempre o pagamento diretamente no Mercado Pago. Essa rota é usada
// pela tela do Pix para detectar a aprovação sem depender de redirecionamento.
app.get("/api/verificar-pagamento", async (req, res) => {
  res.set("Cache-Control", "no-store");

  if (!paymentClient) {
    return res.status(500).json({
      aprovado: false,
      erro: "MP_ACCESS_TOKEN não configurado."
    });
  }

  const paymentId = extrairIdPagamento(req.query.payment_id);

  if (!paymentId) {
    return res.status(400).json({
      aprovado: false,
      erro: "payment_id ausente ou inválido."
    });
  }

  try {
    const pagamento = await paymentClient.get({ id: paymentId });
    return res.json(resumirPagamentoParaCliente(pagamento));
  } catch (error) {
    console.error("Erro ao consultar pagamento:", resumirErro(error));
    return res.status(502).json({
      aprovado: false,
      status: "indisponivel",
      erro: "Não foi possível consultar esse pagamento agora."
    });
  }
});

// URL para cadastrar no painel do Mercado Pago:
// https://SEU-SERVICO.onrender.com/api/webhook
app.post("/api/webhook", async (req, res) => {
  // Enquanto a assinatura não estiver configurada, não processamos a carga,
  // mas respondemos 200 para não gerar tentativas infinitas durante os testes.
  if (!webhookSecretConfigurado) {
    console.warn("Webhook ignorado: MP_WEBHOOK_SECRET não configurado.");
    return res.sendStatus(200);
  }

  const dataIdDaQuery = req.query["data.id"];

  try {
    WebhookSignatureValidator.validate({
      xSignature: req.headers["x-signature"],
      xRequestId: req.headers["x-request-id"],
      dataId: dataIdDaQuery,
      secret: WEBHOOK_SECRET,
      toleranceSeconds: 300
    });
  } catch (error) {
    if (error instanceof InvalidWebhookSignatureError) {
      console.warn("Webhook rejeitado:", {
        motivo: error.reason,
        requestId: error.requestId
      });
      return res.sendStatus(401);
    }

    console.error("Erro ao validar assinatura do webhook:", error);
    return res.sendStatus(500);
  }

  const tipo = String(req.query.type || req.body?.type || "").toLowerCase();
  const paymentId = extrairIdPagamento(
    dataIdDaQuery || req.body?.data?.id
  );

  if (tipo && tipo !== "payment") {
    return res.sendStatus(200);
  }

  if (!paymentId || !paymentClient) {
    return res.sendStatus(200);
  }

  try {
    const pagamento = await paymentClient.get({ id: paymentId });
    const resultado = validarPagamentoDoProduto(pagamento);

    console.log("Pagamento atualizado pelo Webhook:", {
      pagamentoId: pagamento.id,
      pedidoId: pagamento.external_reference,
      status: pagamento.status,
      valor: pagamento.transaction_amount,
      moeda: pagamento.currency_id,
      produtoLiberado: resultado.valido
    });

    // Para venda real: grave o paymentId em um banco de dados e garanta
    // idempotência antes de entregar arquivo, chave ou acesso.
    return res.sendStatus(200);
  } catch (error) {
    console.error("Falha ao processar Webhook:", resumirErro(error));
    return res.sendStatus(500);
  }
});

app.use((error, _req, res, _next) => {
  console.error("Erro interno:", error);
  res.status(500).json({ erro: "Erro interno do servidor." });
});

app.listen(PORT, () => {
  console.log(`Servidor iniciado na porta ${PORT}`);
  console.log(`Valor do produto: R$ ${formatarValor(PRODUTO.valor)}`);
  console.log(`PUBLIC_URL: ${PUBLIC_URL || "não configurada"}`);
  console.log(`Access Token: ${tokenConfigurado ? "configurado" : "não configurado"}`);
  console.log(`Public Key: ${publicKeyConfigurada ? "configurada" : "não configurada"}`);
  console.log(
    `Assinatura do Webhook: ${
      webhookSecretConfigurado ? "configurada" : "não configurada"
    }`
  );
  console.log("Checkout incorporado Payment Brick: ativado");
});

function resumirPagamentoParaCliente(pagamento) {
  const resultado = validarPagamentoDoProduto(pagamento);
  const transactionData = pagamento?.point_of_interaction?.transaction_data || {};
  const pagamentoId = pagamento?.id ? String(pagamento.id) : null;
  const paymentMethodId = String(pagamento?.payment_method_id || "");
  const isPix = paymentMethodId.toLowerCase() === "pix";

  return {
    aprovado: resultado.valido,
    status: String(pagamento?.status || "desconhecido"),
    statusDetalhe: pagamento?.status_detail || null,
    pagamentoId,
    pedidoId: pagamento?.external_reference || null,
    valor: pagamento?.transaction_amount ?? null,
    moeda: pagamento?.currency_id || null,
    meioPagamento: paymentMethodId || null,
    tipoPagamento: pagamento?.payment_type_id || null,
    mensagem: resultado.mensagem,
    pix: isPix
      ? {
          qrCode: transactionData.qr_code || null,
          qrCodeBase64: transactionData.qr_code_base64 || null,
          expiracao: pagamento?.date_of_expiration || null
        }
      : null
  };
}

function validarPagamentoDoProduto(pagamento) {
  const status = String(pagamento?.status || "").toLowerCase();

  if (status !== "approved") {
    return {
      valido: false,
      mensagem: mensagemPorStatus(status, pagamento?.status_detail)
    };
  }

  const referencia = String(pagamento?.external_reference || "");
  const valorCorreto =
    Math.abs(Number(pagamento?.transaction_amount) - PRODUTO.valor) < 0.00001;
  const moedaCorreta = pagamento?.currency_id === PRODUTO.moeda;
  const referenciaCorreta = referencia.startsWith("dayzombi-");
  const produtoCorreto =
    !pagamento?.metadata?.produto_id ||
    pagamento.metadata.produto_id === PRODUTO.id;
  const naoEstornado =
    Number(pagamento?.transaction_amount_refunded || 0) === 0;

  if (
    !valorCorreto ||
    !moedaCorreta ||
    !referenciaCorreta ||
    !produtoCorreto ||
    !naoEstornado
  ) {
    return {
      valido: false,
      mensagem: "O pagamento foi aprovado, mas não corresponde a este produto."
    };
  }

  return {
    valido: true,
    mensagem: "Pagamento confirmado diretamente pela API do Mercado Pago."
  };
}

function mensagemPorStatus(status, statusDetail) {
  if (status === "pending" || status === "in_process") {
    return statusDetail === "pending_waiting_transfer"
      ? "Pix criado. Aguardando o pagamento."
      : "O pagamento está sendo processado.";
  }

  if (status === "rejected") {
    return "O pagamento foi recusado. Confira os dados e tente novamente.";
  }

  if (status === "cancelled") {
    return "O pagamento foi cancelado.";
  }

  if (status === "refunded" || status === "charged_back") {
    return "O pagamento foi devolvido ou contestado.";
  }

  return "O pagamento ainda não está aprovado.";
}

function sanitizarPagador(valor) {
  const payer = valor && typeof valor === "object" ? valor : {};
  const email = limparTexto(payer.email, 180).toLowerCase();
  const resultado = {};

  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    resultado.email = email;
  }

  const firstName = limparTexto(payer.first_name, 80);
  const lastName = limparTexto(payer.last_name, 80);

  if (firstName) resultado.first_name = firstName;
  if (lastName) resultado.last_name = lastName;

  const tipoDocumento = limparTexto(payer.identification?.type, 12).toUpperCase();
  const numeroDocumento = limparTexto(payer.identification?.number, 30)
    .replace(/[^0-9A-Za-z]/g, "");

  if (tipoDocumento && numeroDocumento) {
    resultado.identification = {
      type: tipoDocumento,
      number: numeroDocumento
    };
  }

  return resultado;
}

function normalizarUrlPublica(valor) {
  const url = String(valor || "").trim().replace(/\/+$/, "");

  if (!url || url.includes("SEU-SERVICO")) {
    return "";
  }

  try {
    const parsed = new URL(url);

    if (parsed.protocol !== "https:") {
      return "";
    }

    if (["localhost", "127.0.0.1"].includes(parsed.hostname)) {
      return "";
    }

    return parsed.origin + parsed.pathname.replace(/\/+$/, "");
  } catch {
    return "";
  }
}

function extrairIdPagamento(valor) {
  const texto = Array.isArray(valor) ? valor[0] : valor;

  if (!/^\d+$/.test(String(texto || "").trim())) {
    return null;
  }

  return String(texto).trim();
}

function extrairChaveIdempotencia(valor) {
  const texto = Array.isArray(valor) ? valor[0] : valor;
  const chave = String(texto || "").trim();

  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(chave)
    ? chave
    : null;
}

function limparTexto(valor, limite) {
  return String(valor ?? "").trim().slice(0, limite);
}

function extrairStatusErro(error) {
  const status = Number(error?.status || error?.cause?.status);
  return status >= 400 && status <= 499 ? 400 : 502;
}

function extrairDetalheSeguro(error) {
  const causas = error?.cause;

  if (Array.isArray(causas) && causas.length > 0) {
    return limparTexto(causas[0]?.description || causas[0]?.code, 180) || null;
  }

  return limparTexto(error?.message, 180) || null;
}

function mensagemAmigavelDoErro(error) {
  const detalhe = `${error?.message || ""} ${JSON.stringify(error?.cause || "")}`.toLowerCase();

  if (detalhe.includes("public_key")) {
    return "A Public Key não corresponde à aplicação usada no pagamento.";
  }

  if (detalhe.includes("payer") || detalhe.includes("email")) {
    return "Confira os dados do comprador e tente novamente.";
  }

  if (detalhe.includes("card") || detalhe.includes("token")) {
    return "Os dados do cartão não puderam ser processados.";
  }

  return "O Mercado Pago não conseguiu criar o pagamento. Tente novamente.";
}

function resumirErro(error) {
  return {
    nome: error?.name,
    mensagem: error?.message,
    status: error?.status,
    causa: error?.cause
  };
}

function formatarValor(valor) {
  return Number(valor).toFixed(2).replace(".", ",");
}
