-- --------------------------------------------------
-- GLOBAL /dirk_config COMMAND
-- --------------------------------------------------
-- Scans every started resource for the `dirk_lib 'scriptConfig'` metadata tag,
-- verifies it has a schema.json at its root, and opens a chooser NUI on the
-- invoking admin. Selecting a resource fires `<resourceName>:openScriptConfig`,
-- which the injected scriptConfig client module handles inside that resource.
--
-- Access model:
--   • Master group lives in `dirk_lib_master_group` server convar (default
--     `group.admin`). Anyone with that ACE permission can always edit
--     anything. Convar > config so a bad save can't lock you out.
--   • `scriptConfig.overrides` (in dirk_lib's own scriptConfig) grants extra
--     access to non-master ACE groups or specific player identifiers per
--     resource. Purely additive — overrides cannot remove master access.

local function hasScriptConfigTag(resourceName)
  local count = GetNumResourceMetadata(resourceName, 'dirk_lib') or 0
  for i = 0, count - 1 do
    if GetResourceMetadata(resourceName, 'dirk_lib', i) == 'scriptConfig' then
      return true
    end
  end
  return false
end

-- ── Access helpers ────────────────────────────────────────────────────────

-- Master access is gated by a comma-separated list of values passed to
-- IsPlayerAceAllowed. ANY value that returns true grants master access.
-- Default `group.admin,admin` covers the two permissions most
-- server.cfgs grant to admins:
--   • `group.admin`  — principal membership (works when the cfg has
--                      `add_ace group.admin group.admin allow`)
--   • `admin`        — bare permission (works when the cfg has
--                      `add_ace group.admin admin allow`)
-- `command` is deliberately NOT in the default: admins already inherit it
-- via group.admin, and it's the one token an operator might grant to a
-- non-admin — including it would silently widen master access.
-- A server owner who locks down one of these can override via the
-- `dirk_lib_master_group` server convar with their own value(s).
local DEFAULT_MASTER = 'group.admin,admin'

local function getMasterGroup()
  local cv = GetConvar('dirk_lib_master_group', DEFAULT_MASTER)
  if cv == nil or cv == '' then return DEFAULT_MASTER end
  return cv
end

local scriptConfigAdmins = require '@dirk_lib.src.scriptConfig.admins'

local function isMasterEditor(src)
  for perm in (getMasterGroup()):gmatch('[^,]+') do
    perm = perm:match('^%s*(.-)%s*$')  -- trim whitespace around each value
    if perm ~= '' and IsPlayerAceAllowed(src, perm) then
      return true
    end
  end
  return false
end

-- (The central `scriptConfig.overrides` list was removed — config access is now
-- purely per-resource: each consumer ships its own `access` block and pushes it
-- via registerScriptConfigOverrides. Master access is unchanged.)

-- Resolve a player's match context ONCE per access check (or once per chooser
-- sweep — see collectRegisteredConfigs): their framework persistent id
-- (citizenid on qb/qbx, license on esx — what the PlayerSelect editor stores,
-- so grants made while a player was OFFLINE enforce the moment they join) plus
-- their raw FiveM identifiers (license:/discord:/steam:/… — what the legacy
-- central overrides UI stores). Resolving once avoids re-hitting the framework
-- + the native per resource when a single src is tested against many resources.
local function resolveMatchCtx(src)
  local citizenId
  local okId, resolved = pcall(function() return lib.player.identifier(src) end)
  if okId and type(resolved) == 'string' and resolved ~= '' then citizenId = resolved end
  return { citizenId = citizenId, ids = GetPlayerIdentifiers(src) or {} }
end

-- Does the stored access entry `wanted` match this player? Honours both the
-- framework persistent id and any raw FiveM identifier. `ctx` is from
-- resolveMatchCtx — the caller resolves it once and passes it in.
local function playerHasIdentifier(wanted, ctx)
  if type(wanted) ~= 'string' or wanted == '' then return false end
  if ctx.citizenId and wanted == ctx.citizenId then return true end
  local ids = ctx.ids
  for i = 1, #ids do
    if ids[i] == wanted then return true end
  end
  return false
end

-- ── Per-script PUSH overrides ─────────────────────────────────────────────
-- In addition to the central `overrides` array (which lives in dirk_lib's own
-- scriptConfig and is curated from the admin UI), each consumer resource can
-- declare an `access` block in ITS OWN schema.json. The consumer's
-- scriptConfig module (which runs in the consumer's VM) PUSHES that block to
-- us via registerScriptConfigOverrides. We store it keyed by resource name and
-- read it during canEditResource. This is a one-way push model: dirk_lib only
-- ever READS this map — it never calls back into a consumer, so there is no
-- re-entrancy. Entries are cleared on the consumer's stop (and defensively in
-- our own onResourceStop below, should we ever observe the stop first).
local overridesByResource = {}

-- accessBlock shape: { groups = string[], identifiers = string[] }. Validated
-- defensively — anything non-string / empty is dropped so a malformed schema
-- can't widen access in surprising ways.
exports('registerScriptConfigOverrides', function(resourceName, accessBlock)
  if type(resourceName) ~= 'string' or resourceName == '' then return false end
  accessBlock = type(accessBlock) == 'table' and accessBlock or {}

  local groups = {}
  if type(accessBlock.groups) == 'table' then
    for i = 1, #accessBlock.groups do
      local g = accessBlock.groups[i]
      if type(g) == 'string' and g ~= '' then groups[#groups + 1] = g end
    end
  end

  local identifiers = {}
  if type(accessBlock.identifiers) == 'table' then
    for i = 1, #accessBlock.identifiers do
      local id = accessBlock.identifiers[i]
      if type(id) == 'string' and id ~= '' then identifiers[#identifiers + 1] = id end
    end
  end

  overridesByResource[resourceName] = { groups = groups, identifiers = identifiers }

  -- Fold this block into the Admins page the first time we see it, so there
  -- is one list of who has access instead of one per script - and so a grant
  -- can actually be revoked, which a schema file cannot be from a panel.
  --
  -- Deferred: registration happens as the consumer starts, which can be
  -- before the admin tables exist on a cold boot.
  if not scriptConfigAdmins.isMigrated(resourceName) then
    CreateThread(function()
      Wait(2000)
      pcall(scriptConfigAdmins.migrateAccessBlock, resourceName, groups, identifiers)
    end)
  end

  return true
end)

exports('unregisterScriptConfigOverrides', function(resourceName)
  if type(resourceName) ~= 'string' or resourceName == '' then return false end
  overridesByResource[resourceName] = nil
  return true
end)

-- Defensive cleanup in dirk_lib's own VM. The consumer also unregisters from
-- its own onResourceStop (modules/scriptConfig/server.lua); whichever fires is
-- harmless — both just nil out the same map entry.
AddEventHandler('onResourceStop', function(stopped)
  if type(stopped) == 'string' then
    overridesByResource[stopped] = nil
  end
end)

-- Does the pushed per-script access block for this resource grant src access?
-- Read-only against the map — never calls back into the consumer.
local function pushedOverrideAllows(src, resourceName, ctx)
  -- Once a script's block has been folded into the rows, the block itself
  -- stops granting. Both honouring it AND the migrated rows would mean
  -- deleting a row revokes nothing, because the schema still says yes.
  if scriptConfigAdmins.isMigrated(resourceName) then return false end

  local o = overridesByResource[resourceName]
  if type(o) ~= 'table' then return false end
  local groups = o.groups
  if type(groups) == 'table' then
    for i = 1, #groups do
      local g = groups[i]
      if type(g) == 'string' and g ~= '' and IsPlayerAceAllowed(src, g) then
        return true
      end
    end
  end
  local identifiers = o.identifiers
  if type(identifiers) == 'table' then
    for i = 1, #identifiers do
      if playerHasIdentifier(identifiers[i], ctx) then return true end
    end
  end
  return false
end

-- Exposed on `_G` so modules/scriptConfig/server.lua can use it for the
-- per-resource `/<scriptName>` command without duplicating the access
-- model. Anyone calling this externally must pass src + resourceName —
-- src=0 (server console) always returns true.
function CanEditScriptConfigResource(src, resourceName) end -- forward decl

--- What level of access does src have to this resource: 'edit', 'view', nil.
---
--- Levels are new; access used to be a yes/no. Everything that existed before
--- grants 'edit', so nothing anyone already has changes - 'view' only ever
--- comes from a row someone deliberately added in the panel.
local function resolveLevel(src, resourceName, ctx)
  if not src or src == 0 then return 'edit' end
  if isMasterEditor(src) then return 'edit' end

  ctx = ctx or resolveMatchCtx(src)

  -- Per-script PUSH: the access block the consumer declared in its own
  -- schema.json. Predates levels, so it means edit, and it is checked first
  -- because it is the cheaper of the two.
  if pushedOverrideAllows(src, resourceName, ctx) then return 'edit' end

  -- Rows added from the panel. Matching an identifier uses the same context
  -- as everything else; matching a principal asks the native, which resolves
  -- the whole ACE tree.
  return scriptConfigAdmins.levelFor(resourceName, function(row)
    if row.kind == 'principal' then
      return IsPlayerAceAllowed(src, row.subject)
    end
    return playerHasIdentifier(row.subject, ctx)
  end)
end

ResolveScriptConfigLevel = resolveLevel

--- The master list and whether it is just the default.
---
--- Read by adminsApi rather than rebuilt there: the default lives here, and a
--- second copy of it drifts from this one - which it had, three different
--- values in three places.
function ScriptConfigMasterGroup()
  return getMasterGroup(), GetConvar('dirk_lib_master_group', '__unset__') == '__unset__'
end

local function canEditResource(src, resourceName, ctx)
  if not src or src == 0 then return true end
  if isMasterEditor(src) then return true end
  -- dirk_lib's own config used to be hard-denied to non-masters (its scriptConfig
  -- WAS the access model). With the central overrides removed it's no longer an
  -- escalation vector — master is the dirk_lib_master_group convar, not config —
  -- so dirk_lib is gated like any resource: master (above) + its own pushed access.

  -- Resolve the player's match context once (citizenid/license + raw FiveM
  -- identifiers). The caller may pass a precomputed ctx — the chooser resolves
  -- it ONCE for the whole resource sweep — otherwise resolve lazily here. Done
  -- after the master short-circuit so admins never pay for it.
  return resolveLevel(src, resourceName, ctx) == 'edit'
end

CanEditScriptConfigResource = canEditResource

-- Cross-VM bridge. The global above only exists in dirk_lib's own resource
-- scope, so consumer resources (which run their own Lua VM when they import
-- `@dirk_lib/init.lua`) can't see it. The export below makes the same check
-- available to any consumer via `exports.dirk_lib:canEditScriptConfig(src, name)`,
-- which is what `modules/scriptConfig/server.lua`'s save-permission wrapper
-- now uses regardless of which VM it runs in.
exports('canEditScriptConfig', function(src, resourceName)
  return canEditResource(src, resourceName)
end)

-- 'edit' | 'view' | nil. What the panel gates reads on: a view user may open a
-- script and read its settings, but must never receive the server-only values
-- or be able to write.
exports('getScriptConfigLevel', function(src, resourceName)
  return ResolveScriptConfigLevel(src, resourceName)
end)

exports('canViewScriptConfig', function(src, resourceName)
  return ResolveScriptConfigLevel(src, resourceName) ~= nil
end)

-- Master is the `dirk_lib_master_group` convar and nothing else. Managing
-- access is gated on this rather than on edit, so an admin cannot widen their
-- own access.
exports('isScriptConfigMaster', function(src)
  if not src or src == 0 then return true end
  return isMasterEditor(src)
end)

exports('listScriptConfigAdmins', function() return scriptConfigAdmins.all() end)
exports('putScriptConfigAdmin', function(entry) return scriptConfigAdmins.put(entry) end)
exports('removeScriptConfigAdmin', function(id) return scriptConfigAdmins.remove(id) end)

-- Which started resources are dirk scripts with a parseable schema.
--
-- Cached, because this used to run on EVERY /dirk_config: a sweep of all ~120
-- resources, and for each dirk script a LoadResourceFile of its schema.json
-- plus a full json.decode whose RESULT WAS THROWN AWAY - it only proved the
-- file parses. Fishing's schema alone is a quarter of a megabyte, so each
-- open stalled the server main thread parsing over a megabyte of JSON to
-- answer a yes/no, which read as lag between the command and the panel.
--
-- The set only changes when a resource starts or stops, so that is exactly
-- when the cache drops.
local registryCache = nil

local function registeredResources()
  if registryCache then return registryCache end

  local list = {}
  local total = GetNumResources()
  for i = 0, total - 1 do
    local name = GetResourceByFindIndex(i)
    if name and GetResourceState(name) == 'started' and hasScriptConfigTag(name) then
      local rawSchema = LoadResourceFile(name, 'schema.json')
      if rawSchema then
        local ok, schema = pcall(json.decode, rawSchema)
        if ok and type(schema) == 'table' then
          list[#list + 1] = {
            resource = name,
            label = schema['x-label'] or name,
            icon = schema['x-icon'] or 'sliders-horizontal',
            shared = schema['x-shared'] == true,
            version = GetResourceMetadata(name, 'version', 0) or 'dev',
            -- The raw TEXT is what travels (JSON.parse keeps the author's key
            -- order; re-encoding a Lua table shuffles it), the decoded table
            -- is what autoDefaults walks, and the hash is what lets a client
            -- skip the transfer when it already holds this exact schema.
            rawSchema = rawSchema,
            schema = schema,
            hash = joaat(rawSchema),
          }
        end
      end
    end
  end
  table.sort(list, function(a, b) return a.resource < b.resource end)

  registryCache = list
  return list
end

--- A dirk script started or stopped.
---
--- Drops the registry cache, and tells any open panel to re-read itself. The
--- panel re-gathers rather than closing, so someone editing when a script
--- restarts underneath them keeps their staged changes and their place -
--- previously the only way to see a restarted script was to close the panel
--- and open it again, and any unsaved work went with it.
---
--- Broadcast to everyone: the server does not track who has the panel open,
--- and the client ignores it unless it does. One tiny event on a rare action.
local function announceRegistryChange(resourceName)
  registryCache = nil
  if not resourceName or not hasScriptConfigTag(resourceName) then return end
  TriggerClientEvent('dirk_lib:scriptStudioResourcesChanged', -1, resourceName)
end

AddEventHandler('onResourceStart', announceRegistryChange)
AddEventHandler('onResourceStop', announceRegistryChange)

local function collectRegisteredConfigs(src)
  local all = registeredResources()
  if not src then return all end

  -- Resolve the player's match context ONCE for the whole sweep — a single src
  -- is tested against every registered resource. Masters short-circuit inside
  -- canEditResource before ctx is touched, so skip the lookup for them.
  local ctx
  if src ~= 0 and not isMasterEditor(src) then
    ctx = resolveMatchCtx(src)
  end

  local list = {}
  for i = 1, #all do
    if resolveLevel(src, all[i].resource, ctx) then list[#list + 1] = all[i] end
  end
  return list
end

-- ── Script Studio payload ─────────────────────────────────────────────────
--
-- One callback returns every script this player may edit, WITH its schema.
--
-- The schema is read here rather than shipped in each resource's `files{}`:
-- dirk_lib's server can already `LoadResourceFile` any started resource, so
-- adding the hub costs consumer scripts exactly nothing - no fxmanifest edit,
-- no re-release. It also means a normal player never receives a schema at all;
-- only the admin who opened the panel does.
--
-- VALUES are deliberately NOT included. Each consumer already registers a
-- permission-gated `<resource>:getFullScriptConfig`, and the client calls those
-- directly - so server-only values keep travelling through the one path that
-- checks who is asking, instead of a new one that would have to re-implement
-- the check.
-- Convar-detected schema defaults (`x-autoDefault`). Shared with the
-- scriptConfig engine so both sides agree on what a default is.
local collectAutoDefaults = require '@dirk_lib.src.autoDefaults'

--- The server artifact build, published once.
---
--- The Bridges page reports it, and the page runs on the CLIENT - where the
--- `version` convar does not exist, so reading it there returned nothing and
--- the card said "unknown". It is a server fact, so the server states it.
---
--- A GlobalState bag rather than a callback: it is replicated once at startup
--- and read for free forever after, and a build number cannot change without
--- the server restarting anyway.
CreateThread(function()
  -- "FXServer-master v1.0.0.12913 win32" - the artifact number is the part
  -- that `/server:7290` in a fxmanifest is talking about.
  local raw = GetConvar('version', '')
  local build = tonumber(raw:match('v%d+%.%d+%.%d+%.(%d+)'))
  GlobalState.dirkServerBuild = build or false
end)

lib.callback.register('dirk_lib:getScriptStudio', function(source, knownHashes)
  -- `knownHashes` is { [resource] = hash } for schemas the client still holds
  -- in its KVP cache. A matching hash means the client already has this exact
  -- text, so only the hash goes back - which is what makes a repeat open cost
  -- almost nothing on the wire. The hash is of the schema CONTENT, not the
  -- version, so editing a schema and restarting the resource invalidates it
  -- even without a version bump.
  knownHashes = type(knownHashes) == 'table' and knownHashes or {}

  local ctx
  if source and source ~= 0 and not isMasterEditor(source) then
    ctx = resolveMatchCtx(source)
  end

  local out = {}
  local all = registeredResources()
  for i = 1, #all do
    local entry = all[i]
    if canEditResource(source, entry.resource, ctx) then
      -- Detected defaults (a server name read from server.cfg, say) can change
      -- without a restart, so they are walked fresh per open - over the cached
      -- DECODED schema, which is the cheap part. The expensive part, decoding
      -- a quarter-megabyte of JSON per script, happens once per resource
      -- start, not once per open.
      local autoDefaults = {}
      collectAutoDefaults(entry.schema, nil, autoDefaults)

      out[#out + 1] = {
        resource = entry.resource,
        label    = entry.label,
        icon     = entry.icon,
        version  = entry.version,
        shared   = entry.shared,
        hash     = entry.hash,
        schemaJson   = knownHashes[entry.resource] ~= entry.hash and entry.rawSchema or nil,
        autoDefaults = next(autoDefaults) and autoDefaults or nil,
      }
    end
  end

  -- dirk_lib's own settings are the shared layer every script consumes, so it
  -- leads regardless of alphabetical order.
  table.sort(out, function(a, b)
    if a.shared ~= b.shared then return b.shared end
    return a.resource < b.resource
  end)

  return out
end)

--- Open the hub for this player, optionally focused on one script.
---
--- `askLanguage` rides along because the panel cannot work it out for itself.
--- It is a flag of its own rather than a look at `basic.language`, because the
--- language value cannot answer the question: a server still on the English
--- default is indistinguishable from one that chose English on purpose, and an
--- override row is only written for a value that DIFFERS from the default - so
--- "I picked English" would never be recorded and the chooser would nag forever.
---
--- Only editors are asked. The language is a dirk_lib setting and therefore
--- server-wide, so a view-level admin being shown a chooser they cannot save
--- would be a dead end.
local function openScriptStudio(src, focus)
  if not src or src == 0 then return end

  local askLanguage = false
  if canEditResource(src, 'dirk_lib') then
    local ok, prompted = pcall(function()
      return lib.scriptConfig.get('basic.languagePrompted')
    end)
    askLanguage = ok and not prompted
  end

  TriggerClientEvent('dirk_lib:openScriptStudio', src, focus, askLanguage)
end

-- Every registered script keeps a `/resourceName` command, as it always had -
-- it just lands in the hub with that script selected rather than opening a
-- panel of its own. Customers' muscle memory and docs keep working.
CreateThread(function()
  Wait(2000)   -- let consumers register first
  local registered = {}
  local function registerResourceCommands()
    local total = GetNumResources()
    for i = 0, total - 1 do
      local name = GetResourceByFindIndex(i)
      if name and not registered[name] and GetResourceState(name) == 'started' and hasScriptConfigTag(name) then
        registered[name] = true
        lib.addCommand(name, {
          help = ('Open %s settings in Script Studio'):format(name),
        }, function(source)
          if source == 0 then return end
          if not canEditResource(source, name) then
            lib.notify(source, { type = 'error', description = 'No access to that script\'s settings.' })
            return
          end
          openScriptStudio(source, name)
        end)
      end
    end
  end

  registerResourceCommands()
  -- a script started later should get its command too
  AddEventHandler('onResourceStart', function()
    Wait(500)
    registerResourceCommands()
  end)
end)

lib.addCommand('dirk_config', {
  help = 'Open the Live Configurator to edit registered script configs',
}, function(source)
  if source == 0 then
    lib.print.info(('[dirk_config] master group: %s'):format(getMasterGroup()))
    lib.print.info('[dirk_config] list of registered script configs:')
    for _, entry in ipairs(collectRegisteredConfigs(nil)) do
      lib.print.info(('  - %s (%s)'):format(entry.resource, entry.version))
    end
    return
  end

  local list = collectRegisteredConfigs(source)
  if #list == 0 then
    -- Surface what we actually checked — without this the only signal a
    -- locked-out admin gets is the notify, and they can't tell whether the
    -- convar is wrong, the cfg is missing an ACE, or the script just hasn't
    -- registered yet.
    local plyName = GetPlayerName(source) or ('player:' .. tostring(source))
    lib.print.warn(('[dirk_config] %s denied — master group %q did not match any of the player\'s ACEs. Player identifiers: %s'):format(
      plyName,
      getMasterGroup(),
      json.encode(GetPlayerIdentifiers(source) or {})
    ))
    lib.notify(source, { type = 'error', description = 'No script configs available — check your access permissions.' })
    return
  end
  -- The chooser is retired: it listed scripts and then handed off to each
  -- resource's own NUI. Script Studio draws them all, so this opens straight
  -- into it. The old event handler is left in place for one release so a
  -- consumer still calling it does not break.
  openScriptStudio(source)
end)

RegisterNetEvent('dirk_lib:scriptConfigChooserPick', function(resourceName)
  local src = source
  if type(resourceName) ~= 'string' or resourceName == '' then return end
  if not hasScriptConfigTag(resourceName) then return end
  if GetResourceState(resourceName) ~= 'started' then return end
  if not canEditResource(src, resourceName) then return end

  TriggerClientEvent(('%s:openScriptConfig'):format(resourceName), src)
end)

RegisterNetEvent('dirk_lib:reopenScriptConfigChooser', function()
  local src = source
  TriggerClientEvent('dirk_lib:openScriptConfigChooser', src, collectRegisteredConfigs(src))
end)

-- ── Config delivery health ───────────────────────────────────────────────
-- A client tells us when it could not get its config, and again when it
-- finally did. This exists because the failure was previously invisible from
-- the server: the player just silently ran on defaults, and the only symptom
-- an owner ever saw was "shop times are wrong for players but right for me".
--
-- Untrusted input, so nothing here is taken at face value: the resource must
-- be one that actually registered a config, the state is one of two known
-- words, and a client gets one line per resource per session however many
-- times it shouts.
local fetchReportSeen = {}

AddEventHandler('playerDropped', function()
  fetchReportSeen[source] = nil
end)

RegisterNetEvent('dirk_lib:scriptConfigFetch', function(resourceName, state, attempts)
  local src = source
  if type(resourceName) ~= 'string' or #resourceName > 64 then return end
  if state ~= 'failed' and state ~= 'recovered' then return end
  -- Must be a real, started resource that opted into scriptConfig - not any
  -- string a client cares to send.
  if GetResourceState(resourceName) ~= 'started' then return end
  if not hasScriptConfigTag(resourceName) then return end

  local seen = fetchReportSeen[src]
  if not seen then seen = {}; fetchReportSeen[src] = seen end
  local slot = resourceName .. ':' .. state
  if seen[slot] then return end
  seen[slot] = true

  local tries = math.min(math.max(tonumber(attempts) or 1, 1), 999)

  if state == 'failed' then
    lib.logger(src, 'configFetchFailed',
      ('did not receive %s config after %d attempts - running on defaults'):format(resourceName, tries),
      'level:warn', ('resource:%s'):format(resourceName))
  else
    lib.logger(src, 'configFetchRecovered',
      ('received %s config after %d attempts'):format(resourceName, tries),
      ('resource:%s'):format(resourceName))
  end
end)

-- ── Online players list (for the access overrides UI) ────────────────────
-- Used by the dirk_lib admin Script Config tab to populate the identifier
-- dropdown. Master-only — the UI that consumes it is master-only too.

lib.callback.register('dirk_lib:getOnlinePlayers', function(source)
  if source ~= 0 and not isMasterEditor(source) then return {} end
  local players = GetPlayers() or {}
  local out = {}
  for i = 1, #players do
    local id = tonumber(players[i])
    if id then
      local name = GetPlayerName(id) or ('Player ' .. id)
      local idents = {}
      local raw = GetPlayerIdentifiers(id) or {}
      for j = 1, #raw do idents[#idents + 1] = raw[j] end
      out[#out + 1] = { id = id, name = name, identifiers = idents }
    end
  end
  table.sort(out, function(a, b) return (a.name or '') < (b.name or '') end)
  return out
end)

-- ── Vehicle spawning (the catalogue's "Spawn it" button) ─────────────────
-- The SERVER creates the vehicle, not the client. A client-side spawn would
-- have meant trusting the asking client, and the permission check would have
-- been advice rather than a gate. Here nothing exists unless this callback
-- decides it should, and the client only ever gets a network id back.
--
-- Gated by the same access model as editing a config: master ACE, or a
-- per-resource override that grants dirk_lib.

lib.callback.register('dirk_lib:spawnVehicle', function(source, payload)
  if source == 0 then return false, 'NoPermission' end
  if not canEditResource(source, 'dirk_lib') then return false, 'NoPermission' end

  local model = type(payload) == 'table' and payload.model or nil
  if type(model) ~= 'string' or model == '' or #model > 32 or model:find('[^%w_]') then
    return false, 'BadModel'
  end

  local ped = GetPlayerPed(source)
  if not ped or ped == 0 then return false, 'NoPed' end

  local coords  = GetEntityCoords(ped)
  local heading = GetEntityHeading(ped)
  -- Vectors have to be unpacked for the native, and the numbers have to stay
  -- floats or CreateVehicle refuses without saying so.
  local vehicle = CreateVehicle(joaat(model), coords.x + 0.0, coords.y + 0.0, coords.z + 0.0, heading + 0.0, true, true)
  if not vehicle or vehicle == 0 then return false, 'SpawnFailed' end

  -- The entity is created but not necessarily assigned to an owner yet, so
  -- give it a moment before handing over its network id.
  local tries = 0
  while not DoesEntityExist(vehicle) and tries < 50 do
    Wait(10)
    tries = tries + 1
  end
  if not DoesEntityExist(vehicle) then return false, 'SpawnFailed' end

  -- A plate is what every vehicle-keys resource keys off, so one is set here
  -- rather than left to whatever the game picked - the client cannot hand out
  -- keys for a plate the server did not decide on.
  local plate
  local ok, generated = pcall(function() return lib.vehicle.generatePlate() end)
  if ok and type(generated) == 'string' and generated ~= '' then
    plate = generated
    SetVehicleNumberPlateText(vehicle, plate)
  else
    plate = GetVehicleNumberPlateText(vehicle)
  end

  return true, nil, { netId = NetworkGetNetworkIdFromEntity(vehicle), plate = plate }
end)

-- ── Changelogs ───────────────────────────────────────────────────────────
-- Every script already ships a CHANGELOG.md, and the server can read any
-- file inside any resource - the same route scriptConfig already uses for
-- schema.json, which is deliberately not in files{} either. So "what changed
-- in the version I am running" needs no endpoint and no network: it is sitting
-- in the resource folder, and it is the changelog for the exact build
-- installed rather than whatever is newest.
--
-- Capped because this is going over the NUI bridge. Fishing's is already 578
-- lines and only the recent entries are ever read.

local CHANGELOG_MAX = 96 * 1024

-- ── Test runs: one at a time, and remembered ─────────────────────────────
--
-- A suite has side effects - fishing's adds and removes items to prove the
-- inventory bridge works - so two admins running one at the same time would
-- be testing each other's mess. And a result is worth keeping: opening the
-- page should show what happened last time rather than an empty screen and a
-- button, and certainly rather than firing a run just because someone looked.
--
-- The lock and the cache live HERE, in dirk_lib, because the runs live in
-- every consumer: one place that knows about all of them.
local testRuns = {}
local TEST_COOLDOWN = 20

exports('beginTestRun', function(resource, src)
  if type(resource) ~= 'string' then return false, 'BadRequest' end
  local state = testRuns[resource]
  local now = os.time()

  if state and state.running then
    -- A crashed run must not lock the suite for ever.
    if now - (state.startedAt or 0) < 120 then
      return false, 'AlreadyRunning', state.runningBy
    end
  end

  if state and state.finishedAt and now - state.finishedAt < TEST_COOLDOWN then
    return false, 'TooSoon', TEST_COOLDOWN - (now - state.finishedAt)
  end

  testRuns[resource] = {
    running = true,
    startedAt = now,
    runningBy = src and GetPlayerName(src) or 'console',
    result = state and state.result or nil,
    finishedAt = state and state.finishedAt or nil,
  }
  return true
end)

exports('endTestRun', function(resource, result)
  local state = testRuns[resource]
  if not state then return end
  state.running = false
  state.finishedAt = os.time()
  if type(result) == 'table' then state.result = result end
end)

lib.callback.register('dirk_lib:getTestState', function(source, payload)
  if source == 0 then return false, 'NoPermission' end
  local resource = type(payload) == 'table' and payload.resource or nil
  if type(resource) ~= 'string' then return false, 'BadRequest' end
  if not canEditResource(source, resource) then return false, 'NoPermission' end

  local state = testRuns[resource]
  if not state then return true, nil, { ran = false } end

  return true, nil, {
    ran = state.finishedAt ~= nil,
    running = state.running == true,
    runningBy = state.runningBy,
    at = state.finishedAt,
    ageSeconds = state.finishedAt and (os.time() - state.finishedAt) or nil,
    result = state.result,
  }
end)

-- Which scripts have a test suite loaded.
--
-- Read from the MANIFEST rather than by asking each resource: a consumer that
-- does not load lib.test would never answer a callback, and `await` on an
-- event nobody registered simply hangs. `dirk_lib 'test'` in an fxmanifest is
-- what force-loads the module, so its presence is the answer.
lib.callback.register('dirk_lib:getTestIndex', function(source, payload)
  if source == 0 then return false, 'NoPermission' end
  local resources = type(payload) == 'table' and payload.resources or nil
  if type(resources) ~= 'table' then return false, 'BadRequest' end

  local found = {}
  for i = 1, #resources do
    local resource = resources[i]
    if type(resource) == 'string' and GetResourceState(resource) == 'started'
      and canEditResource(source, resource) then
      local count = GetNumResourceMetadata(resource, 'dirk_lib') or 0
      for m = 0, count - 1 do
        if GetResourceMetadata(resource, 'dirk_lib', m) == 'test' then
          found[#found + 1] = resource
          break
        end
      end
    end
  end

  return true, nil, found
end)

-- Which of these scripts actually ship one, so the panel only offers the tab
-- where there is something to read. One call rather than one per script.
lib.callback.register('dirk_lib:getChangelogIndex', function(source, payload)
  if source == 0 then return false, 'NoPermission' end
  local resources = type(payload) == 'table' and payload.resources or nil
  if type(resources) ~= 'table' then return false, 'BadRequest' end

  local found = {}
  for i = 1, #resources do
    local resource = resources[i]
    if type(resource) == 'string' and GetResourceState(resource) == 'started'
      and canEditResource(source, resource) then
      local text = LoadResourceFile(resource, 'CHANGELOG.md')
      if type(text) == 'string' and text:find('%S') then
        found[#found + 1] = resource
      end
    end
  end

  return true, nil, found
end)

lib.callback.register('dirk_lib:getChangelog', function(source, payload)
  if source == 0 then return false, 'NoPermission' end

  local resource = type(payload) == 'table' and payload.resource or nil
  if type(resource) ~= 'string' or resource == '' then return false, 'BadRequest' end
  if GetResourceState(resource) ~= 'started' then return false, 'NotStarted' end

  -- Gated like everything else in the panel: a changelog is not a secret, but
  -- there is no reason for someone who cannot open a script's settings to be
  -- pulling files out of it either.
  if not canEditResource(source, resource) then return false, 'NoPermission' end

  local text = LoadResourceFile(resource, 'CHANGELOG.md')
  if type(text) ~= 'string' or text == '' then return false, 'NoChangelog' end
  if #text > CHANGELOG_MAX then text = text:sub(1, CHANGELOG_MAX) end

  return true, nil, {
    text = text,
    version = GetResourceMetadata(resource, 'version', 0),
  }
end)

-- ── Giving an item (a list row's "give me one" button) ───────────────────
-- Same shape and the same reasoning as vehicle spawning above: the SERVER
-- hands the item over, so the permission check is a gate rather than advice,
-- and a client that asks for something it is not allowed gets nothing.
--
-- Generic on purpose. dirk_lib does not know what a fish is - it knows a
-- script asked for one of its own items to be given to the person editing it,
-- and that that person is allowed to edit that script.

lib.callback.register('dirk_lib:giveItem', function(source, payload)
  if source == 0 then return false, 'NoPermission' end

  local resource = type(payload) == 'table' and payload.resource or nil
  if type(resource) ~= 'string' or resource == '' then return false, 'BadRequest' end

  -- Gated on the OWNING script, not on dirk_lib: someone trusted with
  -- fishing's settings can hand themselves a fish, which is the whole point of
  -- the button, without that implying anything about the rest of the server.
  if not canEditResource(source, resource) then return false, 'NoPermission' end

  local name = payload.item
  if type(name) ~= 'string' or name == '' or #name > 64 or name:find('[^%w_%-]') then
    return false, 'BadItem'
  end

  local count = tonumber(payload.count) or 1
  if count < 1 then count = 1 end
  if count > 100 then count = 100 end

  if not lib.inventory or not lib.inventory.addItem then return false, 'NoInventory' end

  local ok, added = pcall(lib.inventory.addItem, source, name, count, payload.metadata)
  if not ok then return false, 'InventoryError' end
  -- Bridges disagree on what they return - some a boolean, some nothing at
  -- all - so only an explicit `false` counts as a refusal.
  if added == false then return false, 'NotAdded' end

  return true
end)

-- (Master group + registered-resources lookups for the Script Config tab
-- live entirely client-side now — convars replicate via `setr` and resource
-- metadata is readable from a client NUI callback. See init.lua's
-- GET_SCRIPT_CONFIG_MASTER_GROUP / GET_SCRIPT_CONFIG_RESOURCES handlers.)

require '@dirk_lib.src.scriptConfig.adminsApi'
