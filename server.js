require("dotenv").config();

const crypto = require("crypto");
const express = require("express");
const path = require("path");
const {
  MercadoPagoConfig,
  Preference,
  Payment,
  WebhookSignatureValidator,
  InvalidWebhookSignatureError
} = require("mercadopago");

const app = express();
app.disable("x-powered-by");

const PORT = Number(process.env.PORT) || 3000;
const ACCESS_TOKEN = (process.env.MP_ACCESS_TOKEN || "").trim();
const WEBHOOK_SECRET = (process.env.MP_WEBHOOK_SECRET || "").trim();
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

const webhookSecretConfigurado =
  WEBHOOK_SECRET.length >= 16 && !WEBHOOK_SECRET.includes("COLE_AQUI");

let preferenceClient = null;
let paymentClient = null;

if (tokenConfigurado) {
  const client = new MercadoPagoConfig({
    accessToken: ACCESS_TOKEN,
    options: { timeout: 10000 }
  });

  preferenceClient = new Preference(client);
  paymentClient = new Payment(client);
}

// Cache curto para evitar consultas repetidas enquanto a página verifica o Pix.
// A confirmação continua vindo da API do Mercado Pago, nunca do navegador.
const cachePedidos = new Map();
const CACHE_PENDENTE_MS = 2500;
const CACHE_APROVADO_MS = 10000;

app.use(express.json({ limit: "100kb" }));
app.use(express.static(path.join(__dirname, "public")));

app.get("/api/saude", (_req, res) => {
  res.json({
    online: true,
    tokenConfigurado,
    webhookSecretConfigurado,
    urlPublicaConfigurada: Boolean(PUBLIC_URL),
    verificacaoPixAutomatica: true,
    valor: PRODUTO.valor,
    moeda: PRODUTO.moeda
  });
});

app.post("/api/criar-preferencia", async (_req, res) => {
  if (!preferenceClient) {
    return res.status(500).json({
      erro: "Configure MP_ACCESS_TOKEN nas variáveis de ambiente."
    });
  }

  if (!PUBLIC_URL) {
    return res.status(500).json({
      erro:
        "Configure PUBLIC_URL com a URL HTTPS fornecida pelo Render. " +
        "O Mercado Pago não aceita localhost nas URLs de retorno."
    });
  }

  const pedidoId = `dayzombi-${crypto.randomUUID()}`;

  const body = {
    items: [
      {
        id: PRODUTO.id,
        title: PRODUTO.titulo,
        description: PRODUTO.descricao,
        quantity: 1,
        currency_id: PRODUTO.moeda,
        unit_price: PRODUTO.valor
      }
    ],
    external_reference: pedidoId,
    statement_descriptor: "DAYZOMBI",
    metadata: {
      produto_id: PRODUTO.id,
      pedido_id: pedidoId
    },
    back_urls: {
      success: `${PUBLIC_URL}/sucesso.html`,
      pending: `${PUBLIC_URL}/pendente.html`,
      failure: `${PUBLIC_URL}/erro.html`
    },
    auto_return: "approved"
  };

  try {
    const preference = await preferenceClient.create({ body });

    if (!preference.id || !preference.init_point) {
      console.error("Preferência criada sem URL válida:", preference);
      return res.status(502).json({
        erro: "O Mercado Pago não retornou uma URL de checkout válida."
      });
    }

    cachePedidos.set(pedidoId, {
      pagamento: null,
      atualizadoEm: Date.now()
    });

    return res.json({
      preferenceId: preference.id,
      checkoutUrl: preference.init_point,
      pedidoId
    });
  } catch (error) {
    console.error("Erro ao criar preferência:", resumirErro(error));
    return res.status(502).json({
      erro: "O Mercado Pago recusou a criação do checkout."
    });
  }
});

// Usado quando o Mercado Pago retorna payment_id, como normalmente ocorre no cartão.
app.get("/api/verificar-pagamento", async (req, res) => {
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
    armazenarPagamentoNoCache(pagamento);
    return responderComPagamento(res, pagamento);
  } catch (error) {
    console.error("Erro ao consultar pagamento:", resumirErro(error));
    return res.status(502).json({
      aprovado: false,
      erro: "Não foi possível consultar esse pagamento no Mercado Pago."
    });
  }
});

// Usado pela aba original da loja para acompanhar Pix, cartão ou outro meio.
// A busca é feita pelo external_reference único criado para aquele pedido.
app.get("/api/verificar-pedido", async (req, res) => {
  if (!tokenConfigurado) {
    return res.status(500).json({
      aprovado: false,
      erro: "MP_ACCESS_TOKEN não configurado."
    });
  }

  const pedidoId = extrairPedidoId(req.query.pedido_id);

  if (!pedidoId) {
    return res.status(400).json({
      aprovado: false,
      erro: "pedido_id ausente ou inválido."
    });
  }

  const cache = obterCacheValido(pedidoId);

  if (cache?.pagamento) {
    return responderComPagamento(res, cache.pagamento, pedidoId);
  }

  try {
    const pagamentos = await buscarPagamentosPorPedido(pedidoId);

    if (pagamentos.length === 0) {
      cachePedidos.set(pedidoId, {
        pagamento: null,
        atualizadoEm: Date.now()
      });

      return res.json({
        aprovado: false,
        status: "aguardando",
        statusDetalhe: null,
        pagamentoId: null,
        pedidoId,
        valor: null,
        moeda: null,
        mensagem: "Aguardando o pagamento ser identificado pelo Mercado Pago."
      });
    }

    // Se houver mais de uma tentativa para a mesma referência, prioriza uma
    // aprovação válida. Caso contrário, usa o resultado mais recente.
    const pagamentoAprovado = pagamentos.find(
      (pagamento) => validarPagamentoDoProduto(pagamento, pedidoId).valido
    );
    const pagamento = pagamentoAprovado || pagamentos[0];

    armazenarPagamentoNoCache(pagamento);
    return responderComPagamento(res, pagamento, pedidoId);
  } catch (error) {
    console.error("Erro ao buscar pagamento do pedido:", resumirErro(error));
    return res.status(502).json({
      aprovado: false,
      status: "indisponivel",
      pedidoId,
      erro: "Não foi possível consultar o pedido agora. A página tentará novamente."
    });
  }
});

// URL para cadastrar no painel do Mercado Pago:
// https://SEU-SERVICO.onrender.com/api/webhook
app.post("/api/webhook", async (req, res) => {
  if (!webhookSecretConfigurado) {
    console.error("Webhook recebido, mas MP_WEBHOOK_SECRET não está configurado.");
    return res.sendStatus(503);
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
  const paymentId = extrairIdPagamento(dataIdDaQuery || req.body?.data?.id);

  if (tipo && tipo !== "payment") {
    return res.sendStatus(200);
  }

  if (!paymentId || !paymentClient) {
    return res.sendStatus(200);
  }

  try {
    const pagamento = await paymentClient.get({ id: paymentId });
    const resultado = validarPagamentoDoProduto(pagamento);
    armazenarPagamentoNoCache(pagamento);

    console.log("Pagamento atualizado:", {
      pagamentoId: pagamento.id,
      pedidoId: pagamento.external_reference,
      status: pagamento.status,
      valor: pagamento.transaction_amount,
      moeda: pagamento.currency_id,
      produtoLiberado: resultado.valido
    });

    // Em uma venda real, este é o ponto para gravar o pagamento em banco,
    // gerar acesso e garantir que o mesmo paymentId não seja processado duas vezes.
    return res.sendStatus(200);
  } catch (error) {
    console.error("Falha ao processar pagamento do webhook:", resumirErro(error));
    return res.sendStatus(500);
  }
});

app.use((error, _req, res, _next) => {
  console.error("Erro interno:", error);
  res.status(500).json({ erro: "Erro interno do servidor." });
});

app.listen(PORT, () => {
  console.log(`Servidor iniciado na porta ${PORT}`);
  console.log(`Valor do produto: R$ ${PRODUTO.valor.toFixed(2).replace(".", ",")}`);
  console.log(`PUBLIC_URL: ${PUBLIC_URL || "não configurada"}`);
  console.log(`Access Token: ${tokenConfigurado ? "configurado" : "não configurado"}`);
  console.log(
    `Assinatura do Webhook: ${
      webhookSecretConfigurado ? "configurada" : "não configurada"
    }`
  );
  console.log("Monitoramento automático de Pix: ativado");
});

async function buscarPagamentosPorPedido(pedidoId) {
  const url = new URL("https://api.mercadopago.com/v1/payments/search");
  url.searchParams.set("sort", "date_created");
  url.searchParams.set("criteria", "desc");
  url.searchParams.set("external_reference", pedidoId);
  url.searchParams.set("range", "date_created");
  url.searchParams.set("begin_date", "NOW-30DAYS");
  url.searchParams.set("end_date", "NOW");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${ACCESS_TOKEN}`,
        "Content-Type": "application/json"
      },
      signal: controller.signal
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      const error = new Error("O Mercado Pago recusou a busca de pagamentos.");
      error.status = response.status;
      error.details = data;
      throw error;
    }

    return Array.isArray(data.results) ? data.results : [];
  } finally {
    clearTimeout(timeout);
  }
}

function responderComPagamento(res, pagamento, pedidoIdEsperado = null) {
  const resultado = validarPagamentoDoProduto(pagamento, pedidoIdEsperado);

  return res.json({
    aprovado: resultado.valido,
    status: pagamento.status || "desconhecido",
    statusDetalhe: pagamento.status_detail || null,
    pagamentoId: pagamento.id ? String(pagamento.id) : null,
    valor: pagamento.transaction_amount ?? null,
    moeda: pagamento.currency_id || null,
    pedidoId: pagamento.external_reference || pedidoIdEsperado || null,
    mensagem: resultado.mensagem
  });
}

function armazenarPagamentoNoCache(pagamento) {
  const pedidoId = extrairPedidoId(pagamento?.external_reference);

  if (!pedidoId) {
    return;
  }

  cachePedidos.set(pedidoId, {
    pagamento,
    atualizadoEm: Date.now()
  });
}

function obterCacheValido(pedidoId) {
  const cache = cachePedidos.get(pedidoId);

  if (!cache) {
    return null;
  }

  const aprovado = cache.pagamento?.status === "approved";
  const ttl = aprovado ? CACHE_APROVADO_MS : CACHE_PENDENTE_MS;

  if (Date.now() - cache.atualizadoEm > ttl) {
    cachePedidos.delete(pedidoId);
    return null;
  }

  return cache;
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

function extrairPedidoId(valor) {
  const texto = Array.isArray(valor) ? valor[0] : valor;
  const pedidoId = String(texto || "").trim().toLowerCase();

  if (!/^dayzombi-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(pedidoId)) {
    return null;
  }

  return pedidoId;
}

function validarPagamentoDoProduto(pagamento, pedidoIdEsperado = null) {
  const status = String(pagamento?.status || "").toLowerCase();
  const statusConhecido = [
    "approved",
    "pending",
    "in_process",
    "rejected",
    "cancelled",
    "refunded",
    "charged_back"
  ].includes(status);

  if (status !== "approved") {
    return {
      valido: false,
      statusConhecido,
      mensagem:
        status === "pending" || status === "in_process"
          ? "O pagamento foi localizado e ainda está sendo processado."
          : status === "rejected" || status === "cancelled"
            ? "O pagamento foi recusado ou cancelado."
            : "O pagamento ainda não está aprovado."
    };
  }

  const referencia = String(pagamento.external_reference || "");
  const valorCorreto =
    Math.abs(Number(pagamento.transaction_amount) - PRODUTO.valor) < 0.00001;
  const moedaCorreta = pagamento.currency_id === PRODUTO.moeda;
  const referenciaCorreta = pedidoIdEsperado
    ? referencia === pedidoIdEsperado
    : referencia.startsWith("dayzombi-");
  const produtoCorreto =
    !pagamento.metadata?.produto_id ||
    pagamento.metadata.produto_id === PRODUTO.id;
  const naoEstornado = Number(pagamento.transaction_amount_refunded || 0) === 0;

  if (
    !valorCorreto ||
    !moedaCorreta ||
    !referenciaCorreta ||
    !produtoCorreto ||
    !naoEstornado
  ) {
    return {
      valido: false,
      statusConhecido: true,
      mensagem: "O pagamento foi aprovado, mas não corresponde a este produto."
    };
  }

  return {
    valido: true,
    statusConhecido: true,
    mensagem: "Pagamento confirmado diretamente pela API do Mercado Pago."
  };
}

function resumirErro(error) {
  return {
    nome: error?.name,
    mensagem: error?.message,
    status: error?.status,
    causa: error?.cause?.message
  };
}
