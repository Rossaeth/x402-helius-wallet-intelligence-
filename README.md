# x402 Helius Wallet Intelligence

A pay-per-request API for Solana wallet research, powered by the official Helius Wallet API and x402 v2 payments. Built for AI agents and API clients.

## Features

- Wallet history with parsed transaction activity
- Token/native SOL transfers
- Current token balances and USD portfolio values
- Historical token balance at a timestamp, datetime, or slot
- Wallet identity labels (exchange, protocol, institution, where known)
- Original funding source ("funded by")
- Portfolio snapshot report and activity report
- x402 payment requirements for **Base USDC** and/or **Solana USDC**
- Free `GET /health` and `GET /openapi.json`

## Endpoints

All wallet endpoints use query parameter `wallet` (a Solana address or supported wallet name).

| Method | Endpoint | Description |
|---|---|---|
| GET | `/health` | Free health/config status |
| GET | `/api/wallet/history?wallet=...` | Parsed wallet activity; supports Helius pagination/filter query parameters |
| GET | `/api/wallet/transfers?wallet=...` | Transfer activity |
| GET | `/api/wallet/balances?wallet=...` | Current token balances and USD values |
| GET | `/api/wallet/balance-at?wallet=...&mint=...&timestamp=...` | Historical balance for a token/native SOL |
| GET | `/api/wallet/identity?wallet=...` | Wallet identity labels (requires a Helius paid plan) |
| GET | `/api/wallet/funded-by?wallet=...` | Original funding source (requires a Helius paid plan) |
| GET | `/api/reports/portfolio?wallet=...` | Portfolio balances plus summary |
| GET | `/api/reports/activity?wallet=...` | Recent activity and transfer summary |
| GET | `/openapi.json` | OpenAPI schema, free |

The wallet endpoints are paid by default. Price is configured with `X402_PRICE` (default `$0.01` per request). The server advertises whichever payment networks have recipient addresses configured. The Base and Solana recipients may be different addresses.

## Deploy to Vercel

1. In Vercel, import this GitHub repository.
2. Add environment variables:
   - `HELIUS_API_KEY` — from the Helius dashboard
   - `BASE_PAY_TO` — your receiving EVM address for Base USDC (optional if not using Base)
   - `SOLANA_PAY_TO` — your receiving Solana address for Solana USDC (optional if not using Solana)
   - `X402_FACILITATOR_URL` — optional, defaults to PayAI
   - `BASE_URL` — your deployed URL
3. Redeploy after adding variables.

Never put API keys, private keys, or seed phrases in source code. This service does not need a wallet private key or seed phrase.

## Local development

```bash
npm install
cp .env.example .env
# Fill in Helius API key and at least one receiving address in .env
npm run dev
```

## Helius API notes

Helius Wallet API requests are proxied server-side; the API key is never sent back to callers. Each Wallet API request consumes Helius credits. According to Helius documentation, balances, balance-at, history and transfers are available on the Free plan; identity and funded-by require a paid Helius plan.

## Payment behavior

The x402 middleware is registered before wallet/query validation so an unpaid client receives the payment challenge first. Configure at least one recipient address before paid routes can be used. A `402 Payment Required` response is expected for an unpaid request when payment is configured; this alone is not proof that settlement has been tested.

## License

MIT
