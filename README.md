# Loja DayZombi — validação real do pagamento

Este projeto cria um Checkout Pro de R$ 0,50, recebe notificações Webhook e consulta o pagamento diretamente na API do Mercado Pago antes de considerá-lo aprovado.

## Segurança

- Nunca envie `.env` para o GitHub.
- Nunca coloque o Access Token no HTML.
- Revogue qualquer token que já tenha sido publicado ou enviado em conversa.
- A página `sucesso.html` não confia no parâmetro `status` do navegador. Ela chama o backend, que consulta o pagamento usando o Access Token.

## Rodar localmente

1. Copie `.env.example` para `.env`.
2. Preencha `MP_ACCESS_TOKEN`.
3. Para checkout com retorno automático, `PUBLIC_URL` precisa ser uma URL pública HTTPS. `localhost` serve apenas para abrir a loja localmente.
4. Execute:

```bash
npm install
npm start
```

Abra `http://localhost:3000`.

## Publicar no Render

1. Envie esta pasta para um repositório GitHub. O arquivo `.env` não será enviado porque está no `.gitignore`.
2. No Render, crie um **Web Service** conectado ao repositório.
3. Build Command: `npm install`
4. Start Command: `npm start`
5. Cadastre estas variáveis no Render:

```text
MP_ACCESS_TOKEN=SEU_NOVO_ACCESS_TOKEN
MP_WEBHOOK_SECRET=SUA_ASSINATURA_SECRETA
PUBLIC_URL=https://SEU-SERVICO.onrender.com
```

6. Faça o primeiro deploy.

## Configurar o Webhook no Mercado Pago

No painel da aplicação do Mercado Pago:

1. Abra **Webhooks > Configurar notificações**.
2. Na aba de produção, use:

```text
https://SEU-SERVICO.onrender.com/api/webhook
```

3. Ative o evento **Pagamentos**.
4. Salve.
5. Copie a assinatura secreta gerada e coloque em `MP_WEBHOOK_SECRET` no Render.
6. Reinicie/republique o serviço.
7. Use o botão **Simular** do painel para testar o recebimento.

## Como a validação funciona

1. O servidor cria uma preferência com uma referência única.
2. O comprador paga no Mercado Pago.
3. O Mercado Pago redireciona para `/sucesso.html` e envia `payment_id`.
4. A página chama `/api/verificar-pagamento`.
5. O backend consulta `GET /v1/payments/{id}` por meio do SDK oficial.
6. O produto só é considerado liberado quando:
   - status é `approved`;
   - valor é R$ 0,50;
   - moeda é BRL;
   - a referência pertence ao DayZombi;
   - não houve estorno.
7. O Webhook também valida a assinatura secreta e consulta o pagamento na API.

## Entrega automática do produto

O ponto correto está no `server.js`, dentro do Webhook, após `resultado.valido === true`. Para uma venda real, salve o pagamento em um banco de dados e marque o ID como processado. Webhooks podem ser enviados mais de uma vez, então a entrega deve ser idempotente: o mesmo `paymentId` nunca pode liberar o produto duas vezes.
