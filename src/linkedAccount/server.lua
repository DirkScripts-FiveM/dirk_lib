-- ─────────────────────────────────────────────────────────────────────────────
-- Linked account: this server, linked to a DirkScripts account.
--
-- Linking happens ONLY from /dirk_config → Linked account, and only for someone
-- who may edit dirk_lib's own settings (the same check the panel uses; every
-- callback below asks it again - the NUI is never trusted). It is the device-code
-- flow the site already runs:
--
--   POST /api/link/start   → a short code for a human + a poll secret for us
--   the owner approves at dirkscripts.com/link?code=…, signed in
--   POST /api/link/poll    → pending … then, once, the server's key (dsk_…)
--
-- The key lives in THIS resource's server KVP and nowhere else: never in a
-- client event, never in the NUI, never in an export. With it the server checks
-- in about once a minute (GET /api/servers/checkin) and answers any support
-- bundle request it is handed (POST /api/servers/bundle). A 401 from either -
-- the owner unlinked it on the website - forgets the key.
--
-- The bundle itself is built by src/linkedAccount/support.lua from facts read
-- here. Nothing is sent unless the owner switched support bundles on for this
-- server in their account; the site says so in every check-in.
-- ─────────────────────────────────────────────────────────────────────────────

local support = require '@dirk_lib.src.linkedAccount.support'

local KVP_KEY = 'dirk_lib:linkedAccount'
local DEFAULT_HOST = 'https://www.dirkscripts.com'
local POLL_EVERY_MS = 4000
local HTTP_TIMEOUT_MS = 20000

--- Where to link. A convar only so a dev can point a test server at a local
--- copy of the site; the key is stored WITH the host it came from and only
--- ever sent back there, so changing this later cannot redirect a live key.
local function linkHost()
  local host = GetConvar('dirk_lib_link_host', DEFAULT_HOST):gsub('/+$', '')
  if not host:match('^https?://') then return DEFAULT_HOST end
  return host
end

-- ─── state ───────────────────────────────────────────────────────────────────

---@type { code: string, verifyUrl: string, pollSecret: string, expiresAt: number, host: string, serverName: string?, by: string? }?
local pending = nil
--- why the last attempt ended, for the panel: 'expired' | 'revoked' | 'unreachable' | 'refused'
local lastError = nil
local lastCheckin = nil   -- { at, ok, support }
local lastBundle = nil    -- { at, ok, summary, ticket }
local answered = {}       -- requestId → true, so a request is never sent twice
local checkingIn = false
--- the open tickets the panel was last shown (id → ticket), so "send" only goes to one of them
local offered = {}
local sendingByHand = false

local function readLink()
  local raw = GetResourceKvpString(KVP_KEY)
  if not raw or raw == '' then return nil end
  local ok, data = pcall(json.decode, raw)
  if not ok or type(data) ~= 'table' or type(data.key) ~= 'string' or data.key:sub(1, 4) ~= 'dsk_' then return nil end
  return data
end

local function writeLink(data)
  SetResourceKvp(KVP_KEY, json.encode(data))
end

local function forgetLink()
  DeleteResourceKvp(KVP_KEY)
  lastCheckin, lastBundle, answered, offered = nil, nil, {}, {}
end

local function serverName()
  local name = GetConvar('sv_projectName', '')
  if name == '' then name = GetConvar('sv_hostname', '') end
  name = support.stripColours(name):gsub('^%s+', ''):gsub('%s+$', '')
  if name == '' then name = 'FiveM server' end
  return name:sub(1, 80)
end

local function logEvent(src, event, message)
  pcall(function()
    exports.dirk_lib:logger_emit(src, event, message, 'level:warn')
  end)
end

-- ─── HTTP ────────────────────────────────────────────────────────────────────

--- One request, awaited. `body` is a table (encoded here) or ready JSON text.
--- Returns the status (0 = never answered) and the decoded answer, if any.
local function request(method, host, path, body, key)
  local p, settled = promise.new(), false
  local function settle(result)
    if settled then return end
    settled = true
    p:resolve(result)
  end
  local headers = { ['Content-Type'] = 'application/json', ['Accept'] = 'application/json' }
  if key then headers['Authorization'] = 'Bearer ' .. key end
  local payload = body == nil and '' or (type(body) == 'string' and body or json.encode(body))

  PerformHttpRequest(host .. path, function(status, text, _, errorData)
    settle({ status = status or 0, text = text or errorData })
  end, method, payload, headers)
  SetTimeout(HTTP_TIMEOUT_MS, function() settle({ status = 0 }) end)

  local result = Citizen.Await(p)
  local data
  if type(result.text) == 'string' and result.text ~= '' then
    local ok, decoded = pcall(json.decode, result.text)
    if ok then data = decoded end
  end
  return tonumber(result.status) or 0, type(data) == 'table' and data or nil
end

-- ─── gathering the facts ─────────────────────────────────────────────────────

local RUNNING = { started = true, starting = true }

local BRIDGES = {
  'framework', 'inventory', 'target', 'interact', 'time', 'keys', 'fuel', 'phone', 'garage',
  'clothing', 'ambulance', 'prison', 'dispatch', 'doorlock', 'skills', 'housing',
}
local UI = { 'notify', 'progress', 'showTextUI', 'contextMenu', 'alertDialog', 'inputDialog', 'dialog' }

local function allResources()
  local out = {}
  for i = 0, GetNumResources() - 1 do
    local name = GetResourceByFindIndex(i)
    if name then out[#out + 1] = name end
  end
  return out
end

local function versionOf(name)
  local v = GetResourceMetadata(name, 'version', 0)
  return (v and v ~= '') and v or nil
end

--- A resource's declared dependencies: its `dependency` metadata, or read from
--- the manifest text when the metadata comes back empty.
local function dependenciesOf(name)
  local out = {}
  local count = GetNumResourceMetadata(name, 'dependency') or 0
  for i = 0, count - 1 do
    local dep = GetResourceMetadata(name, 'dependency', i)
    if dep then out[#out + 1] = dep end
  end
  if #out == 0 then
    local manifest = LoadResourceFile(name, 'fxmanifest.lua') or LoadResourceFile(name, '__resource.lua') or ''
    for block in manifest:gmatch('dependencies%s*%{(.-)%}') do
      for dep in block:gmatch("['\"]([^'\"]+)['\"]") do out[#out + 1] = dep end
    end
    for dep in manifest:gmatch("dependency%s*%(?%s*['\"]([^'\"]+)['\"]") do out[#out + 1] = dep end
  end
  local real = {}
  for i = 1, #out do
    -- `/server:7290`, `/onesync`, `/gameBuild:…` are server features, not resources
    if out[i]:sub(1, 1) ~= '/' then real[#real + 1] = out[i] end
  end
  return real
end

local function isNone(v)
  return v == nil or v == false or v == '' or v == 'auto' or v == 'none' or v == 'NOT FOUND'
end

--- The bridges dirk_lib picked, as the site wants them: a name, or false for none.
local function bridgeChoices()
  local settings = lib.settings or {}
  local bridges, ui = {}, {}
  for _, cat in ipairs(BRIDGES) do
    local v = settings[cat]
    bridges[cat] = (type(v) == 'string' and not isNone(v)) and v or false
  end
  for _, key in ipairs(UI) do
    local v = settings[key]
    ui[key] = (type(v) == 'string' and not isNone(v)) and v or false
  end
  return bridges, ui
end

--- The requested script's Script Studio overrides (what differs from default), secrets blanked.
local function studioOverrides(resource)
  if not resource or GetResourceState(resource) == 'missing' then return nil end
  local tagged = false
  for i = 0, (GetNumResourceMetadata(resource, 'dirk_lib') or 0) - 1 do
    if GetResourceMetadata(resource, 'dirk_lib', i) == 'scriptConfig' then tagged = true break end
  end
  if not tagged then return nil end

  local ok, rows = pcall(MySQL.query.await,
    'SELECT path, value FROM dirk_scriptConfig_overrides WHERE script = ? ORDER BY path LIMIT ?',
    { resource, support.MAX_OVERRIDES + 1 })
  if not ok or type(rows) ~= 'table' then return nil end

  local decoded = {}
  for i = 1, #rows do
    local row = rows[i]
    local okValue, value = pcall(json.decode, row.value or 'null')
    decoded[#decoded + 1] = { path = row.path, value = okValue and value or row.value }
  end

  local spec
  Wait(0) -- a big schema is a quarter of a megabyte of JSON; give it a frame of its own
  local rawSchema = LoadResourceFile(resource, 'schema.json')
  if rawSchema then
    local okSchema, schema = pcall(json.decode, rawSchema)
    if okSchema and type(schema) == 'table' then spec = support.secretSpec(schema) end
  end

  return { script = resource, overrides = (support.overrides(decoded, spec)) }
end

--- Everything the bundle says, read from the running server.
---@param requested string? the resource the request is about
local function gatherFacts(requested)
  local names = allResources()
  local known, scripts = {}, {}
  for i = 1, #names do
    local name = names[i]
    known[name] = true
    if name:lower():sub(1, 5) == 'dirk_' then
      scripts[#scripts + 1] = { name = name, version = versionOf(name), state = GetResourceState(name) }
    end
  end
  table.sort(scripts, function(a, b) return a.name < b.name end)

  -- dependencies: what the running dirk scripts declare, plus each bridge resource
  local deps, depIndex = {}, {}
  local function need(dep, by)
    local row = depIndex[dep]
    if not row then
      local state = GetResourceState(dep)
      row = { name = dep, state = state, version = RUNNING[state] and versionOf(dep) or nil, neededBy = {} }
      depIndex[dep] = row
      deps[#deps + 1] = row
    end
    for i = 1, #row.neededBy do if row.neededBy[i] == by then return end end
    if #row.neededBy < 6 then row.neededBy[#row.neededBy + 1] = by end
  end

  for i = 1, #scripts do
    local s = scripts[i]
    if RUNNING[s.state] then
      for _, dep in ipairs(dependenciesOf(s.name)) do
        if dep:lower():sub(1, 5) ~= 'dirk_' then need(dep, s.name) end
      end
    end
  end

  local bridges, ui = bridgeChoices()
  for _, cat in ipairs(BRIDGES) do
    if bridges[cat] then need(bridges[cat], ('dirk_lib %s bridge'):format(cat)) end
  end
  -- ox_lib is the one everyone asks about; say so when it's there even if nothing declared it
  if not depIndex.ox_lib and GetResourceState('ox_lib') ~= 'missing' then need('ox_lib', 'installed') end
  table.sort(deps, function(a, b) return a.name < b.name end)

  local fx = GetConvar('version', '')
  local txadmin = GetConvar('txAdmin-version', '')
  if txadmin == '' then txadmin = versionOf('monitor') or '' end

  -- redacting 400 lines is real work: yield every 50 so it never lands in one server frame
  local console = support.consoleLines(GetConsoleBuffer and GetConsoleBuffer() or '', support.CONSOLE_KEEP,
    function() Wait(0) end)

  return {
    collectedAt = os.date('!%Y-%m-%dT%H:%M:%SZ'),
    server = {
      name = serverName(),
      fxserver = fx ~= '' and fx or nil,
      txadmin = txadmin ~= '' and txadmin or nil,
      onesync = GetConvar('onesync', 'off'),
      gameBuild = GetConvar('sv_enforceGameBuild', '') ~= '' and GetConvar('sv_enforceGameBuild', '') or nil,
      uptime = math.floor(GetGameTimer() / 1000),
      players = #GetPlayers(),
      maxPlayers = GetConvarInt('sv_maxclients', 0),
      resources = #names,
      os = fx:find('win32', 1, true) and 'windows' or (fx:find('linux', 1, true) and 'linux' or nil),
    },
    lib = { version = versionOf('dirk_lib') or 'unknown', language = lib.settings and lib.settings.language or nil },
    scripts = scripts,
    dependencies = deps,
    bridges = bridges,
    ui = ui,
    requested = requested,
    requestedFound = requested and known[requested] or nil,
    studio = studioOverrides(requested),
    console = console,
    consoleProblems = support.consoleProblems(console, known),
  }
end

-- ─── check-in and bundles ────────────────────────────────────────────────────

local function sendBundle(link, req)
  local bundle = support.build(gatherFacts(support.scriptResource(req.script)))
  local body, dropped = support.encode(req.id, bundle, json.encode)
  local status, data = request('POST', link.host, '/api/servers/bundle', body, link.key)

  local ticket = type(req.ticket) == 'table' and req.ticket.number or nil
  if status == 0 or status >= 500 then
    -- the site is down or never answered: the request is still open, try next check-in
    lastBundle = { at = os.time(), ok = false, ticket = ticket }
    return
  end

  answered[req.id] = true
  lastBundle = { at = os.time(), ok = status == 200, ticket = ticket, summary = data and data.summary or nil }
  if status == 200 then
    lib.print.info(('[linked account] Sent a support bundle%s%s.'):format(
      ticket and (' for ticket #' .. tostring(ticket)) or '',
      dropped > 0 and (' (%d oldest console lines left out to fit)'):format(dropped) or ''))
  elseif status ~= 409 then
    lib.print.warn(('[linked account] The site refused a support bundle (HTTP %d): %s'):format(
      status, data and json.encode(data.issues or data.error) or '?'))
  end
end

--- One check-in. Returns how long to wait before the next, in seconds.
local function checkIn()
  local link = readLink()
  if not link or checkingIn then return 60 end
  checkingIn = true

  local ok, wait = pcall(function()
    local status, data = request('GET', link.host, '/api/servers/checkin', nil, link.key)

    if status == 401 then
      forgetLink()
      lastError = 'revoked'
      lib.print.warn('[linked account] This server was unlinked from its DirkScripts account on the website. Link it again from /dirk_config if you meant to keep it.')
      return 60
    end
    if status ~= 200 or not data then
      lastCheckin = { at = os.time(), ok = false, support = lastCheckin and lastCheckin.support or false }
      return 60
    end

    lastCheckin = { at = os.time(), ok = true, support = data.support == true }
    if data.support == true and type(data.requests) == 'table' then
      for _, req in ipairs(data.requests) do
        if type(req) == 'table' and type(req.id) == 'string' and not answered[req.id] then
          local sent, err = pcall(sendBundle, link, req)
          if not sent then lib.print.error(('[linked account] Could not build a support bundle: %s'):format(err)) end
        end
      end
    end
    return tonumber(data.pollSeconds) or 60
  end)

  checkingIn = false
  if not ok then
    lib.print.error(('[linked account] Check-in failed: %s'):format(wait))
    return 60
  end
  return math.max(30, math.min(tonumber(wait) or 60, 600))
end

CreateThread(function()
  -- let everything else start first: the first bundle should see a finished boot
  Wait(20000)
  while true do
    local wait = readLink() and checkIn() or 60
    Wait(wait * 1000)
  end
end)

-- ─── linking ─────────────────────────────────────────────────────────────────

local function pollUntilDone(mine)
  CreateThread(function()
    while pending == mine and os.time() < mine.expiresAt do
      Wait(POLL_EVERY_MS)
      if pending ~= mine then return end

      local status, data = request('POST', mine.host, '/api/link/poll', { pollSecret = mine.pollSecret })
      if pending ~= mine then return end

      if status == 200 and data and data.status == 'approved' and type(data.key) == 'string' and data.key:sub(1, 4) == 'dsk_' then
        writeLink({
          key = data.key,
          host = mine.host,
          account = type(data.account) == 'string' and data.account or nil,
          serverName = mine.serverName,
          linkedAt = os.time(),
          linkedBy = mine.by,
        })
        pending, lastError, answered = nil, nil, {}
        lib.print.info(('[linked account] Linked to DirkScripts%s.'):format(
          type(data.account) == 'string' and (' account ' .. data.account) or ''))
        logEvent(0, 'link:linked', ('Server linked to DirkScripts account %s (started by %s)'):format(
          tostring(data.account or '?'), tostring(mine.by or '?')))
        CreateThread(checkIn)
        return
      elseif status == 404 or status == 410 then
        pending, lastError = nil, 'expired'
        return
      end
    end
    if pending == mine then pending, lastError = nil, 'expired' end
  end)
end

--- Who may see or change the link: an editor of dirk_lib's own settings, the
--- same check the panel's dirk_lib sections use. Asked on EVERY call.
local function allowed(src)
  if not src or src == 0 then return false end
  local ok, yes = pcall(function() return exports.dirk_lib:canEditScriptConfig(src, 'dirk_lib') end)
  return ok and yes == true
end

--- What the panel draws. No key, no poll secret: only what an admin needs to read.
local function status()
  local link = readLink()
  local now = os.time()
  if pending and now >= pending.expiresAt then pending, lastError = nil, 'expired' end
  return {
    linked = link ~= nil,
    account = link and link.account or nil,
    serverName = link and link.serverName or serverName(),
    linkedAt = link and link.linkedAt or nil,
    linkedBy = link and link.linkedBy or nil,
    checkin = link and lastCheckin or nil,
    bundle = link and lastBundle or nil,
    pending = (not link and pending) and {
      code = pending.code,
      verifyUrl = pending.verifyUrl,
      expiresIn = pending.expiresAt - now,
    } or nil,
    error = lastError,
  }
end

lib.callback.register('dirk_lib:link:status', function(source)
  if not allowed(source) then return nil, 'NotAuthorized' end
  return status()
end)

lib.callback.register('dirk_lib:link:start', function(source)
  if not allowed(source) then return nil, 'NotAuthorized' end
  if readLink() then return status() end
  if pending and os.time() < pending.expiresAt then return status() end

  local host = linkHost()
  local name = serverName()
  local code, data = request('POST', host, '/api/link/start', { serverName = name })
  if code ~= 200 or not data or type(data.code) ~= 'string' or type(data.pollSecret) ~= 'string' then
    lastError = code == 0 and 'unreachable' or 'refused'
    return status()
  end

  local mine = {
    code = data.code,
    verifyUrl = type(data.verifyUrl) == 'string' and data.verifyUrl or (host .. '/link?code=' .. data.code),
    pollSecret = data.pollSecret,
    expiresAt = os.time() + math.max(60, tonumber(data.expiresIn) or 600),
    host = host,
    serverName = name,
    by = GetPlayerName(source),
  }
  pending, lastError = mine, nil
  pollUntilDone(mine)
  return status()
end)

lib.callback.register('dirk_lib:link:cancel', function(source)
  if not allowed(source) then return nil, 'NotAuthorized' end
  pending, lastError = nil, nil
  return status()
end)

-- ─── sending a bundle by hand ─────────────────────────────────────────────────
-- /dirk_config → Linked account → "Send a support bundle": the admin picks one of
-- the account's open tickets and this server sends its bundle there. It works
-- with the support switch off - it's the owner choosing to send one - and the
-- site checks the ticket belongs to the account this key is linked to.

--- The account's open tickets, for the picker.
lib.callback.register('dirk_lib:link:tickets', function(source)
  if not allowed(source) then return nil, 'NotAuthorized' end
  local link = readLink()
  if not link then return { error = 'notLinked' } end

  local status, data = request('GET', link.host, '/api/servers/tickets', nil, link.key)
  if status == 401 then
    forgetLink()
    lastError = 'revoked'
    return { error = 'revoked' }
  end
  if status ~= 200 or not data then return { error = (status == 0 or status >= 500) and 'unreachable' or 'refused' } end

  local tickets = support.ticketChoices(data.tickets)
  offered = {}
  for i = 1, #tickets do offered[tickets[i].id] = tickets[i] end
  return {
    tickets = tickets,
    newTicketUrl = type(data.newTicketUrl) == 'string' and data.newTicketUrl or (link.host .. '/tickets?new=true'),
  }
end)

--- Send this server's bundle to one of the tickets the picker was just shown.
lib.callback.register('dirk_lib:link:send', function(source, ticketId)
  if not allowed(source) then return nil, 'NotAuthorized' end
  local link = readLink()
  if not link then return { ok = false, error = 'notLinked' } end
  local ticket = type(ticketId) == 'string' and offered[ticketId] or nil
  if not ticket then return { ok = false, error = 'notFound' } end
  if sendingByHand then return { ok = false, error = 'busy' } end

  sendingByHand = true
  local ok, result = pcall(function()
    local bundle = support.build(gatherFacts(support.scriptResource(ticket.script)))
    local body, dropped = support.encode({ ticketId = ticket.id }, bundle, json.encode)
    local status, data = request('POST', link.host, '/api/servers/bundle', body, link.key)
    local sent = support.sendResult(status, data)
    if status == 401 then
      forgetLink()
      lastError = 'revoked'
    end
    if sent.ok then
      sent.dropped = dropped
      lastBundle = { at = os.time(), ok = true, ticket = ticket.number, summary = sent.summary }
      lib.print.info(('[linked account] %s sent a support bundle to ticket #%s.'):format(GetPlayerName(source), tostring(ticket.number or ticket.id)))
      logEvent(source, 'link:bundle', ('%s sent a support bundle to ticket #%s'):format(GetPlayerName(source), tostring(ticket.number or ticket.id)))
    end
    return sent
  end)
  sendingByHand = false

  if not ok then
    lib.print.error(('[linked account] Could not build a support bundle: %s'):format(result))
    return { ok = false, error = 'failed' }
  end
  result.ticket = ticket.number
  return result
end)

lib.callback.register('dirk_lib:link:unlink', function(source)
  if not allowed(source) then return nil, 'NotAuthorized' end
  local link = readLink()
  if not link then return status() end

  -- Revoke on the site first so the key is dead everywhere, then forget it here
  -- whatever the answer: the owner asked for it gone, and a key we no longer
  -- hold can't be used. If the site was unreachable the panel says to remove
  -- it on the website too.
  local code = request('POST', link.host, '/api/servers/unlink', nil, link.key)
  forgetLink()
  pending = nil
  -- 401 is fine too: the key was already revoked on the website
  if code == 200 or code == 401 then lastError = nil else lastError = 'unlinkedLocally' end
  lib.print.info('[linked account] Unlinked from DirkScripts.')
  logEvent(source, 'link:unlinked', ('%s unlinked this server from DirkScripts account %s'):format(
    GetPlayerName(source), tostring(link.account or '?')))
  return status()
end)
