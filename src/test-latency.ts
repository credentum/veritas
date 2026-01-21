#!/usr/bin/env tsx
/**
 * Veritas Latency Test
 *
 * Tests the core witnessing function latency.
 * Target: <100ms for receipt generation
 */

import { createHash, createSign, createVerify, generateKeyPairSync } from "crypto";
import { performance } from "perf_hooks";

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
}

// Generate keypair
const { privateKey, publicKey } = generateKeyPairSync("ec", {
  namedCurve: "prime256v1",
});

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

  return {
    receipt_id,
    signature,
    timestamp_ms,
    hash,
  };
}

// Test data
const testRequest: WitnessRequest = {
  context: "User requested purchase of Widget X. Price: $99.99. Vendor: Acme Corp. Stock: 47 units available.",
  logic: "1. Verified user has sufficient budget ($500 limit, $99.99 requested). 2. Checked vendor compliance status: APPROVED. 3. Confirmed stock availability. 4. Price within historical range (no anomaly detected).",
  action: "Execute purchase via AP2 mandate. Send Intent Mandate to payment gateway.",
  agent_id: "procurement-agent-001",
};

async function runLatencyTest(): Promise<void> {
  console.log("=".repeat(60));
  console.log("VERITAS LATENCY TEST");
  console.log("=".repeat(60));
  console.log("");

  // Warmup
  console.log("Warmup (10 iterations)...");
  for (let i = 0; i < 10; i++) {
    witnessDecision(testRequest);
  }

  // Actual test
  const iterations = 1000;
  console.log(`\nRunning ${iterations} iterations...\n`);

  const latencies: number[] = [];
  let minLatency = Infinity;
  let maxLatency = 0;

  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    const receipt = witnessDecision(testRequest);
    const elapsed = performance.now() - start;

    latencies.push(elapsed);
    minLatency = Math.min(minLatency, elapsed);
    maxLatency = Math.max(maxLatency, elapsed);

    // Verify signature is valid
    if (i === 0) {
      const valid = verifySignature(receipt.hash, receipt.signature);
      console.log(`Signature verification: ${valid ? "PASS" : "FAIL"}`);
      console.log(`Sample receipt_id: ${receipt.receipt_id}`);
      console.log("");
    }
  }

  // Calculate statistics
  const avgLatency = latencies.reduce((a, b) => a + b, 0) / iterations;
  const sortedLatencies = [...latencies].sort((a, b) => a - b);
  const p50 = sortedLatencies[Math.floor(iterations * 0.5)];
  const p95 = sortedLatencies[Math.floor(iterations * 0.95)];
  const p99 = sortedLatencies[Math.floor(iterations * 0.99)];

  console.log("RESULTS");
  console.log("-".repeat(40));
  console.log(`Iterations:     ${iterations}`);
  console.log(`Min latency:    ${minLatency.toFixed(3)}ms`);
  console.log(`Max latency:    ${maxLatency.toFixed(3)}ms`);
  console.log(`Avg latency:    ${avgLatency.toFixed(3)}ms`);
  console.log(`P50 latency:    ${p50.toFixed(3)}ms`);
  console.log(`P95 latency:    ${p95.toFixed(3)}ms`);
  console.log(`P99 latency:    ${p99.toFixed(3)}ms`);
  console.log("");

  // Pass/fail
  const target = 100; // ms
  const passed = p99 < target;
  console.log("TARGET CHECK");
  console.log("-".repeat(40));
  console.log(`Target:         <${target}ms (P99)`);
  console.log(`Actual (P99):   ${p99.toFixed(3)}ms`);
  console.log(`Status:         ${passed ? "✓ PASS" : "✗ FAIL"}`);
  console.log("");

  // Throughput estimate
  const throughput = 1000 / avgLatency;
  console.log("THROUGHPUT");
  console.log("-".repeat(40));
  console.log(`Estimated:      ${throughput.toFixed(0)} receipts/second`);
  console.log("");

  console.log("=".repeat(60));
}

runLatencyTest().catch(console.error);
