# Veritas MCP Server

> Transaction Witness for autonomous agent decisions. The "Blue Checkmark" for AI.

**Status:** PoC (Proof of Concept)
**Latency:** P99 < 1ms (target was <100ms)
**Throughput:** ~24,000 receipts/second

## What is Veritas?

Veritas is an MCP (Model Context Protocol) server that provides cryptographic proof of agent decision provenance. It's designed for autonomous agents that need to:

1. **Prove decisions** — Create immutable audit trails for EU AI Act compliance
2. **Enable payments** — Provide receipts that AP2 payment gateways can require
3. **Cross-vendor auditing** — Neutral "Switzerland" position across walled gardens

## Quick Start

```bash
# Install dependencies
npm install

# Run latency test
npm test

# Start MCP server (for use with Claude Desktop, Cursor, etc.)
npm run dev
```

## MCP Tools

### `witness_decision`

Witness an agent decision and return a cryptographically signed receipt.

**Input:**
```json
{
  "context": "What the agent knew",
  "logic": "Why it decided (chain of thought)",
  "action": "What it will do",
  "agent_id": "Optional agent identifier"
}
```

**Output:**
```json
{
  "receipt_id": "vts_e2b999c8dbee2ef7",
  "signature": "MEUCIQDx...",
  "timestamp_ms": 1737499200000,
  "hash": "a1b2c3...",
  "arweave_tx": null,
  "status": "pending"
}
```

### `verify_receipt`

Verify a receipt and check settlement status.

**Input:**
```json
{
  "receipt_id": "vts_e2b999c8dbee2ef7"
}
```

**Output:**
```json
{
  "valid": true,
  "receipt": { ... },
  "message": "Receipt verified and settled on Arweave"
}
```

### `get_server_info`

Get server information including public key for independent verification.

## Architecture

```
Agent Decision → Veritas MCP → Immediate Signed Receipt (<1ms)
                      ↓
              Async Settlement → Arweave (<30s)
```

**Optimistic Witnessing Pattern:**
1. Agent calls `witness_decision`
2. Veritas immediately signs and returns receipt
3. Background process batches and settles to Arweave
4. Agent can verify settlement with `verify_receipt`

## Configuration

| Environment Variable | Description |
|---------------------|-------------|
| `VERITAS_PROCESS_ID` | AO process ID for settlement |
| `WALLET_PATH` | Path to Arweave wallet JSON |

## Claude Desktop Integration

Add to `~/.config/claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "veritas": {
      "command": "npx",
      "args": ["tsx", "/path/to/veritas/src/index.ts"]
    }
  }
}
```

## Latency Results

```
VERITAS LATENCY TEST
============================================================
Iterations:     1000
Min latency:    0.031ms
Max latency:    0.889ms
Avg latency:    0.041ms
P50 latency:    0.037ms
P95 latency:    0.053ms
P99 latency:    0.114ms

TARGET CHECK
----------------------------------------
Target:         <100ms (P99)
Actual (P99):   0.114ms
Status:         ✓ PASS

THROUGHPUT
----------------------------------------
Estimated:      24377 receipts/second
```

## Wallet Security

**Never commit wallet files.** Options for secure wallet handling:

### Development
```bash
# Store wallet outside repo
export WALLET_PATH=~/.arweave/wallet.json
```

### Production
- Use environment variables injected at runtime
- Use secret management (AWS Secrets Manager, HashiCorp Vault)
- Use signing services (Othent, ArConnect for browser)

## Use Cases

### 1. EU AI Act Compliance (Article 12)

High-risk AI systems must maintain "automatic recording of events." Veritas provides:
- Cryptographic proof of decision context
- Immutable storage on Arweave
- Cross-vendor audit trail

### 2. AP2 Payment Integration

Agent Payments Protocol (AP2) requires trust signals. Veritas receipt can serve as:
- Proof of authorized decision
- Audit trail for chargebacks
- Compliance evidence for merchants

### 3. Multi-Vendor Agent Orchestration

When agents from different vendors collaborate:
- Each decision gets neutral witness
- No vendor controls the audit trail
- Independent verification possible

## License

MIT
