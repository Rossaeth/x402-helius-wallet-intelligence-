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
    const inputSchema = {
      type: "object",
      properties: {
        wallet: { type: "string", description: "Solana wallet address", minLength: 32, maxLength: 64 },
        limit: { type: "integer", minimum: 1, maximum: 100, description: "Maximum records where supported" },
        mint: { type: "string", description: "Token mint for historical balance queries" },
        timestamp: { type: "integer", description: "Unix timestamp for historical balance queries" },
        datetime: { type: "string", format: "date-time", description: "ISO timestamp for historical balance queries" },
        slot: { type: "integer", description: "Solana slot for historical balance queries" },
      },
      required: ["wallet"],
    };
    const sampleInput = { wallet: "11111111111111111111111111111111" };
    if (route.path === "/api/wallet/balance-at") {
      sampleInput.mint = "So11111111111111111111111111111111111111112";
      sampleInput.timestamp = 1760000000;
    }
    protectedRoutes[`${route.method} ${route.path}`] = {
      accepts: configuredAccepts,
      description: route.description,
      mimeType: "application/json",
      serviceName: "Helius Wallet Intel",
      tags: ["solana", "wallet", "analytics"],
      iconUrl: "https://www.helius.dev/favicon.ico",
      extensions: {
        bazaar: {
          info: {
            input: {
              type: "http",
              method: route.method,
              queryParams: sampleInput,
              inputSchema,
            },
            output: {
              type: "json",
              example: {
                success: true,
                source: "Helius Wallet API",
                wallet: sampleInput.wallet,
                endpoint: route.path,
                data: {},
              },
            },
          },
          schema: {
            type: "object",
            properties: {
              input: {
                type: "object",
                properties: {
                  type: { type: "string", const: "http" },
                  method: { type: "string", const: "GET" },
                  queryParams: { type: "object", additionalProperties: true },
                  inputSchema: { type: "object", additionalProperties: true },
                },
                required: ["type", "method"],
              },
              output: {
                type: "object",
                properties: {
                  type: { type: "string", const: "json" },
                  example: { type: "object", additionalProperties: true },
                },
                required: ["type"],
              },
            },
            required: ["input", "output"],
          },
        },
      },
    };
  }
  app.use(paymentMiddleware(protectedRoutes, resourceServer));
}

// Free routes
app.get("/favicon.ico", (_req, res) => {
  res.set("Content-Type", "image/svg+xml");
  res.set("Cache-Control", "public, max-age=86400");
  res.send('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#111827"/><path d="M32 9 49 19v26L32 55 15 45V19z" fill="#14F195"/><path d="M23 25h18v5H23zm0 9h18v5H23z" fill="#111827"/></svg>');
});

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

function publicOrigin(req) {
  const host = req.get("x-forwarded-host") || req.get("host");
  const forwardedProto = req.get("x-forwarded-proto");
  const protocol = forwardedProto ? forwardedProto.split(",")[0].trim() : req.protocol;
  if (process.env.BASE_URL) return process.env.BASE_URL.replace(/\/+$/, "");
  return host ? protocol + "://" + host : "https://x402-helius-wallet-intelligence.vercel.app";
}

function buildOpenApi(origin) {
  const walletParam = {
    name: "wallet", in: "query", required: true,
    description: "Solana wallet address supported by Helius Wallet API.",
    schema: { type: "string", minLength: 32, maxLength: 64 },
  };
  const genericQueryParams = [
    { name: "limit", in: "query", required: false, description: "Maximum records to return where supported.", schema: { type: "integer", minimum: 1, maximum: 100 } },
    { name: "before", in: "query", required: false, schema: { type: "string" } },
    { name: "after", in: "query", required: false, schema: { type: "string" } },
    { name: "until", in: "query", required: false, schema: { type: "string" } },
    { name: "mint", in: "query", required: false, description: "Token mint address; required for historical balance lookup.", schema: { type: "string" } },
    { name: "timestamp", in: "query", required: false, schema: { type: "integer" } },
    { name: "datetime", in: "query", required: false, schema: { type: "string", format: "date-time" } },
    { name: "slot", in: "query", required: false, schema: { type: "integer" } },
    { name: "page", in: "query", required: false, schema: { type: "integer", minimum: 1 } },
    { name: "sortOrder", in: "query", required: false, schema: { type: "string", enum: ["asc", "desc"] } },
  ];
  const paidOperation = (route) => ({
    summary: route.description,
    operationId: route.path.replace(/^\/api\//, "").replaceAll("/", "_").replaceAll("-", "_"),
    description: route.description + ". Requires valid x402 payment before input validation; send the wallet query parameter.",
    tags: [route.path.startsWith("/api/reports/") ? "Reports" : "Wallet"],
    security: [{ X402Payment: [] }],
    "x-payment-info": {
      protocols: ["x402"],
      price: { mode: "fixed", currency: "USD", amount: (PRICE.match(/[\d.]+/) || ["0.01"])[0] },
    },
    parameters: [
      walletParam,
      ...genericQueryParams.filter((p) => route.path !== "/api/wallet/balance-at" || ["mint", "timestamp", "datetime", "slot"].includes(p.name)),
    ],
    responses: {
      "200": { description: "Successful response with wallet intelligence data.", content: { "application/json": { schema: { "$ref": "#/components/schemas/WalletDataResponse" } } } },
      "402": {
        description: "Payment required. Contains a valid x402 v2 payment challenge.",
        headers: { "Payment-Required": { description: "Base64-encoded x402 v2 payment requirements.", schema: { type: "string" } } },
        content: { "application/json": { schema: { "$ref": "#/components/schemas/PaymentRequiredResponse" } } },
      },
      "400": { description: "Invalid query parameters.", content: { "application/json": { schema: { "$ref": "#/components/schemas/ErrorResponse" } } },
      "502": { description: "Upstream Helius API failure.", content: { "application/json": { schema: { "$ref": "#/components/schemas/ErrorResponse" } } },
      "503": { description: "Provider API key or payment configuration is missing.", content: { "application/json": { schema: { "$ref": "#/components/schemas/ErrorResponse" } } },
    },
  });
  return {
    openapi: "3.1.0",
    info: {
      title: "x402 Helius Wallet Intelligence",
      version: "1.0.0",
      description: "Pay-per-request Solana wallet history, transfers, balances, identity, funding-source lookup, and portfolio/activity reports powered by Helius Wallet API. Paid operations accept x402 payments.",
      contact: { name: "API Support", url: "https://github.com/Rossaeth/x402-helius-wallet-intelligence-" },
    },
    servers: [{ url: origin }],
    "x-discovery": { ownershipProofs: [] },
    paths: {
      "/health": {
        get: {
          operationId: "health", summary: "Health and payment configuration", security: [],
          responses: { "200": { description: "Service health and configured payment networks.", content: { "application/json": { schema: { type: "object", properties: { status: { type: "string" }, name: { type: "string" }, version: { type: "string" } } } } } },
        },
      },
      "/openapi.json": { get: { operationId: "getOpenApi", summary: "OpenAPI discovery document", security: [], responses: { "200": { description: "OpenAPI 3.1 discovery document." } } } },
      "/.well-known/x402": { get: { operationId: "x402Discovery", summary: "List x402-payable resources", security: [], responses: { "200": { description: "x402scan-compatible resource manifest." } } } },
      ...Object.fromEntries(walletRoutes.map((route) => [route.path, { get: paidOperation(route) }])),
    },
    components: {
      securitySchemes: {
        X402Payment: { type: "apiKey", in: "header", name: "Payment-Signature", description: "x402 v2 payment payload supplied by an x402-compatible client after receiving HTTP 402." },
      },
      schemas: {
        WalletDataResponse: {
          type: "object", required: ["success", "source", "wallet", "data"],
          properties: {
            success: { type: "boolean", const: true }, source: { type: "string", example: "Helius Wallet API" },
            wallet: { type: "string" }, endpoint: { type: "string" }, report: { type: "string" },
            generatedAt: { type: "string", format: "date-time" }, data: { type: "object", additionalProperties: true },
            balances: { type: "object", additionalProperties: true }, history: { type: "object", additionalProperties: true },
            transfers: { type: "object", additionalProperties: true }, summary: { type: "object", additionalProperties: true },
          },
        },
        PaymentRequiredResponse: {
          type: "object", description: "Payment challenge metadata may be carried in headers; this body schema documents JSON compatibility.",
          properties: {
            x402Version: { type: "integer", const: 2 }, error: { type: "string", example: "payment_required" },
            accepts: { type: "array", minItems: 1, items: { type: "object", additionalProperties: true } },
          },
        },
        ErrorResponse: { type: "object", required: ["error", "message"], properties: { error: { type: "string" }, message: { type: "string" }, upstreamStatus: { type: "integer" } } },
      },
    },
  };
}

app.get("/openapi.json", (req, res) => {
  res.set("Cache-Control", "public, max-age=60");
  res.json(buildOpenApi(publicOrigin(req)));
});

app.get("/.well-known/x402", (req, res) => {
  const origin = publicOrigin(req);
  res.set("Cache-Control", "public, max-age=60");
  res.json({
    version: 1,
    resources: walletRoutes.map((route) => origin + route.path),
    instructions: "Each resource is an x402 v2 paid HTTP endpoint. Call without payment to receive the Payment-Required challenge, then retry with an x402-compatible payment payload. Free discovery documents: /openapi.json and /.well-known/x402.",
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
