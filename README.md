# Loja DayZombi — Mercado Pago + Firebase + apoiadores públicos

Esta versão contém as opções de R$ 5, R$ 10, R$ 20 e R$ 50, a meta de R$ 5.000 e um mural público de contribuições confirmadas.

## Novo fluxo do Nick / Discord

1. O visitante escolhe uma doação ou o Apoio Fundador.
2. O checkout pede **Seu Nick / nome no Discord**.
3. O nome é enviado ao servidor junto com a opção escolhida.
4. O servidor grava o nome nos metadados do pagamento do Mercado Pago.
5. Somente após o status `approved`, o servidor registra o valor e o nome no Firebase.
6. Abaixo da meta aparecem mensagens como:
   - `Diniz doou R$ 20,00`
   - `Survivor_BR comprou o acesso aos testes`
7. Se o pagamento for estornado ou contestado, ele deixa de contar na meta e é removido do mural.

O navegador não grava diretamente no Firebase. Tudo passa pelo servidor e pela confirmação real do Mercado Pago.

## Estrutura no Realtime Database

```text
LojaDayZombi
├── Doações: 105
├── Meta: 5000
├── AtualizadoEm: 178...
├── ApoiosPublicos
│   └── 123456789
│       ├── nome: "Diniz"
│       ├── tipoApoio: "compra"
│       ├── produtoId: "apoio-fundador-50"
│       ├── valor: 50
│       └── criadoEm: 178...
└── PagamentosProcessados
    └── 123456789
        ├── pagamentoId: "123456789"
        ├── nomeApoiador: "Diniz"
        ├── produtoId: "apoio-fundador-50"
        ├── tipoApoio: "compra"
        ├── valor: 50
        ├── status: "approved"
        └── contabilizar: true
```

`ApoiosPublicos` contém apenas nome, tipo, valor e data. E-mail, documento, token e ID do pagamento não são enviados pelo endpoint público.

## Configuração no Render

```text
Build Command: npm ci
Start Command: npm start
NODE_VERSION=22
```

Variáveis necessárias:

```text
MP_PUBLIC_KEY=sua Public Key de produção
MP_ACCESS_TOKEN=seu Access Token de produção
MP_WEBHOOK_SECRET=sua assinatura secreta do Webhook
PUBLIC_URL=https://loja-dayzombi.onrender.com
FIREBASE_DATABASE_URL=https://dayzozmbi-server-default-rtdb.firebaseio.com
FIREBASE_SERVICE_ACCOUNT_JSON=JSON completo ou Base64 da conta de serviço
```

Webhook do Mercado Pago:

```text
https://loja-dayzombi.onrender.com/api/webhook
```

Selecione o evento **Pagamentos**.

## Arquivos principais

```text
server.js             valida pagamentos, grava a meta e os apoiadores
public/index.html     layout, meta, mural e campo de Nick/Discord
public/app.js         checkout, validação do nome e atualização do mural
public/styles.css     estilos responsivos
public/sucesso.html   agradecimento e Telegram no apoio de R$ 50
```

## Teste local

```bash
npm ci
npm run check
npm start
```

Abra `http://localhost:3000`.

## Segurança e privacidade

- O nome informado é explicitamente marcado como público no checkout.
- O servidor remove controles e sinais `<` e `>` e limita o nome a 36 caracteres.
- O frontend monta o mural com `textContent`, sem interpretar HTML enviado pelo usuário.
- Valores são definidos apenas no catálogo do servidor.
- Cada `paymentId` é processado uma única vez dentro de transação atômica.
- Access Token, assinatura do Webhook e conta de serviço nunca devem ir para o GitHub.
