-- ==============================================================================
-- PING: Atomic Redis Matchmaking Script (matchmaking.lua)
-- ==============================================================================
-- Atomically matches two available users from the waiting queue.
-- Eliminates race conditions across multiple distributed Node.js workers.
--
-- KEYS[1] : ping:waiting_queue (ZSET: member=userId, score=enqueuedTimestamp)
-- KEYS[2] : ping:waiting_set   (SET:  member=userId, for O(1) membership checks)
-- KEYS[3] : ping:user_prefix   (STRING: key prefix for users, e.g. "ping:user:")
-- KEYS[4] : ping:metrics       (HASH: system metrics, e.g. "ping:metrics")
--
-- ARGV[1] : Current timestamp in milliseconds
-- ARGV[2] : Assigned Room ID for the matched pair
-- ARGV[3] : Maximum candidates to scan (e.g. 20)
--
-- RETURNS:
--   cjson.encode({ ok = true, userA = {...}, userB = {...}, roomId = ... })
--   OR nil if not enough valid candidates are found
-- ==============================================================================

local queueKey    = KEYS[1]
local setKey      = KEYS[2]
local userPrefix  = KEYS[3]
local metricsKey  = KEYS[4]

local now         = tonumber(ARGV[1])
local roomId      = ARGV[2]
local maxScan     = tonumber(ARGV[3]) or 20

-- Fetch candidates ordered by waiting time (FIFO: lowest score first)
local candidateIds = redis.call('ZRANGE', queueKey, 0, maxScan - 1)
if #candidateIds < 2 then
    return nil
end

local validUsers = {}

for i = 1, #candidateIds do
    local uid = candidateIds[i]
    local uKey = userPrefix .. uid
    
    -- Check if user hash exists
    local exists = redis.call('EXISTS', uKey)
    if exists == 1 then
        local fields = redis.call('HMGET', uKey, 'id', 'status', 'roomId', 'socketId', 'country')
        local id       = fields[1]
        local status   = fields[2]
        local rId      = fields[3]
        local socketId = fields[4]
        local country  = fields[5] or "Someone nearby"

        -- User is valid if status is 'waiting', socketId is present, and has no active room
        if status == 'waiting' and socketId and socketId ~= '' and (not rId or rId == '' or rId == 'null') then
            -- Ensure distinct socket IDs
            if #validUsers == 0 or validUsers[1].socketId ~= socketId then
                table.insert(validUsers, {
                    id = id or uid,
                    socketId = socketId,
                    country = country,
                    score = redis.call('ZSCORE', queueKey, uid)
                })
            end
        else
            -- Clean up stale/invalid user from queue and set
            redis.call('ZREM', queueKey, uid)
            redis.call('SREM', setKey, uid)
        end
    else
        -- Clean up orphaned queue member
        redis.call('ZREM', queueKey, uid)
        redis.call('SREM', setKey, uid)
    end

    -- Once we have 2 valid candidates, break immediately
    if #validUsers == 2 then
        break
    end
end

if #validUsers < 2 then
    return nil
end

local userA = validUsers[1]
local userB = validUsers[2]

-- Atomically remove both users from waiting queue and waiting set
redis.call('ZREM', queueKey, userA.id, userB.id)
redis.call('SREM', setKey, userA.id, userB.id)

-- Atomically update user states to 'matched' with their new roomId
local userAKey = userPrefix .. userA.id
local userBKey = userPrefix .. userB.id

redis.call('HSET', userAKey, 'status', 'matched', 'roomId', roomId, 'matchedWith', userB.id, 'matchedAt', now)
redis.call('HSET', userBKey, 'status', 'matched', 'roomId', roomId, 'matchedWith', userA.id, 'matchedAt', now)

-- Increment atomic metric counters
redis.call('HINCRBY', metricsKey, 'totalMatches', 1)

return cjson.encode({
    ok = true,
    roomId = roomId,
    userA = {
        id = userA.id,
        socketId = userA.socketId,
        country = userA.country,
        waitTime = userA.score and (now - tonumber(userA.score)) or 0
    },
    userB = {
        id = userB.id,
        socketId = userB.socketId,
        country = userB.country,
        waitTime = userB.score and (now - tonumber(userB.score)) or 0
    }
})
