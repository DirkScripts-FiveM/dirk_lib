local context = IsDuplicityVersion() and 'server' or 'client'

local debug_getinfo = debug.getinfo

noop = function() 

end 

lib = setmetatable({
  name = 'dirk_lib',
  context = IsDuplicityVersion() and 'server' or 'client',
  onCache = function(key, cb)
    AddEventHandler(('dirk_lib:cache:%s'):format(key), cb)
    if cache and cache[key] ~= nil then cb(cache[key]) end
  end,
}, {
  __newindex = function(self,key,fn)
    rawset(self,key,fn)

    if debug_getinfo(2, 'S').short_src:find('@dirk_lib/src') then
      exports(key, fn)
    end
  end,

  __index = function(self,key)
    local dir = ('modules/%s'):format(key)
    local chunk = LoadResourceFile(self.name, ('%s/%s.lua'):format(dir, self.context))
    local shared = LoadResourceFile(self.name, ('%s/shared.lua'):format(dir))

    if shared then 
      chunk = (chunk and ('%s\n%s'):format(shared, chunk)) or shared
    end

    if chunk then 
      local fn, err = load(chunk, ('@@dirk_lib/modules/%s/%s.lua'):format(key, self.context))

      if not fn or err then 
        return error(('Error loading module %s: %s'):format(key, err or 'unknown error'))
      end

      local result = fn()
      self[key] = result or noop
      return self[key]
    end
  end
})

if lib.context == 'server' then 
  lib.notify = function(src, data)
    if type(src) == 'table' then 
      for _, id in ipairs(src) do 
        TriggerClientEvent('dirk_lib:notify', id, data)
      end
      return 
    end
    
    TriggerClientEvent('dirk_lib:notify', src, data)
  end
end 

--## Override require with ox's lovely require module
require = lib.require
--## FRAMEWORK/SETTINGS
local settings = require 'src.settings'
lib.settings = settings

--## FRAMEWORK/SETTINGS
local frameworkBridge = lib.loadBridge('framework', settings.framework, 'shared')

-- Resolve the framework core object ONCE (lazily, on first access) and cache
-- it - the same as the consumer shim in init.lua. getObject() is a
-- cross-resource export call, and it used to run on every single `lib.FW.x`
-- access in dirk_lib's own VM, so anything reading the framework in a loop
-- paid that call per read. A nil result isn't cached, so it self-heals if
-- something touches lib.FW before the framework is ready.
local fwObj
lib.FW = setmetatable({}, {
	__index = function(self, index)
		fwObj = fwObj or frameworkBridge.getObject()
		return fwObj and fwObj[index]
	end
})

cache = {
  resource = GetCurrentResourceName(),
  game     = GetGameName(),
}

--## SETTINGS HOT-RELOAD
-- Same module as consumers load via require in the public init.lua so dirk_lib
-- itself exposes lib.onSettings and stays in sync with its own scriptConfig
-- broadcasts. Must run after lib.settings and cache are defined.
require 'src.onSettings'

local poolNatives = {
  CPed = GetAllPeds,
  CObject = GetAllObjects,
  CVehicle = GetAllVehicles,
}

local GetGamePool = function(poolName)
  local fn = poolNatives[poolName]
  return fn and fn() --[[@as number[] ]]
end


if context == 'client' then
  ---## REDM SHIT
 
  if cache.game == 'redm' then 
    local redmNatives = require 'src.redmNatives'
    for k, v in pairs(redmNatives) do
      lib.print.info(('Added native %s for RedM'):format(k))
      _G[k] = v 
    end
  end 

  if not LoadResourceFile(lib.name, 'web/build/index.html') then
    CreateThread(function()
      while true do
        print('^1[dirk_lib] ERROR: The UI has not been built! The web/build folder is missing.^0')
        print('^3[dirk_lib] Download the latest release or build the UI yourself.^0')
        print('^3[dirk_lib] https://www.dirkscripts.com/scripts/library^0')
        Wait(5000)
      end
    end)
    return
  end

  RegisterNuiCallback('GET_SETTINGS', function(data, cb)
    -- Ensure scriptConfig has loaded (and the settings overlay has run) before
    -- handing lib.settings to the NUI, otherwise DirkProvider caches the
    -- pre-overlay convar defaults and the saved theme doesn't stick.
    pcall(function() return lib.scriptConfig.get() end)
    cb(lib.settings)
  end)
  
  RegisterNuiCallback('GET_LOCALES', function(data, cb)
    cb(lib.getLocales())
  end)

  -- The same standard callbacks consumers get from the public init.lua.
  -- dirk_lib boots from this file, not that one, so without this its own
  -- panel is the only UI on the server missing them.
  require('@dirk_lib.src.nuiBridge')(frameworkBridge)

  -- Master ACE for the Script Config tab banner. Reads the replicated
  -- convar — `setr` values are pushed to clients on connect.
  RegisterNuiCallback('GET_SCRIPT_CONFIG_MASTER_GROUP', function(_, cb)
    -- Match the server-side default in src/scriptConfig/server.lua —
    -- comma-separated list, ANY one passing IsPlayerAceAllowed = master.
    local g = GetConvar('dirk_lib_master_group', 'group.admin,admin,command')
    if g == nil or g == '' then g = 'group.admin,admin,command' end
    cb({ group = g })
  end)

  -- Resource list for the access-overrides resource picker. Pure client
  -- iteration — `GetNumResourceMetadata` and friends work fine on client.
  -- The surrounding UI is master-only by design (dirk_lib's own panel),
  -- so no permission gate needed here.
  RegisterNuiCallback('GET_SCRIPT_CONFIG_RESOURCES', function(_, cb)
    local out = {}
    local total = GetNumResources() or 0
    for i = 0, total - 1 do
      local name = GetResourceByFindIndex(i)
      if name and GetResourceState(name) == 'started' then
        local count = GetNumResourceMetadata(name, 'dirk_lib') or 0
        for j = 0, count - 1 do
          if GetResourceMetadata(name, 'dirk_lib', j) == 'scriptConfig' then
            out[#out + 1] = {
              resource = name,
              label = name,
              version = GetResourceMetadata(name, 'version', 0) or 'dev',
            }
            break
          end
        end
      end
    end
    table.sort(out, function(a, b) return a.resource < b.resource end)
    cb(out)
  end)

  -- Online-player list — server-bounced because the client only knows
  -- about local-scope players, not the full server roster.
  RegisterNuiCallback('GET_SCRIPT_CONFIG_ONLINE_PLAYERS', function(_, cb)
    CreateThread(function()
      local ok, data = pcall(lib.callback.await, 'dirk_lib:getOnlinePlayers')
      cb(ok and type(data) == 'table' and data or {})
    end)
  end)

  -- Discord connection diagnostic — fires when the admin clicks "Test
  -- Connection" in the Discord tab. Server-bounced so it can hit Discord
  -- with the (server-only) bot token. Form values are forwarded so the
  -- test runs against what the admin has *typed*, even before they save.
  RegisterNuiCallback('DISCORD_DIAGNOSE', function(data, cb)
    CreateThread(function()
      local token = type(data) == 'table' and type(data.botToken) == 'string' and data.botToken or nil
      local guild = type(data) == 'table' and type(data.guildId)  == 'string' and data.guildId  or nil
      local ok, result = pcall(lib.callback.await, 'dirk_lib:discord:diagnose', token, guild)
      if ok and type(result) == 'table' then
        cb(result)
      else
        cb({ ok = false, checks = { { id = 'transport', ok = false, message = 'Server callback failed' } } })
      end
    end)
  end)

  return
end


--## SERVER

--## SQL DIAGNOSTICS (opt-in via scriptConfig basic.debug, default OFF)
-- Wraps this VM's oxmysql MySQL methods to capture SQL errors/hitches, but ONLY
-- when dirk_lib's scriptConfig `basic.debug` flag is on. scriptConfig loads
-- asynchronously, so we arm via a watcher that fires on load + on change;
-- instrument() is idempotent. Off by default = never armed = zero overhead.
-- pcall'd so it can never break dirk_lib startup.
pcall(function()
  if not (lib.scriptConfig and lib.scriptConfig.on) then return end
  lib.scriptConfig.on('basic.debug', function(enabled)
    if enabled == true then
      pcall(function() lib.diag.instrument() end)
    else
      -- Turn the diagnostics off when debug is disabled — previously the per-frame
      -- hitch-monitor kept running until a full resource restart.
      pcall(function() lib.diag.disarm() end)
    end
  end)
end)

if not LoadResourceFile(lib.name, 'web/build/index.html') then
  CreateThread(function()
    while true do
      print('^1[dirk_lib] ERROR: The UI has not been built! The web/build folder is missing.^0')
      print('^3[dirk_lib] Download the latest release or build the UI yourself.^0')
      print('^3[dirk_lib] https://www.dirkscripts.com/scripts/library^0')
      Wait(5000)
    end
  end)
  return
end



-- Server-side callback for the auto-registered NUI handler in consumer
-- resources. Lives here so it's only registered once (in dirk_lib's own
-- runtime) — any consumer's client can `lib.callback.await` it.
CreateThread(function()
  -- Wait until lib.framework is available + the framework bridge has loaded
  -- its job table from the underlying framework script.
  Wait(500)
  pcall(function()
    lib.callback.register('dirk_lib:getFrameworkGroups', function()
      return lib.framework and lib.framework.getGroupsBundle and lib.framework.getGroupsBundle()
        or { jobs = {}, gangs = {} }
    end)
  end)
end)

CreateThread(function()
  --- PRINT INFO FOR AUTODETCTION
  SetTimeout(1000, function()
    local strVers = GetResourceMetadata('dirk_lib', 'version')
    local detectables = {
      'framework',
      'inventory',
      'target',
      'time',
      'keys',
      'fuel',
      'phone',
      'garage',
      'ambulance',
      'prison',
      'dispatch',
      'clothing',
      'skills',
      'housing',
    }

    local W = 46 -- inner width of the box (between │ and │)
    -- All printed rows go through this so colour codes don't throw off the
    -- right-side border alignment. `visibleLen` is the rendered character
    -- count of the row's content, sans `^N` colour escapes; the helper pads
    -- to W spaces and slaps the closing │ on.
    local function row(visible, content)
      local pad = math.max(0, W - visible)
      print('│' .. content .. string.rep(' ', pad) .. '^7│')
    end
    local function strip(s) return (s:gsub('%^%d', '')) end
    local function rowText(text)
      -- Default `^7` foreground; padding off the visible (stripped) length.
      row(#strip(text), '^7' .. text)
    end

    local topBorder = '┌' .. string.rep('─', W) .. '┐'
    local bottomBorder = '└' .. string.rep('─', W) .. '┘'
    print(topBorder)
    do
      local content = '^2 DIRK_LIB ^3V' .. strVers
      row(#strip(content), content)
    end
    do
      local content = '^6 RESOURCE AUTO-DETECTION'
      row(#strip(content), content)
    end
    do
      local content = '^7 WWW.DIRKSCRIPTS.COM'
      row(#strip(content), content)
    end
    print('│' .. string.rep('─', W) .. '│')

    local maxKeyLength = 0
    for _, v in ipairs(detectables) do
      maxKeyLength = math.max(maxKeyLength, #v)
    end
    for _, system in ipairs(detectables) do
      local value = lib.settings[system]
      if value then
        local keyStr = string.upper(system)
        local valueStr = tostring(value)
        local keySpacing = string.rep(' ', maxKeyLength - #system)
        local valueColor = valueStr == "NOT FOUND" and "^1" or "^2"
        local content = ' ^5' .. keyStr .. keySpacing .. '  ' .. valueColor .. valueStr
        local visible = 1 + #keyStr + (maxKeyLength - #system) + 2 + #valueStr
        row(visible, content)
      end
    end
    rowText('')
    rowText(' If you are running something other than what')
    rowText(' is autodetected, its because the resource')
    rowText(' you use has "provide xyz" in the fxmanifest.')
    rowText(' If they are using this correctly it should')
    rowText(' work fine — otherwise edit via /dirk_config.')
    print(bottomBorder)
  end)
end)


