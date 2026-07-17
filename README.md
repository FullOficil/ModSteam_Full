# Loja DayZombi — Mercado Pago + Firebase

Esta versão mantém o layout original da loja e integra quatro opções reais de pagamento:

- R$ 50 — Apoio Fundador, acesso aos testes e benefícios.
- R$ 5 — Doação opcional.
- R$ 10 — Doação opcional.
- R$ 20 — Doação opcional.

O valor nunca é aceito diretamente do navegador. O frontend envia somente o identificador da opção e o servidor escolhe o preço correto no catálogo interno.

## Fluxo implementado

1. O visitante escolhe R$ 5, R$ 10, R$ 20 ou R$ 50.
2. O Payment Brick abre dentro do layout e aceita Pix ou cartão.
3. O servidor cria o pagamento no Mercado Pago com o valor correto.
4. A aprovação é confirmada consultando a API do Mercado Pago e também pelo Webhook.
5. O `paymentId` é registrado no Firebase uma única vez.
6. A variável `LojaDayZombi/Doações` é recalculada dentro de uma transação atômica.
7. A barra do site consulta `/api/arrecadacao` e reflete o total da meta de R$ 5.000.
8. Na compra de R$ 50, a página agradece e abre automaticamente o grupo do Telegram:
   `https://t.me/+CyDPE-Hbq00wOGRh`
9. Nas doações menores, a página apenas agradece e atualiza a arrecadação.

## Estrutura criada no Realtime Database

```text
LojaDayZombi
├── Doações: 105
├── Meta: 5000
├── AtualizadoEm: 178...
└── PagamentosProcessados
    └── 123456789
        ├── pagamentoId: "123456789"
        ├── produtoId: "apoio-fundador-50"
        ├── tipoApoio: "compra"
        ├── valor: 50
        ├── valorCentavos: 5000
        ├── status: "approved"
        └── contabilizar: true
```

O total e o registro dos pagamentos ficam no mesmo nó e são atualizados por transação. Assim, o Webhook e a consulta do navegador podem processar a mesma aprovação sem duplicar o valor.

## Configuração no Render

Use:

```text
Build Command: npm install
Start Command: npm start
NODE_VERSION=22
```

Adicione estas variáveis:

```text
MP_PUBLIC_KEY=sua Public Key de produção
MP_ACCESS_TOKEN=seu Access Token de produção
MP_WEBHOOK_SECRET=sua assinatura secreta do Webhook
PUBLIC_URL=https://loja-dayzombi.onrender.com
FIREBASE_DATABASE_URL=https://dayzozmbi-server-default-rtdb.firebaseio.com
FIREBASE_SERVICE_ACCOUNT_JSON=JSON completo ou Base64 da conta de serviço
```

## Credencial correta do Firebase

O arquivo `google-services.json` do aplicativo Android contém a configuração pública do cliente, mas não concede permissão administrativa ao servidor.

Para o Render gravar a arrecadação:

1. Abra Firebase Console.
2. Entre no projeto `dayzozmbi-server`.
3. Vá em **Configurações do projeto → Contas de serviço**.
4. Clique em **Gerar nova chave privada**.
5. Baixe o JSON.
6. No Render, crie `FIREBASE_SERVICE_ACCOUNT_JSON`.
7. Cole o JSON completo ou converta o arquivo para Base64 e cole o resultado.
8. Nunca envie esse JSON ao GitHub.

O servidor também aceita estas variáveis separadas como alternativa:

```text
FIREBASE_PROJECT_ID=dayzozmbi-server
FIREBASE_CLIENT_EMAIL=firebase-adminsdk-...@dayzozmbi-server.iam.gserviceaccount.com
FIREBASE_PRIVATE_KEY=-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n
```

## Webhook do Mercado Pago

Cadastre o evento **Pagamentos** usando:

```text
https://loja-dayzombi.onrender.com/api/webhook
```

Depois copie a assinatura secreta gerada pelo Mercado Pago para `MP_WEBHOOK_SECRET` no Render.

## Arquivos públicos

```text
public/index.html    layout principal e modal de pagamento
public/app.js        Payment Brick, Pix, cartão e barra de arrecadação
public/styles.css    layout original + estilos do checkout
public/sucesso.html  agradecimento e redirecionamento ao Telegram
```

## Teste local

1. Copie `.env.example` para `.env`.
2. Preencha as credenciais.
3. Execute:

```bash
npm install
npm run check
npm start
```

4. Abra `http://localhost:3000`.

O Webhook exige uma URL HTTPS pública. Para o teste completo de notificações, publique no Render ou use um túnel HTTPS confiável.

## Segurança

- O Access Token e a conta de serviço permanecem somente no servidor.
- O navegador nunca determina livremente o valor cobrado.
- A aprovação é consultada diretamente pelo servidor no Mercado Pago.
- O `paymentId` é a chave única no Firebase, evitando soma duplicada.
- As regras públicas do Realtime Database não precisam permitir escrita; o Admin SDK usa a conta de serviço.
