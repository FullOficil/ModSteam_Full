# Loja DayZombi — Pix automático

Esta versão mantém a loja aberta em uma aba e abre o Mercado Pago em outra. A aba da loja consulta o backend pelo `pedidoId` e muda automaticamente para **Pagamento aprovado** quando a API do Mercado Pago confirmar o Pix.

## O que mudou

- O checkout abre em outra aba.
- O pedido fica salvo no navegador, inclusive após atualizar a página.
- O backend pesquisa o pagamento pelo `external_reference` único do pedido.
- Pix, cartão e outros meios são validados pelo servidor.
- A página de sucesso continua aceitando `payment_id` quando o Mercado Pago faz o retorno normal.
- O navegador nunca decide sozinho que o produto foi pago.

## Atualizar o projeto no GitHub e Render

1. Substitua no GitHub os arquivos antigos pelos arquivos desta pasta.
2. Não envie `.env`.
3. Faça o commit. O Render deve iniciar o deploy automático.
4. Mantenha no Render:

```text
Build Command: yarn install
Start Command: npm start
NODE_VERSION=22
MP_ACCESS_TOKEN=seu token
PUBLIC_URL=https://loja-dayzombi.onrender.com
```

Não é necessário alterar novamente `PUBLIC_URL` nem o Access Token apenas por causa desta atualização.

## Webhook

O Webhook continua recomendado para uma venda real:

```text
https://loja-dayzombi.onrender.com/api/webhook
```

Configure `MP_WEBHOOK_SECRET` no Render com a assinatura secreta gerada no painel do Mercado Pago. O fluxo automático do Pix desta versão também consulta a API de pagamentos pelo pedido, portanto não depende somente de o navegador ser redirecionado.

## Teste

1. Abra a loja.
2. Clique em comprar.
3. O Mercado Pago abrirá em outra aba.
4. Pague o Pix pelo celular.
5. Deixe a aba original da loja aberta.
6. Quando a API confirmar o pagamento, ela abrirá `sucesso.html` automaticamente.

## Segurança

- Nunca envie `.env` ao GitHub.
- Nunca coloque o Access Token no HTML.
- Use um Access Token novo se algum token já apareceu em conversa ou print.
- Para entrega real de produto, grave pagamentos em banco de dados e impeça processar o mesmo `paymentId` duas vezes.
