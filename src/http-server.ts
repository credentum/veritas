#!/usr/bin/env node
/**
 * Veritas HTTP Server
 *
 * REST API for witness_decision, verify_receipt, get_server_info.
 * Runs alongside or instead of MCP server for hosted service model.
 */

import { createServer, IncomingMessage, ServerResponse } from "http";
import { createHash, createSign, createVerify, generateKeyPairSync } from "crypto";
import { settleToArweave } from "./arweave-settler.js";

// Types
interface WitnessRequest {
  context: string;
  logic: string;
  action: string;
  agent_id?: string;
}

interface WitnessReceipt {
  receipt_id: string;
  signature: string;
  timestamp_ms: number;
  hash: string;
  arweave_tx: string | null;
  status: "pending" | "settled" | "failed";
}

interface PendingReceipt extends WitnessReceipt {
  full_payload: WitnessRequest;
}

// Server state
const pendingReceipts: Map<string, PendingReceipt> = new Map();
const settledReceipts: Map<string, WitnessReceipt> = new Map();

// Generate server signing keypair
// In production: load from secure storage / env var
const { privateKey, publicKey } = generateKeyPairSync("ec", {
  namedCurve: "prime256v1",
});

const SERVER_PUBLIC_KEY = publicKey.export({ type: "spki", format: "pem" }) as string;

function generateReceiptId(hash: string): string {
  return `vts_${hash.substring(0, 16)}`;
}

function hashWitnessRequest(request: WitnessRequest, timestamp_ms: number): string {
  const payload = JSON.stringify({
    context: request.context,
    logic: request.logic,
    action: request.action,
    agent_id: request.agent_id || null,
    timestamp_ms,
  });
  return createHash("sha256").update(payload).digest("hex");
}

function signHash(hash: string): string {
  const sign = createSign("SHA256");
  sign.update(hash);
  sign.end();
  return sign.sign(privateKey, "base64");
}

function verifySignature(hash: string, signature: string): boolean {
  const verify = createVerify("SHA256");
  verify.update(hash);
  verify.end();
  return verify.verify(publicKey, signature, "base64");
}

function witnessDecision(request: WitnessRequest): WitnessReceipt {
  const timestamp_ms = Date.now();
  const hash = hashWitnessRequest(request, timestamp_ms);
  const receipt_id = generateReceiptId(hash);
  const signature = signHash(hash);

  const receipt: WitnessReceipt = {
    receipt_id,
    signature,
    timestamp_ms,
    hash,
    arweave_tx: null,
    status: "pending",
  };

  const pendingReceipt: PendingReceipt = {
    ...receipt,
    full_payload: request,
  };
  pendingReceipts.set(receipt_id, pendingReceipt);

  return receipt;
}

function verifyReceipt(receipt_id: string): { valid: boolean; receipt: WitnessReceipt | null; message: string } {
  const settled = settledReceipts.get(receipt_id);
  if (settled) {
    const valid = verifySignature(settled.hash, settled.signature);
    return { valid, receipt: settled, message: valid ? "Receipt verified and settled" : "Invalid signature" };
  }

  const pending = pendingReceipts.get(receipt_id);
  if (pending) {
    const valid = verifySignature(pending.hash, pending.signature);
    return {
      valid,
      receipt: { ...pending, full_payload: undefined } as unknown as WitnessReceipt,
      message: valid ? "Receipt verified, settlement pending" : "Invalid signature",
    };
  }

  return { valid: false, receipt: null, message: "Receipt not found" };
}

// Settlement to Arweave via AO
async function settleReceipts(): Promise<void> {
  if (pendingReceipts.size === 0) return;

  // Convert to array for batch settlement
  const batch = Array.from(pendingReceipts.values());
  console.log(`[Veritas] Settling batch of ${batch.length} receipts...`);

  const results = await settleToArweave(batch);

  for (const result of results) {
    const pending = pendingReceipts.get(result.receipt_id);
    if (!pending) continue;

    if (result.status === "settled") {
      const settled: WitnessReceipt = {
        receipt_id: pending.receipt_id,
        signature: pending.signature,
        timestamp_ms: pending.timestamp_ms,
        hash: pending.hash,
        arweave_tx: result.arweave_tx,
        status: "settled",
      };
      settledReceipts.set(result.receipt_id, settled);
      pendingReceipts.delete(result.receipt_id);
      console.log(`[Veritas] Settled: ${result.receipt_id} -> ${result.arweave_tx}`);
    } else {
      console.error(`[Veritas] Settlement failed for ${result.receipt_id}: ${result.error}`);
      // Keep in pending for retry on next interval
    }
  }
}

// Settlement interval
setInterval(() => {
  if (pendingReceipts.size > 0) {
    settleReceipts().catch(console.error);
  }
}, 10000);

// HTTP request handler
async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url || "/", `http://${req.headers.host}`);

  // CORS headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  // Parse JSON body for POST
  let body: unknown = {};
  if (req.method === "POST") {
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(chunk as Buffer);
    }
    try {
      body = JSON.parse(Buffer.concat(chunks).toString());
    } catch {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Invalid JSON" }));
      return;
    }
  }

  // Routes
  const sendJson = (status: number, data: unknown) => {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(data, null, 2));
  };

  // Health check
  if (url.pathname === "/" || url.pathname === "/health") {
    sendJson(200, { status: "ok", service: "veritas", version: "0.1.0" });
    return;
  }

  // POST /witness
  if (url.pathname === "/witness" && req.method === "POST") {
    const request = body as WitnessRequest;

    if (!request.context || !request.logic || !request.action) {
      sendJson(400, { error: "Missing required fields: context, logic, action" });
      return;
    }

    const receipt = witnessDecision(request);
    sendJson(200, { success: true, receipt });
    return;
  }

  // GET /verify/:receipt_id
  if (url.pathname.startsWith("/verify/") && req.method === "GET") {
    const receipt_id = url.pathname.substring(8);
    const result = verifyReceipt(receipt_id);
    sendJson(result.valid ? 200 : 404, result);
    return;
  }

  // GET /info
  if (url.pathname === "/info" && req.method === "GET") {
    sendJson(200, {
      name: "Veritas",
      version: "0.1.0",
      description: "Transaction Witness for autonomous agent decisions",
      public_key: SERVER_PUBLIC_KEY,
      pending_receipts: pendingReceipts.size,
      settled_receipts: settledReceipts.size,
    });
    return;
  }

  // GET /stats
  if (url.pathname === "/stats" && req.method === "GET") {
    sendJson(200, {
      pending: pendingReceipts.size,
      settled: settledReceipts.size,
      total: pendingReceipts.size + settledReceipts.size,
    });
    return;
  }

  // 404
  sendJson(404, { error: "Not found" });
}

// Start server
const PORT = parseInt(process.env.PORT || "3000", 10);
const HOST = process.env.HOST || "0.0.0.0";

const server = createServer((req, res) => {
  handleRequest(req, res).catch((err) => {
    console.error("[Veritas] Error:", err);
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Internal server error" }));
  });
});

server.listen(PORT, HOST, () => {
  console.log(`[Veritas] HTTP server running at http://${HOST}:${PORT}`);
  console.log("[Veritas] Endpoints:");
  console.log("  POST /witness     - Witness a decision");
  console.log("  GET  /verify/:id  - Verify a receipt");
  console.log("  GET  /info        - Server info");
  console.log("  GET  /stats       - Receipt stats");
  console.log("  GET  /health      - Health check");
});
