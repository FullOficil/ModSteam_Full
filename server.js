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
  ACCESS_TOKEN.length > 20 &&
  !ACCESS_TOKEN.includes("COLE_AQUI");

const webhookSecretConfigurado =
  WEBHOOK_SECRET.length >= 16 &&
  !WEBHOOK_SECRET.includes("COLE_AQUI");

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

app.use(express.json({ limit: "100kb" }));
app.use(express.static(path.join(__dirname, "public")));

app.get("/api/saude", (_req, res) => {
  res.json({
    online: true,
    tokenConfigurado,
    webhookSecretConfigurado,
    urlPublicaConfigurada: Boolean(PUBLIC_URL),
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

// O navegador nunca decide se o produto foi pago.
// Esta rota consulta o pagamento diretamente no Mercado Pago usando o Access Token.
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
    const resultado = validarPagamentoDoProduto(pagamento);

    return res.status(resultado.valido || resultado.statusConhecido ? 200 : 403).json({
      aprovado: resultado.valido,
      status: pagamento.status || "desconhecido",
      statusDetalhe: pagamento.status_detail || null,
      pagamentoId: String(pagamento.id || paymentId),
      valor: pagamento.transaction_amount ?? null,
      moeda: pagamento.currency_id || null,
      pedidoId: pagamento.external_reference || null,
      mensagem: resultado.mensagem
    });
  } catch (error) {
    console.error("Erro ao consultar pagamento:", resumirErro(error));
    return res.status(502).json({
      aprovado: false,
      erro: "Não foi possível consultar esse pagamento no Mercado Pago."
    });
  }
});

// URL que deve ser cadastrada no painel do Mercado Pago:
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

    console.log("Pagamento atualizado:", {
      pagamentoId: pagamento.id,
      pedidoId: pagamento.external_reference,
      status: pagamento.status,
      valor: pagamento.transaction_amount,
      moeda: pagamento.currency_id,
      produtoLiberado: resultado.valido
    });

    // Neste ponto, quando resultado.valido for true, você pode:
    // 1. salvar o pagamento em um banco de dados;
    // 2. gerar uma chave única;
    // 3. enviar um e-mail;
    // 4. liberar o produto para a conta do comprador.
    // Não faça essas ações mais de uma vez para o mesmo pagamento.

    return res.sendStatus(200);
  } catch (error) {
    console.error("Falha ao processar pagamento do webhook:", resumirErro(error));

    // Retorna erro para o Mercado Pago tentar enviar novamente.
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
});

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

function validarPagamentoDoProduto(pagamento) {
  const status = String(pagamento.status || "").toLowerCase();
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
          ? "O pagamento ainda está sendo processado."
          : "O pagamento não está aprovado."
    };
  }

  const valorCorreto =
    Math.abs(Number(pagamento.transaction_amount) - PRODUTO.valor) < 0.00001;
  const moedaCorreta = pagamento.currency_id === PRODUTO.moeda;
  const referenciaCorreta = String(pagamento.external_reference || "").startsWith(
    "dayzombi-"
  );
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
