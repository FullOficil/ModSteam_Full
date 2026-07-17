# Loja DayZombi — Mercado Pago, Google Login e Firebase

Esta versão integra:

- apoio fundador de R$ 50;
- doações de R$ 5, R$ 10 e R$ 20;
- Payment Brick do Mercado Pago;
- Firebase Realtime Database;
- login Google pelo Firebase Authentication;
- reconhecimento do acesso em outros navegadores usando a mesma conta;
- geração de chave única para o jogo;
- painel privado com Telegram, download e chave.

## Fluxo da compra de R$ 50

1. A pessoa entra com a conta Google.
2. O navegador envia o ID token ao servidor.
3. O servidor valida o token com o Firebase Admin e obtém o UID.
4. O pagamento é criado com o UID nos metadados.
5. Quando o Mercado Pago confirma `approved`, o servidor registra a arrecadação.
6. Dentro da mesma transação do Realtime Database, o servidor cria o acesso do usuário e uma chave aleatória.
7. Ao entrar com a mesma conta Google em outro navegador, `/api/meu-acesso` recupera o benefício.

## Estrutura no Firebase

```text
LojaDayZombi
├── Doações
├── Meta
├── ApoiosPublicos
├── PagamentosProcessados
├── Usuarios
│   └── <firebaseUid>
│       └── AcessoTeste
│           ├── comprado: true
│           ├── ativo: true
│           ├── chave: "CHAVE-PLAYER-TESTE-..."
│           └── pagamentoId: "..."
└── Chaves de Acessos
    └── CHAVE-PLAYER-TESTE-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX
        ├── uid
        ├── ativa: true
        ├── usada: false
        └── usadaPor: null
```

## Rota para ativação dentro do jogo

```http
POST /api/ativar-chave
Content-Type: application/json

{
  "chave": "CHAVE-PLAYER-TESTE-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX",
  "identificadorJogador": "ID-UNICO-DO-JOGADOR"
}
```

Na primeira chamada, a chave é vinculada ao identificador. Chamadas posteriores com o mesmo identificador continuam válidas. Outro identificador recebe erro de chave já usada.

## Firebase Authentication

No Firebase Console:

1. Abra **Authentication**.
2. Ative o provedor **Google**.
3. Adicione `loja-dayzombi.onrender.com` em **Domínios autorizados**.

## Render

```text
Build Command: npm ci
Start Command: npm start
NODE_VERSION=22
```

Variáveis obrigatórias:

```text
MP_PUBLIC_KEY
MP_ACCESS_TOKEN
MP_WEBHOOK_SECRET
PUBLIC_URL=https://loja-dayzombi.onrender.com
FIREBASE_DATABASE_URL=https://dayzozmbi-server-default-rtdb.firebaseio.com
FIREBASE_SERVICE_ACCOUNT_JSON
```

Variável do download:

```text
GAME_DOWNLOAD_URL=https://seu-link-de-download
```

Opcional:

```text
TELEGRAM_URL=https://t.me/+CyDPE-Hbq00wOGRh
```

## Segurança

- O preço é escolhido no servidor.
- O ID token do Firebase é verificado no backend.
- A chave privada do Firebase fica somente no Render.
- A chave de acesso não aparece na lista pública de apoiadores.
- O `paymentId` é idempotente e não soma duas vezes.
- Estornos revogam o acesso quando não existe outra compra ativa para o mesmo UID.
