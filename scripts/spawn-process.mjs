#!/usr/bin/env node
/**
 * Spawn Veritas AO Process
 *
 * Creates a new AO process for receipt storage.
 * Run once to set up, then save the process ID.
 */

import { spawn, message, result, createDataItemSigner } from "@permaweb/aoconnect";
import { readFileSync, existsSync } from "fs";
import { homedir } from "os";
import { join } from "path";

// Find wallet (check multiple locations)
const walletPaths = [
  process.env.WALLET_PATH,
  join(process.cwd(), "wallets", "wallet.json"),
  join(homedir(), ".aos.json"),
  join(homedir(), "wallet.json"),
].filter(Boolean);

let wallet = null;
for (const path of walletPaths) {
  if (existsSync(path)) {
    console.log(`[Spawn] Using wallet: ${path}`);
    wallet = JSON.parse(readFileSync(path, "utf-8"));
    break;
  }
}

if (!wallet) {
  console.error("[Spawn] No wallet found. Set WALLET_PATH or place wallet at ~/.aos.json");
  process.exit(1);
}

const signer = createDataItemSigner(wallet);

// Read Lua code
const luaCode = readFileSync(new URL("../lua/veritas-process.lua", import.meta.url), "utf-8");

async function spawnVeritasProcess() {
  console.log("[Spawn] Spawning Veritas process...");

  // Spawn new process
  const processId = await spawn({
    module: "Do_Uc2Sju_ffp6Ev0AnLVdPtot15rvMjP-a9VVaA5fM", // Standard AOS module
    scheduler: "_GQ33BkPtZrqxA84vM8Zk-N2aO0toNNu_C-l-rawrBA", // Standard scheduler
    signer,
    tags: [
      { name: "Name", value: "Veritas" },
      { name: "Description", value: "Transaction Witness Receipt Storage" },
      { name: "Version", value: "0.1.0" },
    ],
  });

  console.log(`[Spawn] Process created: ${processId}`);

  // Load the Lua code
  console.log("[Spawn] Loading Veritas code...");

  const loadResult = await message({
    process: processId,
    signer,
    tags: [{ name: "Action", value: "Eval" }],
    data: luaCode,
  });

  console.log(`[Spawn] Code loaded, message: ${loadResult}`);

  // Wait for result
  const evalResult = await result({
    process: processId,
    message: loadResult,
  });

  const output = evalResult.Output?.data || evalResult.Messages?.[0]?.Data;
  console.log(`[Spawn] Result: ${output}`);

  // Test with GetStats
  console.log("[Spawn] Testing GetStats...");

  const testMsg = await message({
    process: processId,
    signer,
    tags: [{ name: "Action", value: "GetStats" }],
  });

  const testResult = await result({
    process: processId,
    message: testMsg,
  });

  const stats = testResult.Messages?.[0]?.Data;
  console.log(`[Spawn] Stats: ${stats}`);

  console.log("");
  console.log("=".repeat(60));
  console.log("VERITAS PROCESS SPAWNED SUCCESSFULLY");
  console.log("=".repeat(60));
  console.log("");
  console.log(`Process ID: ${processId}`);
  console.log("");
  console.log("Add to your environment:");
  console.log(`  export VERITAS_PROCESS_ID=${processId}`);
  console.log("");
  console.log("Or add to docker-compose.yml:");
  console.log(`  VERITAS_PROCESS_ID: ${processId}`);
  console.log("");
  console.log("View on ao.link:");
  console.log(`  https://ao.link/#/entity/${processId}`);
  console.log("=".repeat(60));
}

spawnVeritasProcess().catch((err) => {
  console.error("[Spawn] Error:", err);
  process.exit(1);
});
