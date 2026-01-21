#!/usr/bin/env node
/**
 * Veritas MCP Server
 *
 * Transaction Witness for autonomous agent decisions.
 * Provides cryptographic proof of decision provenance with Arweave permanence.
 *
 * CRITICAL_LLM_CONTEXT:
 * - PURPOSE: Witness agent decisions, return signed receipts, settle to Arweave
 * - PATTERN: Optimistic Witnessing (immediate signature, async settlement)
 * - LATENCY TARGET: <100ms for receipt, <30s for Arweave settlement
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { createHash, createSign, createVerify, generateKeyPairSync } from "crypto";

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

// Generate server signing keypair (in production, load from secure storage)
const { privateKey, publicKey } = generateKeyPairSync("ec", {
  namedCurve: "prime256v1",
});

const SERVER_PUBLIC_KEY = publicKey.export({ type: "spki", format: "pem" }) as string;

/**
 * Generate deterministic receipt ID from hash
 */
function generateReceiptId(hash: string): string {
  return `vts_${hash.substring(0, 16)}`;
}

/**
 * Hash the witness request inputs
 */
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

/**
 * Sign a hash with the server's private key
 */
function signHash(hash: string): string {
  const sign = createSign("SHA256");
  sign.update(hash);
  sign.end();
  return sign.sign(privateKey, "base64");
}

/**
 * Verify a signature
 */
function verifySignature(hash: string, signature: string): boolean {
  const verify = createVerify("SHA256");
  verify.update(hash);
  verify.end();
  return verify.verify(publicKey, signature, "base64");
}

/**
 * Witness a decision - core function
 * Target latency: <100ms
 */
function witnessDecision(request: WitnessRequest): WitnessReceipt {
  const start = performance.now();

  // 1. Capture timestamp
  const timestamp_ms = Date.now();

  // 2. Hash inputs
  const hash = hashWitnessRequest(request, timestamp_ms);

  // 3. Generate receipt ID
  const receipt_id = generateReceiptId(hash);

  // 4. Sign hash
  const signature = signHash(hash);

  // 5. Create receipt
  const receipt: WitnessReceipt = {
    receipt_id,
    signature,
    timestamp_ms,
    hash,
    arweave_tx: null,
    status: "pending",
  };

  // 6. Queue for async settlement
  const pendingReceipt: PendingReceipt = {
    ...receipt,
    full_payload: request,
  };
  pendingReceipts.set(receipt_id, pendingReceipt);

  const elapsed = performance.now() - start;
  console.error(`[Veritas] Witnessed decision in ${elapsed.toFixed(2)}ms - ${receipt_id}`);

  return receipt;
}

/**
 * Verify a receipt
 */
function verifyReceipt(receipt_id: string): { valid: boolean; receipt: WitnessReceipt | null; message: string } {
  // Check settled receipts first
  const settled = settledReceipts.get(receipt_id);
  if (settled) {
    const valid = verifySignature(settled.hash, settled.signature);
    return {
      valid,
      receipt: settled,
      message: valid ? "Receipt verified and settled on Arweave" : "Invalid signature",
    };
  }

  // Check pending receipts
  const pending = pendingReceipts.get(receipt_id);
  if (pending) {
    const valid = verifySignature(pending.hash, pending.signature);
    return {
      valid,
      receipt: {
        receipt_id: pending.receipt_id,
        signature: pending.signature,
        timestamp_ms: pending.timestamp_ms,
        hash: pending.hash,
        arweave_tx: null,
        status: "pending",
      },
      message: valid ? "Receipt verified, settlement pending" : "Invalid signature",
    };
  }

  return {
    valid: false,
    receipt: null,
    message: "Receipt not found",
  };
}

/**
 * Simulate Arweave settlement (replace with real implementation)
 * In production: batch receipts and send to AO process
 */
async function simulateArweaveSettlement(): Promise<void> {
  for (const [receipt_id, pending] of pendingReceipts) {
    // Simulate settlement delay
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Create settled receipt
    const settled: WitnessReceipt = {
      receipt_id: pending.receipt_id,
      signature: pending.signature,
      timestamp_ms: pending.timestamp_ms,
      hash: pending.hash,
      arweave_tx: `simulated_tx_${Date.now()}`, // In production: real Arweave TX ID
      status: "settled",
    };

    settledReceipts.set(receipt_id, settled);
    pendingReceipts.delete(receipt_id);

    console.error(`[Veritas] Settled to Arweave: ${receipt_id} -> ${settled.arweave_tx}`);
  }
}

// Start background settlement (every 10 seconds for PoC)
setInterval(() => {
  if (pendingReceipts.size > 0) {
    console.error(`[Veritas] Settling ${pendingReceipts.size} pending receipts...`);
    simulateArweaveSettlement().catch(console.error);
  }
}, 10000);

// MCP Server setup
const server = new Server(
  {
    name: "veritas-mcp-server",
    version: "0.1.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Define tools
const TOOLS: Tool[] = [
  {
    name: "witness_decision",
    description: `Witness an agent decision and return a cryptographically signed receipt.

Use this to create an immutable audit trail for autonomous agent decisions.
The receipt can be used as proof of decision provenance for compliance (EU AI Act Article 12).

Returns immediately (<100ms) with a signed receipt. Settlement to Arweave happens async (<30s).`,
    inputSchema: {
      type: "object" as const,
      properties: {
        context: {
          type: "string",
          description: "What the agent knew when making the decision (can be summarized or hashed for privacy)",
        },
        logic: {
          type: "string",
          description: "Why the agent made this decision (chain of thought summary)",
        },
        action: {
          type: "string",
          description: "What action the agent will take",
        },
        agent_id: {
          type: "string",
          description: "Optional identifier for the agent",
        },
      },
      required: ["context", "logic", "action"],
    },
  },
  {
    name: "verify_receipt",
    description: `Verify a witness receipt and check its settlement status.

Returns the receipt details, signature validity, and Arweave transaction ID if settled.`,
    inputSchema: {
      type: "object" as const,
      properties: {
        receipt_id: {
          type: "string",
          description: "The receipt ID returned from witness_decision",
        },
      },
      required: ["receipt_id"],
    },
  },
  {
    name: "get_server_info",
    description: "Get Veritas server information including public key for independent verification.",
    inputSchema: {
      type: "object" as const,
      properties: {},
    },
  },
];

// Handle tool listing
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools: TOOLS };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case "witness_decision": {
        const witnessRequest = args as unknown as WitnessRequest;

        if (!witnessRequest.context || !witnessRequest.logic || !witnessRequest.action) {
          return {
            content: [{ type: "text", text: "Error: context, logic, and action are required" }],
            isError: true,
          };
        }

        const receipt = witnessDecision(witnessRequest);

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              success: true,
              receipt,
              message: "Decision witnessed. Receipt signature valid. Settlement pending.",
              verification_note: "Use verify_receipt to check Arweave settlement status.",
            }, null, 2),
          }],
        };
      }

      case "verify_receipt": {
        const { receipt_id } = args as { receipt_id: string };

        if (!receipt_id) {
          return {
            content: [{ type: "text", text: "Error: receipt_id is required" }],
            isError: true,
          };
        }

        const result = verifyReceipt(receipt_id);

        return {
          content: [{
            type: "text",
            text: JSON.stringify(result, null, 2),
          }],
        };
      }

      case "get_server_info": {
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              name: "Veritas MCP Server",
              version: "0.1.0",
              description: "Transaction Witness for autonomous agent decisions",
              public_key: SERVER_PUBLIC_KEY,
              pending_receipts: pendingReceipts.size,
              settled_receipts: settledReceipts.size,
              settlement_interval_seconds: 10,
            }, null, 2),
          }],
        };
      }

      default:
        return {
          content: [{ type: "text", text: `Unknown tool: ${name}` }],
          isError: true,
        };
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: "text", text: `Error: ${errorMessage}` }],
      isError: true,
    };
  }
});

// Start server
async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[Veritas] MCP Server started");
  console.error("[Veritas] Tools: witness_decision, verify_receipt, get_server_info");
}

main().catch(console.error);
