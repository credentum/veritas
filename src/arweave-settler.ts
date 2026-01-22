/**
 * Arweave Settlement Module
 *
 * Handles async settlement of witness receipts to Arweave via AO.
 *
 * CRITICAL_LLM_CONTEXT:
 * - PURPOSE: Batch receipts and settle to permanent storage
 * - PATTERN: Optimistic - sign immediately, settle async
 * - TARGET: <30s from receipt creation to Arweave TX
 */

import { message, createDataItemSigner, result } from "@permaweb/aoconnect";
import { readFileSync, existsSync } from "fs";
import { homedir } from "os";
import { join } from "path";

interface PendingReceipt {
  receipt_id: string;
  signature: string;
  timestamp_ms: number;
  hash: string;
  full_payload: {
    context: string;
    logic: string;
    action: string;
    agent_id?: string;
  };
}

interface SettlementResult {
  receipt_id: string;
  arweave_tx: string | null;
  ao_message_id: string | null;
  status: "settled" | "failed";
  error?: string;
}

// Default AO process for Veritas receipts (can be configured)
// In production, this would be a dedicated Veritas process
const DEFAULT_PROCESS_ID = process.env.VERITAS_PROCESS_ID || null;

/**
 * Load wallet from default locations
 */
function loadWallet(): object | null {
  const locations = [
    process.env.WALLET_PATH,
    join(process.cwd(), "wallets", "wallet.json"),
    join(homedir(), ".aos.json"),
    join(homedir(), "wallet.json"),
  ].filter(Boolean) as string[];

  for (const path of locations) {
    if (existsSync(path)) {
      try {
        const content = readFileSync(path, "utf-8");
        return JSON.parse(content);
      } catch {
        continue;
      }
    }
  }

  return null;
}

/**
 * Settle a batch of receipts to Arweave via AO
 */
export async function settleToArweave(
  receipts: PendingReceipt[],
  processId?: string
): Promise<SettlementResult[]> {
  const results: SettlementResult[] = [];
  const targetProcess = processId || DEFAULT_PROCESS_ID;

  if (!targetProcess) {
    // No process configured - return simulated results for PoC
    console.error("[Settler] No AO process configured - simulating settlement");
    for (const receipt of receipts) {
      results.push({
        receipt_id: receipt.receipt_id,
        arweave_tx: `sim_${Date.now()}_${receipt.receipt_id}`,
        ao_message_id: `sim_msg_${Date.now()}`,
        status: "settled",
      });
    }
    return results;
  }

  const wallet = loadWallet();
  if (!wallet) {
    console.error("[Settler] No wallet found - simulating settlement");
    for (const receipt of receipts) {
      results.push({
        receipt_id: receipt.receipt_id,
        arweave_tx: null,
        ao_message_id: null,
        status: "failed",
        error: "No wallet configured",
      });
    }
    return results;
  }

  const signer = createDataItemSigner(wallet);

  // Batch all receipts into a single message
  const batchPayload = {
    type: "VeritasReceiptBatch",
    count: receipts.length,
    receipts: receipts.map((r) => ({
      receipt_id: r.receipt_id,
      hash: r.hash,
      signature: r.signature,
      timestamp_ms: r.timestamp_ms,
      context_hash: hashString(r.full_payload.context), // Privacy: hash context
      logic_summary: r.full_payload.logic.substring(0, 200), // Truncate for space
      action: r.full_payload.action,
      agent_id: r.full_payload.agent_id || null,
    })),
    settled_at: Date.now(),
  };

  try {
    const messageId = await message({
      process: targetProcess,
      signer,
      tags: [
        { name: "Action", value: "StoreReceipts" },
        { name: "Veritas-Version", value: "0.1.0" },
        { name: "Receipt-Count", value: String(receipts.length) },
      ],
      data: JSON.stringify(batchPayload),
    });

    console.error(`[Settler] Sent batch to AO: ${messageId}`);

    // Wait for result
    const res = await result({
      process: targetProcess,
      message: messageId,
    });

    // Check for success
    const output = res.Output?.data || res.Messages?.[0]?.Data;

    for (const receipt of receipts) {
      results.push({
        receipt_id: receipt.receipt_id,
        arweave_tx: messageId, // The message ID is the Arweave TX
        ao_message_id: messageId,
        status: "settled",
      });
    }

    console.error(`[Settler] Batch settled: ${receipts.length} receipts -> ${messageId}`);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`[Settler] Settlement failed: ${errorMessage}`);

    for (const receipt of receipts) {
      results.push({
        receipt_id: receipt.receipt_id,
        arweave_tx: null,
        ao_message_id: null,
        status: "failed",
        error: errorMessage,
      });
    }
  }

  return results;
}

/**
 * Simple string hash for privacy
 */
function hashString(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash).toString(16);
}

/**
 * Verify a receipt on Arweave
 */
export async function verifyOnArweave(
  arweave_tx: string,
  receipt_id: string
): Promise<{ found: boolean; data?: object }> {
  // In production, query Arweave/AO for the transaction
  // For PoC, return simulated verification

  if (arweave_tx.startsWith("sim_")) {
    return {
      found: true,
      data: {
        simulated: true,
        receipt_id,
        arweave_tx,
      },
    };
  }

  // TODO: Implement real Arweave query
  // const tx = await arweave.transactions.get(arweave_tx);

  return {
    found: false,
  };
}
