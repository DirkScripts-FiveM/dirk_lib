-- Anti-cheats that filter events can drop dirk_lib's callbacks before the
-- server sees them. The script then looks broken - shops missing, zones
-- invisible, players on the wrong language - and reinstalling fixes nothing,
-- because nothing in the script is at fault. It cost one customer two weeks
-- and three reinstalls before anyone asked what anti-cheat he ran.
--
-- Two halves. This one names a known anti-cheat at boot so the admin has read
-- the word "whitelist" before the first ticket. The client half proves the
-- actual symptom - a request that gets no answer - regardless of name.

local DOCS = 'https://docs.dirkscripts.com/resources/dirk-lib/anticheats'

-- Resource names, as they appear in server.cfg. Matched case-insensitively
-- against every resource present (started or not - one that starts later
-- still filters). Keep this list boring: a name here only earns a warning.
local KNOWN = {
  'ElectronAC', 'electron', 'FiveGuard', 'fiveguard', 'WaveShield', 'wave-shield',
  'ReaperV4', 'reaper', 'SecureServe', 'PhoenixAC', 'phoenix-ac', 'VersusAC', 'FYAC',
}

local function findAnticheats()
  local lowered = {}
  for _, name in ipairs(KNOWN) do lowered[name:lower()] = name end

  local found = {}
  for i = 0, GetNumResources() - 1 do
    local resource = GetResourceByFindIndex(i)
    if resource and lowered[resource:lower()] then
      found[#found + 1] = resource
    end
  end
  return found
end

CreateThread(function()
  -- After the autodetection banner, so this reads as its own notice.
  Wait(3000)
  local found = findAnticheats()
  if #found == 0 then return end

  lib.print.warn(('[dirk_lib] anti-cheat detected: %s'):format(table.concat(found, ', ')))
  lib.print.warn('[dirk_lib] If it filters events, whitelist everything beginning with `__dirk_cb_` - every dirk script talks to its server through those. Without that, players get default settings and see "Callback ... timed out".')
  lib.print.warn(('[dirk_lib] How, per anti-cheat: %s'):format(DOCS))
end)

-- The probe. A client fires this and expects the reply within seconds; if the
-- reply never comes, the event was dropped on the way in (or the reply on the
-- way out) and the client says so. Deliberately a plain event pair rather
-- than lib.callback, so the probe cannot be confused with the thing it tests.
RegisterNetEvent('__dirk_cb_dirk_lib:probe', function()
  TriggerClientEvent('dirk_lib:probe:reply', source)
end)

exports('detectedAnticheats', findAnticheats)
