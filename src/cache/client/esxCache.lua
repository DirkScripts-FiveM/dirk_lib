if lib.settings.framework ~= 'es_extended' then return end

local parsePlayerData = function(playerData)
  cache:set('dead', playerData.dead)
end

local parseJob = function(job)
  local parsedJob = {
    name = job.name,
    type = job.type,
    label = job.label,
    grade = job.grade,
    isBoss = job.isboss,
    bankAuth = job.bankAuth,
    gradeLabel = job.grade_label,
    duty = job.onduty
  }
  cache:set('job', parsedJob)
end

local parsePlayerCache = function(playerData)
  playerData = playerData or lib.FW.GetPlayerData()
  if not playerData then return end
  if not playerData.job?.name then return end
  cache:set('citizenId', playerData.identifier)
  -- print(json.encode(playerData, {indent=true}))
  cache:set('charName', playerData.firstName..' '..playerData.lastName)
  parseJob(playerData.job)
  parsePlayerData(playerData)
  cache:set('playerLoaded', true)
end

CreateThread(function()
  while not lib.FW do Wait(500); end 
  while not lib.FW.GetPlayerData() do Wait(500); end
  while not lib.FW.GetPlayerData().job?.name do Wait(500); end
  parsePlayerCache()
end)

RegisterNetEvent('esx:playerLoaded', function(xPlayer)
  parsePlayerCache(xPlayer)
end)

RegisterNetEvent('esx:setJob', function(job)
  parseJob(job)
end)

-- Only the keys this cache is built from. ESX fires esx:setPlayerData for
-- EVERY key it sets - and for any table value even when unchanged - and other
-- resources call ESX.SetPlayerData freely. Re-parsing the whole cache on each
-- one meant an export call into es_extended plus a rebuild for keys we never
-- read. (Reported by a customer as dirk_lib CPU rising while walking.)
local CACHED_KEYS = {
  job = true, dead = true, identifier = true, firstName = true, lastName = true,
}

AddEventHandler('esx:setPlayerData', function(key, val, last)
  if not CACHED_KEYS[key] then return end
  if key == 'job' then
    if type(val) == 'table' then parseJob(val) end
  elseif key == 'dead' then
    cache:set('dead', val)
  else
    -- identifier / name: rare, take the full snapshot.
    parsePlayerCache()
  end
end)

RegisterNetEvent('esx:onPlayerDeath', function()
  cache:set('dead', true)
end)

RegisterNetEvent('esx_ambulancejob:revive', function()
  cache:set('dead', false)
end)

-- HANDDCUFFING CACHE

RegisterNetEvent('esx_policejob:handcuff', function()
	cache:set('cuffed', not cache.cuffed)
end)

RegisterNetEvent('esx_policejob:unrestrain', function()
  cache:set('cuffed', false)
end)