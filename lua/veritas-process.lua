--[[
================================================================================
Veritas AO Process - Transaction Witness Receipt Storage
================================================================================

PURPOSE: Store and query witness receipts permanently on Arweave via AO
SELF-CONTAINED: No external library dependencies
IMMUTABLE: Once stored, receipts cannot be modified or deleted
OWNER-GATED: Only process owner can store receipts (prevents spam)

RECOVERY_QUERY:
    veritas receipt storage witness ao arweave transaction audit trail
================================================================================
]]

local json = require("json")

-- ============================================================================
-- STATE INITIALIZATION
-- ============================================================================

-- Initialize state on first load (idempotent)
-- Owner is set immediately from spawn to prevent nil==nil bypass
State = State or {
    Receipts = {},           -- receipt_id -> receipt_data
    ReceiptCount = 0,        -- total receipts stored
    Owner = ao.env.Process.Owner or ao.id,  -- Set from spawn, never nil
    Frozen = false,          -- Emergency stop flag
    Version = "0.1.0"
}

-- ============================================================================
-- HELPER FUNCTIONS
-- ============================================================================

local function safe_json_encode(data)
    local ok, result = pcall(json.encode, data)
    if ok then
        return result
    end
    return '{"error":"JSON encode failed"}'
end

local function send_reply(msg, action, data)
    -- Guard against nil msg.From
    if not msg.From then return end

    ao.send({
        Target = msg.From,
        Action = action,
        Data = safe_json_encode(data)
    })
end

local function is_owner(msg)
    return msg.From and msg.From == State.Owner
end

local function parse_data(msg)
    if msg.Data and msg.Data ~= "" then
        local ok, parsed = pcall(json.decode, msg.Data)
        if ok then return parsed end
    end
    return nil
end

-- ============================================================================
-- OWNER-ONLY HANDLERS (State-mutating)
-- ============================================================================

--[[
Store a batch of receipts.
Called by Veritas HTTP server after signing.

Only owner can store receipts (prevents spam)
Receipts are immutable once stored
Duplicate receipt_ids are silently skipped
]]
Handlers.add(
    "StoreReceipts",
    Handlers.utils.hasMatchingTag("Action", "StoreReceipts"),
    function(msg)
        -- Frozen check
        if State.Frozen then
            send_reply(msg, "Error", { error = "Process is frozen" })
            return
        end

        -- Owner check
        if not is_owner(msg) then
            send_reply(msg, "Error", { error = "Unauthorized: owner only" })
            return
        end

        local data = parse_data(msg)
        if not data or not data.receipts then
            send_reply(msg, "Error", { error = "Invalid payload: missing receipts array" })
            return
        end

        local stored_count = 0

        for _, receipt in ipairs(data.receipts) do
            local receipt_id = receipt.receipt_id

            -- Skip if already exists (immutable)
            if receipt_id and not State.Receipts[receipt_id] then
                State.Receipts[receipt_id] = {
                    receipt_id = receipt_id,
                    hash = receipt.hash,
                    signature = receipt.signature,
                    timestamp_ms = receipt.timestamp_ms,
                    context_hash = receipt.context_hash,
                    logic_summary = receipt.logic_summary,
                    action = receipt.action,
                    agent_id = receipt.agent_id,
                    stored_at = msg.Timestamp,
                    message_id = msg.Id
                }
                State.ReceiptCount = State.ReceiptCount + 1
                stored_count = stored_count + 1
            end
        end

        send_reply(msg, "ReceiptsStored", {
            stored_count = stored_count,
            total_count = State.ReceiptCount
        })
    end
)

--[[
Freeze the process (emergency stop).
Owner only.
]]
Handlers.add(
    "Freeze",
    Handlers.utils.hasMatchingTag("Action", "Freeze"),
    function(msg)
        if not is_owner(msg) then
            send_reply(msg, "Error", { error = "Unauthorized: owner only" })
            return
        end
        State.Frozen = true
        send_reply(msg, "Frozen", { frozen = true })
    end
)

--[[
Unfreeze the process.
Owner only.
]]
Handlers.add(
    "Unfreeze",
    Handlers.utils.hasMatchingTag("Action", "Unfreeze"),
    function(msg)
        if not is_owner(msg) then
            send_reply(msg, "Error", { error = "Unauthorized: owner only" })
            return
        end
        State.Frozen = false
        send_reply(msg, "Unfrozen", { frozen = false })
    end
)

-- ============================================================================
-- PUBLIC QUERY HANDLERS (Read-only)
-- ============================================================================

--[[
Get a single receipt by ID.
Anyone can verify receipts - this is public data.
]]
Handlers.add(
    "GetReceipt",
    Handlers.utils.hasMatchingTag("Action", "GetReceipt"),
    function(msg)
        local receipt_id = msg.Tags["Receipt-Id"]
        local data = parse_data(msg)
        if not receipt_id and data then
            receipt_id = data.receipt_id
        end
        if not receipt_id then
            receipt_id = msg.Data
        end

        if not receipt_id or receipt_id == "" then
            send_reply(msg, "Error", { error = "Missing Receipt-Id" })
            return
        end

        local receipt = State.Receipts[receipt_id]

        if receipt then
            send_reply(msg, "Receipt", receipt)
        else
            send_reply(msg, "NotFound", {
                error = "Receipt not found",
                receipt_id = receipt_id
            })
        end
    end
)

--[[
List recent receipts (summary only).
Returns receipt_id and timestamps, not full data.
]]
Handlers.add(
    "ListReceipts",
    Handlers.utils.hasMatchingTag("Action", "ListReceipts"),
    function(msg)
        local limit = tonumber(msg.Tags["Limit"]) or 100
        local receipts = {}
        local count = 0

        for receipt_id, receipt in pairs(State.Receipts) do
            if count >= limit then
                break
            end
            table.insert(receipts, {
                receipt_id = receipt_id,
                timestamp_ms = receipt.timestamp_ms,
                stored_at = receipt.stored_at
            })
            count = count + 1
        end

        send_reply(msg, "ReceiptList", {
            receipts = receipts,
            total_count = State.ReceiptCount
        })
    end
)

--[[
Verify a receipt exists and return verification proof.
Returns process_id and message_id for independent verification on Arweave.
]]
Handlers.add(
    "VerifyReceipt",
    Handlers.utils.hasMatchingTag("Action", "VerifyReceipt"),
    function(msg)
        local receipt_id = msg.Tags["Receipt-Id"]
        local data = parse_data(msg)
        if not receipt_id and data then
            receipt_id = data.receipt_id
        end
        if not receipt_id then
            receipt_id = msg.Data
        end

        local receipt = State.Receipts[receipt_id]

        send_reply(msg, "VerificationResult", {
            receipt_id = receipt_id,
            exists = receipt ~= nil,
            stored_at = receipt and receipt.stored_at or nil,
            message_id = receipt and receipt.message_id or nil,
            process_id = ao.id
        })
    end
)

--[[
Get process statistics.
]]
Handlers.add(
    "GetStats",
    Handlers.utils.hasMatchingTag("Action", "GetStats"),
    function(msg)
        send_reply(msg, "Stats", {
            receipt_count = State.ReceiptCount,
            owner = State.Owner,
            frozen = State.Frozen,
            version = State.Version,
            process_id = ao.id
        })
    end
)

return "Veritas Process v0.1.0 Loaded"
