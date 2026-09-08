-- ─────────────────────────────────────────────────────────────────────────────
-- lib.skill — XP, levels and progress, once.
--
-- ── why ─────────────────────────────────────────────────────────────────────
--
-- The curve was written FIVE times: fishing's `src/shared/skill.lua`, a second
-- one in its server that is a DIFFERENT formula, two hand copies in its admin
-- React, and `createSkill` in dirk-cfx-react. The two Lua ones disagree — at
-- 8,134 XP fishing's gates say level 24 and its own `getLevel` export says 99.
-- That is what happens to arithmetic nobody owns.
--
-- This module owns it. The formula here is the RuneScape curve fishing's SHARED
-- file uses — the one every gate and every bar in the game is already drawn
-- from — and `createSkill` in cfx-react is a line-for-line port of the same
-- thing, so the number the player sees and the number the server gates on come
-- out of the same maths.
--
-- ── one skill, or one skill each ────────────────────────────────────────────
--
-- A skill is one thing you can be good at. Some are SINGLE — there is one
-- fishing level and you either have it or you do not. Others are INSTANCED:
-- the same skill, the same curve, held separately against each of several
-- things.
--
--   lib.skill.register('fishing', { baseXP = 83, maxLevel = 99 })
--   lib.skill.register('yardRep', { baseXP = 40, maxLevel = 10, instanced = true })
--
-- Reputation is the second kind, and getting that wrong is what would have
-- made this a copy of fishing instead of a rewrite. It is NOT one skill called
-- "yard rep" — it is one definition with an instance per yard, because you are
-- somebody to one man and nobody to the next. So an instanced skill stores a
-- map rather than a number, and every call names the instance alongside the
-- player. Fishing, by contrast, has exactly one level, hardcoded to the
-- metadata key `fishingXp` in fifteen places.
--
-- Level is DERIVED, never stored. Change the curve in the panel and everyone's
-- level moves with it, which is the correct answer and impossible if a number
-- was written down at the time.
-- ─────────────────────────────────────────────────────────────────────────────

-- The module's own table. `modules/<name>/shared.lua` is CONCATENATED with the
-- context file and the chunk's return value becomes `lib.skill`, so the table
-- has to exist as a local here and be returned at the bottom of client.lua /
-- server.lua. Writing to `lib.skill` from inside would be writing to a key
-- that does not exist yet.
local skill = {}
local tracks = {}

local DEFAULTS = {
  baseLevel = 1,
  maxLevel  = 99,
  --- XP to reach level 2. Every later step scales off it.
  baseXP    = 83,
  --- Multiplies the requirement, so HIGHER IS SLOWER. Named the way fishing's
  --- schema describes it, which is the opposite of what the panel's
  --- `progression` meter currently implies — see the note on that control.
  modifier  = 1,
  --- The default stays what every existing dirk level was earned against.
  curve     = 'runescape',
}

--- The SHAPES a ladder can have.
---
--- Each returns the cumulative XP needed to BE `level`. They differ only in how
--- fast the cost grows, and that difference is the whole feel of a skill:
---
---   runescape  Early levels fly past, the last few are a project. What every
---              dirk level ever earned was earned against, so it stays the
---              default and stays first.
---   linear     Every level costs the same. Honest and predictable; goes flat
---              and dull at the top, because level 40 is no more of an
---              achievement than level 4.
---   quadratic  Cost grows with the square. The middle ground most RPGs use -
---              a real climb without a cliff.
---   softcap    Steep early, flattening near the ceiling, so the top stays
---              reachable. For a ladder people are meant to FINISH.
---
--- `modifier` scales all of them the same way: higher is slower.
---
--- Whichever is chosen, the XP a player holds is untouched. Level is derived,
--- never stored, so switching shape re-reads everyone against the new ladder
--- rather than taking anything away.
local CURVES = {}

--- `(i + 300 * 2^(i/7)) / 4` per step, floored. Not derived from anything - it
--- is a shape that happens to feel right, and has since 2001.
CURVES.runescape = function(track, level)
  local total = track.baseXP
  for i = 2, level - 1 do
    total = total + (math.floor((i + 300 * (2 ^ (i / 7))) / 4) * track.modifier)
  end
  return total
end

CURVES.linear = function(track, level)
  return track.baseXP * (level - track.baseLevel) * track.modifier
end

CURVES.quadratic = function(track, level)
  local steps = level - track.baseLevel
  return track.baseXP * steps * steps * track.modifier
end

--- Steep, then easing. The last level costs a little over twice the first
--- rather than thousands of times as much.
CURVES.softcap = function(track, level)
  local span = math.max(1, track.maxLevel - track.baseLevel)
  local total = 0
  for i = 1, level - track.baseLevel do
    -- Each step costs progressively less of a growing base, so the curve bends
    -- over instead of running away.
    total = total + (track.baseXP * (1 + (i / span) * 2) * track.modifier)
  end
  return total
end

--- Cumulative XP needed to BE this level, in whichever shape the skill uses.
local function xpForLevel(track, level)
  if level <= track.baseLevel then return 0 end

  local curve = CURVES[track.curve] or CURVES.runescape
  -- Level 2 always costs exactly `baseXP`, whatever the shape. It is the one
  -- number an admin sets directly and the one they check first.
  if level == track.baseLevel + 1 then return math.floor(track.baseXP) end

  return math.floor(curve(track, level))
end

--- Precompute the whole ladder.
---
--- Rebuilt whenever the settings move, so a curve edited in the panel takes
--- effect without a restart. Integer-keyed, unlike fishing's string keys - the
--- only reason those were strings is that they came back out of JSON.
local function buildMap(track)
  local map = {}
  for level = track.baseLevel, track.maxLevel do
    map[level] = xpForLevel(track, level)
  end
  track.map = map
end

local function get(id)
  local track = tracks[id]
  if not track then
    error(("no level track registered as '%s' - call skill.register first"):format(tostring(id)), 3)
  end
  return track
end

--- Declare a track.
---
--- Call it from a shared file so both sides agree. Registering the same id
--- again REPLACES the settings and rebuilds the ladder, which is what a
--- scriptConfig watcher wants to do on every save.
---
--- @param id string
--- @param settings table|nil  { baseLevel, maxLevel, baseXP, modifier, keyed }
function skill.register(id, settings)
  assert(type(id) == 'string' and id ~= '', 'skill.register needs an id')
  settings = settings or {}

  local existing = tracks[id]
  local track = {
    id        = id,
    baseLevel = settings.baseLevel or (existing and existing.baseLevel) or DEFAULTS.baseLevel,
    maxLevel  = settings.maxLevel  or (existing and existing.maxLevel)  or DEFAULTS.maxLevel,
    baseXP    = settings.baseXP    or (existing and existing.baseXP)    or DEFAULTS.baseXP,
    modifier  = settings.modifier  or (existing and existing.modifier)  or DEFAULTS.modifier,
    -- Which SHAPE the ladder has. Unknown values fall back to runescape rather
    -- than erroring: a typo in a config should not take the skill down.
    curve     = settings.curve or (existing and existing.curve) or DEFAULTS.curve,
    -- Held per-something (a yard, a gang, a town) rather than once per player.
    instanced = settings.instanced == true or (existing and existing.instanced) or false,
    -- The metadata key, namespaced by the OWNING RESOURCE. `craftingrep`,
    -- `jobrep` and `dealerrep` are already taken on a stock QBX install, so an
    -- unprefixed name is a collision waiting to happen with somebody else's
    -- script - and the loser is silent.
    -- `metaKey` can be stated outright, and fishing is why: its XP has lived
    -- under `fishingXp` on every live server since launch. Namespacing it
    -- would orphan every player's level in silence. A skill that already has
    -- data keeps its key; a new one takes the safe default.
    metaKey   = settings.metaKey or (existing and existing.metaKey)
      or ('%s_%s'):format(GetCurrentResourceName(), id),
  }

  if track.maxLevel < track.baseLevel then track.maxLevel = track.baseLevel end

  tracks[id] = track
  buildMap(track)
  return track
end

--- Change a skill's curve after it was registered.
---
--- The whole point of the split: `register` is a declaration you make once, at
--- load, from a shared file - `update` is what a scriptConfig watcher calls on
--- every save. Registering again would work, but it reads as though the skill
--- did not exist yet, and it would let a typo silently create a second one.
---
---     lib.skill.register('yardRep', { instanced = true })
---     lib.scriptConfig.on('scrapyards.rep', function(s) lib.skill.update('yardRep', s) end)
---
--- Nothing recomputes downstream because nothing downstream stores a level -
--- everyone's level simply moves with the curve, next time it is asked for.
function skill.update(id, settings)
  local track = get(id)
  settings = settings or {}

  track.baseLevel = tonumber(settings.baseLevel) or track.baseLevel
  track.maxLevel  = tonumber(settings.maxLevel)  or track.maxLevel
  track.baseXP    = tonumber(settings.baseXP)    or track.baseXP
  track.modifier  = tonumber(settings.modifier)  or track.modifier
  track.curve     = settings.curve or track.curve
  if track.maxLevel < track.baseLevel then track.maxLevel = track.baseLevel end

  buildMap(track)
  return track
end

--- Is this skill known here?
function skill.has(id)
  return tracks[id] ~= nil
end

--- The XP needed to BE `level` on this track.
function skill.xpForLevel(id, level)
  local track = get(id)
  return track.map[level] or xpForLevel(track, level)
end

--- What level that much XP is worth.
function skill.levelFromXp(id, xp)
  local track = get(id)
  xp = tonumber(xp) or 0

  for level = track.baseLevel, track.maxLevel do
    if (track.map[level] or 0) > xp then return level - 1 end
  end
  return track.maxLevel
end

--- Everything a bar needs, in one call.
---
--- Deliberately the same field names `createSkill` returns in cfx-react, so a
--- payload built here drops straight into `LevelPanel` / `LevelBanner` with no
--- translation layer in between - which is where the two would drift apart.
---
--- @return table { xp, level, currentLevelXp, nextLevelXp, xpToNext, progress, maxed }
function skill.progress(id, xp)
  local track = get(id)
  xp = tonumber(xp) or 0

  local level  = skill.levelFromXp(id, xp)
  local atThis = track.map[level] or 0
  local atNext = track.map[level + 1]

  if not atNext then
    return {
      xp = xp, level = level,
      currentLevelXp = atThis, nextLevelXp = atThis,
      xpToNext = 0, progress = 100, maxed = true,
    }
  end

  local span = atNext - atThis
  return {
    xp = xp,
    level = level,
    currentLevelXp = atThis,
    nextLevelXp = atNext,
    xpToNext = atNext - xp,
    -- Clamped, because a curve edited downwards can leave someone holding more
    -- XP than their next level costs for the moment before it settles.
    progress = span > 0 and math.min(100, math.max(0, ((xp - atThis) / span) * 100)) or 100,
    maxed = false,
  }
end

--- A track's settings, for anything that has to send them to a NUI.
function skill.settings(id)
  local track = get(id)
  return {
    baseLevel = track.baseLevel,
    maxLevel  = track.maxLevel,
    baseXP    = track.baseXP,
    modifier  = track.modifier,
    curve     = track.curve,
  }
end

--- Internal: the whole track, for the client and server halves.
function skill._track(id)
  return get(id)
end
