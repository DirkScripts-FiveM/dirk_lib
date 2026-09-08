-- ─────────────────────────────────────────────────────────────────────────────
-- lib.skill, client half — what this player knows about their own XP.
--
-- PUSHED, never fetched. Framework client-side metadata does not reliably
-- refresh — QBX in particular keeps a stale copy — so asking it is how fishing
-- ended up showing a level that was minutes out of date. The server tells us
-- on every write, and this holds the answer.
--
-- Nothing here reaches the server. Opening a UI that shows a level must not
-- cost a round trip, so a value that has never been pushed reads as zero and
-- corrects itself the moment anything is earned. The server is the authority
-- for GATES; this is the authority for what is on screen.
-- ─────────────────────────────────────────────────────────────────────────────

--- skill id -> xp, or skill id -> instance -> xp.
local held = {}

--- Take a pushed value.
RegisterNetEvent('dirk_lib:levelSync', function(id, key, value)
  if type(id) ~= 'string' then return end

  if key == nil then
    held[id] = tonumber(value) or 0
    return
  end

  local map = held[id]
  if type(map) ~= 'table' then map = {}; held[id] = map end
  map[key] = tonumber(value) or 0
end)

--- Seed everything this player already has, on load.
---
--- One push covers every skill and every instance, so a UI opened in the first
--- second after spawning shows the real numbers rather than zeroes that
--- quietly correct themselves later.
RegisterNetEvent('dirk_lib:levelSyncAll', function(all)
  if type(all) ~= 'table' then return end
  for id, value in pairs(all) do
    held[id] = value
  end
end)

--- How much XP we hold on a skill.
---
--- @param id string
--- @param key string|nil  the instance, for an instanced skill
function skill.get(id, key)
  local value = held[id]

  if key == nil then
    return type(value) == 'number' and value or 0
  end
  return (type(value) == 'table' and tonumber(value[key])) or 0
end

--- Every instance we hold XP on. `{}` for a single skill.
function skill.all(id)
  local value = held[id]
  if type(value) ~= 'table' then return {} end

  local out = {}
  for key, xp in pairs(value) do out[key] = tonumber(xp) or 0 end
  return out
end

--- Level and progress, ready for `LevelPanel` / `LevelBanner`.
---
--- The field names match `createSkill` in dirk-cfx-react exactly, so this drops
--- into either component with nothing in between to go stale.
function skill.progressFor(id, key)
  return skill.progress(id, skill.get(id, key))
end

--- What level we are.
function skill.levelOf(id, key)
  return skill.levelFromXp(id, skill.get(id, key))
end

--- Are we at least this level? The client-side twin of the server's gate.
---
--- For SHOWING things — greying a locked option, ordering a list. Never for
--- deciding one: the server re-checks everything, because this is a number a
--- client was handed and could be lied about.
function skill.atLeast(id, level, key)
  return skill.levelOf(id, key) >= (tonumber(level) or 0)
end

return skill
