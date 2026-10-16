import "dotenv/config";
import express from "express";
import { paymentMiddleware } from "@x402/express";
import { x402ResourceServer, HTTPFacilitatorClient } from "@x402/core/server";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { ExactSvmScheme } from "@x402/svm/exact/server";

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "64kb" }));

const HELIUS_API_KEY = process.env.HELIUS_API_KEY;
const FACILITATOR_URL = process.env.X402_FACILITATOR_URL || "https://facilitator.payai.network";
const BASE_URL = process.env.BASE_URL || "http://localhost:3000";
const PRICE = process.env.X402_PRICE || "$0.01";
const BASE_PAY_TO = process.env.BASE_PAY_TO || "";
const SOLANA_PAY_TO = process.env.SOLANA_PAY_TO || "";
const SOLANA_MAINNET = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";
const BASE_MAINNET = "eip155:8453";
const SOLANA_USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

const walletRoutes = [
  { method: "GET", path: "/api/wallet/history", description: "Parsed Solana wallet transaction history" },
  { method: "GET", path: "/api/wallet/transfers", description: "Solana wallet token and native transfers" },
  { method: "GET", path: "/api/wallet/balances", description: "Current wallet balances and USD values" },
  { method: "GET", path: "/api/wallet/balance-at", description: "Historical wallet token balance" },
  { method: "GET", path: "/api/wallet/identity", description: "Wallet identity labels and tags" },
  { method: "GET", path: "/api/wallet/funded-by", description: "Original SOL funding source for a wallet" },
  { method: "GET", path: "/api/reports/portfolio", description: "Portfolio snapshot report" },
  { method: "GET", path: "/api/reports/activity", description: "Wallet activity summary report" },
];

const configuredAccepts = [];
if (BASE_PAY_TO) configuredAccepts.push({
  scheme: "exact",
  network: BASE_MAINNET,
  payTo: BASE_PAY_TO,
  price: PRICE,
});
if (SOLANA_PAY_TO) configuredAccepts.push({
  scheme: "exact",
  network: SOLANA_MAINNET,
  payTo: SOLANA_PAY_TO,
  price: PRICE,
  extra: { asset: SOLANA_USDC },
});

if (configuredAccepts.length > 0) {
  const facilitator = new HTTPFacilitatorClient({ url: FACILITATOR_URL });
  const resourceServer = new x402ResourceServer(facilitator);
  if (BASE_PAY_TO) resourceServer.register(BASE_MAINNET, new ExactEvmScheme());
  if (SOLANA_PAY_TO) resourceServer.register(SOLANA_MAINNET, new ExactSvmScheme());

  const protectedRoutes = {};
  for (const route of walletRoutes) {
    protectedRoutes[`${route.method} ${route.path}`] = {
      accepts: configuredAccepts,
      description: route.description,
      mimeType: "application/json",
    };
  }
  app.use(paymentMiddleware(protectedRoutes, resourceServer));
}

// Free routes
app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    name: "x402-helius-wallet-intelligence",
    version: "1.0.0",
    payment: {
      enabled: configuredAccepts.length > 0,
      networks: [
        ...(BASE_PAY_TO ? ["eip155:8453 (Base USDC)"] : []),
        ...(SOLANA_PAY_TO ? [`${SOLANA_MAINNET} (Solana USDC)`] : []),
      ],
      price: PRICE,
      facilitator: FACILITATOR_URL,
    },
    helius: { configured: Boolean(HELIUS_API_KEY) },
    endpoints: walletRoutes.map(({ method, path }) => ({ method, path })),
  });
});

app.get("/openapi.json", (_req, res) => {
  res.json({
    openapi: "3.1.0",
    info: {
      title: "x402 Helius Wallet Intelligence",
      version: "1.0.0",
      description: "Pay-per-request Solana wallet intelligence API powered by Helius Wallet API.",
      contact: { name: "API Support", url: "https://github.com/Rossaeth/x402-helius-wallet-intelligence-" },
    },
    servers: [{ url: BASE_URL }],
    paths: Object.fromEntries([
      ["/health", { get: { summary: "Health status", security: [], responses: { "200": { description: "Service status" } } } }],
      ...walletRoutes.map((r) => [r.path, {
        get: {
          summary: r.description,
          parameters: [
            { name: "wallet", in: "query", required: true, schema: { type: "string", minLength: 32 }, description: "Solana wallet address" },
          ],
          responses: {
            "200": { description: "Wallet data returned" },
            "402": { description: "x402 payment required" },
            "400": { description: "Invalid or missing input" },
            "502": { description: "Helius upstream API error" },
          },
        },
      }]),
      ["/openapi.json", { get: { summary: "OpenAPI schema", security: [], responses: { "200": { description: "OpenAPI 3.1 schema" } } } }],
    ]),
  });
});

function requirePaymentConfig(_req, res, next) {
  if (!configuredAccepts.length) {
    return res.status(503).json({
      error: "x402_not_configured",
      message: "Set BASE_PAY_TO and/or SOLANA_PAY_TO in the deployment environment before using paid routes.",
    });
  }
  next();
}

function getWallet(req, res) {
  const wallet = String(req.query.wallet || "").trim();
  if (!wallet || wallet.length < 32 || wallet.length > 64) {
    res.status(400).json({ error: "invalid_wallet", message: "Provide a valid Solana wallet in the wallet query parameter." });
    return null;
  }
  return wallet;
}

const allowedQueryKeys = new Set([
  "wallet", "limit", "before", "after", "until", "commitment", "tokenAccounts",
  "type", "source", "mint", "timestamp", "datetime", "slot", "page", "sortOrder",
  "nativeTransfers", "tokenTransfers", "accountData", "events",
]);

function heliusUrl(wallet, endpoint, query) {
  const url = new URL(`https://api.helius.xyz/v1/wallet/${encodeURIComponent(wallet)}/${endpoint}`);
  url.searchParams.set("api-key", HELIUS_API_KEY);
  for (const [key, value] of Object.entries(query)) {
    if (key === "wallet" || !allowedQueryKeys.has(key) || value === undefined || value === "") continue;
    url.searchParams.set(key, String(value));
  }
  return url;
}

async function heliusGet(wallet, endpoint, query = {}) {
  if (!HELIUS_API_KEY) {
    const error = new Error("HELIUS_API_KEY is not configured.");
    error.status = 503;
    throw error;
  }
  const response = await fetch(heliusUrl(wallet, endpoint, query), {
    headers: { accept: "application/json", "user-agent": "x402-helius-wallet-intelligence/1.0.0" },
    signal: AbortSignal.timeout(15000),
  });
  const body = await response.json().catch(() => ({ error: "Invalid JSON response from Helius" }));
  if (!response.ok) {
    const error = new Error(body?.message || body?.error || `Helius returned HTTP ${response.status}`);
    error.status = response.status === 403 ? 403 : 502;
    error.upstreamStatus = response.status;
    throw error;
  }
  return body;
}

function sendError(res, error) {
  const status = Number.isInteger(error.status) ? error.status : 502;
  res.status(status).json({
    error: status === 403 ? "helius_plan_required" : status === 503 ? "service_not_configured" : "helius_request_failed",
    message: error.message || "The wallet data provider request failed.",
    ...(error.upstreamStatus ? { upstreamStatus: error.upstreamStatus } : {}),
  });
}

async function walletEndpoint(req, res, endpoint) {
  const wallet = getWallet(req, res);
  if (!wallet) return;
  try {
    const data = await heliusGet(wallet, endpoint, req.query);
    res.json({ success: true, source: "Helius Wallet API", wallet, endpoint, data });
  } catch (error) {
    sendError(res, error);
  }
}

app.get("/api/wallet/history", (req, res) => walletEndpoint(req, res, "history"));
app.get("/api/wallet/transfers", (req, res) => walletEndpoint(req, res, "transfers"));
app.get("/api/wallet/balances", (req, res) => walletEndpoint(req, res, "balances"));
app.get("/api/wallet/balance-at", (req, res) => {
  const wallet = getWallet(req, res);
  if (!wallet) return;
  if (!req.query.mint && !req.query.timestamp && !req.query.datetime && !req.query.slot) {
    return res.status(400).json({
      error: "missing_balance_at_selector",
      message: "Provide mint and one of timestamp, datetime, or slot as required by the Helius balance-at API.",
    });
  }
  walletEndpoint(req, res, "balance-at");
});
app.get("/api/wallet/identity", (req, res) => walletEndpoint(req, res, "identity"));
app.get("/api/wallet/funded-by", (req, res) => walletEndpoint(req, res, "funded-by"));

app.get("/api/reports/portfolio", async (req, res) => {
  const wallet = getWallet(req, res);
  if (!wallet) return;
  try {
    const balances = await heliusGet(wallet, "balances", req.query);
    const list = Array.isArray(balances.balances) ? balances.balances : [];
    res.json({
      success: true,
      report: "portfolio",
      source: "Helius Wallet API",
      wallet,
      generatedAt: new Date().toISOString(),
      summary: {
        tokenCount: list.length,
        totalUsdValue: balances.totalUsdValue ?? null,
        page: balances.pagination?.page ?? null,
        hasMore: balances.pagination?.hasMore ?? false,
      },
      balances,
    });
  } catch (error) {
    sendError(res, error);
  }
});

app.get("/api/reports/activity", async (req, res) => {
  const wallet = getWallet(req, res);
  if (!wallet) return;
  try {
    const [history, transfers] = await Promise.all([
      heliusGet(wallet, "history", { ...req.query, limit: req.query.limit || 10 }),
      heliusGet(wallet, "transfers", { ...req.query, limit: req.query.limit || 10 }),
    ]);
    res.json({
      success: true,
      report: "activity",
      source: "Helius Wallet API",
      wallet,
      generatedAt: new Date().toISOString(),
      summary: {
        historyTransactions: Array.isArray(history.data) ? history.data.length : null,
        transfers: Array.isArray(transfers.data) ? transfers.data.length : null,
      },
      history,
      transfers,
    });
  } catch (error) {
    sendError(res, error);
  }
});

app.use((_req, res) => res.status(404).json({ error: "not_found", message: "Endpoint not found." }));

const port = Number(process.env.PORT || 3000);
if (process.env.VERCEL !== "1") {
  app.listen(port, () => console.log(`x402 Helius Wallet Intelligence listening on :${port}`));
}

export default app;
