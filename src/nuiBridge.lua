--- Standard NUI callbacks that any dirk_lib-powered UI can rely on.
---
--- These used to live inline in the public `init.lua`, which consumers load via
--- `@dirk_lib/init.lua`. dirk_lib itself does NOT load that file — it boots from
--- `src/init.lua` — so its own panel never got them, and the Script Studio's
--- vehicle list came back empty on a server with 900+ vehicles. One copy here,
--- required by both bootstraps, is the fix.
---
--- Client-only, and only worth registering for a resource that actually has a
--- ui_page. The caller checks both.

--- Every vehicle the framework knows, as a flat list.
---
--- Asked of the framework bridge first, so per-framework knowledge stays in
--- `bridge/framework/<name>/shared.lua`. `lib.FW.Shared.Vehicles` is the
--- fallback for a bridge that has not been taught this yet — it works for
--- anything QB-shaped, and is simply absent on ESX.
local function readVehicles(frameworkBridge)
  local raw
  if frameworkBridge and frameworkBridge.getVehicles then
    local ok, result = pcall(frameworkBridge.getVehicles)
    if ok and type(result) == 'table' then raw = result end
  end

  if not raw then
    local shared = lib.FW and lib.FW.Shared
    raw = type(shared) == 'table' and shared.Vehicles or nil
  end

  if type(raw) ~= 'table' then return {} end

  -- qb-core ships an array, qbx_core a model-keyed map. `pairs` covers both,
  -- and the key is the model when the row does not carry one.
  local out = {}
  for key, v in pairs(raw) do
    if type(v) == 'table' then
      local model = v.model or (type(key) == 'string' and key or nil)
      if model then
        out[#out + 1] = {
          model    = model,
          name     = v.name or model,
          brand    = v.brand,
          price    = v.price,
          category = v.category,
        }
      end
    end
  end
  return out
end

---@param frameworkBridge table? the already-loaded framework/shared bridge
return function(frameworkBridge)
  -- Normalised { jobs, gangs } regardless of the underlying framework. Bounced
  -- through the server because grade/label data is not all client-readable.

--- Refuse anything that ACTS unless the admin panel is really open.
---
--- These callbacks exist to serve Script Studio: they teleport the admin's ped,
--- hand out items, spawn vehicles, run a test suite, and forward requests to
--- other resources. None of that has any meaning with the panel shut.
---
--- The threat this closes is not a modded client. A modded client can already
--- trigger server events directly and always could. It is CEF devtools: without
--- this, every one of these was one `fetch` away for any player who opened the
--- console, which is a far lower bar than a Lua injector.
---
--- The flag lives in src/scriptConfig/client.lua and is set by a
--- server-triggered event that fires only after the server's permission check,
--- so nothing reachable from the NUI can turn it on.
---
--- Server-side checks still stand behind this; it is the outer door, not the
--- only one.
local function adminUiOpen()
  -- pcall'd: this module is required from a shared script, so on the server
  -- context the export does not exist at all - and a hard error there would
  -- take out whatever called it.
  local ok, open = pcall(function() return exports.dirk_lib:isDirkAdminUiOpen() end)
  return ok and open == true
end


  RegisterNuiCallback('GET_FRAMEWORK_GROUPS', function(_, cb)
    CreateThread(function()
      local ok, data = pcall(lib.callback.await, 'dirk_lib:getFrameworkGroups')
      cb((ok and type(data) == 'table') and data or { jobs = {}, gangs = {} })
    end)
  end)

  -- Shared-vehicle list for cfx-react's useVehicles / VehicleSelect /
  -- CategorySelect, and for the Script Studio's vehicle catalogue.
  RegisterNuiCallback('GET_VEHICLES', function(_, cb)
    cb(readVehicles(frameworkBridge))
  end)

  -- "Spawn it" from the vehicle catalogue.
  --
  -- The client does NOT spawn anything. It asks the server, which checks the
  -- same permission that gates editing a config and creates the vehicle
  -- itself; all that comes back is a network id. Without permission there is
  -- no vehicle to be seated in, so this callback existing in a resource is not
  -- a way to spawn one.
  -- Test suites: which scripts have one, and running one on request.
  RegisterNuiCallback('GET_TEST_INDEX', function(data, cb)
    CreateThread(function()
      local ok, success, _err, found = pcall(lib.callback.await, 'dirk_lib:getTestIndex', {
        resources = type(data) == 'table' and data.resources or {},
      })
      cb({ resources = (ok and success and type(found) == 'table') and found or {} })
    end)
  end)

  RegisterNuiCallback('GET_TEST_STATE', function(data, cb)
    CreateThread(function()
      local ok, success, _err, state = pcall(lib.callback.await, 'dirk_lib:getTestState', {
        resource = type(data) == 'table' and data.resource or nil,
      })
      cb((ok and success and type(state) == 'table') and state or { ran = false })
    end)
  end)

  RegisterNuiCallback('RUN_TESTS', function(data, cb)
    if not adminUiOpen() then cb({ success = false, _error = 'NotOpen' }) return end
    CreateThread(function()
      local resource = type(data) == 'table' and data.resource or nil
      if type(resource) ~= 'string' or resource == '' then
        cb({ ok = false, _error = 'BadRequest' })
        return
      end

      -- Answered by the SCRIPT, not by dirk_lib: the registry is per-VM.
      local ok, success, err, result = pcall(lib.callback.await, ('%s:test:run'):format(resource), {
        filter = type(data) == 'table' and data.filter or nil,
      })

      if not ok or not success or type(result) ~= 'table' then
        cb({ ok = false, _error = (ok and err) or 'CallbackFailed' })
        return
      end
      cb({ ok = true, result = result })
    end)
  end)

  -- Changelogs, read straight out of each resource's own CHANGELOG.md.
  RegisterNuiCallback('GET_CHANGELOG', function(data, cb)
    CreateThread(function()
      local ok, success, err, payload = pcall(lib.callback.await, 'dirk_lib:getChangelog', {
        resource = type(data) == 'table' and data.resource or nil,
      })
      if not ok or not success then
        cb({ ok = false, _error = (ok and err) or 'CallbackFailed' })
        return
      end
      cb({ ok = true, text = payload and payload.text or '', version = payload and payload.version or nil })
    end)
  end)

  RegisterNuiCallback('GET_CHANGELOG_INDEX', function(data, cb)
    CreateThread(function()
      local ok, success, _err, found = pcall(lib.callback.await, 'dirk_lib:getChangelogIndex', {
        resources = type(data) == 'table' and data.resources or {},
      })
      cb({ resources = (ok and success and type(found) == 'table') and found or {} })
    end)
  end)

  -- ── dirk-cfx-react's admin tools ────────────────────────────────────
  --
  -- ONE router, and it is not this file.
  --
  -- `modules/scriptConfig/admin` is the admin-tool router: `ADMIN_TOOL_BEGIN`
  -- / `INVOKE` / `QUERY` dispatched by id, tools registered with
  -- `lib.adminTool.register`, each one plain Lua in `admin/tools/`. This file
  -- used to carry a SECOND copy of the whole thing - its own capture thread,
  -- its own instruction card - registered over the top of it, so which one ran
  -- came down to load order and fixing a tool meant remembering to fix it
  -- twice.
  --
  -- Required rather than reimplemented. dirk_lib boots from `src/init.lua` and
  -- so never loads `@dirk_lib/init.lua`, which is what pulls the router into
  -- every CONSUMER's VM - the same gap that once left the Studio's own vehicle
  -- list empty. One require closes it.
  require '@dirk_lib/modules/scriptConfig/admin/init'

  -- World position, for any coordinate control in the panel.
  --
  -- dirk-cfx-react's Vector4 buttons call these BY NAME with no resource
  -- scope - every script that has an admin panel registers its own pair. The
  -- Studio is dirk_lib's own page, so `fetchNui` posts here: without these the
  -- Goto and Set buttons post into nothing and silently do nothing, which is
  -- exactly how they behaved. Kept identical to the copies in dirk_fishing and
  -- dirk_druglabsv2 so a coordinate behaves the same wherever it is edited.
  RegisterNuiCallback('GET_POSITION', function(_, cb)
    if not adminUiOpen() then cb({ success = false, _error = 'NotOpen' }) return end
    local ped = PlayerPedId()
    local pos = GetEntityCoords(ped)
    -- The GROUND, not your middle - the same offset the walk-and-set capture
    -- applies, so both ways of setting a position store the same number.
    cb({ x = pos.x, y = pos.y, z = pos.z - 1.0, w = GetEntityHeading(ped) })
  end)

  RegisterNuiCallback('GOTO_POSITION', function(data, cb)
    if not adminUiOpen() then cb({ success = false, _error = 'NotOpen' }) return end
    cb({})
    if type(data) ~= 'table' then return end
    local x = tonumber(data.x) or 0.0
    local y = tonumber(data.y) or 0.0
    local z = tonumber(data.z) or 0.0
    local w = tonumber(data.w) or 0.0
    local ped = PlayerPedId()
    -- No offset: the stored number is already the ground.
    SetEntityCoords(ped, x + 0.0, y + 0.0, z + 0.0, false, false, false, false)
    SetEntityHeading(ped, w % 360.0)
  end)

  -- Give the editor one of a script's own items.
  --
  -- Same reasoning as SPAWN_VEHICLE below: the server decides, gated on
  -- permission to edit the OWNING script, so this callback existing is not a
  -- way to hand yourself items.
  RegisterNuiCallback('GIVE_ITEM', function(data, cb)
    if not adminUiOpen() then cb({ success = false, _error = 'NotOpen' }) return end
    CreateThread(function()
      local resource = type(data) == 'table' and data.resource or nil
      local item = type(data) == 'table' and data.item or nil
      if type(resource) ~= 'string' or type(item) ~= 'string' or item == '' then
        cb({ success = false, _error = 'BadRequest' })
        return
      end

      local ok, success, err = pcall(lib.callback.await, 'dirk_lib:giveItem', {
        resource = resource,
        item = item,
        count = tonumber(data.count) or 1,
      })

      if not ok or not success then
        cb({ success = false, _error = (ok and err) or 'CallbackFailed' })
        return
      end
      cb({ success = true })
    end)
  end)

  --- Ask the OWNING SCRIPT something, from inside its own Studio page.
  ---
  --- A page supplied by dirk_fishing renders inside dirk_lib's NUI frame, so
  --- `fetchNui` posts to dirk_lib - not to fishing. Fishing's own callbacks are
  --- simply never reached, and because fetchNui falls back to its mock data on
  --- a failed fetch, the page showed invented players and said nothing.
  ---
  --- So the request comes here and is forwarded to the server callback the page
  --- names. Two things keep that honest:
  ---
  ---  * the callback name MUST start with `<resource>:`, so a page can only
  ---    ever reach the script that supplied it;
  ---  * the answering script does its own permission check, exactly as it did
  ---    when its own panel asked - nothing here grants access.
  --- What the Bridges page cannot read out of a schema.
  ---
  --- The OPTIONS for every bridge are already in dirk_lib's own schema - each
  --- setting's enum is the list of things it can be - so the page builds the
  --- rows from settings it already has. What no schema can say is what this
  --- particular server is running, and that is all this answers:
  ---
  ---   * which resources are actually up, and at what version;
  ---   * what auto-detection picked, for a setting left on "auto";
  ---   * the fixed facts from the manifest - server build, OneSync, oxmysql.
  ---
  --- The resource NAMES come from the caller rather than a list kept here, so
  --- adding a supported inventory means editing the schema and nothing else.
  --- A list in two places is a list that disagrees with itself.
  --- Discord channels the bot can see, for the redirect picker.
  RegisterNuiCallback('GET_DISCORD_CHANNELS', function(_, cb)
    if not adminUiOpen() then cb({ success = false, _error = 'NotOpen' }) return end
    CreateThread(function()
      local ok, result, err = pcall(lib.callback.await, 'dirk_lib:getDiscordChannels')
      if not ok or not result then
        cb({ success = false, _error = err or 'NoAnswer' })
        return
      end
      cb({ success = true, data = result })
    end)
  end)

  --- Who can open Script Studio.
  ---
  --- The rows, who is online to add, and whether this viewer may change any
  --- of it - in one call, because the page needs all three to draw and asking
  --- separately just means three round trips for one screen.
  RegisterNuiCallback('GET_ADMINS', function(_, cb)
    if not adminUiOpen() then cb({ success = false, _error = 'NotOpen' }) return end
    CreateThread(function()
      local ok, result, err = pcall(lib.callback.await, 'dirk_lib:getAdmins')
      if not ok or not result then
        cb({ success = false, _error = err or 'NoAnswer' })
        return
      end
      cb({ success = true, data = result })
    end)
  end)

  --- Add or update one access entry. Refused for anyone but a master, on the
  --- server - this check is only about not drawing a button that will fail.
  RegisterNuiCallback('PUT_ADMIN', function(data, cb)
    if not adminUiOpen() then cb({ success = false, _error = 'NotOpen' }) return end
    CreateThread(function()
      local ok, success, err = pcall(lib.callback.await, 'dirk_lib:putAdmin',
        type(data) == 'table' and data or {})
      cb({ success = ok and success == true, _error = (not success) and (err or 'Failed') or nil })
    end)
  end)

  RegisterNuiCallback('REMOVE_ADMIN', function(data, cb)
    if not adminUiOpen() then cb({ success = false, _error = 'NotOpen' }) return end
    CreateThread(function()
      local ok, success, err = pcall(lib.callback.await, 'dirk_lib:removeAdmin',
        type(data) == 'table' and data or {})
      cb({ success = ok and success == true, _error = (not success) and (err or 'Failed') or nil })
    end)
  end)

  RegisterNuiCallback('GET_BRIDGE_STATE', function(data, cb)
    if not adminUiOpen() then cb({ success = false, _error = 'NotOpen' }) return end
    CreateThread(function()
      local wanted = type(data) == 'table' and data.resources or nil
      local resourceName = GetCurrentResourceName()

      local resources = {}
      if type(wanted) == 'table' then
        for _, name in ipairs(wanted) do
          if type(name) == 'string' and name ~= '' and name ~= 'auto' then
            local state = GetResourceState(name)
            local running = state == 'started' or state == 'starting'
            resources[name] = {
              running = running,
              state = state,
              -- Only meaningful for something that is actually up; a stopped
              -- resource still has a manifest and reporting its version reads
              -- as "installed and fine".
              version = running and GetResourceMetadata(name, 'version', 0) or nil,
            }
          end
        end
      end

      -- dirk_lib's OWN declared dependencies, whatever the caller asked about.
      --
      -- The caller sends the resources its dropdowns can offer, and oxmysql is
      -- not one of them - it is not a bridge, it is a hard requirement. So it
      -- came back unknown and the card read "not running" on a server that
      -- plainly has it. Read from the manifest rather than named here, so the
      -- page follows the dependency block instead of a second copy of it.
      local minimumBuild, needsOneSync = nil, false

      -- Read from the MANIFEST TEXT, not from resource metadata.
      --
      -- Which key a `dependencies { }` block lands under is not something to
      -- be confident about from memory, and being wrong is silent: the loop
      -- runs zero times and the section renders as a heading with nothing
      -- beneath it. The file itself is not ambiguous.
      local manifest = LoadResourceFile(resourceName, 'fxmanifest.lua')
        or LoadResourceFile(resourceName, '__resource.lua')
        or ''
      local block = manifest:match('dependencies%s*%{(.-)%}') or ''

      for dep in block:gmatch("['\"]([^'\"]+)['\"]") do
        local build = dep:match('^/server:(%d+)$')
        if build then
          minimumBuild = tonumber(build)
        elseif dep == '/onesync' then
          needsOneSync = true
        elseif dep:sub(1, 1) ~= '/' then
          -- a real resource, not a server feature
          local state = GetResourceState(dep)
          local running = state == 'started' or state == 'starting'
          resources[dep] = {
            running = running,
            state = state,
            version = running and GetResourceMetadata(dep, 'version', 0) or nil,
            required = true,
          }
        end
      end

      -- `lib.detectResources` re-runs detection rather than handing back the
      -- snapshot taken when dirk_lib booted - an inventory that started after
      -- the library would otherwise show as missing forever.
      local detected = (lib.detectResources and lib.detectResources()) or {}

      local build = tonumber(GetConvar('sv_enforceGameBuild', '0')) or 0
      -- Published by the server into GlobalState: the `version` convar this
      -- used to read is server-side only, so on the client it was always empty
      -- and the card reported "unknown" on a perfectly fine server.
      local artifact = tonumber(GlobalState.dirkServerBuild) or 0

      local onesync = GetConvar('onesync', 'off')

      cb({
        success   = true,
        detected  = detected,
        resources = resources,
        -- Both read from the manifest above, so the page reports what this
        -- build of dirk_lib actually asks for rather than a number written
        -- here that has to be remembered when the manifest changes.
        server = {
          artifact  = artifact > 0 and artifact or nil,
          minimum   = minimumBuild,
          ok        = not minimumBuild or artifact == 0 or artifact >= minimumBuild,
          gameBuild = build > 0 and build or nil,
        },
        onesync = {
          mode     = onesync,
          required = needsOneSync,
          ok       = not needsOneSync or (onesync ~= 'off' and onesync ~= ''),
        },
      })
    end)
  end)

  --- The Logs page: one page of lines, its filter options, and how much is kept.
  ---
  --- Three separate callbacks rather than one payload, because they are asked
  --- for at very different rates. Rows are paged as you scroll; the facets and
  --- the health figures change slowly and the page caches them for minutes.
  --- Bundling them would refetch the expensive ones on every scroll.
  RegisterNuiCallback('GET_LOGS', function(data, cb)
    if not adminUiOpen() then cb({ success = false, _error = 'NotOpen' }) return end
    CreateThread(function()
      local ok, result, err = pcall(lib.callback.await, 'dirk_lib:getLogs', type(data) == 'table' and data or {})
      cb({ success = ok and result ~= nil, data = result, _error = (not ok) and 'CallbackFailed' or err })
    end)
  end)

  RegisterNuiCallback('GET_LOG_FACETS', function(data, cb)
    if not adminUiOpen() then cb({ success = false, _error = 'NotOpen' }) return end
    CreateThread(function()
      local ok, result, err = pcall(lib.callback.await, 'dirk_lib:getLogFacets', type(data) == 'table' and data or {})
      cb({ success = ok and result ~= nil, data = result, _error = (not ok) and 'CallbackFailed' or err })
    end)
  end)

  RegisterNuiCallback('GET_LOG_HEALTH', function(_, cb)
    if not adminUiOpen() then cb({ success = false, _error = 'NotOpen' }) return end
    CreateThread(function()
      local ok, result, err = pcall(lib.callback.await, 'dirk_lib:getLogHealth')
      cb({ success = ok and result ~= nil, data = result, _error = (not ok) and 'CallbackFailed' or err })
    end)
  end)

  RegisterNuiCallback('STUDIO_REQUEST', function(data, cb)
    if not adminUiOpen() then cb({ success = false, _error = 'NotOpen' }) return end
    CreateThread(function()
      local resource = type(data) == 'table' and data.resource or nil
      local callback = type(data) == 'table' and data.callback or nil

      if type(resource) ~= 'string' or type(callback) ~= 'string' then
        cb({ success = false, _error = 'BadRequest' })
        return
      end

      -- Its own script, and no other. Without this a page could name any
      -- callback on the server and this would dutifully await it.
      if callback:sub(1, #resource + 1) ~= resource .. ':' then
        cb({ success = false, _error = 'NotYourCallback' })
        return
      end

      if GetResourceState(resource) ~= 'started' then
        cb({ success = false, _error = 'NotStarted' })
        return
      end

      local ok, result, err = pcall(lib.callback.await, callback, data.payload)
      if not ok then
        cb({ success = false, _error = 'CallbackFailed' })
        return
      end
      -- `result` is whatever the script returns - usually a table, sometimes a
      -- boolean with the reason alongside it. Both are passed through as they
      -- are; reading them is the page's business, not this bridge's.
      cb({ success = result ~= nil, data = result, _error = err })
    end)
  end)

  RegisterNuiCallback('SPAWN_VEHICLE', function(data, cb)
    if not adminUiOpen() then cb({ success = false, _error = 'NotOpen' }) return end
    CreateThread(function()
      local model = type(data) == 'table' and data.model or nil
      if type(model) ~= 'string' or model == '' then
        cb({ success = false, _error = 'BadModel' })
        return
      end

      local ok, success, err, result = pcall(lib.callback.await, 'dirk_lib:spawnVehicle', { model = model })
      if not ok or not success or type(result) ~= 'table' then
        cb({ success = false, _error = (ok and err) or 'CallbackFailed' })
        return
      end

      -- The server owns it; this side just waits for it to stream in before
      -- putting the player behind the wheel.
      local vehicle, tries = 0, 0
      while tries < 100 do
        vehicle = NetworkGetEntityFromNetworkId(result.netId)
        if vehicle ~= 0 and DoesEntityExist(vehicle) then break end
        Wait(10)
        tries = tries + 1
      end

      if vehicle == 0 or not DoesEntityExist(vehicle) then
        -- It exists server-side either way, so this is "you may have to walk
        -- to it", not a failure.
        cb({ success = true })
        return
      end

      SetPedIntoVehicle(PlayerPedId(), vehicle, -1)

      -- Keys go through the CLIENT bridge on purpose: every supported
      -- vehicle-keys resource implements the client half, while only
      -- wasabi_carlock implements the server one. A vehicle you cannot start is
      -- not much of a spawn.
      pcall(function()
        lib.vehicle.addKeys(vehicle, result.plate or GetVehicleNumberPlateText(vehicle))
      end)

      cb({ success = true })
    end)
  end)
end
