# Loja DayZombi — Payment Brick incorporado

Esta versão substitui o redirecionamento do Checkout Pro pelo **Payment Brick**. Pix e cartões aparecem dentro do próprio site, sem abrir automaticamente o aplicativo do Mercado Pago.

## Como funciona

- O navegador carrega o Payment Brick usando apenas a `MP_PUBLIC_KEY`.
- O Access Token permanece no servidor.
- O backend cria o pagamento com valor fixo de R$ 0,50.
- No Pix, o QR Code e o código Copia e Cola aparecem na própria página.
- A página consulta o pagamento periodicamente e abre a tela de sucesso quando a API confirmar `approved`.
- A opção de pagamento pela Conta Mercado Pago não está habilitada.

## Atualização no GitHub

Substitua os arquivos antigos pelos arquivos desta pasta. Não envie `.env` nem `node_modules`.

No Render, mantenha:

```text
Build Command: yarn install
Start Command: npm start
NODE_VERSION=22
MP_ACCESS_TOKEN=seu Access Token
PUBLIC_URL=https://loja-dayzombi.onrender.com
```

Adicione obrigatoriamente:

```text
MP_PUBLIC_KEY=sua Public Key de produção
```

A Public Key fica em **Mercado Pago Developers → sua aplicação → Credenciais de produção**. Ela pode ser usada no navegador; o Access Token não pode.

## Webhook recomendado

```text
https://loja-dayzombi.onrender.com/api/webhook
```

Depois de cadastrar o evento **Pagamentos**, coloque a assinatura secreta no Render:

```text
MP_WEBHOOK_SECRET=sua assinatura secreta
```

## Teste

1. Faça o deploy dos novos arquivos.
2. Abra `https://loja-dayzombi.onrender.com`.
3. Escolha Pix ou cartão dentro da própria página.
4. No Pix, copie o código para o aplicativo do banco ou escaneie o QR Code.
5. Deixe a página aberta; ela mudará para pagamento aprovado quando a API confirmar.

## Segurança

- O servidor ignora o valor enviado pelo navegador e sempre cobra R$ 0,50.
- Boleto e Conta Mercado Pago não são aceitos pelo backend.
- Cada criação de pagamento usa uma chave de idempotência.
- A entrega real de produto ainda deve ser gravada em banco de dados para impedir processamento duplicado do mesmo `paymentId`.
