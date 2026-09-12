-- --------------------------------------------------
-- GLOBAL /dirk_config CLIENT HANDLER
-- --------------------------------------------------
-- Receives the chooser list from the server, opens dirk_lib's own NUI, and
-- forwards the selected resource back for dispatch.

local chooserOpen = false
local studioOpen = false

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
-- player may edit; the VALUES are pulled per resource from that resource's own
-- permission-gated `getFullScriptConfig`, so server-only values keep travelling
-- through the one path that checks who is asking.

local function closeStudio()
  if not studioOpen then return end
  studioOpen = false
  SendNuiMessage(json.encode({ action = 'CLOSE_SCRIPT_STUDIO' }))
  SetNuiFocus(false, false)
end

-- Schemas cache locally, keyed by CONTENT hash - so a repeat open transfers
-- no schema at all, and an edited schema (even without a version bump) misses
-- the cache and comes down fresh. Safe to share across servers: the key is
-- the content itself, so a hit is by definition the right text.
local function schemaKvpKey(resource)
  return ('dirk_lib_studioSchema_%s'):format(resource)
end

local function readCachedSchema(resource)
  local raw = GetResourceKvpString(schemaKvpKey(resource))
  if not raw or raw == '' then return nil end
  local ok, decoded = pcall(json.decode, raw)
  return ok and decoded or nil
end

-- Overlay the server-only sliver onto the client-visible values, in place.
local function mergeInto(target, extra)
  for key, value in pairs(extra) do
    if type(value) == 'table' and type(target[key]) == 'table' then
      mergeInto(target[key], value)
    else
      target[key] = value
    end
  end
end

--- Everything the panel needs: schemas (cached by content hash) and values
--- (from each script's own client VM, plus its server-only sliver).
---
--- Extracted from the open handler so a REFRESH can run exactly the same
--- gather. The panel had a Refresh button and a reloadFromServer() that asked
--- for 'GET_SCRIPT_STUDIO' - a NUI callback that was never registered, so it
--- always got the empty fallback and silently did nothing.
local function buildStudioPayload()
  -- Tell the server which schemas we already hold, so it only sends what
  -- changed. First ever open pays the full transfer; every one after costs a
  -- list of hashes.
  local known, cached = {}, {}
  do
    -- The server decides which resources we may see, so ask it cheaply first?
    -- No - the hashes ARE the ask. Reading a stale KVP entry for a resource
    -- the server no longer offers just means an unused key.
    local total = GetNumResources()
    for i = 0, total - 1 do
      local name = GetResourceByFindIndex(i)
      if name then
        local hit = readCachedSchema(name)
        if hit and hit.hash and hit.schemaJson then
          known[name] = hit.hash
          cached[name] = hit
        end
      end
    end
  end

  local scripts = lib.callback.await('dirk_lib:getScriptStudio', known)
  if type(scripts) ~= 'table' or #scripts == 0 then return nil end

  for i = 1, #scripts do
    local entry = scripts[i]
    if entry.schemaJson then
      -- Fresh from the server: remember it for next time.
      SetResourceKvp(schemaKvpKey(entry.resource),
        json.encode({ hash = entry.hash, schemaJson = entry.schemaJson }))
    else
      -- The server held it back because our hash matched, so the cached text
      -- IS this schema.
      entry.schemaJson = cached[entry.resource] and cached[entry.resource].schemaJson
    end
  end

  -- Values come from each script's OWN client VM - this client already holds
  -- every config, kept current by the engine, so nothing is re-downloaded.
  -- Only the server-only sliver (webhook URLs and the like) comes over the
  -- wire, per script, permission-gated, and in PARALLEL - the old flow
  -- re-fetched every full config one after another and held the panel shut
  -- until the last one landed.
  local pending = 0
  for i = 1, #scripts do
    local entry = scripts[i]
    pending += 1
    CreateThread(function()
      local ok, snap = pcall(function()
        return exports[entry.resource]:dirkStudioSnapshot()
      end)

      if ok and type(snap) == 'table' and snap.loaded and type(snap.config) == 'table' then
        entry.values = lib.table.deepClone(snap.config)
        entry.clientVersion = snap.client_version
      else
        -- The consumer has not finished its own first load (or predates the
        -- export). The old full fetch still exists and still checks who is
        -- asking, so fall back to it rather than showing an empty script.
        local ok2, success, _err, payload = pcall(function()
          -- Short deadline: this resource may be mid-restart, and one script
          -- being unreachable must cost one empty script, not a frozen open.
          return lib.callback.awaitTimeout(('%s:getFullScriptConfig'):format(entry.resource), 5000)
        end)
        local got = (ok2 and success and type(payload) == 'table') and payload or nil
        entry.values = (got and type(got.config) == 'table') and got.config or {}
        entry.clientVersion = got and got.clientVersion or nil
      end

      -- The sliver: nil for view-level admins, tiny for editors.
      local ok3, success3, _err3, extra = pcall(function()
        return lib.callback.awaitTimeout(('%s:getServerOnlyScriptConfig'):format(entry.resource), 5000)
      end)
      if ok3 and success3 and type(extra) == 'table' then
        if type(extra.serverOnly) == 'table' then mergeInto(entry.values, extra.serverOnly) end
        entry.clientVersion = extra.clientVersion or entry.clientVersion
      end

      pending -= 1
    end)
  end
  while pending > 0 do Wait(10) end

  return scripts
end

RegisterNetEvent('dirk_lib:openScriptStudio', function(focus, askLanguage)
  if studioOpen then return end
  studioOpen = true

  local scripts = buildStudioPayload()
  if not scripts then
    studioOpen = false
    lib.notify({ type = 'error', description = 'No script settings available.' })
    return
  end

  SetNuiFocus(true, true)
  SendNuiMessage(json.encode({
    action = 'OPEN_SCRIPT_STUDIO',
    data = { scripts = scripts, focus = focus, askLanguage = askLanguage or false },
  }))
end)

--- Re-gather without reopening. Backs the Refresh button, and the automatic
--- rebuild when a script restarts underneath an open panel.
RegisterNUICallback('GET_SCRIPT_STUDIO', function(_, cb)
  cb(buildStudioPayload() or {})
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
RegisterNUICallback('GET_STUDIO_LOCALES', function(payload, cb)
  local language = type(payload) == 'table' and payload.language
  if type(language) ~= 'string' or language == '' or language:find('[^%w%-_]') then
    return cb({})
  end

  local resources = type(payload) == 'table' and payload.resources
  if type(resources) ~= 'table' then return cb({}) end

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
            local slim = {}
            for key, value in pairs(decoded) do
              if type(key) == 'string'
                and (key:sub(1, 9) == 'settings.' or key:sub(1, 9) == 'sections.') then
                slim[key] = value
              end
            end
            if next(slim) then out[resource] = slim end
          end
        end
      end
    end
  end

  cb(out)
end)
