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
const {
  initializeApp: initializeFirebaseApp,
  applicationDefault,
  cert
} = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const { getDatabase } = require("firebase-admin/database");

const app = express();
app.disable("x-powered-by");

const PORT = Number(process.env.PORT) || 3000;
const ACCESS_TOKEN = String(process.env.MP_ACCESS_TOKEN || "").trim();
const PUBLIC_KEY = String(process.env.MP_PUBLIC_KEY || "").trim();
const WEBHOOK_SECRET = String(process.env.MP_WEBHOOK_SECRET || "").trim();
const PUBLIC_URL = normalizarUrlPublica(process.env.PUBLIC_URL || "");
const TELEGRAM_URL = normalizarUrlExterna(
  process.env.TELEGRAM_URL || "https://t.me/+CyDPE-Hbq00wOGRh"
);
const GAME_DOWNLOAD_URL = normalizarUrlExterna(process.env.GAME_DOWNLOAD_URL || "");

const FIREBASE_DATABASE_URL = String(
  process.env.FIREBASE_DATABASE_URL ||
  "https://dayzozmbi-server-default-rtdb.firebaseio.com"
).trim();

// Configuração pública do Firebase Web. A chave de API identifica o projeto,
// mas a autorização real do servidor continua sendo feita pelo ID token.
const FIREBASE_WEB_CONFIG = Object.freeze({
  apiKey: String(
    process.env.FIREBASE_WEB_API_KEY ||
    "AIzaSyB5A-ySceXCFRQ7iSCnOA68nRJqYpK6DQc"
  ).trim(),
  authDomain: String(
    process.env.FIREBASE_AUTH_DOMAIN ||
    "dayzozmbi-server.firebaseapp.com"
  ).trim(),
  projectId: String(
    process.env.FIREBASE_WEB_PROJECT_ID ||
    "dayzozmbi-server"
  ).trim(),
  databaseURL: FIREBASE_DATABASE_URL,
  storageBucket: String(
    process.env.FIREBASE_STORAGE_BUCKET ||
    "dayzozmbi-server.firebasestorage.app"
  ).trim(),
  messagingSenderId: String(
    process.env.FIREBASE_MESSAGING_SENDER_ID ||
    "221905253103"
  ).trim()
});

const META_ARRECADACAO = 5000;
const FIREBASE_LOJA_PATH = "LojaDayZombi";
const FIREBASE_CHAVES_PATH = "Chaves de Acessos";
const FIREBASE_LOGINS_PATH = "LOGINS_REGISTRADOS";
const LIMITE_APOIOS_RECENTES = 12;

const PRODUTOS = Object.freeze({
  "apoio-fundador-50": Object.freeze({
    id: "apoio-fundador-50",
    titulo: "Apoio Fundador DayZombi",
    descricao: "Apoio ao DayZombi com acesso às versões de teste e benefícios de apoiador",
    tipo: "compra",
    valor: 50,
    moeda: "BRL",
    telegram: true
  }),
  "doacao-5": Object.freeze({
    id: "doacao-5",
    titulo: "Doação DayZombi — R$ 5",
    descricao: "Doação opcional para o desenvolvimento do DayZombi",
    tipo: "doacao",
    valor: 5,
    moeda: "BRL",
    telegram: false
  }),
  "doacao-10": Object.freeze({
    id: "doacao-10",
    titulo: "Doação DayZombi — R$ 10",
    descricao: "Doação opcional para o desenvolvimento do DayZombi",
    tipo: "doacao",
    valor: 10,
    moeda: "BRL",
    telegram: false
  }),
  "doacao-20": Object.freeze({
    id: "doacao-20",
    titulo: "Doação DayZombi — R$ 20",
    descricao: "Doação opcional para o desenvolvimento do DayZombi",
    tipo: "doacao",
    valor: 20,
    moeda: "BRL",
    telegram: false
  })
});

const tokenConfigurado =
  ACCESS_TOKEN.length > 20 && !ACCESS_TOKEN.includes("COLE_AQUI");
const publicKeyConfigurada =
  PUBLIC_KEY.length > 20 && !PUBLIC_KEY.includes("COLE_AQUI");
const webhookSecretConfigurado =
  WEBHOOK_SECRET.length >= 16 && !WEBHOOK_SECRET.includes("COLE_AQUI");
const firebaseWebConfigurado =
  FIREBASE_WEB_CONFIG.apiKey.length > 20 &&
  FIREBASE_WEB_CONFIG.authDomain.length > 5 &&
  FIREBASE_WEB_CONFIG.projectId.length > 2;

let paymentClient = null;
let firebaseApp = null;
let firebaseDb = null;
let firebaseAuth = null;
let firebaseErroInicializacao = null;

if (tokenConfigurado) {
  const client = new MercadoPagoConfig({
    accessToken: ACCESS_TOKEN,
    options: { timeout: 12000 }
  });
  paymentClient = new Payment(client);
}

try {
  const firebaseCredential = carregarCredencialFirebase();

  if (firebaseCredential) {
    firebaseApp = initializeFirebaseApp({
      credential: firebaseCredential,
      databaseURL: FIREBASE_DATABASE_URL
    });
    firebaseDb = getDatabase(firebaseApp);
    firebaseAuth = getAuth(firebaseApp);
  }
} catch (error) {
  firebaseErroInicializacao = error;
  console.error("Firebase não foi inicializado:", error.message);
}

app.use(express.json({ limit: "220kb" }));
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
    firebaseConfigurado: Boolean(firebaseDb && firebaseAuth),
    firebaseWebConfigurado,
    firebaseErro: firebaseErroInicializacao?.message || null,
    checkoutIncorporado: true,
    downloadConfigurado: Boolean(GAME_DOWNLOAD_URL),
    metaArrecadacao: META_ARRECADACAO,
    produtos: Object.values(PRODUTOS).map(produtoPublico)
  });
});

app.get("/api/configuracao-publica", (_req, res) => {
  res.set("Cache-Control", "no-store");

  if (!publicKeyConfigurada) {
    return res.status(500).json({
      erro: "Configure MP_PUBLIC_KEY nas variáveis de ambiente do Render."
    });
  }

  return res.json({
    publicKey: PUBLIC_KEY,
    metaArrecadacao: META_ARRECADACAO,
    produtos: Object.values(PRODUTOS).map(produtoPublico),
    firebaseWebConfig: firebaseWebConfigurado ? FIREBASE_WEB_CONFIG : null,
    autenticacaoDisponivel: Boolean(firebaseAuth && firebaseWebConfigurado),
    telegramUrl: TELEGRAM_URL || null,
    downloadConfigurado: Boolean(GAME_DOWNLOAD_URL)
  });
});

app.get("/api/arrecadacao", async (_req, res) => {
  res.set("Cache-Control", "no-store");

  if (!firebaseDb) {
    return res.status(503).json({
      total: 0,
      meta: META_ARRECADACAO,
      percentual: 0,
      apoiosRecentes: [],
      erro: "Firebase Admin ainda não foi configurado no servidor."
    });
  }

  try {
    const [totalSnapshot, apoiosSnapshot] = await Promise.all([
      firebaseDb.ref(`${FIREBASE_LOJA_PATH}/Doações`).once("value"),
      firebaseDb.ref(`${FIREBASE_LOJA_PATH}/ApoiosPublicos`).once("value")
    ]);

    const total = arredondarDinheiro(totalSnapshot.val());
    return res.json({
      ...criarResumoArrecadacao(total),
      apoiosRecentes: criarListaApoiosRecentes(
        apoiosSnapshot.val(),
        LIMITE_APOIOS_RECENTES
      )
    });
  } catch (error) {
    console.error("Erro ao consultar arrecadação:", resumirErro(error));
    return res.status(502).json({
      total: 0,
      meta: META_ARRECADACAO,
      percentual: 0,
      apoiosRecentes: [],
      erro: "Não foi possível consultar a arrecadação agora."
    });
  }
});


app.get("/api/minha-conta", async (req, res) => {
  res.set("Cache-Control", "no-store");

  if (!firebaseDb) {
    return res.status(503).json({
      cadastrado: false,
      erro: "Firebase Admin ainda não foi configurado no servidor."
    });
  }

  try {
    const usuario = await obterUsuarioAutenticado(req, true);
    const contaRef = firebaseDb.ref(
      `${FIREBASE_LOJA_PATH}/${FIREBASE_LOGINS_PATH}/USUARIOS/${usuario.uid}`
    );
    const snapshot = await contaRef.once("value");
    const conta = snapshot.val();

    if (!conta?.Dados?.nick) {
      return res.json({
        autenticado: true,
        cadastrado: false,
        usuario: usuarioPublico(usuario)
      });
    }

    const agora = Date.now();
    await contaRef.child("Dados").update({
      googleEmail: usuario.email || conta.Dados.googleEmail || "",
      googleNome: usuario.nome || conta.Dados.googleNome || "",
      googleFoto: usuario.foto || conta.Dados.googleFoto || "",
      provedor: usuario.provedor || conta.Dados.provedor || "google.com",
      emailVerificado: Boolean(usuario.emailVerificado),
      ultimoLoginEm: agora,
      atualizadoEm: agora
    });

    const contaAtualizada = {
      ...conta,
      Dados: {
        ...conta.Dados,
        googleEmail: usuario.email || conta.Dados.googleEmail || "",
        googleNome: usuario.nome || conta.Dados.googleNome || "",
        googleFoto: usuario.foto || conta.Dados.googleFoto || "",
        provedor: usuario.provedor || conta.Dados.provedor || "google.com",
        emailVerificado: Boolean(usuario.emailVerificado),
        ultimoLoginEm: agora,
        atualizadoEm: agora
      }
    };

    return res.json({
      autenticado: true,
      cadastrado: true,
      usuario: usuarioPublico(usuario),
      conta: contaPublica(contaAtualizada)
    });
  } catch (error) {
    return responderErroAutenticacao(res, error);
  }
});

app.post("/api/cadastrar-conta", async (req, res) => {
  res.set("Cache-Control", "no-store");

  if (!firebaseDb) {
    return res.status(503).json({
      cadastrado: false,
      erro: "Firebase Admin ainda não foi configurado no servidor."
    });
  }

  try {
    const usuario = await obterUsuarioAutenticado(req, true);
    const nickInfo = normalizarNickConta(req.body?.nick);

    if (!nickInfo) {
      return res.status(400).json({
        cadastrado: false,
        erro: "Use de 3 a 20 caracteres: letras, números, _ ou -. O Nick deve começar com letra ou número."
      });
    }

    const lojaRef = firebaseDb.ref(FIREBASE_LOJA_PATH);
    let nickEmUso = false;

    const transacao = await lojaRef.transaction((estadoAtual) => {
      const estado = estadoAtual && typeof estadoAtual === "object"
        ? { ...estadoAtual }
        : {};
      const logins = clonarObjeto(estado[FIREBASE_LOGINS_PATH]);
      const usuariosRegistrados = clonarObjeto(logins.USUARIOS);
      const nicksRegistrados = clonarObjeto(logins.NICKS);
      const uidParaNick = clonarObjeto(logins.UID_PARA_NICK);
      const contaExistente = clonarObjeto(usuariosRegistrados[usuario.uid]);
      const dadosExistentes = clonarObjeto(contaExistente.Dados);

      if (dadosExistentes.nick) {
        return estado;
      }

      const donoNick = nicksRegistrados[nickInfo.nickKey]?.uid;
      if (donoNick && donoNick !== usuario.uid) {
        nickEmUso = true;
        return;
      }

      const agora = Date.now();
      const eventosMigrados = criarEventosContaDosPagamentos(
        estado.PagamentosProcessados,
        usuario.uid,
        agora
      );

      usuariosRegistrados[usuario.uid] = {
        Dados: {
          firebaseUid: usuario.uid,
          googleEmail: usuario.email || "",
          googleNome: usuario.nome || "",
          googleFoto: usuario.foto || "",
          provedor: usuario.provedor || "google.com",
          emailVerificado: Boolean(usuario.emailVerificado),
          nick: nickInfo.nick,
          nickChave: nickInfo.nickKey,
          criadoEm: agora,
          ultimoLoginEm: agora,
          atualizadoEm: agora
        },
        Eventos: eventosMigrados
      };

      nicksRegistrados[nickInfo.nickKey] = {
        uid: usuario.uid,
        nick: nickInfo.nick,
        criadoEm: agora
      };
      uidParaNick[usuario.uid] = {
        nickChave: nickInfo.nickKey,
        nick: nickInfo.nick
      };

      logins.USUARIOS = usuariosRegistrados;
      logins.NICKS = nicksRegistrados;
      logins.UID_PARA_NICK = uidParaNick;
      estado[FIREBASE_LOGINS_PATH] = logins;
      estado.AtualizadoEm = agora;
      return estado;
    }, undefined, false);

    if (!transacao.committed) {
      if (nickEmUso) {
        return res.status(409).json({
          cadastrado: false,
          erro: "Esse Nick já está sendo usado. Escolha outro."
        });
      }

      return res.status(500).json({
        cadastrado: false,
        erro: "Não foi possível registrar a conta agora."
      });
    }

    const conta = transacao.snapshot
      .child(`${FIREBASE_LOGINS_PATH}/USUARIOS/${usuario.uid}`)
      .val();

    return res.status(201).json({
      autenticado: true,
      cadastrado: true,
      usuario: usuarioPublico(usuario),
      conta: contaPublica(conta)
    });
  } catch (error) {
    return responderErroAutenticacao(res, error);
  }
});

app.get("/api/meu-acesso", async (req, res) => {
  res.set("Cache-Control", "no-store");

  try {
    const usuario = await obterUsuarioAutenticado(req, true);
    const snapshot = await firebaseDb
      .ref(`${FIREBASE_LOJA_PATH}/Usuarios/${usuario.uid}/AcessoTeste`)
      .once("value");
    const acesso = snapshot.val();

    if (!acesso?.comprado || !acesso?.ativo || !acesso?.chave) {
      return res.json({
        autenticado: true,
        comprado: false,
        usuario: usuarioPublico(usuario)
      });
    }

    return res.json({
      autenticado: true,
      comprado: true,
      usuario: usuarioPublico(usuario),
      acesso: {
        chave: String(acesso.chave),
        aviso: "Uso único. Não compartilhe esta chave.",
        compradoEm: Number(acesso.compradoEm) || null,
        atualizadoEm: Number(acesso.atualizadoEm) || null,
        usada: Boolean(acesso.usada),
        telegramUrl: TELEGRAM_URL || null,
        downloadUrl: GAME_DOWNLOAD_URL || null,
        downloadDisponivel: Boolean(GAME_DOWNLOAD_URL)
      }
    });
  } catch (error) {
    return responderErroAutenticacao(res, error);
  }
});

// Rota destinada ao jogo. Na primeira ativação, a chave é vinculada a um
// identificador de jogador/dispositivo. Uma pessoa diferente não consegue usar
// a mesma chave novamente.
app.post("/api/ativar-chave", async (req, res) => {
  res.set("Cache-Control", "no-store");

  if (!firebaseDb) {
    return res.status(503).json({
      valida: false,
      erro: "Servidor de chaves indisponível."
    });
  }

  const chave = normalizarChaveAcesso(req.body?.chave);
  const identificadorJogador = normalizarIdentificadorJogador(
    req.body?.identificadorJogador
  );

  if (!chave || !identificadorJogador) {
    return res.status(400).json({
      valida: false,
      erro: "Informe uma chave e um identificador de jogador válidos."
    });
  }

  const chaveRef = firebaseDb.ref(
    `${FIREBASE_LOJA_PATH}/${FIREBASE_CHAVES_PATH}/${chave}`
  );
  let resultadoLocal = "invalida";

  try {
    const transacao = await chaveRef.transaction((registroAtual) => {
      if (!registroAtual || registroAtual.ativa !== true) {
        resultadoLocal = "invalida";
        return;
      }

      if (registroAtual.usada === true) {
        if (registroAtual.usadaPor === identificadorJogador) {
          resultadoLocal = "mesmo_jogador";
          return registroAtual;
        }

        resultadoLocal = "ja_usada";
        return;
      }

      resultadoLocal = "ativada";
      return {
        ...registroAtual,
        usada: true,
        usadaPor: identificadorJogador,
        usadaEm: Date.now(),
        atualizadoEm: Date.now()
      };
    }, undefined, false);

    if (!transacao.committed && resultadoLocal === "ja_usada") {
      return res.status(409).json({
        valida: false,
        jaUsada: true,
        erro: "Esta chave já foi ativada por outro jogador."
      });
    }

    if (!transacao.committed && resultadoLocal === "invalida") {
      return res.status(404).json({
        valida: false,
        erro: "Chave inválida ou desativada."
      });
    }

    const registroFinal = transacao.snapshot.val();
    if (registroFinal?.uid && ["ativada", "mesmo_jogador"].includes(resultadoLocal)) {
      await firebaseDb.ref(
        `${FIREBASE_LOJA_PATH}/Usuarios/${registroFinal.uid}/AcessoTeste`
      ).update({
        usada: true,
        usado: true,
        usadaEm: registroFinal.usadaEm || Date.now(),
        atualizadoEm: Date.now()
      });
    }

    return res.json({
      valida: true,
      ativadaAgora: resultadoLocal === "ativada",
      mensagem: resultadoLocal === "ativada"
        ? "Chave ativada com sucesso."
        : "Esta chave já está vinculada a este jogador."
    });
  } catch (error) {
    console.error("Erro ao ativar chave:", resumirErro(error));
    return res.status(502).json({
      valida: false,
      erro: "Não foi possível validar a chave agora."
    });
  }
});

app.post("/api/processar-pagamento", async (req, res) => {
  res.set("Cache-Control", "no-store");

  if (!paymentClient) {
    return res.status(500).json({
      erro: "Configure MP_ACCESS_TOKEN nas variáveis de ambiente do Render."
    });
  }

  const produtoId = limparTexto(req.body?.produtoId, 80);
  const produto = PRODUTOS[produtoId];
  const formData = req.body?.formData || {};
  const paymentMethodId = limparTexto(formData.payment_method_id, 60).toLowerCase();
  const tokenCartao = limparTexto(formData.token, 300);
  const pagador = sanitizarPagador(formData.payer);

  if (!produto) {
    return res.status(400).json({ erro: "Opção de apoio inválida." });
  }

  let usuario = null;
  let contaRegistrada = null;
  try {
    usuario = await obterUsuarioAutenticado(req, true);
    contaRegistrada = await obterContaRegistradaPorUid(usuario.uid);
  } catch (error) {
    return responderErroAutenticacao(res, error);
  }

  if (!contaRegistrada?.Dados?.nick) {
    return res.status(403).json({
      erro: "Finalize o cadastro escolhendo seu Nick antes de pagar."
    });
  }

  const apoiadorNome = contaRegistrada.Dados.nick;

  if (!paymentMethodId) {
    return res.status(400).json({ erro: "Meio de pagamento não informado." });
  }

  const pagamentoPix = paymentMethodId === "pix";
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

  const pedidoId = `dayzombi-${produto.id}-${crypto.randomUUID()}`;
  const idempotencyKey = extrairChaveIdempotencia(
    req.headers["x-idempotency-key"]
  ) || crypto.randomUUID();

  const body = {
    transaction_amount: produto.valor,
    description: produto.descricao,
    payment_method_id: paymentMethodId,
    payer: pagador,
    external_reference: pedidoId,
    statement_descriptor: "DAYZOMBI",
    metadata: {
      produto_id: produto.id,
      tipo_apoio: produto.tipo,
      pedido_id: pedidoId,
      apoiador_nome: apoiadorNome,
      firebase_uid: usuario?.uid || "",
      firebase_email: usuario?.email || "",
      firebase_nome: usuario?.nome || "",
      nick_conta: apoiadorNome,
      checkout: "payment_brick"
    }
  };

  if (!pagamentoPix) {
    body.token = tokenCartao;
    body.installments = 1;

    const issuerId = limparTexto(formData.issuer_id, 40);
    if (issuerId) body.issuer_id = issuerId;
  }

  if (PUBLIC_URL) {
    body.notification_url = `${PUBLIC_URL}/api/webhook`;
  }

  try {
    const pagamento = await paymentClient.create({
      body,
      requestOptions: { idempotencyKey }
    });

    let registroArrecadacao = null;
    if (String(pagamento.status).toLowerCase() === "approved") {
      registroArrecadacao = await tentarRegistrarArrecadacao(pagamento);
    }

    console.log("Pagamento criado:", {
      pagamentoId: pagamento.id,
      pedidoId,
      produtoId: produto.id,
      firebaseUid: usuario?.uid || null,
      apoiadorNome,
      status: pagamento.status,
      meio: pagamento.payment_method_id,
      valor: pagamento.transaction_amount,
      arrecadacaoRegistrada: registroArrecadacao?.registrado ?? false,
      acessoGerado: registroArrecadacao?.acessoGerado ?? false
    });

    return res
      .status(201)
      .json(resumirPagamentoParaCliente(pagamento, registroArrecadacao));
  } catch (error) {
    console.error("Erro ao criar pagamento:", resumirErro(error));
    return res.status(extrairStatusErro(error)).json({
      erro: mensagemAmigavelDoErro(error),
      detalhe: extrairDetalheSeguro(error)
    });
  }
});

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
    let registroArrecadacao = null;

    if (["approved", "refunded", "charged_back"].includes(
      String(pagamento.status).toLowerCase()
    )) {
      registroArrecadacao = await tentarRegistrarArrecadacao(pagamento);
    }

    return res.json(resumirPagamentoParaCliente(pagamento, registroArrecadacao));
  } catch (error) {
    console.error("Erro ao consultar pagamento:", resumirErro(error));
    return res.status(502).json({
      aprovado: false,
      status: "indisponivel",
      erro: "Não foi possível consultar esse pagamento agora."
    });
  }
});

app.post("/api/webhook", async (req, res) => {
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

  if (tipo && tipo !== "payment") return res.sendStatus(200);
  if (!paymentId || !paymentClient) return res.sendStatus(200);

  try {
    const pagamento = await paymentClient.get({ id: paymentId });
    const registro = await tentarRegistrarArrecadacao(pagamento, true);
    const validacao = validarPagamento(pagamento);

    console.log("Pagamento atualizado pelo Webhook:", {
      pagamentoId: pagamento.id,
      pedidoId: pagamento.external_reference,
      produtoId: validacao.produto?.id || null,
      firebaseUid: extrairUidFirebaseDoPagamento(pagamento) || null,
      status: pagamento.status,
      valor: pagamento.transaction_amount,
      valido: validacao.identidadeValida,
      arrecadacaoRegistrada: registro?.registrado ?? false,
      acessoGerado: registro?.acessoGerado ?? false,
      totalArrecadado: registro?.total ?? null
    });

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
  console.log(`PUBLIC_URL: ${PUBLIC_URL || "não configurada"}`);
  console.log(`Access Token: ${tokenConfigurado ? "configurado" : "não configurado"}`);
  console.log(`Public Key: ${publicKeyConfigurada ? "configurada" : "não configurada"}`);
  console.log(`Firebase Admin/Auth: ${firebaseDb && firebaseAuth ? "configurado" : "não configurado"}`);
  console.log(`Download do jogo: ${GAME_DOWNLOAD_URL ? "configurado" : "não configurado"}`);
  console.log(
    `Assinatura do Webhook: ${
      webhookSecretConfigurado ? "configurada" : "não configurada"
    }`
  );
  console.log("Checkout incorporado Payment Brick: ativado");
});

async function obterUsuarioAutenticado(req, obrigatorio = false) {
  if (!firebaseAuth) {
    const erro = new Error("Firebase Authentication não está configurado no servidor.");
    erro.statusCode = 503;
    throw erro;
  }

  const cabecalho = String(req.headers.authorization || "");
  const match = cabecalho.match(/^Bearer\s+(.+)$/i);

  if (!match) {
    if (!obrigatorio) return null;
    const erro = new Error("Entre com sua conta Google para continuar.");
    erro.statusCode = 401;
    throw erro;
  }

  try {
    const token = await firebaseAuth.verifyIdToken(match[1]);
    return {
      uid: token.uid,
      email: sanitizarEmail(token.email),
      nome: sanitizarNomeConta(token.name || ""),
      foto: normalizarUrlExterna(token.picture || ""),
      provedor: limparTexto(token.firebase?.sign_in_provider || "google.com", 40),
      emailVerificado: Boolean(token.email_verified)
    };
  } catch {
    const erro = new Error("Sua sessão expirou. Entre novamente com o Google.");
    erro.statusCode = 401;
    throw erro;
  }
}


async function obterContaRegistradaPorUid(uid) {
  if (!firebaseDb) return null;
  const snapshot = await firebaseDb
    .ref(`${FIREBASE_LOJA_PATH}/${FIREBASE_LOGINS_PATH}/USUARIOS/${uid}`)
    .once("value");
  return snapshot.val();
}

function normalizarNickConta(valor) {
  const nick = String(valor || "")
    .normalize("NFKC")
    .trim();

  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{2,19}$/.test(nick)) {
    return null;
  }

  return {
    nick,
    nickKey: nick.toLowerCase()
  };
}

function contaPublica(conta) {
  const dados = clonarObjeto(conta?.Dados);
  const resumo = clonarObjeto(conta?.Eventos?.Resumo);
  return {
    nick: dados.nick || null,
    criadoEm: Number(dados.criadoEm) || null,
    ultimoLoginEm: Number(dados.ultimoLoginEm) || null,
    eventos: {
      valorDoado: arredondarDinheiro(resumo.valorDoado),
      totalContribuido: arredondarDinheiro(resumo.totalContribuido),
      comprouAcessoTeste: Boolean(resumo.comprouAcessoTeste),
      dataCompraAcessoTeste: Number(resumo.dataCompraAcessoTeste) || null,
      quantidadeDoacoes: Number(resumo.quantidadeDoacoes) || 0
    }
  };
}

function criarEventosContaDosPagamentos(pagamentosGlobais, uid, agora = Date.now()) {
  const pagamentosConta = {};
  const registros = pagamentosGlobais && typeof pagamentosGlobais === "object"
    ? pagamentosGlobais
    : {};

  for (const [pagamentoId, registroBruto] of Object.entries(registros)) {
    const registro = clonarObjeto(registroBruto);
    if (registro.firebaseUid !== uid) continue;

    pagamentosConta[pagamentoId] = {
      pagamentoId,
      pedidoId: String(registro.pedidoId || ""),
      produtoId: String(registro.produtoId || ""),
      tipo: registro.tipoApoio === "compra" ? "compra" : "doacao",
      valor: arredondarDinheiro(registro.valor),
      valorCentavos: Number(registro.valorCentavos) || 0,
      moeda: String(registro.moeda || "BRL"),
      status: String(registro.status || ""),
      contabilizar: registro.contabilizar === true,
      aprovadoEm: Number(registro.aprovadoEm || registro.criadoEm) || null,
      criadoEm: Number(registro.criadoEm) || agora,
      atualizadoEm: Number(registro.atualizadoEm) || agora
    };
  }

  return {
    Resumo: criarResumoEventosConta(pagamentosConta, agora),
    Pagamentos: pagamentosConta
  };
}

function criarResumoEventosConta(pagamentosConta, agora = Date.now()) {
  const registros = pagamentosConta && typeof pagamentosConta === "object"
    ? Object.values(pagamentosConta)
    : [];
  let doadoCentavos = 0;
  let comprasCentavos = 0;
  let quantidadeDoacoes = 0;
  let quantidadeCompras = 0;
  let dataPrimeiraCompra = null;

  for (const registro of registros) {
    if (registro?.contabilizar !== true) continue;
    const centavos = Number(registro.valorCentavos) || Math.round(
      arredondarDinheiro(registro.valor) * 100
    );

    if (registro.tipo === "compra") {
      comprasCentavos += centavos;
      quantidadeCompras += 1;
      const dataCompra = Number(registro.aprovadoEm || registro.criadoEm) || agora;
      dataPrimeiraCompra = dataPrimeiraCompra === null
        ? dataCompra
        : Math.min(dataPrimeiraCompra, dataCompra);
    } else {
      doadoCentavos += centavos;
      quantidadeDoacoes += 1;
    }
  }

  return {
    valorDoado: doadoCentavos / 100,
    valorApoios: comprasCentavos / 100,
    totalContribuido: (doadoCentavos + comprasCentavos) / 100,
    quantidadeDoacoes,
    quantidadeCompras,
    comprouAcessoTeste: quantidadeCompras > 0,
    dataCompraAcessoTeste: dataPrimeiraCompra,
    atualizadoEm: agora
  };
}

function obterTimestampPagamentoAprovado(pagamento) {
  const valor = pagamento?.date_approved || pagamento?.date_created;
  const timestamp = valor ? Date.parse(valor) : NaN;
  return Number.isFinite(timestamp) ? timestamp : null;
}

function responderErroAutenticacao(res, error) {
  const status = Number(error?.statusCode) || 401;
  return res.status(status).json({
    autenticado: false,
    comprado: false,
    erro: error?.message || "Não foi possível validar sua conta."
  });
}

async function tentarRegistrarArrecadacao(pagamento, exigirFirebase = false) {
  const validacao = validarPagamento(pagamento);
  const status = String(pagamento?.status || "").toLowerCase();
  const statusContabilizavel = ["approved", "refunded", "charged_back"].includes(status);

  if (!validacao.identidadeValida || !statusContabilizavel) {
    return {
      registrado: false,
      acessoGerado: false,
      total: null,
      motivo: validacao.mensagem
    };
  }

  if (!firebaseDb) {
    const erro = new Error(
      "Firebase Admin não configurado. Adicione a credencial da conta de serviço no Render."
    );

    if (exigirFirebase) throw erro;
    console.error(erro.message);
    return {
      registrado: false,
      acessoGerado: false,
      total: null,
      motivo: erro.message
    };
  }

  return registrarPagamentoNoFirebase(pagamento, validacao.produto);
}

async function registrarPagamentoNoFirebase(pagamento, produto) {
  const pagamentoId = String(pagamento.id);
  const status = String(pagamento.status || "").toLowerCase();
  const valorEstornado = Number(pagamento.transaction_amount_refunded || 0);
  const contabilizar = status === "approved" && valorEstornado <= 0;
  const nomeApoiador = extrairNomeApoiadorDoPagamento(pagamento);
  const firebaseUid = extrairUidFirebaseDoPagamento(pagamento);
  const firebaseEmail = extrairEmailFirebaseDoPagamento(pagamento);
  const firebaseNome = extrairNomeFirebaseDoPagamento(pagamento);
  const agora = Date.now();
  const chaveCandidata = produto.tipo === "compra" && firebaseUid
    ? gerarChaveAcesso()
    : null;
  const lojaRef = firebaseDb.ref(FIREBASE_LOJA_PATH);
  let acessoGerado = false;

  const resultado = await lojaRef.transaction((estadoAtual) => {
    const estado = estadoAtual && typeof estadoAtual === "object"
      ? { ...estadoAtual }
      : {};

    const pagamentos = clonarObjeto(estado.PagamentosProcessados);
    const apoiosPublicos = clonarObjeto(estado.ApoiosPublicos);
    const usuarios = clonarObjeto(estado.Usuarios);
    const chavesAcesso = clonarObjeto(estado[FIREBASE_CHAVES_PATH]);
    const loginsRegistrados = clonarObjeto(estado[FIREBASE_LOGINS_PATH]);
    const contasRegistradas = clonarObjeto(loginsRegistrados.USUARIOS);

    const existente = clonarObjeto(pagamentos[pagamentoId]);
    const apoioPublicoExistente = clonarObjeto(apoiosPublicos[pagamentoId]);

    if (!contabilizar && !pagamentos[pagamentoId]) {
      return;
    }

    pagamentos[pagamentoId] = {
      ...existente,
      pagamentoId,
      pedidoId: String(pagamento.external_reference || ""),
      produtoId: produto.id,
      tipoApoio: produto.tipo,
      nomeApoiador: nomeApoiador || existente.nomeApoiador || "",
      firebaseUid: firebaseUid || existente.firebaseUid || "",
      firebaseEmail: firebaseEmail || existente.firebaseEmail || "",
      firebaseNome: firebaseNome || existente.firebaseNome || "",
      valor: produto.valor,
      valorCentavos: Math.round(produto.valor * 100),
      moeda: produto.moeda,
      status,
      statusDetalhe: String(pagamento.status_detail || ""),
      contabilizar,
      criadoEm: existente.criadoEm || agora,
      atualizadoEm: agora
    };

    if (contabilizar && nomeApoiador) {
      apoiosPublicos[pagamentoId] = {
        nome: nomeApoiador,
        tipoApoio: produto.tipo,
        produtoId: produto.id,
        valor: produto.valor,
        valorCentavos: Math.round(produto.valor * 100),
        criadoEm: apoioPublicoExistente.criadoEm || agora,
        atualizadoEm: agora
      };
    } else {
      delete apoiosPublicos[pagamentoId];
    }

    if (produto.tipo === "compra" && firebaseUid) {
      const usuarioExistente = clonarObjeto(usuarios[firebaseUid]);
      const acessoExistente = clonarObjeto(usuarioExistente.AcessoTeste);
      const comprasAtivas = Object.values(pagamentos).filter((registro) =>
        registro?.firebaseUid === firebaseUid &&
        registro?.tipoApoio === "compra" &&
        registro?.contabilizar === true
      );

      if (comprasAtivas.length > 0) {
        const chave = normalizarChaveAcesso(acessoExistente.chave) || chaveCandidata;
        const chaveExistente = clonarObjeto(chavesAcesso[chave]);
        const usada = Boolean(chaveExistente.usada || acessoExistente.usada);

        acessoGerado = Boolean(chave && !acessoExistente.chave);
        usuarios[firebaseUid] = {
          ...usuarioExistente,
          uid: firebaseUid,
          email: firebaseEmail || usuarioExistente.email || "",
          nome: firebaseNome || nomeApoiador || usuarioExistente.nome || "",
          atualizadoEm: agora,
          AcessoTeste: {
            ...acessoExistente,
            comprado: true,
            ativo: true,
            chave,
            pagamentoId: acessoExistente.pagamentoId || pagamentoId,
            produtoId: produto.id,
            usado: usada,
            usada,
            compradoEm: acessoExistente.compradoEm || agora,
            atualizadoEm: agora,
            revogadoEm: null
          }
        };

        chavesAcesso[chave] = {
          ...chaveExistente,
          chave,
          uid: firebaseUid,
          email: firebaseEmail || chaveExistente.email || "",
          nome: firebaseNome || nomeApoiador || chaveExistente.nome || "",
          pagamentoId: chaveExistente.pagamentoId || pagamentoId,
          produtoId: produto.id,
          ativa: true,
          revogada: false,
          usada,
          usadaPor: chaveExistente.usadaPor || null,
          usadaEm: chaveExistente.usadaEm || null,
          criadaEm: chaveExistente.criadaEm || agora,
          atualizadoEm: agora
        };
      } else {
        const chave = normalizarChaveAcesso(acessoExistente.chave);
        usuarios[firebaseUid] = {
          ...usuarioExistente,
          atualizadoEm: agora,
          AcessoTeste: {
            ...acessoExistente,
            comprado: false,
            ativo: false,
            atualizadoEm: agora,
            revogadoEm: agora
          }
        };

        if (chave && chavesAcesso[chave]) {
          chavesAcesso[chave] = {
            ...chavesAcesso[chave],
            ativa: false,
            revogada: true,
            revogadaEm: agora,
            atualizadoEm: agora
          };
        }
      }
    }


    if (firebaseUid && contasRegistradas[firebaseUid]?.Dados?.nick) {
      const contaRegistrada = clonarObjeto(contasRegistradas[firebaseUid]);
      const dadosConta = clonarObjeto(contaRegistrada.Dados);
      const eventosConta = clonarObjeto(contaRegistrada.Eventos);
      const pagamentosConta = clonarObjeto(eventosConta.Pagamentos);
      const eventoExistente = clonarObjeto(pagamentosConta[pagamentoId]);
      const aprovadoEmMercadoPago = obterTimestampPagamentoAprovado(pagamento);

      pagamentosConta[pagamentoId] = {
        ...eventoExistente,
        pagamentoId,
        pedidoId: String(pagamento.external_reference || ""),
        produtoId: produto.id,
        tipo: produto.tipo,
        valor: produto.valor,
        valorCentavos: Math.round(produto.valor * 100),
        moeda: produto.moeda,
        status,
        contabilizar,
        aprovadoEm: aprovadoEmMercadoPago || eventoExistente.aprovadoEm || null,
        criadoEm: eventoExistente.criadoEm || agora,
        atualizadoEm: agora
      };

      contasRegistradas[firebaseUid] = {
        ...contaRegistrada,
        Dados: {
          ...dadosConta,
          googleEmail: firebaseEmail || dadosConta.googleEmail || "",
          googleNome: firebaseNome || dadosConta.googleNome || "",
          atualizadoEm: agora
        },
        Eventos: {
          ...eventosConta,
          Resumo: criarResumoEventosConta(pagamentosConta, agora),
          Pagamentos: pagamentosConta
        }
      };
    }

    let totalCentavos = 0;
    for (const registro of Object.values(pagamentos)) {
      if (registro?.contabilizar === true) {
        totalCentavos += Number(registro.valorCentavos) || 0;
      }
    }

    estado.PagamentosProcessados = pagamentos;
    estado.ApoiosPublicos = apoiosPublicos;
    estado.Usuarios = usuarios;
    estado[FIREBASE_CHAVES_PATH] = chavesAcesso;
    loginsRegistrados.USUARIOS = contasRegistradas;
    estado[FIREBASE_LOGINS_PATH] = loginsRegistrados;
    estado["Doações"] = totalCentavos / 100;
    estado.Meta = META_ARRECADACAO;
    estado.AtualizadoEm = agora;
    return estado;
  }, undefined, false);

  if (!resultado.committed) {
    const snapshot = await lojaRef.child("Doações").once("value");
    return {
      registrado: false,
      acessoGerado: false,
      total: arredondarDinheiro(snapshot.val()),
      motivo: "Nenhuma alteração necessária."
    };
  }

  const total = arredondarDinheiro(resultado.snapshot.child("Doações").val());
  return {
    registrado: contabilizar,
    acessoGerado: Boolean(acessoGerado && contabilizar),
    acessoVinculado: Boolean(
      contabilizar && produto.tipo === "compra" && firebaseUid
    ),
    total,
    motivo: contabilizar
      ? "Pagamento contabilizado na arrecadação."
      : "Pagamento removido da arrecadação por estorno ou contestação."
  };
}

function resumirPagamentoParaCliente(pagamento, registroArrecadacao = null) {
  const validacao = validarPagamento(pagamento);
  const transactionData = pagamento?.point_of_interaction?.transaction_data || {};
  const pagamentoId = pagamento?.id ? String(pagamento.id) : null;
  const paymentMethodId = String(pagamento?.payment_method_id || "");
  const isPix = paymentMethodId.toLowerCase() === "pix";

  return {
    aprovado: validacao.valido,
    identidadeValida: validacao.identidadeValida,
    status: String(pagamento?.status || "desconhecido"),
    statusDetalhe: pagamento?.status_detail || null,
    pagamentoId,
    pedidoId: pagamento?.external_reference || null,
    valor: pagamento?.transaction_amount ?? null,
    moeda: pagamento?.currency_id || null,
    meioPagamento: paymentMethodId || null,
    tipoPagamento: pagamento?.payment_type_id || null,
    produtoId: validacao.produto?.id || null,
    produtoTitulo: validacao.produto?.titulo || null,
    tipoApoio: validacao.produto?.tipo || null,
    nomeApoiador: extrairNomeApoiadorDoPagamento(pagamento) || null,
    temAcessoTelegram: Boolean(validacao.valido && validacao.produto?.telegram),
    acessoVinculado: Boolean(registroArrecadacao?.acessoVinculado),
    acessoGerado: Boolean(registroArrecadacao?.acessoGerado),
    arrecadacaoRegistrada: registroArrecadacao?.registrado ?? false,
    totalArrecadado: registroArrecadacao?.total ?? null,
    mensagem: validacao.mensagem,
    pix: isPix
      ? {
          qrCode: transactionData.qr_code || null,
          qrCodeBase64: transactionData.qr_code_base64 || null,
          expiracao: pagamento?.date_of_expiration || null
        }
      : null
  };
}

function validarPagamento(pagamento) {
  const status = String(pagamento?.status || "").toLowerCase();
  const produtoId = limparTexto(pagamento?.metadata?.produto_id, 80);
  const produto = PRODUTOS[produtoId] || null;

  if (!produto) {
    return {
      valido: false,
      identidadeValida: false,
      produto: null,
      mensagem: "O pagamento não corresponde a uma opção válida da loja."
    };
  }

  const referencia = String(pagamento?.external_reference || "");
  const valorCorreto =
    Math.abs(Number(pagamento?.transaction_amount) - produto.valor) < 0.00001;
  const moedaCorreta = pagamento?.currency_id === produto.moeda;
  const referenciaCorreta = referencia.startsWith(`dayzombi-${produto.id}-`);
  const identidadeValida = valorCorreto && moedaCorreta && referenciaCorreta;

  if (!identidadeValida) {
    return {
      valido: false,
      identidadeValida: false,
      produto,
      mensagem: "O pagamento foi localizado, mas os dados não correspondem à opção escolhida."
    };
  }

  if (status !== "approved") {
    return {
      valido: false,
      identidadeValida: true,
      produto,
      mensagem: mensagemPorStatus(status, pagamento?.status_detail)
    };
  }

  const naoEstornado = Number(pagamento?.transaction_amount_refunded || 0) === 0;
  if (!naoEstornado) {
    return {
      valido: false,
      identidadeValida: true,
      produto,
      mensagem: "O pagamento foi estornado e não libera os benefícios."
    };
  }

  return {
    valido: true,
    identidadeValida: true,
    produto,
    mensagem: "Pagamento confirmado diretamente pela API do Mercado Pago."
  };
}

function gerarChaveAcesso() {
  const partes = crypto.randomBytes(12)
    .toString("hex")
    .toUpperCase()
    .match(/.{1,4}/g)
    .slice(0, 6);
  return `CHAVE-PLAYER-TESTE-${partes.join("-")}`;
}

function normalizarChaveAcesso(valor) {
  const chave = String(valor || "").trim().toUpperCase();
  return /^CHAVE-PLAYER-TESTE(?:-[A-F0-9]{4}){6}$/.test(chave)
    ? chave
    : "";
}

function normalizarIdentificadorJogador(valor) {
  return String(valor || "")
    .normalize("NFKC")
    .replace(/[^A-Za-z0-9:_-]/g, "")
    .slice(0, 100);
}

function extrairUidFirebaseDoPagamento(pagamento) {
  const uid = limparTexto(
    pagamento?.metadata?.firebase_uid || pagamento?.metadata?.firebaseUid,
    128
  );
  return /^[A-Za-z0-9:_-]{1,128}$/.test(uid) ? uid : "";
}

function extrairEmailFirebaseDoPagamento(pagamento) {
  return sanitizarEmail(
    pagamento?.metadata?.firebase_email || pagamento?.metadata?.firebaseEmail
  );
}

function extrairNomeFirebaseDoPagamento(pagamento) {
  return sanitizarNomeConta(
    pagamento?.metadata?.firebase_nome || pagamento?.metadata?.firebaseNome
  );
}

function sanitizarNomeApoiador(valor) {
  const texto = String(valor || "")
    .normalize("NFKC")
    .replace(/[\u0000-\u001F\u007F<>]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const limitado = Array.from(texto).slice(0, 36).join("");
  return limitado.length >= 2 ? limitado : "";
}

function sanitizarNomeConta(valor) {
  return String(valor || "")
    .normalize("NFKC")
    .replace(/[\u0000-\u001F\u007F<>]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

function sanitizarEmail(valor) {
  const email = String(valor || "").trim().toLowerCase().slice(0, 180);
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : "";
}

function extrairNomeApoiadorDoPagamento(pagamento) {
  return sanitizarNomeApoiador(
    pagamento?.metadata?.apoiador_nome ||
    pagamento?.metadata?.apoiadorNome ||
    ""
  );
}

function criarListaApoiosRecentes(valor, limite = LIMITE_APOIOS_RECENTES) {
  const registros = valor && typeof valor === "object"
    ? Object.values(valor)
    : [];

  return registros
    .map((registro) => ({
      nome: sanitizarNomeApoiador(registro?.nome),
      tipoApoio: registro?.tipoApoio === "compra" ? "compra" : "doacao",
      valor: arredondarDinheiro(registro?.valor),
      criadoEm: Number(registro?.criadoEm) || 0
    }))
    .filter((registro) => registro.nome && registro.valor > 0)
    .sort((a, b) => b.criadoEm - a.criadoEm)
    .slice(0, Math.max(1, Math.min(Number(limite) || 12, 30)));
}

function carregarCredencialFirebase() {
  const jsonBruto = String(process.env.FIREBASE_SERVICE_ACCOUNT_JSON || "").trim();

  if (jsonBruto) {
    let conteudo = jsonBruto;
    if (!conteudo.startsWith("{")) {
      conteudo = Buffer.from(conteudo, "base64").toString("utf8");
    }

    const serviceAccount = JSON.parse(conteudo);
    serviceAccount.private_key = String(serviceAccount.private_key || "")
      .replace(/\\n/g, "\n");
    return cert(serviceAccount);
  }

  const projectId = String(process.env.FIREBASE_PROJECT_ID || "").trim();
  const clientEmail = String(process.env.FIREBASE_CLIENT_EMAIL || "").trim();
  const privateKey = String(process.env.FIREBASE_PRIVATE_KEY || "")
    .replace(/\\n/g, "\n")
    .trim();

  if (projectId && clientEmail && privateKey) {
    return cert({ projectId, clientEmail, privateKey });
  }

  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    return applicationDefault();
  }

  return null;
}

function produtoPublico(produto) {
  return {
    id: produto.id,
    titulo: produto.titulo,
    descricao: produto.descricao,
    tipo: produto.tipo,
    valor: produto.valor,
    moeda: produto.moeda
  };
}

function usuarioPublico(usuario) {
  return {
    uid: usuario.uid,
    email: usuario.email || null,
    nome: usuario.nome || null,
    foto: usuario.foto || null,
    provedor: usuario.provedor || null,
    emailVerificado: Boolean(usuario.emailVerificado)
  };
}

function criarResumoArrecadacao(total) {
  const percentual = META_ARRECADACAO > 0
    ? Math.max(0, (total / META_ARRECADACAO) * 100)
    : 0;
  return {
    total,
    meta: META_ARRECADACAO,
    percentual: Number(percentual.toFixed(2))
  };
}

function clonarObjeto(valor) {
  return valor && typeof valor === "object" ? { ...valor } : {};
}

function arredondarDinheiro(valor) {
  const numero = Number(valor);
  return Number.isFinite(numero) ? Math.round(numero * 100) / 100 : 0;
}

function mensagemPorStatus(status, statusDetail) {
  if (status === "pending" || status === "in_process") {
    return statusDetail === "pending_waiting_transfer"
      ? "Pix criado. Aguardando o pagamento."
      : "O pagamento está sendo processado.";
  }
  if (status === "rejected") return "O pagamento foi recusado. Confira os dados e tente novamente.";
  if (status === "cancelled") return "O pagamento foi cancelado.";
  if (status === "refunded" || status === "charged_back") {
    return "O pagamento foi devolvido ou contestado.";
  }
  return "O pagamento ainda não está aprovado.";
}

function sanitizarPagador(valor) {
  const payer = valor && typeof valor === "object" ? valor : {};
  const email = sanitizarEmail(payer.email);
  const resultado = {};
  if (email) resultado.email = email;

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
  if (!url || url.includes("SEU-SERVICO")) return "";

  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return "";
    if (["localhost", "127.0.0.1"].includes(parsed.hostname)) return "";
    return parsed.origin + parsed.pathname.replace(/\/+$/, "");
  } catch {
    return "";
  }
}

function normalizarUrlExterna(valor) {
  const url = String(valor || "").trim();
  if (!url) return "";

  try {
    const parsed = new URL(url);
    return ["https:", "http:"].includes(parsed.protocol) ? parsed.href : "";
  } catch {
    return "";
  }
}

function extrairIdPagamento(valor) {
  const texto = Array.isArray(valor) ? valor[0] : valor;
  return /^\d+$/.test(String(texto || "").trim())
    ? String(texto).trim()
    : null;
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
