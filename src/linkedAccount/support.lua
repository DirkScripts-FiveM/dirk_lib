-- ─────────────────────────────────────────────────────────────────────────────
-- Support bundles: the PURE half.
--
-- Everything here takes plain values and gives plain values back - no natives,
-- no exports, no HTTP - so tests/linkedAccount.lua can pin it without a player,
-- a database or a network. src/linkedAccount/server.lua gathers the facts from
-- the running server and hands them to `build`.
--
-- The shape is the site's contract (dirkscripts-site `_planning/linked-servers.md`,
-- validated by `src/utils/supportBundle.ts`). The site redacts again before it
-- stores anything; redacting here as well means a secret never crosses the wire
-- in the first place, which is the promise that actually matters.
-- ─────────────────────────────────────────────────────────────────────────────

local M = {}

--- The newest console lines kept, and how long one line may be (the site's own caps).
M.CONSOLE_KEEP = 400
M.LINE_MAX = 1000
--- The site refuses a body over 512 KB. Aim well under it: JSON escaping is done
--- by the encoder, and the request id wraps the bundle.
M.MAX_BYTES = 480 * 1024
M.MAX_OVERRIDES = 500
--- Distinct console problems reported; the rest are counted in the last one.
M.MAX_CONSOLE_PROBLEMS = 30

-- ─── redaction ───────────────────────────────────────────────────────────────
-- A port of the site's RULES (src/utils/supportBundle.ts), in Lua patterns.
-- Lua has no alternation, no lookbehind and no case-insensitive flag, so each
-- rule is spelled out and `ci` builds the [aA] classes.

local function ci(s)
  return (s:gsub('%a', function(c) return ('[%s%s]'):format(c:lower(), c:upper()) end))
end

-- convars that hold a secret, whatever it looks like
local SECRET_CONVARS = {
  'sv_licenseKey', 'sv_tebexSecret', 'steam_webApiKey', 'rcon_password', 'sv_password',
  'mysql_connection_string',
}
local CONVAR_PATTERNS = {}
for i = 1, #SECRET_CONVARS do
  local name = '%f[%w_](' .. ci(SECRET_CONVARS[i]) .. ')'
  CONVAR_PATTERNS[#CONVAR_PATTERNS + 1] = name .. '(%s*=%s*)("[^"]*")'
  CONVAR_PATTERNS[#CONVAR_PATTERNS + 1] = name .. "(%s*=%s*)('[^']*')"
  CONVAR_PATTERNS[#CONVAR_PATTERNS + 1] = name .. '(%s*=%s*)([^%s"\']%S*)'
  CONVAR_PATTERNS[#CONVAR_PATTERNS + 1] = name .. '(%s+)("[^"]*")'
  CONVAR_PATTERNS[#CONVAR_PATTERNS + 1] = name .. "(%s+)('[^']*')"
  CONVAR_PATTERNS[#CONVAR_PATTERNS + 1] = name .. '(%s+)([^%s"\'=]%S*)'
end

-- key=value and key: value secrets
-- each with the lowercase word that must be in the text for it to be worth running
local SECRET_KEYS = {
  { ci('api') .. '[_%-]?' .. ci('key'), 'key' },
  { ci('access') .. '[_%-]?' .. ci('token'), 'token' },
  { ci('auth') .. '[_%-]?' .. ci('token'), 'token' },
  { ci('client') .. '[_%-]?' .. ci('secret'), 'secret' },
  { ci('token'), 'token' },
  { ci('secret'), 'secret' },
  { ci('password'), 'password' },
  { ci('passwd'), 'passwd' },
  { ci('pwd'), 'pwd' },
}
local KEY_PATTERNS, KEY_GUARDS = {}, {}
for i = 1, #SECRET_KEYS do
  KEY_PATTERNS[i] = '%f[%w](' .. SECRET_KEYS[i][1] .. ')(["\']?%s*[:=]%s*["\']?)([^%s"\',;&}]+)'
  KEY_GUARDS[i] = SECRET_KEYS[i][2]
end

-- player identifiers (license2 before license only for readability; either order works)
local ID_PREFIXES = { 'license2', 'license', 'steam', 'discord', 'fivem', 'xbl', 'live', 'ip' }
local ID_PATTERNS = {}
for i, prefix in ipairs(ID_PREFIXES) do
  ID_PATTERNS[i] = '%f[%w](' .. ci(prefix) .. '):[%w%.:]+'
end

local WEBHOOK = '(' .. ci('discord') .. '[aA]?[pP]?[pP]?%.' .. ci('com') .. '/' .. ci('api') .. '/' .. ci('webhooks') .. '/)%d+/[%w_%-]+'
-- `[` `]` are in the value class so a key an earlier rule already blanked
-- (`Bearer dsk_[redacted]`) is taken whole rather than leaving a tail behind
local AUTH_HEADERS = { '%f[%w](' .. ci('bearer') .. ')%s+[%w%._~%+/%-%[%]]+=*', '%f[%w](' .. ci('basic') .. ')%s+[%w%._~%+/%-%[%]]+=*' }

--- addresses that say nothing about anyone, and help ("listening on 0.0.0.0:30120")
local HARMLESS_IPS = { ['0.0.0.0'] = true, ['127.0.0.1'] = true }

local function octet(o)
  if #o > 3 or (#o > 1 and o:sub(1, 1) == '0') then return false end
  return tonumber(o) <= 255
end

-- Every pattern here has to stay LINEAR in the line length. This runs on the
-- server thread over 400 console lines of up to 1000 characters; a pattern that
-- backtracks across a long run (`[%w]+%.` tried from every position of a long
-- word) measured 21 seconds of hitch for one bundle. Hence the frontiers, the
-- literal anchors, and the token rule splitting runs by hand.

local function redactIPv4(s)
  return (s:gsub('%f[%d]()(%d+)%.(%d+)%.(%d+)%.(%d+)()', function(i, a, b, c, d, j)
    local ip = ('%s.%s.%s.%s'):format(a, b, c, d)
    -- not part of a version (v1.0.0.1234) or a longer dotted number
    local before = i > 1 and s:sub(i - 1, i - 1) or ''
    if before:match('[%w%.]') then return nil end
    local after = s:sub(j, j)
    if after:match('%w') or (after == '.' and s:sub(j + 1, j + 1):match('%d')) then return nil end
    if not (octet(a) and octet(b) and octet(c) and octet(d)) then return nil end
    if HARMLESS_IPS[ip] then return nil end
    return '[ip]'
  end))
end

local function hexGroups(part)
  if part == '' then return 0 end
  local n = 0
  for group in (part .. ':'):gmatch('([^:]*):') do
    if not group:match('^%x%x?%x?%x?$') then return nil end
    n = n + 1
  end
  return n
end

--- A full 8-group address, or a `::` one with at least one group before it
--- (fe80::1). Times (12:34:56) and MAC addresses have neither, so they stay.
local function isIPv6(candidate)
  local first, last = candidate:find('::', 1, true)
  if first then
    if candidate:find('::', last + 1, true) then return false end
    local head = hexGroups(candidate:sub(1, first - 1))
    local tail = hexGroups(candidate:sub(last + 1))
    if not head or not tail or head < 1 or head > 6 then return false end
    return head + tail <= 7
  end
  return hexGroups(candidate) == 8
end

local function redactIPv6(s)
  return (s:gsub('()([%x:]+)()', function(i, candidate, j)
    if not candidate:find(':', 1, true) then return nil end
    local before = i > 1 and s:sub(i - 1, i - 1) or ''
    if before:match('[%w:]') or s:sub(j, j):match('[%w:]') then return nil end
    if not isIPv6(candidate) then return nil end
    return '[ip]'
  end))
end

--- Blank IPs, license keys, tokens, passwords, webhooks and player identifiers in one string.
function M.redact(s)
  if type(s) ~= 'string' or s == '' then return s end
  local out = s
  -- Each rule only runs when the text could hold what it looks for: a plain
  -- `find` is far cheaper than a pattern pass, and most console lines hold
  -- nothing secret at all.
  local lower = s:lower()
  local function has(needle) return lower:find(needle, 1, true) ~= nil end

  if has('sv_') or has('rcon_') or has('steam_') or has('mysql_') then
    for i = 1, #CONVAR_PATTERNS do out = out:gsub(CONVAR_PATTERNS[i], '%1%2[redacted]') end
  end

  -- Cfx.re license keys
  if has('cfxk_') then out = out:gsub('cfxk_[%w_]+', 'cfxk_[redacted]') end

  -- our own server keys, link secrets and assistant keys (dirk_ + 40 is no resource name)
  if has('dsk_') then
    out = out:gsub('%f[%w](dsk)_([%w_%-]+)', function(p, rest) if #rest >= 20 then return p .. '_[redacted]' end end)
  end
  if has('lnk_') then
    out = out:gsub('%f[%w](lnk)_([%w_%-]+)', function(p, rest) if #rest >= 20 then return p .. '_[redacted]' end end)
  end
  if #s >= 45 and has('dirk_') then
    out = out:gsub('%f[%w](dirk)_([%w_%-]+)', function(p, rest) if #rest >= 40 then return p .. '_[redacted]' end end)
  end

  -- Discord webhooks: the id and token are the whole secret
  if has('webhooks/') then out = out:gsub(WEBHOOK, '%1[redacted]') end

  -- Authorization headers
  if has('bearer') or has('basic') then
    for i = 1, #AUTH_HEADERS do out = out:gsub(AUTH_HEADERS[i], '%1 [redacted]') end
  end

  -- JWTs and Discord bot tokens: three dot-separated base64url parts (20+, 6+, 20+).
  -- Only dotted runs, found from the start of each word (the frontier), so a
  -- long word is walked once rather than once per character.
  if #s >= 48 and has('.') then out = out:gsub('%f[%w_%-][%w_%-]+%.[%w_%-%.]*', function(run)
    local parts = {}
    for part in (run .. '.'):gmatch('([^%.]*)%.') do parts[#parts + 1] = part end
    local changed, i = false, 1
    while i <= #parts - 2 do
      if #parts[i] >= 20 and #parts[i + 1] >= 6 and #parts[i + 2] >= 20 then
        parts[i] = '[token]'
        table.remove(parts, i + 2)
        table.remove(parts, i + 1)
        changed = true
      end
      i = i + 1
    end
    if changed then return table.concat(parts, '.') end
  end) end

  -- user:password@ inside a URL
  if has('://') then out = out:gsub('(://)[^%s:@/]+:[^%s@/]+@', '%1[redacted]@') end

  for i = 1, #KEY_PATTERNS do
    if has(KEY_GUARDS[i]) then out = out:gsub(KEY_PATTERNS[i], '%1%2[redacted]') end
  end
  if has(':') then
    for i = 1, #ID_PATTERNS do
      if has(ID_PREFIXES[i] .. ':') then out = out:gsub(ID_PATTERNS[i], '%1:[redacted]') end
    end
  end

  if out:find('%d%.%d') then out = redactIPv4(out) end
  -- `%x:` can only start right before a colon, so this pre-check is linear too
  if has('::') or out:find('%x:%x+:%x+:%x+:%x') then out = redactIPv6(out) end
  return out
end

--- M.redact over every string in a value (values, not keys). Returns a copy.
function M.redactDeep(value, depth)
  depth = depth or 0
  if type(value) == 'string' then return M.redact(value) end
  if type(value) ~= 'table' or depth > 20 then return value end
  local out = {}
  for k, v in pairs(value) do out[k] = M.redactDeep(v, depth + 1) end
  return out
end

-- ─── the console ─────────────────────────────────────────────────────────────

--- FXServer's colour codes: ANSI escapes (the channel tags) and ^0-^9 (prints).
--- The escape byte itself sometimes goes missing on the way through a log, so a
--- bare `[38;5;81m` goes too.
function M.stripColours(s)
  return (s:gsub('\27%[[%d;]*m', ''):gsub('%[%d[%d;]*m', ''):gsub('%^%d', ''))
end

--- GetConsoleBuffer's text as the newest `keep` lines, oldest first: colours
--- stripped, each line cut to LINE_MAX and redacted.
---@param pause fun()? called every few lines, so the server can yield (`Wait(0)`) mid-way
function M.consoleLines(buffer, keep, pause)
  keep = keep or M.CONSOLE_KEEP
  if type(buffer) ~= 'string' or buffer == '' then return {} end

  local all = {}
  for line in (buffer:gsub('\r', '') .. '\n'):gmatch('([^\n]*)\n') do
    if line:find('%S') then all[#all + 1] = line end
  end

  local out = {}
  for i = math.max(1, #all - keep + 1), #all do
    local line = M.stripColours(all[i])
    if #line > M.LINE_MAX then line = line:sub(1, M.LINE_MAX) end
    out[#out + 1] = M.redact(line)
    if pause and #out % 50 == 0 then pause() end
  end
  return out
end

--- The console cuts a channel name to fit its column (`[script:dirk_traphous]`
--- is dirk_traphouses), so a tag is matched against the names we know.
local function resolveResource(tag, known)
  if not tag then return nil end
  if known then
    if known[tag] then return tag end
    local found
    for name in pairs(known) do
      if name:sub(1, #tag) == tag then
        if found then return tag end -- two candidates: keep what the console said
        found = name
      end
    end
    if found then return found end
  end
  return tag
end

local function isDirk(name)
  return type(name) == 'string' and name:lower():sub(1, 5) == 'dirk_'
end

--- Problems only the console can show: script errors from dirk_ resources, a
--- dirk_ resource that could not start, a dependency FXServer could not find.
--- Repeats are folded into one problem with a count, in the order first seen.
---@param lines string[] cleaned console lines (M.consoleLines)
---@param known table<string, true>? resource names on the server, to undo the console's truncation
function M.consoleProblems(lines, known)
  local list, byKey = {}, {}
  local extra = 0

  local function add(level, kind, resource, message)
    local key = kind .. '\0' .. message
    local found = byKey[key]
    if found then
      found.count = (found.count or 1) + 1
      return
    end
    if #list >= M.MAX_CONSOLE_PROBLEMS then
      extra = extra + 1
      return
    end
    local problem = { level = level, kind = kind, resource = resource, message = message }
    byKey[key] = problem
    list[#list + 1] = problem
  end

  for i = 1, #(lines or {}) do
    local line = lines[i]
    local tag = line:match('^%[%s*script:([^%]]+)%]')
    local body = tag and line:gsub('^%[[^%]]*%]%s*', '', 1) or line
    local channel = resolveResource(tag, known)

    local scriptError = body:match('SCRIPT ERROR:.*')
    if scriptError then
      local fromPath = scriptError:match('@([%w_%-]+)/')
      local resource = (isDirk(channel) and channel) or (isDirk(fromPath) and fromPath) or nil
      if resource then add('error', 'script_error', resource, scriptError) end
    elseif body:match('^%[ERROR%]') then
      -- lib.print.error: the script reporting something it could not do.
      -- GetConsoleBuffer keeps the text but NOT the `[script:…]` channel, so
      -- without one the line has to name a dirk_ resource itself to count.
      local resource = isDirk(channel) and channel or nil
      if not resource and not tag then
        local named = body:match('(dirk_[%w_%-]+)')
        resource = named and resolveResource(named, known) or nil
      end
      if resource then add('warning', 'other', resource, (body:gsub('^%[ERROR%]%s*', 'Reported: '))) end
    else
      local failed = line:match("Couldn't start resource ([%w_%-]+)")
      if isDirk(failed) then
        add('error', 'other', failed, ("%s couldn't start (see the console around it)."):format(failed))
      end
      local dep, forResource = line:match('Could not find dependency (%S+) for resource ([%w_%-]+)')
      if dep and isDirk(forResource) then
        dep = dep:gsub('%.$', '')
        add('error', 'missing_dependency', dep,
          ('%s needs %s, which FXServer could not find.'):format(forResource, dep))
      end
    end
  end

  if extra > 0 then
    list[#list + 1] = {
      level = 'info', kind = 'other',
      message = ('%d more distinct console problem%s not listed.'):format(extra, extra == 1 and '' or 's'),
    }
  end
  return list
end

-- ─── problems ────────────────────────────────────────────────────────────────

local RUNNING = { started = true, starting = true }

--- "Problems found": what only the server knows. The site adds what the
--- versions and states say on their own and sorts them, so this list does not
--- need to be ordered - but it is, errors first, so it reads well raw too.
---@param facts table the gathered facts (see M.build)
function M.problems(facts)
  local list = {}
  local function add(p) list[#list + 1] = p end

  -- dependencies: anything a started dirk script or a bridge needs that isn't running
  for _, dep in ipairs(facts.dependencies or {}) do
    if dep.state and not RUNNING[dep.state] then
      local needed = type(dep.neededBy) == 'table' and #dep.neededBy > 0
        and (' (needed by %s)'):format(table.concat(dep.neededBy, ', ')) or ''
      add({
        level = 'error', kind = 'missing_dependency', resource = dep.name,
        message = dep.state == 'missing'
          and ("%s isn't on the server%s."):format(dep.name, needed)
          or ('%s is installed but %s%s.'):format(dep.name, dep.state, needed),
      })
    end
  end

  -- bridges: no framework is fatal, no inventory or target breaks most scripts
  local bridges = facts.bridges or {}
  local function none(v) return v == nil or v == false or v == '' or v == 'none' end
  if none(bridges.framework) then
    add({ level = 'error', kind = 'no_bridge', resource = 'framework',
      message = 'dirk_lib found no framework (qbx_core, qb-core, es_extended, ND_Core). Pick one in /dirk_config → Bridges.' })
  end
  for _, cat in ipairs({ 'inventory', 'target' }) do
    if none(bridges[cat]) then
      add({ level = 'warning', kind = 'no_bridge', resource = cat,
        message = ('dirk_lib found no %s resource.'):format(cat) })
    end
  end

  -- dirk scripts that are not running
  for _, script in ipairs(facts.scripts or {}) do
    local state = script.state
    if state and not RUNNING[state] then
      if facts.requested and script.name == facts.requested then
        add({ level = 'error', kind = 'other', resource = script.name,
          message = ('%s, the script this request is about, is %s.'):format(script.name, state) })
      elseif state == 'stopped' then
        add({ level = 'info', kind = 'other', resource = script.name,
          message = ('%s is on the server but stopped.'):format(script.name) })
      else
        add({ level = 'warning', kind = 'other', resource = script.name,
          message = ('%s is %s.'):format(script.name, state) })
      end
    end
  end
  if facts.requested and not facts.requestedFound then
    add({ level = 'warning', kind = 'other', resource = facts.requested,
      message = ("%s, the script this request is about, isn't on the server."):format(facts.requested) })
  end

  for _, p in ipairs(facts.consoleProblems or {}) do add(p) end

  local rank = { error = 0, warning = 1, info = 2 }
  for i, p in ipairs(list) do p._i = i end
  table.sort(list, function(a, b)
    local ra, rb = rank[a.level] or 1, rank[b.level] or 1
    if ra ~= rb then return ra < rb end
    return a._i < b._i
  end)
  for _, p in ipairs(list) do p._i = nil end
  return list
end

-- ─── Script Studio overrides ─────────────────────────────────────────────────

--- Setting names that are secret whatever the schema says. Only a non-empty
--- STRING is blanked by name: `webhookEnabled = true` is worth seeing.
local SECRET_NAMES = { 'token', 'secret', 'password', 'passwd', 'webhook', 'apikey', 'api_key', 'licensekey', 'connectionstring' }

local function secretByName(name)
  if type(name) ~= 'string' then return false end
  local lower = name:lower()
  for i = 1, #SECRET_NAMES do
    if lower:find(SECRET_NAMES[i], 1, true) then return true end
  end
  return false
end

local function isSecretControl(v)
  if v == 'secret' then return true end
  return type(v) == 'table' and (v.control == 'secret' or v['x-control'] == 'secret')
end

--- Which settings a schema marks secret: `x-control: "secret"` (the Studio's
--- masked input), `x-secret`, `format: "password"`, and row fields declared
--- secret through `x-rowControls` or an item schema.
---@return { paths: table<string, true>, rowKeys: table<string, table<string, true>> }
function M.secretSpec(schema)
  local spec = { paths = {}, rowKeys = {} }

  local function rowKey(path, key)
    spec.rowKeys[path] = spec.rowKeys[path] or {}
    spec.rowKeys[path][key] = true
  end

  local function walk(node, path, depth)
    if type(node) ~= 'table' or depth > 30 then return end
    if path and (isSecretControl(node['x-control']) or node['x-secret'] or node.format == 'password') then
      spec.paths[path] = true
    end
    if path and type(node['x-rowControls']) == 'table' then
      for key, control in pairs(node['x-rowControls']) do
        if isSecretControl(control) then rowKey(path, key) end
      end
    end
    if type(node.properties) == 'table' then
      for key, child in pairs(node.properties) do
        walk(child, path and (path .. '.' .. key) or key, depth + 1)
      end
    end
    -- a list's rows (and a map's values) are stored under the list's own path,
    -- so a secret field inside a row is a secret KEY of that path's value
    for pass = 1, 2 do
      local rowSchema = pass == 1 and node.items or node.additionalProperties
      if path and type(rowSchema) == 'table' and type(rowSchema.properties) == 'table' then
        for key, child in pairs(rowSchema.properties) do
          if type(child) == 'table' and (isSecretControl(child['x-control']) or child['x-secret'] or child.format == 'password') then
            rowKey(path, key)
          end
        end
      end
    end
  end

  walk(schema, nil, 0)
  return spec
end

local function blank(v)
  if v == nil or v == '' then return v end
  return '[redacted]'
end

--- One override's value with its secrets blanked: the whole value when its path
--- (or a parent) is secret, else any secret field inside it.
local function redactOverride(path, value, spec)
  local probe = path
  while probe do
    if spec.paths[probe] then return blank(value) end
    probe = probe:match('^(.*)%.[^%.]+$')
  end
  local leaf = path:match('([^%.]+)$')
  if type(value) == 'string' and secretByName(leaf) then return blank(value) end

  local function walk(v, at, rowKeys, depth)
    if type(v) ~= 'table' or depth > 20 then return v end
    local out = {}
    for k, child in pairs(v) do
      local childPath = type(k) == 'string' and (at .. '.' .. k) or at
      if type(k) == 'string' and (spec.paths[childPath] or (rowKeys and rowKeys[k])) then
        out[k] = blank(child)
      elseif type(k) == 'string' and type(child) == 'string' and secretByName(k) then
        out[k] = blank(child)
      elseif type(k) == 'number' then
        -- a row of a list: its fields are the list's row keys
        out[k] = walk(child, at, spec.rowKeys[at], depth + 1)
      else
        out[k] = walk(child, childPath, spec.rowKeys[childPath], depth + 1)
      end
    end
    return out
  end

  return walk(value, path, spec.rowKeys[path], 0)
end

--- The rows of `dirk_scriptConfig_overrides` for one script as path → value,
--- secrets blanked, capped at MAX_OVERRIDES. `rows` are { path, value } with
--- the value already decoded.
function M.overrides(rows, spec)
  spec = spec or { paths = {}, rowKeys = {} }
  local out, n = {}, 0
  for i = 1, #(rows or {}) do
    local row = rows[i]
    if type(row) == 'table' and type(row.path) == 'string' and row.path ~= '' and n < M.MAX_OVERRIDES then
      n = n + 1
      local value = redactOverride(row.path, row.value, spec)
      -- a value Lua can't hold (JSON null) still says "this was set"
      if value == nil then value = false end
      out[row.path] = value
    end
  end
  return out, n
end

-- ─── the bundle ──────────────────────────────────────────────────────────────

local function resourceRows(list)
  local out = {}
  for i = 1, #(list or {}) do
    local r = list[i]
    out[#out + 1] = { name = r.name, version = r.version, state = r.state }
  end
  return out
end

--- The bundle the site's POST /api/servers/bundle takes, from gathered facts:
---   collectedAt, server{}, lib{ version, language }, scripts[], dependencies[]
---   (with neededBy), bridges{}, ui{}, requested, requestedFound, studio?,
---   console[] (already cleaned), consoleProblems[]
--- Every string in it is redacted. The console is taken as M.consoleLines left
--- it (already redacted, line by line), so it isn't walked a second time.
function M.build(facts)
  local bundle = M.redactDeep({
    version = 1,
    collectedAt = facts.collectedAt,
    server = facts.server or {},
    lib = { version = facts.lib and facts.lib.version or 'unknown', language = facts.lib and facts.lib.language },
    scripts = resourceRows(facts.scripts),
    dependencies = resourceRows(facts.dependencies),
    bridges = facts.bridges or {},
    ui = facts.ui or {},
    problems = M.problems(facts),
    studio = facts.studio,
  })
  bundle.console = facts.console or {}
  return bundle
end

--- Encode the upload under the size cap, giving up the oldest console lines
--- first, then the Studio overrides. Returns the JSON text and how many console
--- lines had to go.
---   a request id (string)  → `{ requestId, bundle }`, the answer to a check-in's request
---   `{ ticketId = … }`      → `{ ticketId, bundle }`, sent by hand to an open ticket
---@param target string|{ ticketId: string }
---@param encode fun(v: any): string json.encode
function M.encode(target, bundle, encode, maxBytes)
  maxBytes = maxBytes or M.MAX_BYTES
  local function wrap()
    if type(target) == 'table' then return encode({ ticketId = target.ticketId, bundle = bundle }) end
    return encode({ requestId = target, bundle = bundle })
  end
  local body = wrap()
  local dropped = 0

  local console = bundle.console or {}
  while #body > maxBytes and #console > 0 do
    -- cut in proportion to the overshoot, at least a tenth, so it converges in a few passes
    local over = #body - maxBytes
    local avg = math.max(1, math.floor(#body / math.max(1, #console + 20)))
    local cut = math.min(#console, math.max(math.ceil(#console / 10), math.ceil(over / avg)))
    local kept = {}
    for i = cut + 1, #console do kept[#kept + 1] = console[i] end
    dropped = dropped + cut
    console = kept
    bundle.console = console
    body = wrap()
  end

  if #body > maxBytes and bundle.studio then
    bundle.studio = { script = bundle.studio.script, overrides = {} }
    body = wrap()
  end

  return body, dropped
end

-- ─── the check-in's script list ──────────────────────────────────────────────

--- The most scripts a check-in lists (the site keeps 100).
M.MAX_SCRIPTS = 100

--- The server's dirk_ resources as the check-in (and the bundle) list them:
--- `{ name, version, state }`, A-Z, at most MAX_SCRIPTS. The site shows them in
--- Account → Linked servers, marked against our releases.
---@param names string[] every resource on the server
---@param versionOf fun(name: string): string? its fxmanifest version
---@param stateOf fun(name: string): string GetResourceState
function M.scriptRows(names, versionOf, stateOf)
  local rows = {}
  for i = 1, #(names or {}) do
    local name = names[i]
    if isDirk(name) then rows[#rows + 1] = { name = name, version = versionOf(name), state = stateOf(name) } end
  end
  table.sort(rows, function(a, b) return a.name < b.name end)
  for i = #rows, M.MAX_SCRIPTS + 1, -1 do rows[i] = nil end
  return rows
end

-- ─── the account ─────────────────────────────────────────────────────────────

--- The site's picture link for the account, or nil: an https url and nothing else.
function M.avatarUrl(v)
  if type(v) ~= 'string' or #v > 512 or not v:match('^https://[%w%.%-]+/') then return nil end
  return v
end

--- Fold a check-in's `account { name, avatar }` into the stored link. Returns
--- true when the name or picture changed (the caller writes it back).
function M.mergeAccount(link, account)
  if type(link) ~= 'table' or type(account) ~= 'table' then return false end
  local name = type(account.name) == 'string' and account.name ~= '' and account.name:sub(1, 64) or link.account
  local avatar = M.avatarUrl(account.avatar)
  if name == link.account and avatar == link.avatar then return false end
  link.account, link.avatar = name, avatar
  return true
end

-- ─── sending one by hand ─────────────────────────────────────────────────────

--- The resource a request or ticket is about, for its Script Studio settings:
--- `script.resource`, or a `script.name` that is itself a dirk_ resource.
---@param script { name: string?, resource: string? }?
---@return string?
function M.scriptResource(script)
  if type(script) ~= 'table' then return nil end
  if type(script.resource) == 'string' and script.resource:match('^[%w_%-]+$') then return script.resource end
  if type(script.name) == 'string' and script.name:match('^dirk_[%w_%-]+$') then return script.name end
  return nil
end

--- The most tickets the picker shows (the site sends at most 20).
M.MAX_TICKETS = 20

--- The site's GET /api/servers/tickets answer as the picker's rows: only
--- well-formed tickets, only the fields the panel draws, at most MAX_TICKETS.
--- An empty list may arrive as {} (Lua) or [] (JSON); both are "none".
---@return { id: string, number: integer?, subject: string, script: { name: string?, resource: string? }?, updatedAt: string? }[]
function M.ticketChoices(list)
  local out = {}
  if type(list) ~= 'table' then return out end
  for i = 1, #list do
    local t = list[i]
    if #out >= M.MAX_TICKETS then break end
    if type(t) == 'table' and type(t.id) == 'string' and t.id ~= '' and #t.id <= 64 then
      local script = type(t.script) == 'table' and {
        name = type(t.script.name) == 'string' and t.script.name or nil,
        resource = type(t.script.resource) == 'string' and t.script.resource or nil,
      } or nil
      out[#out + 1] = {
        id = t.id,
        number = tonumber(t.number or '') and math.tointeger(tonumber(t.number)) or nil,
        subject = type(t.subject) == 'string' and t.subject:sub(1, 120) or '',
        script = script,
        updatedAt = type(t.updatedAt) == 'string' and t.updatedAt or nil,
      }
    end
  end
  return out
end

--- What the panel says about a sent bundle, from the site's answer to it.
---@param status integer HTTP status (0 = never answered)
---@param data table? the decoded answer
---@return { ok: boolean, summary: string?, error: string?, message: string? }
function M.sendResult(status, data)
  data = type(data) == 'table' and data or {}
  if status == 200 then return { ok = true, summary = type(data.summary) == 'string' and data.summary or nil } end
  local code = ({
    [0] = 'unreachable', [401] = 'revoked', [404] = 'notFound', [409] = 'closed', [413] = 'tooLarge', [429] = 'tooSoon',
  })[status] or (status >= 500 and 'unreachable' or 'refused')
  return { ok = false, error = code, message = type(data.error) == 'string' and data.error or nil }
end

return M
