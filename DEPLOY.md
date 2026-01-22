# Veritas Deployment Guide

Step-by-step deployment of Veritas as a hosted service.

---

## What You're Deploying

```
┌─────────────────────────────────────────────────────────────┐
│                     YOUR SERVER                              │
│                                                              │
│   ┌─────────────────┐         ┌─────────────────────────┐  │
│   │  Veritas        │         │  Veritas AO Process     │  │
│   │  HTTP Container │ ──────► │  (on Arweave)           │  │
│   │  Port 3100      │         │  Receipt Storage        │  │
│   └─────────────────┘         └─────────────────────────┘  │
│          ▲                                                  │
└──────────┼──────────────────────────────────────────────────┘
           │
    Agent requests
```

---

## Prerequisites

- Node.js 20+
- Docker (optional, for containerized deployment)
- Arweave wallet (JWK format)
  - Get from arweave.app
  - Or use existing aos wallet at `~/.aos.json`

---

## Step 1: Install Dependencies

```bash
npm install
```

---

## Step 2: Add Your Wallet

**Option A: Copy existing aos wallet**
```bash
cp ~/.aos.json wallets/wallet.json
```

**Option B: Use a new wallet**
```bash
# Copy example and replace with your wallet contents
cp wallets/wallet.example.json wallets/wallet.json
# Edit wallets/wallet.json with your actual wallet
```

The `wallets/` directory is `.gitignore`d - your wallet won't be committed.

---

## Step 3: Spawn Veritas AO Process

This creates the on-chain storage. Run once, save the process ID.

```bash
node scripts/spawn-process.mjs
```

**Output will look like:**
```
VERITAS PROCESS SPAWNED SUCCESSFULLY
Process ID: abc123...
```

**Save this process ID.** You'll need it for Step 4.

---

## Step 4: Configure Environment

Create `.env` file:

```bash
# The process ID from Step 3
VERITAS_PROCESS_ID=abc123...
```

---

## Step 5: Deploy

### Option A: Docker (Recommended)

```bash
docker compose up -d
```

### Option B: Direct Node

```bash
npm run build
node dist/http-server.js
```

### Option C: Development (tsx)

```bash
npx tsx src/http-server.ts
```

---

## Step 6: Verify

```bash
# Health check
curl http://localhost:3100/health

# Server info
curl http://localhost:3100/info

# Test witness (should return signed receipt)
curl -X POST http://localhost:3100/witness \
  -H "Content-Type: application/json" \
  -d '{
    "context": "Test decision context",
    "logic": "Test reasoning",
    "action": "Test action"
  }'
```

---

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Health check |
| `/info` | GET | Server info + public key |
| `/stats` | GET | Receipt counts |
| `/witness` | POST | Witness a decision |
| `/verify/:id` | GET | Verify a receipt |

---

## Wallet Security

**Never commit wallet files.**

The `wallets/` directory has a `.gitignore` that excludes:
- `*.json` (all wallet files)
- Only `*.example.json` is tracked

For production deployments:
1. **Volume mount** — Mount wallet directory as read-only (docker-compose default)
2. **Environment variable** — Set `WALLET_PATH` to an external location
3. **Secrets manager** — Use Docker secrets or cloud KMS

---

## Monitoring

```bash
# View logs
docker logs -f veritas

# Check stats
curl http://localhost:3100/stats
```

---

## Costs

| Operation | Cost |
|-----------|------|
| Spawn process | ~0.001 AR (one-time) |
| Store receipts | ~0.0001 AR per batch |
| Query receipts | Free (read-only) |

At current AR prices (~$20), expect <$1/month for moderate usage.

---

## Troubleshooting

### "No wallet found"
- Check wallet exists at `wallets/wallet.json`
- Or set `WALLET_PATH` environment variable

### "No AO process configured"
- Set `VERITAS_PROCESS_ID` in `.env` or environment
- Run `node scripts/spawn-process.mjs` if you haven't spawned yet

### Settlement not working
- Check container logs: `docker logs veritas`
- Verify wallet has AR balance for message fees
- Verify process ID is correct: `curl https://ao.link/#/entity/YOUR_PROCESS_ID`
