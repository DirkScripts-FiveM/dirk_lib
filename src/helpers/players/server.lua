-- Player listing admin tool — SERVER side.
--
-- Two ace-gated callbacks that the client-side `players.lua` (loaded via
-- the admin/init.lua tool registry) round-trips into. Tiny TTL cache
-- keeps multiple <PlayerSelect> renders from spamming the framework /
-- MySQL on every screen update.
--
-- Player shape:
--   { id = number|nil, citizenId = string, name = string,
--     charName = string, online = boolean }

local SEARCH_CACHE_TTL_MS = 30000  -- search — stable enough to cache longer

local searchCache = {}

local function freshSearch(search, limit)
  local key = (search or '') .. '|' .. tostring(limit or 50)
  local now = GetGameTimer()
  local entry = searchCache[key]
  if entry and (now - entry.at) < SEARCH_CACHE_TTL_MS then
    return entry.value
  end
  local value = lib.framework.searchPlayers({ search = search, limit = limit })
  searchCache[key] = { at = now, value = value }
  return value
end

-- `dirk_lib:getOnlinePlayers` is registered in src/scriptConfig/server.lua,
-- gated on the master editor. A second registration used to live here, gated
-- on the 'admin' ACE and returning a different shape; the glob loads that file
-- last, so this one never answered and only made the gate look ambiguous.

lib.callback.register('dirk_lib:searchPlayers', function(src, opts)
  if not IsPlayerAceAllowed(src, 'admin') then return {} end
  if type(opts) ~= 'table' then opts = {} end
  return freshSearch(opts.search or '', tonumber(opts.limit) or 50)
end)
