local scriptName = GetCurrentResourceName()
local hasUI = (GetNumResourceMetadata(cache.resource, 'ui_page') or 0) > 0
scriptConfig = scriptConfig or {}
local clientVersion = 0
local settingsUiOpen = false
local openEventName = ('%s:openScriptConfig'):format(scriptName)
local nuiReady = false
local settingsLoaded = false
local scriptConfigWatchers = {}
local nextScriptConfigWatcherId = 0
local resourceVersion = GetResourceMetadata(scriptName, 'version', 0) or 'dev'

-- Single-shot back-handler hook. Consumers that open the configurator from
-- their own UI (e.g. dirk_multichar's character-list cog) install a handler
-- right before triggering the open flow; it runs in place of the default
-- "reopen chooser" branch when the user hits Back, then is cleared so the
-- next standalone /<resource> open still drops into the chooser as normal.
local customBackHandler = nil

local function debugLog(msg)
  -- print(('[scriptConfig:%s] %s'):format(scriptName, msg))
end

local function cloneValue(value)
  if type(value) ~= 'table' then return value end
  return lib.table.deepClone(value)
end

local function isEqualValue(a, b)
  if type(a) ~= type(b) then return false end
  if type(a) ~= 'table' then return a == b end
  return lib.table.compare(a, b) and lib.table.compare(b, a)
end

local function getValueAtPath(data, path)
  if path == '*' or path == '' or path == nil then
    return data
  end

  local current = data
  for segment in path:gmatch('[^.]+') do
    if type(current) ~= 'table' then return nil end
    current = current[segment]
  end

  return current
end

local function pathsOverlap(watchPath, changedPath)
  if watchPath == '*' then return true end
  if watchPath == changedPath then return true end
  if not changedPath or changedPath == '' then return false end

  return watchPath:sub(1, #changedPath + 1) == changedPath .. '.'
    or changedPath:sub(1, #watchPath + 1) == watchPath .. '.'
end

-- Records every leaf under a removed subtree as {path, old, new=nil}. Used by
-- collectChangedLeaves' removal pass below. Mirrors the server copy.
local function collectRemovedLeaves(oldValue, path, out)
  if type(oldValue) ~= 'table' or next(oldValue) == nil then
    out[#out + 1] = { path = path, old = oldValue, new = nil }
    return out
  end
  for key, v in pairs(oldValue) do
    collectRemovedLeaves(v, path .. '.' .. key, out)
  end
  return out
end

local function collectChangedLeaves(partial, previous, path, out)
  if type(partial) ~= 'table' then return out end
  out = out or {}

  for key, value in pairs(partial) do
    local nextPath = path and (path .. '.' .. key) or key
    local oldValue = type(previous) == 'table' and previous[key] or nil

    if type(value) == 'table' then
      collectChangedLeaves(value, oldValue, nextPath, out)
    else
      if not isEqualValue(oldValue, value) then
        out[#out + 1] = {
          path = nextPath,
          old = oldValue,
          new = value,
        }
      end
    end
  end

  -- Removal-aware pass (mirrors server): a key/element present in `previous`
  -- but absent from the new config is a deletion. Without this, client-side
  -- watchers never fire on a pure removal.
  if type(previous) == 'table' then
    for key, oldValue in pairs(previous) do
      if partial[key] == nil then
        collectRemovedLeaves(oldValue, path and (path .. '.' .. key) or key, out)
      end
    end
  end

  return out
end

local function notifyWatcher(watcher, current, previous, changedPaths, source, forceInitial)
  if forceInitial then
    if not watcher.immediate or watcher.initialDelivered then
      return false
    end
  elseif #changedPaths == 0 then
    return false
  end

  local newValue = cloneValue(getValueAtPath(current, watcher.path))
  local oldValue = cloneValue(getValueAtPath(previous, watcher.path))

  if not forceInitial and watcher.path ~= '*' and isEqualValue(oldValue, newValue) then
    return false
  end

  local ok, err = pcall(watcher.cb, newValue, oldValue, {
    path = watcher.path,
    changedPaths = changedPaths,
    source = source,
    current = current,
    previous = previous,
  })

  if not ok then
    lib.print.error(('[scriptConfig:%s] watcher for "%s" failed: %s'):format(scriptName, watcher.path, tostring(err)))
  end

  watcher.initialDelivered = true
  return watcher.once == true
end

--- Guards against a watcher that causes another dispatch while it is running.
---
--- A watcher is free to read config, and reading it can reach
--- ensureSettingsLoaded, which dispatches - so a watcher could re-enter this
--- function, re-run itself, and recurse until the C stack gave out. That is
--- exactly what dirk_phone's zoneLabels handler did on every join during the
--- server's NotReady window.
---
--- The nested call is dropped rather than queued: the outer pass is already
--- delivering the same `current`, so re-running every watcher would only hand
--- them what they are being handed anyway.
local dispatching = false

--- Tell dirk_lib what colours this resource wears.
---
--- dirk_lib draws every shared UI on ITS OWN page, so without this a dialogue
--- opened by a resource with its own theme comes up in dirk_lib's colours.
--- This module is the right place to send it from because it runs inside the
--- CONSUMER — it is the only code that sees another resource's config at all.
---
--- Sent on every application of the config, which covers both moments that
--- matter: the first hydration and every later edit. No startup special case,
--- no polling, and nothing for a script author to remember.
local lastTheme
local function announceTheme(current)
  if scriptName == 'dirk_lib' then return end

  local theme = current and current.theme
  -- A resource with no `theme` block never announces, so dirk_lib has no entry
  -- for it and falls back to the global appearance. Which is correct, and is
  -- the behaviour every resource has today.
  if type(theme) ~= 'table' then return end

  local stamp = json.encode(theme)
  if stamp == lastTheme then return end
  lastTheme = stamp

  pcall(function()
    exports.dirk_lib:registerTheme(GetCurrentResourceName(), theme)
  end)
end

local function dispatchScriptConfigWatchers(current, previous, changedLeaves, source, forceInitial)
  -- Before the watcher guard: a resource with no watchers still has a theme.
  announceTheme(current)

  if not next(scriptConfigWatchers) then return end
  if dispatching then return end
  dispatching = true

  -- pcall'd so the flag ALWAYS clears. A stuck flag would silently drop every
  -- future config update for this resource - a far worse failure than the
  -- recursion it guards against, and one with no symptom to trace.
  local ok, err = pcall(function()
    for watcherId, watcher in pairs(scriptConfigWatchers) do
      local changedPaths = {}

      if not forceInitial then
        for i = 1, #(changedLeaves or {}) do
          local changedPath = changedLeaves[i].path
          if pathsOverlap(watcher.path, changedPath) then
            changedPaths[#changedPaths + 1] = changedPath
          end
        end
      end

      if notifyWatcher(watcher, current, previous, changedPaths, source, forceInitial) then
        scriptConfigWatchers[watcherId] = nil
      end
    end
  end)

  dispatching = false
  if not ok then
    lib.print.error(('[scriptConfig:%s] watcher dispatch failed: %s'):format(scriptName, tostring(err)))
  end
end

local function onScriptConfig(path, cb, options)
  assert(type(path) == 'string' and path ~= '', 'scriptConfig.on requires a non-empty path string')
  assert(type(cb) == 'function', 'scriptConfig.on requires a callback function')

  options = options or {}
  nextScriptConfigWatcherId = nextScriptConfigWatcherId + 1

  local watcher = {
    id = nextScriptConfigWatcherId,
    path = path,
    cb = cb,
    once = options.once == true,
    immediate = options.immediate ~= false,
    initialDelivered = false,
  }

  scriptConfigWatchers[watcher.id] = watcher

  if settingsLoaded and watcher.immediate then
    if notifyWatcher(watcher, scriptConfig, nil, { path }, 'initial', true) then
      scriptConfigWatchers[watcher.id] = nil
    end
  elseif settingsLoaded then
    watcher.initialDelivered = true
  end

  return function()
    scriptConfigWatchers[watcher.id] = nil
  end
end

-- The cached config is NOT applied until the server has vouched for it.
--
-- KVP is keyed per resource, not per server, so `dirk_fishing_scriptConfig` is
-- one slot shared by every server the player visits that runs a resource of
-- that name. The old code assigned that blob to `scriptConfig` immediately and
-- only then asked the server, so between those two points a player who also
-- plays elsewhere was live on ANOTHER server's shop hours, zones and language.
--
-- Scoping the key by endpoint or a server id was the obvious answer and is the
-- wrong one - both are defeated by a cloned server, and neither closes the
-- window, it only narrows it. Holding the blob aside until the server confirms
-- its hash closes it completely, and costs nothing on the wire: the hash goes
-- up either way, and a match still returns no payload.
local fetchFromKVP = function()
  local raw = GetResourceKvpString(('%s_scriptConfig'):format(scriptName))
  if not raw or raw == '' then return nil end
  return json.decode(raw)
end

local updateKVP = function(ver, data)
  SetResourceKvp(('%s_scriptConfig'):format(scriptName), json.encode({
    client_version = ver,
    data = data,
  }))
end

local sendSettingsToNui = function()
  if not hasUI or not scriptConfig then return end
  debugLog(('sendSettingsToNui called (nuiReady=%s)'):format(tostring(nuiReady)))
  SendNuiMessage(json.encode({
    action = 'UPDATE_SCRIPT_CONFIG',
    data = {
      config = scriptConfig,
      clientVersion = clientVersion,
    },

  }))
end

-- What happens when the server has no config to give yet.
--
-- On a cold boot the server answers 'NotReady' until it has finished merging
-- the stored config over the schema. That is transient - but it used to be
-- permanent, because the fetch result was ignored and `settingsLoaded` was set
-- regardless. The guard at the top of ensureSettingsLoaded then answered every
-- later call from cache, so that client served DEFAULTS for the rest of its
-- session and never asked again.
--
-- That is the whole bug behind "my shop times are wrong", "the zone I drew is
-- invisible to players" and "players see English while I see Lithuanian" - the
-- language, the zones and the shop hours are all config, and an admin looked
-- fine only because opening the panel forces a fresh fetch.
local RETRY_FIRST_MS, RETRY_MAX_MS = 1000, 30000
local retrying = false
local lastAttemptAt, attempts = 0, 0
-- Read from KVP but NOT applied - see the note above fetchFromKVP.
local pendingCache = nil
local reportedFailure = false

--- One attempt.
---
--- Three answers, and only one of them is a failure - which is the trap the
--- first version of this fix fell into:
---
---   table         a fresh config
---   nil, nil      "you are already up to date" - the NORMAL answer for any
---                 client whose KVP cache matches the server's hash
---   nil, reason   the server has no config yet ('NotReady'), still booting
---
--- Treating a bare nil as a failure would put every healthy cached client into
--- a permanent retry loop and warn about a server that is working fine.
local reportedSilence = false

local function fetchFromServer()
  attempts += 1
  lastAttemptAt = GetGameTimer()
  -- A request the server never answers is a THROW, not a reply: the callback
  -- module rejects its promise after five minutes and `await` raises. Unwrapped,
  -- that raise killed this retry thread, so one dropped request left the client
  -- on defaults for the whole session with a bare "timed out" in F8.
  --
  -- And "never answered" is a specific thing. Every server-side path replies -
  -- a handler error comes back as `false`, a config still building comes back
  -- as NotReady within 20s - so total silence means the request was dropped
  -- before it reached the handler. In practice that is an anti-cheat or event
  -- filter blocking the `__dirk_cb_` event, or the server half not running.
  -- Say that, once, and keep retrying.
  local ok, reply, reason = pcall(lib.callback.await, ('%s:getScriptConfig'):format(scriptName), clientVersion or -1)
  if not ok then
    if not reportedSilence then
      reportedSilence = true
      lib.print.error(('scriptConfig [%s]: the server never answered the config request (%s). '
        .. 'This is not a slow server - a slow one replies NotReady. Something dropped the event '
        .. '`__dirk_cb_%s:getScriptConfig` before it reached the script: check any anti-cheat or '
        .. 'event filter for it, and that %s is started server-side. Still retrying.')
        :format(scriptName, tostring(reply), scriptName, scriptName))
      TriggerServerEvent('dirk_lib:scriptConfigFetch', scriptName, 'silent', attempts)
    end
    return false
  end
  debugLog(('fetchFromServer returned (type=%s, reason=%s, attempt=%d)')
    :format(type(reply), tostring(reason), attempts))

  if type(reply) == 'table' then
    scriptConfig = reply.data or scriptConfig
    clientVersion = reply.client_version or clientVersion
    updateKVP(clientVersion, scriptConfig)
    return true
  end

  -- "Up to date": the server only says this when its hash equals the one we
  -- sent, so the blob we were holding is provably THIS server's. Apply it now.
  if reason == nil then
    if pendingCache then
      scriptConfig = pendingCache.data or scriptConfig
      clientVersion = pendingCache.client_version or clientVersion
      pendingCache = nil
    end
    return true
  end

  return false
end

--- Set by the server the moment it has a config to serve, so a waiting client
--- can stop sitting out a backoff it no longer needs.
local serverAnnouncedReady = false

RegisterNetEvent(('%s:scriptConfigReady'):format(scriptName), function()
  serverAnnouncedReady = true
end)

local function startRetrying()
  if retrying then return end
  retrying = true

  CreateThread(function()
    local wait = RETRY_FIRST_MS
    while not settingsLoaded do
      -- Wait for the backoff OR the server saying it is ready, whichever
      -- comes first. A resource restarting under live players starts both
      -- halves at once, so the first ask is always too early - and polling
      -- blind meant a wasted attempt and a second on defaults every time.
      -- Now the announcement wakes us the instant there is something to get.
      local waited = 0
      while waited < wait and not serverAnnouncedReady do
        Wait(50)
        waited += 50
      end
      serverAnnouncedReady = false
      wait = math.min(wait * 2, RETRY_MAX_MS)

      if fetchFromServer() then
        settingsLoaded = true
        lib.print.info(('scriptConfig [%s]: config arrived after %d attempt(s); settings are live.')
          :format(scriptName, attempts))
        -- Everything that read a default in the meantime gets told the truth.
        dispatchScriptConfigWatchers(scriptConfig, nil, nil, 'load', true)
        if hasUI then sendSettingsToNui() end
        TriggerServerEvent('dirk_lib:scriptConfigFetch', scriptName, 'recovered', attempts)
        break
      end

      -- Said once, not every retry, so a struggling server does not flood F8.
      if not reportedFailure then
        reportedFailure = true
        lib.print.warn(('scriptConfig [%s]: the server has not finished building its config yet '
          .. '(%d attempts, usually a cold boot). Running on DEFAULTS until it does - shop hours, '
          .. 'zones and language will not match the panel. Still retrying.'):format(scriptName, attempts))
        TriggerServerEvent('dirk_lib:scriptConfigFetch', scriptName, 'failed', attempts)
      end
    end
    retrying = false
  end)
end

local function ensureSettingsLoaded(forceRefresh)
  local previousSettings = settingsLoaded and cloneValue(scriptConfig) or nil

  if settingsLoaded and not forceRefresh then
    return scriptConfig
  end

  debugLog(('ensureSettingsLoaded start (forceRefresh=%s)'):format(tostring(forceRefresh)))

  if not forceRefresh then
    -- Held, not applied. Only the hash goes up; the data stays parked until
    -- the server confirms it, so a blob left by another server can never be
    -- live - not even for the moment it takes to ask.
    pendingCache = fetchFromKVP()
    if pendingCache then clientVersion = pendingCache.client_version or 0 end
    debugLog(('ensureSettingsLoaded kvp read (hasKvp=%s, version=%s, applied=no)')
      :format(tostring(pendingCache ~= nil), tostring(clientVersion)))
  end

  -- Callers reach this on demand (lib.scriptConfig.get). While a retry thread
  -- is already running, do not add another blocking await on top of it - hand
  -- back what we have and let the retry finish.
  local canAttempt = not retrying or forceRefresh
    or (GetGameTimer() - lastAttemptAt) > RETRY_FIRST_MS

  if canAttempt and fetchFromServer() then
    settingsLoaded = true
  elseif not settingsLoaded then
    -- NOT marked loaded. That single line was the bug: it made a failed fetch
    -- permanent, because the early return above then answered every later call.
    startRetrying()
    -- And NO dispatch: nothing arrived. Dispatching here fed watchers the
    -- defaults - and a watcher that itself reads config (phone's zoneLabels
    -- does) re-entered this function, which dispatched again, which re-ran
    -- the watcher... down to a C stack overflow on every cold boot. Watchers
    -- get their one real delivery when the retry lands.
    return scriptConfig
  end

  dispatchScriptConfigWatchers(scriptConfig, previousSettings, nil, forceRefresh and 'refresh' or 'load', true)
  debugLog(('ensureSettingsLoaded complete (loaded=%s, version=%s)')
    :format(tostring(settingsLoaded), tostring(clientVersion)))
  return scriptConfig
end

CreateThread(function()
  debugLog('init thread started')
  ensureSettingsLoaded()

  if hasUI then
    debugLog('waiting for NUI_READY')
    while not nuiReady do Wait(50) end
    debugLog('NUI_READY confirmed, sending settings')
    sendSettingsToNui()
  end

  debugLog('init thread complete')
end)

-- ──────────────────────────────────────
-- UI OPEN / CLOSE
-- ──────────────────────────────────────
local closeSettingsUi

local openSettingsUi = function()
  debugLog(('openSettingsUi called (hasUI=%s, settingsUiOpen=%s, nuiReady=%s)'):format(
    tostring(hasUI), tostring(settingsUiOpen), tostring(nuiReady)))

  if not hasUI then debugLog('openSettingsUi -> no UI page') return end
  if settingsUiOpen then debugLog('openSettingsUi -> already open') return end
  if not nuiReady then
    debugLog('openSettingsUi -> NUI not ready')
    lib.notify({
      title = 'Script Config',
      description = 'Settings UI is still loading, please try again.',
      type = 'inform',
    })
    return
  end


  settingsUiOpen = true
  -- Lifecycle event for the admin-tool subsystem (modules/scriptConfig/admin).
  -- Flips the shared `adminEditing` flag so position/goto/etc tools become
  -- callable. Fired AFTER server-side perms validation (the server only
  -- triggers `<resource>:openScriptConfig` when canEditScript passes).
  TriggerEvent('dirk_lib:scriptConfigOpened', scriptName)

  while IsScreenblurFadeRunning() do Wait(0) end
  TriggerScreenblurFadeIn(0)
  SetNuiFocus(true, true)

  -- Once we hold focus the chooser can safely release its own claim.
  -- Without this, dirk_lib still holds focus from the chooser handoff,
  -- and our SetNuiFocus(false,false) on close only releases this resource —
  -- the cursor stays visible because dirk_lib never let go.
  if scriptName ~= 'dirk_lib' then
    pcall(function() exports['dirk_lib']:releaseScriptConfigChooserFocus() end)
  end

  local ped = cache.ped
  local coords = GetEntityCoords(ped)
  local heading = GetEntityHeading(ped)
  debugLog(('openSettingsUi -> ped=%s coords=%s heading=%s'):format(
    tostring(ped), tostring(coords), tostring(heading)))

  SendNuiMessage(json.encode({
    action = 'OPEN_ADMIN_SECTION',
    data = {
      myPos = { x = coords.x, y = coords.y, z = coords.z, w = heading },
    },
  }))
end

closeSettingsUi = function(opts)
  debugLog(('closeSettingsUi called (hasUI=%s, settingsUiOpen=%s)'):format(
    tostring(hasUI), tostring(settingsUiOpen)))
  if not hasUI then return end
  if not settingsUiOpen then return end
  settingsUiOpen = false
  -- Mirror of the open event — flips the admin-tool subsystem flag back to
  -- false so position/goto/etc tools can't be triggered once the panel is
  -- gone, even if a stale NUI iframe somehow stays alive.
  TriggerEvent('dirk_lib:scriptConfigClosed', scriptName)

  -- Drain the consumer-installed back handler under the same shot regardless
  -- of which exit path closed the panel (CONFIG_PANEL_BACK button, Esc key,
  -- × close button, etc.). Lets a consumer that opened us from its own UI
  -- (e.g. dirk_multichar's character-list cog) keep NUI focus claimed instead
  -- of getting it yanked when the admin hits Esc.
  local handler = customBackHandler
  customBackHandler = nil

  SendNuiMessage(json.encode({ action = 'CLOSE_ADMIN_SECTION' }))

  if handler then
    pcall(handler)
    -- Handler is responsible for focus from here. Don't release ours.
  elseif not (opts and opts.keepFocus) then
    -- Default behaviour: release focus unless caller asked to keep it (e.g.
    -- back path that's about to hand off to the chooser).
    SetNuiFocus(false, false)
  end
  TriggerScreenblurFadeOut(0)
  debugLog('closeSettingsUi -> done')
end

-- ──────────────────────────────────────
-- NUI CALLBACKS
-- ──────────────────────────────────────
if hasUI then
  RegisterNuiCallback('NUI_READY', function(_, cb)
    debugLog('NUI_READY received')
    nuiReady = true
    -- Notify any other code in this resource that wants to gate SendNuiMessage
    -- on the iframe being mounted (e.g. server-driven push events that fire
    -- during resource start, before React has rendered).
    TriggerEvent('dirk_lib:nuiReady')
    -- Re-push the current config on every NUI (re)mount. The one-shot init
    -- thread pushes once on first load (it waits on this flag), but a NUI
    -- remount WITHOUT a resource restart would otherwise land on an empty
    -- store now that DirkProvider no longer does a proactive full fetch.
    -- sendSettingsToNui self-guards on scriptConfig and SendNuiMessage is
    -- local (no net/KVP cost); UPDATE_SCRIPT_CONFIG is idempotent, so the
    -- extra push that overlaps the init thread's first-load push is harmless.
    sendSettingsToNui()
    cb({})
  end)

  RegisterNuiCallback('GET_RESOURCE_VERSION', function(_, cb)
    cb({ version = resourceVersion })
  end)

  RegisterNuiCallback('CLOSE_ADMIN_SECTION', function(_, cb)
    closeSettingsUi()
    cb({})
  end)

  RegisterNuiCallback('CONFIG_PANEL_BACK', function(_, cb)
    -- A consumer installed a custom back handler — closeSettingsUi will fire
    -- it and keep focus claimed (see the handler-drain branch in that fn).
    -- We just need to close; no chooser reopen.
    if customBackHandler then
      closeSettingsUi()
      cb({})
      return
    end

    -- Hand off to dirk_lib's chooser without a focus flicker. We keep our
    -- focus claim during the server roundtrip, then poll dirk_lib for
    -- chooser-open state and drop our claim only AFTER it has taken focus.
    -- Polling (vs. a fixed Wait) avoids both: dropping focus before the
    -- chooser claims it (cursor disappears) and dropping it well after
    -- (cursor stays visible across an unfocused frame).
    --
    -- Skip the explicit drop entirely when this IS dirk_lib's own config —
    -- per-script and chooser share the resource, so SetNuiFocus(false,false)
    -- here would clobber the focus the chooser just claimed.
    closeSettingsUi({ keepFocus = true })
    TriggerServerEvent('dirk_lib:reopenScriptConfigChooser')
    if scriptName ~= 'dirk_lib' then
      CreateThread(function()
        local elapsed = 0
        while elapsed < 2000 do
          Wait(30)
          elapsed = elapsed + 30
          local ok, open = pcall(function()
            return exports['dirk_lib']:isScriptConfigChooserOpen()
          end)
          if ok and open then break end
        end
        if not settingsUiOpen then
          SetNuiFocus(false, false)
        end
      end)
    end
    cb({})
  end)

  RegisterNuiCallback('FETCH_ALL_ITEMS', function(_, cb)
    cb(lib.inventory.items())
  end)

  RegisterNuiCallback('GIVE_SCRIPT_CONFIG_ITEM', function(data, cb)
    local success, err = lib.callback.await(('%s:giveScriptConfigItem'):format(scriptName), data or {})
    cb({ success = success, _error = err })
  end)

  RegisterNuiCallback('GET_MISSING_ITEMS', function(_, cb)
    local success, _error, data = lib.callback.await(('%s:getMissingItems'):format(scriptName))
    cb({ success = success, _error = _error, data = data })
  end)

  RegisterNuiCallback('GET_FULL_SCRIPT_CONFIG', function(_, cb)
    local success, _error, data = lib.callback.await(('%s:getFullScriptConfig'):format(scriptName))
    cb({ success = success, _error = _error, data = data })
  end)

  -- Server-only "sliver" bridge for the admin editor. Mirrors the
  -- GET_FULL_SCRIPT_CONFIG handler above but hits the new server callback that
  -- returns ONLY the locked (x-serverOnly) subtree. The editor fetches this
  -- once on panel open and MERGES it onto the already-cached client-visible
  -- config (pushed via UPDATE_SCRIPT_CONFIG) to form the full editor view —
  -- never re-fetching the whole config. Permission is enforced server-side
  -- (canEditScript); a non-admin gets {success=false,_error='NoPermission'}.
  -- The sliver is in-memory only — it is NOT written to KVP.
  RegisterNuiCallback('GET_SERVER_ONLY_SCRIPT_CONFIG', function(_, cb)
    local success, _error, data = lib.callback.await(('%s:getServerOnlyScriptConfig'):format(scriptName))
    cb({ success = success, _error = _error, data = data })
  end)
end

-- What Script Studio reads instead of re-downloading this resource's config.
--
-- The client already HOLDS the client-visible config - hydrated from KVP,
-- confirmed by hash, kept current by updateScriptConfig pushes. Fetching it
-- again from the server on every panel open re-sent hundreds of kilobytes to
-- say what this VM already knew. The panel merges the small server-only
-- sliver (a separate, permission-gated call) on top of this.
exports('dirkStudioSnapshot', function()
  return {
    loaded = settingsLoaded,
    config = scriptConfig,
    client_version = clientVersion,
    -- How many asks it took. The whole cold-boot bug was invisible because
    -- nothing outside this file could see it: a client that gave up and ran on
    -- defaults looked identical to one that never needed to retry. Exposed so a
    -- test can assert the config arrived FIRST time, which is the only
    -- statement that actually distinguishes a fixed server from a lucky one.
    attempts = attempts,
  }
end)

-- ──────────────────────────────────────
-- EVENTS
-- ──────────────────────────────────────
RegisterNetEvent(openEventName, openSettingsUi)

lib.onCache('dead', function(isDead)
  if isDead then closeSettingsUi() end
end)

-- ──────────────────────────────────────
-- UPDATE / HISTORY / RESET
-- ──────────────────────────────────────
local updateScriptConfig = function(data, expectedVersion, sectionReplace)
  return lib.callback.await(('%s:updateScriptConfig'):format(scriptName), {
    data = data,
    expectedVersion = expectedVersion or clientVersion,
    -- Carry the section-delta flag through to the server. Without this the
    -- server sees no flag, defaults to fullReplace=true, and a partial (delta)
    -- payload wipes every unsent section. nil (not false) when off so the
    -- server's `payload.sectionReplace == true` gate reads cleanly.
    sectionReplace = sectionReplace == true or nil,
  })
end

RegisterNetEvent(('%s:updateScriptConfig'):format(scriptName), function(data, new_version, fullReplace, sectionReplace)
  local previousSettings = cloneValue(scriptConfig)
  if sectionReplace then
    -- Section-delta: `data` holds only the changed top-level sections, each as
    -- its full value. WHOLESALE-overwrite those keys (leaving other sections
    -- intact) so deletions inside a section propagate — lib.table.merge would
    -- deep-recurse and never truncate an array, leaving e.g. a deleted store
    -- alive on the client.
    for k, v in pairs(data) do
      scriptConfig[k] = v
    end
  elseif fullReplace then
    scriptConfig = data
  else
    scriptConfig = lib.table.merge(scriptConfig, data, false)
  end
  clientVersion = new_version or clientVersion
  settingsLoaded = true
  local changedLeaves = collectChangedLeaves(data, previousSettings, nil, {})
  SetResourceKvp(('%s_scriptConfig'):format(scriptName), json.encode({
    client_version = clientVersion,
    data = scriptConfig,
  }))
  if hasUI then
    if sectionReplace then
      -- Forward only the received delta (the changed sections) to the NUI
      -- instead of re-serializing the WHOLE config — the NUI applies the same
      -- wholesale-per-section overwrite. Full config posts are reserved for
      -- initial load / fullReplace below.
      SendNuiMessage(json.encode({
        action = 'UPDATE_SCRIPT_CONFIG',
        data = {
          config = data,
          clientVersion = clientVersion,
          sectionReplace = true,
        },
      }))
    else
      SendNuiMessage(json.encode({
        action = 'UPDATE_SCRIPT_CONFIG',
        data = {
          config = scriptConfig,
          clientVersion = clientVersion,
        },
      }))
    end
  end
  dispatchScriptConfigWatchers(scriptConfig, previousSettings, changedLeaves, 'update', false)
end)

if hasUI then
  RegisterNuiCallback('UPDATE_SCRIPT_CONFIG', function(data, cb)
    local payload = data
    local expectedVersion = clientVersion
    local sectionReplace = false
    if type(data) == 'table' and data.data ~= nil then
      payload = data.data
      expectedVersion = data.expectedVersion or clientVersion
      sectionReplace = data.sectionReplace == true
    end

    -- Defensive fallback for stale UI builds that still send expectedVersion=0.
    if type(expectedVersion) == 'number' and expectedVersion <= 0 and type(clientVersion) == 'number' and clientVersion > 0 then
      expectedVersion = clientVersion
    end

    local success, _error, meta = updateScriptConfig(payload, expectedVersion, sectionReplace)
    if type(meta) == 'table' and meta.client_version then
      clientVersion = meta.client_version
    end
    cb({ success = success, _error = _error, meta = meta })
  end)

  RegisterNuiCallback('GET_SCRIPT_CONFIG_HISTORY', function(data, cb)
    local result, err = lib.callback.await(('%s:getScriptConfigHistory'):format(scriptName), data or {})
    cb({ success = result ~= nil, _error = err, data = result })
  end)

  RegisterNuiCallback('RESET_SCRIPT_CONFIG', function(_, cb)
    local success, _error, meta = lib.callback.await(('%s:resetScriptConfig'):format(scriptName))
    if success and type(meta) == 'table' and meta.client_version then
      clientVersion = meta.client_version
    end
    cb({ success = success, _error = _error })
  end)
end

AddEventHandler('onResourceStop', function(resourceName)
  if resourceName ~= scriptName then return end
  if hasUI then
    SetNuiFocus(false, false)
    TriggerScreenblurFadeOut(0)
  end
end)

-- ──────────────────────────────────────
-- PUBLIC API
-- ──────────────────────────────────────
local toRet = {
  -- `.get()` returns the whole config; `.get('basic')` / `.get('basic.time')`
  -- drills into nested fields. Mirrors the server-side API so fishing-style
  -- `lib.scriptConfig.get('basic').foo` works on either side.
  get = function(path)
    local cfg = ensureSettingsLoaded()
    if not path or path == '' then return cfg end
    return getValueAtPath(cfg, path)
  end,

  getAll = function(src)
    return lib.callback.await(('%s:getFullScriptConfig'):format(scriptName), src)
  end,

  set = updateScriptConfig,
  on = onScriptConfig,

  -- Install a one-shot back-handler. Called instead of the default chooser
  -- reopen the next time the user hits Back inside the configurator. Cleared
  -- after that invocation. Pass `nil` to drop a previously-installed handler.
  setBackHandler = function(fn)
    customBackHandler = fn
  end,
}
setmetatable(toRet, {
  __call = function()
    return ensureSettingsLoaded()
  end,
})

-- Bootstrap the admin-tool subsystem (capture position, goto coord, etc).
-- Self-contained — registers its own NUI callbacks gated on the
-- scriptConfig open/close lifecycle events fired above.
require '@dirk_lib/modules/scriptConfig/admin/init'

return toRet