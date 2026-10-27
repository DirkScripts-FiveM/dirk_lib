-- Reading the log table back, for the Logs page.
--
-- Every query here is written to be answerable from an index. The shapes that
-- matter:
--
--   * paging is KEYSET - `WHERE id < ? ORDER BY id DESC LIMIT n`. An OFFSET
--     scan re-reads everything before the page it returns, so page forty costs
--     forty pages of work; keyset costs one, forever.
--   * every filter is paired with `id` in an index, so filtering and ordering
--     are the same walk rather than a filter followed by a sort.
--   * free text over `message` is the one thing no index can help with, so it
--     is only ever applied on top of a bounded window - never on its own.
--
-- Read access is the same permission that opens the panel. Logs name players
-- and carry whatever a script put in them; they are not less sensitive than
-- the settings next to them.

local sink = require '@dirk_lib.src.logger.localSink'
local routes = require '@dirk_lib.src.logger.routes'

local MAX_LIMIT = 100
local DEFAULT_LIMIT = 50

--- Bounded, so a caller cannot ask for the whole table in one go.
local function pageSize(value)
  local n = tonumber(value) or DEFAULT_LIMIT
  return math.max(1, math.min(MAX_LIMIT, math.floor(n)))
end

--- The WHERE clause and its arguments, built from what was actually asked.
---
--- Nothing is interpolated: every value goes through a placeholder, because a
--- log filter is a string an admin typed and a resource name a script chose.
local function buildFilter(query)
  local where, args = {}, {}

  local function add(clause, value)
    where[#where + 1] = clause
    args[#args + 1] = value
  end

  if type(query.resource) == 'string' and query.resource ~= '' then
    add('`resource` = ?', query.resource)
  end
  if type(query.event) == 'string' and query.event ~= '' then
    add('`event` = ?', query.event)
  end
  if type(query.level) == 'string' and query.level ~= '' then
    add('`level` = ?', query.level)
  end
  if type(query.player) == 'string' and query.player ~= '' then
    -- ONE column, chosen from what was typed - never `name OR identifier`.
    --
    -- The OR read well and performed terribly: MariaDB cannot turn a range on
    -- one index OR an equality on another into a single ordered scan, so it
    -- fell back to walking the primary key. Measured on 300k rows it examined
    -- 298,039 of them to return fifty.
    --
    -- You are either pasting an identifier or typing a name, and identifiers
    -- carry a colon. Deciding here means one indexed predicate either way.
    if query.player:find(':', 1, true) then
      add('`identifier` = ?', query.player)
    else
      -- A prefix, not `%name%`: a leading wildcard cannot use an index at all.
      add('`playerName` LIKE ?', query.player .. '%')
    end
  end
  if tonumber(query.since) then
    add('`at` >= ?', math.floor(tonumber(query.since)))
  end
  if type(query.search) == 'string' and query.search ~= '' then
    -- The only unindexable filter, and the reason `since` is encouraged
    -- alongside it: a message scan is bounded by whatever the other clauses
    -- have already narrowed it to.
    add('`message` LIKE ?', '%' .. query.search .. '%')
  end

  return where, args
end

--- One page of log lines, newest first.
lib.callback.register('dirk_lib:getLogs', function(source, query)
  if not lib.scriptConfig.canView(source) then return nil, 'NotAuthorized' end
  if not sink.isEnabled() then return { rows = {}, nextCursor = nil, off = true } end

  query = type(query) == 'table' and query or {}
  local limit = pageSize(query.limit)

  local where, args = buildFilter(query)

  -- The cursor IS the last id of the previous page. Keyset paging cannot skip
  -- or repeat a row when new ones arrive mid-scroll, which offset paging does
  -- constantly on a table being written to.
  local cursor = tonumber(query.cursor)
  if cursor then
    where[#where + 1] = '`id` < ?'
    args[#args + 1] = math.floor(cursor)
  end

  local clause = #where > 0 and (' WHERE ' .. table.concat(where, ' AND ')) or ''

  -- One extra row, purely to answer "is there more" without a COUNT. A COUNT
  -- over a filtered log table is the expensive query on this page, and it is
  -- not a question the reader asked.
  args[#args + 1] = limit + 1

  local ok, rows = pcall(MySQL.query.await,
    'SELECT `id`,`at`,`resource`,`event`,`level`,`message`,`playerName`,`identifier`,`identifiers`,`serverId`,`tags`'
    .. ' FROM `dirk_logs`' .. clause .. ' ORDER BY `id` DESC LIMIT ?', args)

  if not ok or type(rows) ~= 'table' then return nil, 'QueryFailed' end

  local more = #rows > limit
  if more then rows[#rows] = nil end

  local out = {}
  for i = 1, #rows do
    local row = rows[i]
    out[i] = {
      id = row.id,
      at = row.at,
      resource = row.resource,
      event = row.event,
      level = row.level,
      message = row.message,
      player = row.playerName and {
        name = row.playerName,
        identifier = row.identifier,
        -- Every raw identifier captured at the time, so a row still names
        -- someone even if they have since changed framework id.
        identifiers = row.identifiers and json.decode(row.identifiers) or nil,
        source = row.serverId,
      } or nil,
      tags = row.tags and json.decode(row.tags) or nil,
    }
  end

  return {
    rows = out,
    nextCursor = more and out[#out] and out[#out].id or nil,
  }
end)

--- What is worth filtering by, with counts.
---
--- Deliberately over a WINDOW rather than the whole table: "which resources
--- have logged anything" is a question about recent activity, and a GROUP BY
--- across every row ever written is the one query here that would grow without
--- bound. The page caches the answer for minutes, not seconds.
--- Facets are CACHED, because they are the expensive query on this page.
---
--- A GROUP BY over a week of logs is a temporary table and a filesort over
--- however many rows that is - measured at 297,531 on a 300k table. It is also
--- an answer that barely changes: which resources are logging is not a
--- second-by-second question. So it is computed at most once a minute, and
--- every admin looking at the page shares that one result.
local facetCache = { at = 0, key = '', value = nil }
local FACET_TTL = 60

lib.callback.register('dirk_lib:getLogFacets', function(source, query)
  if not lib.scriptConfig.canView(source) then return nil, 'NotAuthorized' end
  if not sink.isEnabled() then return { resources = {}, events = {}, levels = {}, off = true } end

  query = type(query) == 'table' and query or {}
  -- A DAY by default, not a week. Facets answer "what is active", and a week
  -- of rows costs several times as much to group for an answer that is nearly
  -- always the same list.
  local since = tonumber(query.since) or (os.time() - 86400)

  local key = ('%d|%s'):format(math.floor(since / FACET_TTL), tostring(query.resource or ''))
  if facetCache.value and facetCache.key == key and (os.time() - facetCache.at) < FACET_TTL then
    return facetCache.value
  end

  local function group(column, extraWhere, extraArg)
    local args = { math.floor(since) }
    local clause = '`at` >= ?'
    if extraWhere then
      clause = clause .. ' AND ' .. extraWhere
      args[#args + 1] = extraArg
    end
    local ok, rows = pcall(MySQL.query.await,
      ('SELECT `%s` AS name, COUNT(*) AS count FROM `dirk_logs` WHERE %s GROUP BY `%s` ORDER BY count DESC LIMIT 50')
        :format(column, clause, column), args)
    return (ok and type(rows) == 'table') and rows or {}
  end

  local out = {
    resources = group('resource'),
    -- Events are only meaningful within a resource - every script names its
    -- own - so asking for all of them at once returns a list nobody can read.
    events = query.resource and query.resource ~= ''
      and group('event', '`resource` = ?', query.resource) or {},
    levels = group('level'),
  }

  facetCache = { at = os.time(), key = key, value = out }
  return out
end)

--- How much is being kept, and how big it is.
lib.callback.register('dirk_lib:getLogHealth', function(source)
  if not lib.scriptConfig.canView(source) then return nil, 'NotAuthorized' end

  -- Routes are reported either way: forwarding to Discord works whether or
  -- not lines are also being kept here, and "the sink is off" must not read
  -- as "nothing is being delivered".
  local delivery = routes.health()

  if not sink.isEnabled() then
    return {
      enabled = false, rows = 0, bytes = 0,
      retentionDays = sink.retentionDays(),
      routes = delivery,
    }
  end

  -- From information_schema rather than COUNT(*): an approximate row count and
  -- the real on-disk size, for the price of a dictionary lookup. The exact
  -- count is not worth a full scan of the table it is counting.
  local ok, info = pcall(MySQL.single.await, [[
    SELECT TABLE_ROWS AS rows, (DATA_LENGTH + INDEX_LENGTH) AS bytes
    FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'dirk_logs'
  ]])

  return {
    enabled = true,
    rows = (ok and info and tonumber(info.rows)) or 0,
    bytes = (ok and info and tonumber(info.bytes)) or 0,
    retentionDays = sink.retentionDays(),
    routes = delivery,
  }
end)

--- Post a test line to one redirect, whichever kind it is.
---
--- The button lives on the row, which is where you have just chosen the
--- destination - the moment you actually want to know whether it works. It
--- sends ONE message, straight out, deliberately bypassing the batching
--- queue: a test you have to wait two seconds for reads as a test that failed.
lib.callback.register('dirk_lib:testLogRoute', function(source, payload)
  if not lib.scriptConfig.hasPerm(source) then return { success = false, error = 'NoPermission' } end

  payload = type(payload) == 'table' and payload or {}
  local label = payload.label or 'this redirect'

  local embed = {
    embeds = { {
      title = 'Redirect connected',
      description = ('Lines matching **%s** will arrive here.'):format(label),
      color = 0x4AB569,
      footer = { text = ('%s - %s'):format(GetConvar('sv_projectName', 'FiveM server'), os.date('%Y-%m-%d %H:%M:%S')) },
    } },
  }

  -- Follows `kind`, exactly as destOf in routes.lua does, so the test
  -- exercises the path a real line would take rather than whichever
  -- destination happens to be filled in.
  local kind = payload.kind
  if kind ~= 'webhook' and kind ~= 'channel' then
    kind = (type(payload.channelId) == 'string' and payload.channelId ~= '') and 'channel' or 'webhook'
  end

  local channelId = payload.channelId
  if kind == 'channel' then
    if type(channelId) ~= 'string' or channelId == '' then
      return { success = false, error = 'NoChannel' }
    end
    local ok, err = lib.discord.sendChannel(channelId, embed)
    if not ok then return { success = false, error = tostring(err or 'Failed') } end
    return { success = true, message = 'Test sent — check the channel' }
  end

  -- `url` first: the button sits on the row now, so `value` is whatever field
  -- it was attached to (the label), not the destination.
  local url = payload.url or payload.value
  if type(url) ~= 'string' or not url:find('^https://[%w%.]*discord[app]*%.com/api/webhooks/') then
    return { success = false, error = 'BadUrl' }
  end

  lib.discord.sendWebhook(url, embed)

  -- Fire-and-forget, so this reports that it was SENT, not that Discord liked
  -- it. Saying more than we know would be worse than saying this.
  return { success = true, message = 'Test sent — check the channel' }
end)

--- Adopt a webhook a script used to own.
---
--- Every script used to carry its own webhook URL. Those settings are going
--- away, and a server owner who configured one should not have to notice, go
--- and find it, and paste it somewhere new - so the script hands it over on
--- its way out and this turns it into a route.
---
--- Idempotent by URL AND resource: a script calling this on every restart must
--- not stack up duplicate routes, and two scripts pointing at the same channel
--- should end up as one route naming both.
exports('logger_adoptWebhook', function(payload)
  local resource = GetInvokingResource() or cache.resource
  local url = type(payload) == 'table' and payload.url or nil
  if type(url) ~= 'string' or url == '' then return false end

  local cfg = (lib.scriptConfig and lib.scriptConfig.get and lib.scriptConfig.get('logger')) or {}
  local list = type(cfg.routes) == 'table' and cfg.routes or {}

  for i = 1, #list do
    if list[i].url == url then
      local resources = type(list[i].resources) == 'table' and list[i].resources or {}
      -- Already forwarding everything, or already naming this script.
      if #resources == 0 then return true end
      for j = 1, #resources do
        if resources[j] == resource then return true end
      end
      resources[#resources + 1] = resource
      list[i].resources = resources
      lib.scriptConfig.set('logger.routes', list)
      lib.print.info(('[lib.logger] added %s to the existing webhook route %q'):format(resource, list[i].label or '?'))
      return true
    end
  end

  list[#list + 1] = {
    id = ('adopted_%s_%d'):format(resource, os.time()),
    label = payload.label or ('%s logs'):format(resource),
    enabled = true,
    url = url,
    resources = { resource },
    events = type(payload.events) == 'table' and payload.events or {},
    levels = {},
  }

  lib.scriptConfig.set('logger.routes', list)
  lib.print.info(('[lib.logger] moved the %s webhook into the shared log routes - configure it in /dirk_config > Logs from now on.'):format(resource))
  return true
end)

--- Discord channels the bot can post to, for the redirect picker.
---
--- Read-level, because it names channels rather than granting anything - and
--- the alternative is asking someone to find a channel id in Discord's
--- developer mode and paste it, which is how a redirect ends up pointing at
--- the wrong place.
lib.callback.register('dirk_lib:getDiscordChannels', function(source)
  if not lib.scriptConfig.canView(source) then return nil, 'NotAuthorized' end

  local ok, configured = pcall(function() return exports.dirk_lib:discord_isConfigured() end)
  if not ok or not configured then return { configured = false, channels = {} } end

  local got, channels, err = pcall(function() return exports.dirk_lib:discord_getChannels() end)
  if not got or type(channels) ~= 'table' then
    return { configured = true, channels = {}, error = tostring(err or 'Failed') }
  end

  return { configured = true, channels = channels }
end)

--- Discord roles, for the role pickers (a backstory's lock, a VIP slot).
---
--- Read-level for the same reason as channels: it names roles rather than
--- granting anything, and the alternative is developer mode and a pasted id.
--- @everyone is already left out by discord_getRoles.
lib.callback.register('dirk_lib:getDiscordRoles', function(source)
  if not lib.scriptConfig.canView(source) then return nil, 'NotAuthorized' end

  local ok, configured = pcall(function() return exports.dirk_lib:discord_isConfigured() end)
  if not ok or not configured then return { configured = false, roles = {} } end

  local got, roles, err = pcall(function() return exports.dirk_lib:discord_getRoles() end)
  if not got or type(roles) ~= 'table' then
    return { configured = true, roles = {}, error = tostring(err or 'Failed') }
  end

  local out = {}
  for _, r in ipairs(roles) do
    out[#out + 1] = { id = tostring(r.id), name = r.name, color = tonumber(r.color) or 0, managed = r.managed == true }
  end
  return { configured = true, roles = out }
end)

return true
