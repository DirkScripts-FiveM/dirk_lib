-- ─────────────────────────────────────────────────────────────────────────────
-- lib.skill, server half — where the XP actually lives.
--
-- Stored in framework player metadata, under a key namespaced by the owning
-- resource. A stock QBX install already has `craftingrep`, `jobrep`,
-- `dealerrep` and `attachmentcraftingrep` in there, so an unprefixed name is a
-- collision with somebody else's script, and the loser fails silently.
--
--   uninstanced skill -> metadata['dirk_fishing_fishing']      = 4200
--   instanced skill   -> metadata['dirk_projectCars_yardRep']  = { yard_lsia = 4200 }
--
-- ── the two things fishing got wrong that this fixes ────────────────────────
--
-- 1. THREE grant sites there write metadata directly instead of going through
--    the add function, so they never fire the sync event and the player's own
--    client shows a stale level until they relog. Here there is one write path
--    and it always syncs.
--
-- 2. There is no level-up hook at all. Fishing's celebration is the NUI
--    diffing before against after and inferring one, in two components, each
--    with its own copy of the animation. `add` returns whether a threshold was
--    crossed and fires an event, so the party is the caller's decision and
--    nobody has to guess.
-- ─────────────────────────────────────────────────────────────────────────────

--- Read the whole stored value for a track.
---
--- Defensive about the shape rather than about the NAME - fishing accreted
--- `fishingXp` / `fishingXP` / `fishingxp` / `meta.fishing.xp` and every reader
--- has to try all four forever. One name, decided here, and never a second.
local function readRaw(src, track)
  local value = lib.player.getMetadata(src, track.metaKey)
  if track.instanced then
    return type(value) == 'table' and value or {}
  end
  return tonumber(value) or 0
end

local function writeRaw(src, track, value)
  lib.player.setMetadata(src, track.metaKey, value)
end

--- How much XP this player has on a track.
---
--- @param src number
--- @param id string  the track
--- @param key string|nil  which one, for an instanced skill (a yard, a gang, a town)
--- @return number
function skill.get(src, id, key)
  local track = skill._track(id)
  local raw = readRaw(src, track)

  if not track.instanced then return raw end
  if key == nil then return 0 end
  return tonumber(raw[key]) or 0
end

--- Every key a player has XP on, for an instanced skill. `{}` for an unkeyed one.
---
--- The shape the admin panel wants: which yards this person is known at, and
--- how well, without asking about each in turn.
function skill.all(src, id)
  local track = skill._track(id)
  if not track.instanced then return {} end

  local out = {}
  for key, xp in pairs(readRaw(src, track)) do
    out[key] = tonumber(xp) or 0
  end
  return out
end

--- Level and progress in one call, ready to send to a NUI.
function skill.progressFor(src, id, key)
  return skill.progress(id, skill.get(src, id, key))
end

--- Set XP outright. Returns the stored value.
---
--- Clamped at zero: negative XP is not a debt, it is a bug that would read as
--- a level below the floor everywhere downstream.
function skill.set(src, id, amount, key)
  local track = skill._track(id)
  local value = math.max(0, math.floor(tonumber(amount) or 0))

  if track.instanced then
    assert(key ~= nil, 'skill.set on an instanced skill needs a key')
    local map = readRaw(src, track)
    map[key] = value
    writeRaw(src, track, map)
  else
    writeRaw(src, track, value)
  end

  skill._sync(src, track, key, value)
  return value
end

--- Grant (or take, with a negative) XP.
---
--- THE write path. Everything else goes through here so the sync and the
--- level-up check cannot be forgotten - which is exactly how fishing ended up
--- with three grant sites that leave the client stale.
---
--- @return number xp        the new total
--- @return boolean levelled did this cross a threshold
--- @return number level     the level now
function skill.add(src, id, amount, key)
  local track = skill._track(id)
  local before = skill.get(src, id, key)
  local after = math.max(0, before + (math.floor(tonumber(amount) or 0)))

  local wasLevel = skill.levelFromXp(id, before)
  local nowLevel = skill.levelFromXp(id, after)

  skill.set(src, id, after, key)

  if nowLevel > wasLevel then
    -- An EVENT, not a notification. dirk_lib has no business deciding what a
    -- level-up looks like in someone else's script - only that one happened.
    TriggerEvent('dirk_lib:levelUp', src, id, key, nowLevel, wasLevel)
    TriggerClientEvent('dirk_lib:levelUp', src, id, key, nowLevel, wasLevel)
  end

  return after, nowLevel > wasLevel, nowLevel
end

--- Take XP away. A convenience over `add` with a negative, so call sites read
--- as what they mean.
function skill.remove(src, id, amount, key)
  return skill.add(src, id, -(math.abs(tonumber(amount) or 0)), key)
end

--- Is this player at least `level` on the track?
---
--- The one-line gate every consumer wants, so nobody writes
--- `if levelFromXp(get(...)) < n` by hand and gets the comparison backwards.
function skill.atLeast(src, id, level, key)
  return skill.levelFromXp(id, skill.get(src, id, key)) >= (tonumber(level) or 0)
end

--- Push the new value to the owner's client.
---
--- Framework client-side metadata does not reliably refresh - QBX in
--- particular keeps a stale copy - so the client is TOLD rather than left to
--- read it back. Fishing learned this the hard way and added an event; here it
--- is simply how writing works.
function skill._sync(src, track, key, value)
  TriggerClientEvent('dirk_lib:levelSync', src, track.id, key, value)
end

--- Push everything this player holds, in one go.
---
--- For a fresh spawn: a UI opened in the first second would otherwise draw
--- zeroes and correct itself a moment later, which reads as a bug even though
--- the number was only late. Call it from wherever the resource decides a
--- player is ready.
function skill.syncAll(src)
  local all = {}
  for id, track in pairs(tracks) do
    all[id] = readRaw(src, track)
  end
  TriggerClientEvent('dirk_lib:levelSyncAll', src, all)
end

return skill
