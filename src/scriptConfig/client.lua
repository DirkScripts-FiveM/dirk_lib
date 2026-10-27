-- --------------------------------------------------
-- GLOBAL /dirk_config CLIENT HANDLER
-- --------------------------------------------------
-- Receives the chooser list from the server, opens dirk_lib's own NUI, and
-- forwards the selected resource back for dispatch.

local chooserOpen = false
local studioOpen = false
local startedAt = {}                 -- resource -> GetGameTimer() at its last start (see onClientResourceStart below)

local function closeChooser()
  if not chooserOpen then return end
  chooserOpen = false
  SendNuiMessage(json.encode({ action = 'CLOSE_SCRIPT_CONFIG_CHOOSER' }))
  SetNuiFocus(false, false)
end

RegisterNetEvent('dirk_lib:openScriptConfigChooser', function(list)
  if chooserOpen then return end
  chooserOpen = true

  SetNuiFocus(true, true)
  SendNuiMessage(json.encode({
    action = 'OPEN_SCRIPT_CONFIG_CHOOSER',
    data = { scripts = list or {} },
  }))
end)

-- Polled by per-script CONFIG_PANEL_BACK handlers so they can drop their
-- own NUI focus claim only AFTER we've taken focus on this resource.
-- TriggerEvent doesn't cross resources on the client, so an export poll
-- is the simplest race-free signal.
exports('isScriptConfigChooserOpen', function()
  return chooserOpen
end)

--- Is one of dirk_lib's admin surfaces actually on screen?
---
--- Read by src/nuiBridge before it will do anything on an admin's behalf.
---
--- The point is WHERE this lives. `studioOpen` is set by
--- `dirk_lib:openScriptStudio`, a server-triggered event the server only fires
--- after its permission check - so it cannot be set from the NUI. A player who
--- opens CEF devtools can send any `fetchNui` they like, but they cannot make
--- this true, and every acting callback refuses while it is false.
---
--- Without it, "can you reach this" was answered by "can you run Lua on your
--- client", when the honest answer was "can you press F12".
--- An EXPORT rather than a global: nuiBridge is a `require`d module loaded
--- from a shared script, so whether it can see a global this client script
--- declares depends on module environments and load order. An export is the
--- same answer without either question, and is how the chooser above already
--- reports itself.
exports('isDirkAdminUiOpen', function()
  return studioOpen or chooserOpen
end)

RegisterNuiCallback('SCRIPT_CONFIG_CHOOSER_PICK', function(data, cb)
  chooserOpen = false
  -- Don't release NUI focus: the picked resource will take over and re-grab
  -- focus. Releasing here causes a brief frame where the player's character
  -- can move/look around between the chooser closing and the consumer UI
  -- mounting.

  local resource = data and data.resource
  if type(resource) == 'string' and resource ~= '' then
    TriggerServerEvent('dirk_lib:scriptConfigChooserPick', resource)
  end

  cb({ success = true })
end)

RegisterNuiCallback('SCRIPT_CONFIG_CHOOSER_CLOSE', function(_, cb)
  closeChooser()
  cb({ success = true })
end)

-- Called by a consumer's scriptConfig module once it has finished grabbing
-- NUI focus. Lets the chooser release its lingering focus claim without
-- creating the focus gap that prompted us to keep it held during pick.
exports('releaseScriptConfigChooserFocus', function()
  if chooserOpen then return end
  SetNuiFocus(false, false)
end)

-- --------------------------------------------------
-- SCRIPT STUDIO
-- --------------------------------------------------
-- The hub that replaces the chooser. The server hands over the schemas this
-- player may edit, plus each script's server-only sliver (asked of that script
-- through its own permission check); the client-visible VALUES come from each
-- script's own client VM, which already holds them.
--
-- An open is shown from MEMORY when it can be: the panel keeps what it was
-- showing last time, appears at once, and fresh values merge in behind it
-- (SCRIPT_STUDIO_DATA). It used to wait for a full gather - every schema
-- re-read, two round trips, every schema re-sent to the NUI - before drawing
-- anything, on every single open.

local studioPayload = require '@dirk_lib.src.scriptConfig.studioPayload'

local function closeStudio()
  if not studioOpen then return end
  studioOpen = false
  SendNuiMessage(json.encode({ action = 'CLOSE_SCRIPT_STUDIO' }))
  SetNuiFocus(false, false)
  -- The admin tools stop on this event - a free camera or a hand-off still
  -- running when the panel shuts would otherwise keep the player frozen and
  -- invisible with nothing left open to end it. Only a consumer's own panel
  -- ever fired it, so closing Script Studio left every tool running.
  TriggerEvent('dirk_lib:scriptConfigClosed', 'dirk_lib')
  -- The admin pickers (position, object, door) fade the blur back IN when
  -- they hand control back, on the assumption the panel had blurred on open.
  -- Script Studio never does, and nothing here ever faded it out - so picking
  -- a shop location and closing left the whole screen blurred until a relog.
  TriggerScreenblurFadeOut(0)
end

-- Schemas cache locally, keyed by CONTENT hash - so a repeat open transfers
-- no schema at all, and an edited schema (even without a version bump) misses
-- the cache and comes down fresh. Safe to share across servers: the key is
-- the content itself, so a hit is by definition the right text.
local function schemaKvpKey(resource)
  return ('dirk_lib_studioSchema_%s'):format(resource)
end

--- The KVP cache, held in a table for the session.
---
--- Every open used to walk all ~120 resources, read each one's KVP entry and
--- json.decode it again - over a megabyte of decoding to produce the same
--- table as last time. Now each resource's entry is read at most once a
--- session, and only for resources that are dirk scripts at all; a fresh
--- schema from the server updates the table and the KVP together.
local schemaStore = {}
local probed = {}

local function isConsumer(name)
  for i = 0, (GetNumResourceMetadata(name, 'dirk_lib') or 0) - 1 do
    if GetResourceMetadata(name, 'dirk_lib', i) == 'scriptConfig' then return true end
  end
  return false
end

local function readSchemaStore()
  for i = 0, GetNumResources() - 1 do
    local name = GetResourceByFindIndex(i)
    if name and not probed[name] then
      probed[name] = true
      if isConsumer(name) then
        local raw = GetResourceKvpString(schemaKvpKey(name))
        if raw and raw ~= '' then
          local ok, decoded = pcall(json.decode, raw)
          if ok and type(decoded) == 'table' and decoded.hash and decoded.schemaJson then
            schemaStore[name] = decoded
          end
        end
      end
    end
  end
  return schemaStore
end

--- Which schema hashes the PANEL holds, as it last reported them.
---
--- The panel says so itself (SCRIPT_STUDIO_HELD) rather than this side
--- assuming whatever it sent arrived: a message sent before the page has
--- loaded is simply lost, and then the panel would be asked to show a schema
--- it never got.
local heldByPanel = {}

--- The panel has real data from this session, so an open can show it at once.
--- Set only by the panel's own report, for the same reason.
local panelPrimed = false

--- Everything the panel needs: schemas (cached by content hash) and values
--- (from each script's own client VM, plus its server-only sliver).
---
--- ONE round trip. The server-only sliver used to be a second call per
--- script, each with a 5 s deadline, so one script mid-restart held the whole
--- panel shut for up to ten seconds. It now arrives inside the
--- getScriptStudio reply, asked of each script by dirk_lib's server through
--- that script's own permission check.
local function gatherStudio()
  -- Tell the server which schemas we already hold, so it only sends what
  -- changed. First ever open pays the full transfer; every one after costs a
  -- list of hashes.
  local store = readSchemaStore()
  local known = {}
  for name, hit in pairs(store) do known[name] = hit.hash end

  local scripts = lib.callback.await('dirk_lib:getScriptStudio', known)
  if type(scripts) ~= 'table' or #scripts == 0 then return nil end

  local pending = 0
  for i = 1, #scripts do
    local entry = scripts[i]
    if entry.schemaJson then
      -- Fresh from the server: remember it for next time.
      store[entry.resource] = { hash = entry.hash, schemaJson = entry.schemaJson }
      SetResourceKvp(schemaKvpKey(entry.resource),
        json.encode({ hash = entry.hash, schemaJson = entry.schemaJson }))
    else
      -- The server held it back because our hash matched, so the cached text
      -- IS this schema.
      entry.schemaJson = store[entry.resource] and store[entry.resource].schemaJson
    end

    entry.startedAt = startedAt[entry.resource] or 0

    -- Values come from each script's OWN client VM - this client already holds
    -- every config, kept current by the engine, so nothing is re-downloaded.
    local ok, snap = pcall(function()
      return exports[entry.resource]:dirkStudioSnapshot()
    end)
    local fromSnapshot = ok and type(snap) == 'table' and snap.loaded and type(snap.config) == 'table'
    if fromSnapshot then
      entry.values = lib.table.deepClone(snap.config)
      entry.clientVersion = snap.client_version
    end

    -- Read off and cleared: the sliver is merged into the values below and
    -- has no business travelling to the panel a second time on its own.
    local serverOnly, checked, onlyVersion = entry.serverOnly, entry.serverOnlyChecked, entry.serverOnlyVersion
    entry.serverOnly, entry.serverOnlyChecked, entry.serverOnlyVersion = nil, nil, nil

    if fromSnapshot and checked then
      -- The common case, and it is synchronous: no thread, no wait.
      if type(serverOnly) == 'table' then studioPayload.mergeInto(entry.values, serverOnly) end
      entry.clientVersion = onlyVersion or entry.clientVersion
    else
      -- Either this script has not finished its own first load, or it started
      -- before this dirk_lib and has no export for the server to ask. Both old
      -- calls still exist and still check who is asking, so fall back to them
      -- for this one script - in parallel, on a short deadline, so one script
      -- mid-restart costs one empty script rather than a frozen open.
      pending += 1
      CreateThread(function()
        if not fromSnapshot then
          local ok2, success, _err, payload = pcall(function()
            return lib.callback.awaitTimeout(('%s:getFullScriptConfig'):format(entry.resource), 5000)
          end)
          local got = (ok2 and success and type(payload) == 'table') and payload or nil
          entry.values = (got and type(got.config) == 'table') and got.config or {}
          entry.clientVersion = got and got.clientVersion or nil
        end

        if checked then
          if type(serverOnly) == 'table' then studioPayload.mergeInto(entry.values, serverOnly) end
          entry.clientVersion = onlyVersion or entry.clientVersion
        else
          local ok3, success3, _err3, extra = pcall(function()
            return lib.callback.awaitTimeout(('%s:getServerOnlyScriptConfig'):format(entry.resource), 5000)
          end)
          if ok3 and success3 and type(extra) == 'table' then
            if type(extra.serverOnly) == 'table' then studioPayload.mergeInto(entry.values, extra.serverOnly) end
            entry.clientVersion = extra.clientVersion or entry.clientVersion
          end
        end
        pending -= 1
      end)
    end
  end
  while pending > 0 do Wait(10) end

  return scripts
end

-- The warm-up, an open and a Refresh can overlap; they share one gather.
local gather = studioPayload.single(gatherStudio)

--- Hand the panel a gather, minus the schema text it already holds.
---
--- Sent whether the panel is open or shut: shut, it is the warm-up, and the
--- next open has something to show at once.
local function sendToPanel(scripts, extra)
  local data = { scripts = studioPayload.forPanel(scripts, heldByPanel) }
  for key, value in pairs(extra or {}) do data[key] = value end
  SendNuiMessage(json.encode({ action = 'SCRIPT_STUDIO_DATA', data = data }))
end

--- When each resource last started on this client.
---
--- Sent with every payload so the panel can tell a script restarted while it
--- was SHUT - scriptStudioResourcesChanged below only reaches an open panel,
--- and without this the next open rendered that script's page from before the
--- restart (the browser keeps an imported module for the life of the page).
AddEventHandler('onClientResourceStart', function(resource)
  startedAt[resource] = GetGameTimer()
end)

RegisterNetEvent('dirk_lib:openScriptStudio', function(focus, askLanguage)
  if studioOpen then return end
  studioOpen = true

  if panelPrimed then
    -- Show what the panel already holds, NOW, and let fresh values land behind
    -- it. `stale` holds saves back until they have (the panel waits for the
    -- next SCRIPT_STUDIO_DATA), so nothing is ever written against an old
    -- version - and a save carries expectedVersion regardless.
    SetNuiFocus(true, true)
    SendNuiMessage(json.encode({
      action = 'OPEN_SCRIPT_STUDIO',
      data = { focus = focus, askLanguage = askLanguage or false, stale = true },
    }))

    local scripts = gather()
    if not scripts then
      -- An empty answer, so the panel stops holding saves back.
      sendToPanel({}, { reason = 'open' })
      closeStudio()
      lib.notify({ type = 'error', description = 'No script settings available.' })
      return
    end
    -- Even if the panel was shut again meanwhile: the memory is fresher for it.
    sendToPanel(scripts, { reason = 'open' })
    return
  end

  -- Nothing held yet (the warm-up has not landed): gather first, as before,
  -- so the panel never opens onto nothing.
  local scripts = gather()
  if not scripts then
    studioOpen = false
    lib.notify({ type = 'error', description = 'No script settings available.' })
    return
  end
  if not studioOpen then return end

  sendToPanel(scripts, { focus = focus, reason = 'open' })
  SetNuiFocus(true, true)
  SendNuiMessage(json.encode({
    action = 'OPEN_SCRIPT_STUDIO',
    data = { focus = focus, askLanguage = askLanguage or false },
  }))
end)

--- Re-gather without reopening. Backs the Refresh button, and the automatic
--- rebuild when a script restarts underneath an open panel.
---
--- `full` asks for every schema's text again: the panel found a hash it was
--- told it holds but does not (its page was reloaded), and says so rather than
--- rendering a script with no schema.
RegisterNUICallback('GET_SCRIPT_STUDIO', function(payload, cb)
  if type(payload) == 'table' and payload.full then heldByPanel = {} end
  local scripts = gather()
  cb(scripts and studioPayload.forPanel(scripts, heldByPanel) or {})
end)

--- The panel's report of which schemas it now holds, sent after it applies a
--- payload. What it claims only decides what is left out of the next payload
--- to this same client, so a false claim costs nobody but the claimant.
RegisterNUICallback('SCRIPT_STUDIO_HELD', function(payload, cb)
  heldByPanel = studioPayload.readHeld(type(payload) == 'table' and payload.schemas or nil)
  panelPrimed = next(heldByPanel) ~= nil
  cb({})
end)

--- Warm-up: ask once, a while after joining, while nobody is waiting on it.
--- The server only answers a player who could open the panel.
CreateThread(function()
  while not NetworkIsSessionStarted() do Wait(1000) end
  -- Out of the way of the join itself - spawning, the inventory and every
  -- script's own first config fetch.
  Wait(20000)
  TriggerServerEvent('dirk_lib:studioPrewarm')
end)

RegisterNetEvent('dirk_lib:studioPrewarm', function()
  if panelPrimed or studioOpen then return end
  local scripts = gather()
  if scripts and not panelPrimed then sendToPanel(scripts, { reason = 'prewarm' }) end
end)

--- A consumer started or stopped while the panel is open.
---
--- The panel re-reads rather than closing: reloadFromServer keeps whatever is
--- staged and whatever you were looking at, so a restart during an edit costs
--- nothing. Ignored when the panel is shut, and the server broadcasts to
--- everyone because it does not track who has it open.
RegisterNetEvent('dirk_lib:scriptStudioResourcesChanged', function(resource)
  if not studioOpen then return end
  SendNuiMessage(json.encode({
    action = 'SCRIPT_STUDIO_RESOURCES_CHANGED',
    data = { resource = resource },
  }))
end)

RegisterNUICallback('CLOSE_SCRIPT_STUDIO', function(_, cb)
  closeStudio()
  cb({})
end)

-- Losing the resource while the panel is open would leave NUI focus stuck.
AddEventHandler('onResourceStop', function(resource)
  if resource == GetCurrentResourceName() then closeStudio() end
end)

-- Proxy the per-resource, permission-gated callbacks the panel needs. The hub
-- renders every script, but each script still answers for its own data — so
-- these forward by resource name rather than dirk_lib answering on their behalf.
-- Deliberately NOT called GET_SCRIPT_CONFIG_HISTORY. `modules/scriptConfig`
-- registers a callback of that name too, and it loads lazily - so inside
-- dirk_lib it registered SECOND and quietly replaced this one. The Studio then
-- got the module's `{success, _error, data}` shape instead of the page, read no
-- `items` in it, and showed an empty change log however much was in the log.
RegisterNUICallback('GET_SCRIPT_STUDIO_HISTORY', function(payload, cb)
  local resource = type(payload) == 'table' and payload.resource
  if type(resource) ~= 'string' or resource == '' then return cb({ entries = {}, total = 0 }) end

  local ok, result = pcall(function()
    return lib.callback.await(('%s:getScriptConfigHistory'):format(resource), payload)
  end)
  cb((ok and type(result) == 'table') and result or { entries = {}, total = 0 })
end)


--- Save from the Script Studio.
---
--- The panel edits every script, but a script's config is written by that
--- script's own server callback — dirk_lib forwards, it does not answer on
--- their behalf, so each resource keeps enforcing its own permission gate.
---
--- The payload is a SECTION DELTA: only the top-level sections the admin
--- actually touched, each as its complete current value, with
--- `sectionReplace` so deletions inside a section propagate. Sending the whole
--- config would make one changed toggle rewrite everything.
RegisterNUICallback('SAVE_SCRIPT_STUDIO', function(payload, cb)
  local resource = type(payload) == 'table' and payload.resource
  if type(resource) ~= 'string' or resource == '' then
    return cb({ success = false, _error = 'NoResource' })
  end
  if type(payload.data) ~= 'table' then
    return cb({ success = false, _error = 'InvalidPayload' })
  end

  local ok, success, err, meta = pcall(function()
    return lib.callback.await(('%s:updateScriptConfig'):format(resource), {
      data            = payload.data,
      expectedVersion = payload.expectedVersion,
      sectionReplace  = true,
    })
  end)

  if not ok then return cb({ success = false, _error = 'CallbackFailed' }) end
  cb({ success = success == true, _error = err, meta = meta })
end)

--- Fetch a resource's own Script Studio component, as source.
---
--- The Studio is dirk_lib's NUI bundle, so a component living in another
--- resource's bundle is not something it can import - different bundle,
--- different origin. Lua has no such problem: LoadResourceFile reads any
--- started resource's declared files, so the code is fetched HERE and handed to
--- the panel to evaluate.
---
--- That also keeps the rule this whole design rests on: dirk_lib ships no
--- per-script code. It renders what a script gives it, sight unseen.
---
--- Only resources that actually declare `dirk_lib 'scriptConfig'` are readable,
--- and only from inside their own web build - so this cannot be used to read
--- arbitrary files out of arbitrary resources.
RegisterNUICallback('GET_STUDIO_COMPONENT', function(payload, cb)
  local resource = type(payload) == 'table' and payload.resource
  local path     = type(payload) == 'table' and payload.path

  if type(resource) ~= 'string' or type(path) ~= 'string' then
    return cb({ ok = false, _error = 'BadRequest' })
  end
  if GetResourceState(resource) ~= 'started' then
    return cb({ ok = false, _error = 'NotStarted' })
  end
  -- No traversal, and nothing outside the resource's built web assets.
  if path:find('%.%.') or not path:match('^web/build/[%w%-%._/]+%.js$') then
    return cb({ ok = false, _error = 'BadPath' })
  end

  local declares = false
  for i = 0, (GetNumResourceMetadata(resource, 'dirk_lib') or 0) - 1 do
    if GetResourceMetadata(resource, 'dirk_lib', i) == 'scriptConfig' then
      declares = true
      break
    end
  end
  if not declares then return cb({ ok = false, _error = 'NotAConsumer' }) end

  local source = LoadResourceFile(resource, path)
  if not source then return cb({ ok = false, _error = 'NotFound' }) end

  cb({ ok = true, source = source })
end)

--- Locale bundles for the Script Studio.
---
--- The panel resolves every label through the OWNING script's bundle, falling
--- back to English and then to the schema's own text - but nothing was ever
--- fetching those bundles, so `state.locales` stayed on its browser mock and
--- changing the language changed nothing on screen.
---
--- Fetched per language rather than all at once: fishing alone ships nine
--- files of ~900 keys, and sending every language on open would be most of a
--- megabyte to answer a question nobody has asked yet.
---
--- Consumer bundles are filtered to the keys the panel can actually use.
--- dirk_lib's own bundle comes whole, because it holds the panel's chrome.
---
--- Only the languages asked for - but more than one per call. A non-English panel
--- needs its own language and English (the fallback), and asking for them one
--- after the other was two NUI round trips in a row before any label could
--- settle. `languages` answers { [lang] = { [resource] = bundle } };
--- `language` (one) keeps its old flat shape for anything still asking that way.
local function readLocaleBundles(language, resources)
  local out = {}
  for i = 1, #resources do
    local resource = resources[i]
    if type(resource) == 'string' and GetResourceState(resource) == 'started' then
      local raw = LoadResourceFile(resource, ('locales/%s.json'):format(language))
      if raw then
        local ok, decoded = pcall(json.decode, raw)
        if ok and type(decoded) == 'table' then
          if resource == GetCurrentResourceName() then
            out[resource] = decoded
          else
            -- Only what the panel looks up. A script's gameplay strings are
            -- its own business and have no reason to cross into the panel.
            -- studio.* is the panel's too: a script's page tab labels and the
            -- words inside its own pages and controls (t()). Dropping them left
            -- fishing's Players tab English on a German panel (30/09).
            local slim = {}
            for key, value in pairs(decoded) do
              if type(key) == 'string'
                and (key:sub(1, 9) == 'settings.' or key:sub(1, 9) == 'sections.' or key:sub(1, 7) == 'studio.') then
                slim[key] = value
              end
            end
            if next(slim) then out[resource] = slim end
          end
        end
      end
    end
  end
  return out
end

local function isLanguageCode(language)
  return type(language) == 'string' and language ~= '' and #language <= 16 and not language:find('[^%w%-_]')
end

RegisterNUICallback('GET_STUDIO_LOCALES', function(payload, cb)
  local resources = type(payload) == 'table' and payload.resources
  if type(resources) ~= 'table' then return cb({}) end

  local languages = type(payload) == 'table' and payload.languages
  if type(languages) == 'table' then
    local out = {}
    for i = 1, math.min(#languages, 4) do
      local language = languages[i]
      if isLanguageCode(language) then out[language] = readLocaleBundles(language, resources) end
    end
    return cb(out)
  end

  local language = type(payload) == 'table' and payload.language
  if not isLanguageCode(language) then return cb({}) end
  cb(readLocaleBundles(language, resources))
end)
