-- The client half of the anti-cheat probe. See src/anticheat/server.lua.
--
-- Once per session, shortly after the character loads: send one event under
-- the same `__dirk_cb_` prefix every dirk callback uses, and wait for the
-- reply. A healthy server answers in milliseconds. No answer in ten seconds
-- means something between this client and dirk_lib swallowed the event - and
-- that is exactly what every "config timed out" ticket turned out to be.
--
-- Prints once, names the anti-cheat if the server found one, and links the
-- fix. Never blocks anything.

local DOCS = 'https://docs.dirkscripts.com/resources/dirk-lib/anticheats'
local PROBE_WAIT_MS = 10000

local answered = false
local probed = false

RegisterNetEvent('dirk_lib:probe:reply', function()
  answered = true
end)

local function probe()
  if probed then return end
  probed = true

  TriggerServerEvent('__dirk_cb_dirk_lib:probe')

  local waited = 0
  while not answered and waited < PROBE_WAIT_MS do
    Wait(250)
    waited = waited + 250
  end
  if answered then return end

  local found = {}
  pcall(function() found = exports.dirk_lib:detectedAnticheats() or {} end)
  local who = #found > 0 and (' Your server runs ' .. table.concat(found, ', ') .. '.') or ''

  lib.print.error(('[dirk_lib] a test event sent to the server was never answered.%s '
    .. 'Something is dropping events that begin with `__dirk_cb_` before they reach dirk_lib. '
    .. 'Every dirk script depends on those - players will run on default settings until it is fixed. '
    .. 'Whitelist that prefix in your anti-cheat: %s'):format(who, DOCS))
end

-- After the character is in. Fired by the cache module on every framework.
AddEventHandler('dirk_lib:cache:playerLoaded', function(loaded)
  if not loaded then return end
  CreateThread(function()
    Wait(5000)
    probe()
  end)
end)

-- A player who was already loaded when dirk_lib restarted never sees the
-- event above; catch them too.
CreateThread(function()
  Wait(8000)
  if cache.playerLoaded then probe() end
end)
