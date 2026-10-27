-- Hand-off admin tool: lend the screen to a script, then take it back.
--
-- The other tools here each do ONE thing in the world and answer with a value.
-- Some things a script wants to show from its own Studio page are not a value
-- at all: "play this intro" or "run this scene" is the script's own code, in
-- its own resource, and the panel just has to get out of the way while it
-- runs. Without this the test plays BEHIND a full-screen panel that still holds
-- the mouse, and the admin has to close it - losing whatever was staged - just
-- to watch.
--
-- Flow:
--   1. The page arms cfx-react's admin-tool store with id 'handOff' (which
--      hides the panel) and fires ADMIN_TOOL_BEGIN { id = 'handOff' }.
--   2. This releases NUI focus and clears the blur.
--   3. The page asks its own server to start the thing (STUDIO_REQUEST), and
--      the script's CLIENT does it.
--   4. When it is done, the script's client fires, from any resource:
--        TriggerEvent('dirk_lib:studioHandBack', result?)
--      and the panel comes back exactly as it was left.
--
-- Replies: { action = 'handOff_RESULT', data = result or {} }. A script that
-- never hands back is not allowed to strand the admin: after `timeoutMs`
-- (default two minutes) the panel comes back on its own with { timedOut = true }.

local TOOL_ID = 'handOff'
local DEFAULT_TIMEOUT = 120000

local handing = false
local token = 0

local function fade(on, still)
  CreateThread(function()
    while IsScreenblurFadeRunning() do Wait(0) end
    if still and not still() then return end
    if on then TriggerScreenblurFadeIn(0) else TriggerScreenblurFadeOut(0) end
  end)
end

local function handBack(result)
  if not handing then return end
  handing = false
  SetNuiFocus(true, true)
  fade(true, function() return lib.adminTool.isEditing() end)
  lib.hideInstructions()
  SendNuiMessage(json.encode({
    action = TOOL_ID .. '_RESULT',
    data = type(result) == 'table' and result or {},
  }))
end

lib.adminTool.register(TOOL_ID, 'begin', function(data)
  if handing then return end
  handing = true
  token = token + 1
  local mine = token

  SetNuiFocus(false, false)
  fade(false)
  if type(data) == 'table' and type(data.instructions) == 'table' and data.instructions.title then
    lib.showInstructions(data.instructions)
  end

  local timeout = type(data) == 'table' and tonumber(data.timeoutMs) or DEFAULT_TIMEOUT
  SetTimeout(math.max(1000, timeout), function()
    if handing and token == mine then handBack({ timedOut = true }) end
  end)
end)

-- The page's own way back, for when the script refused and nothing is going
-- to run: the panel has already un-hidden itself, so this only has to return
-- the mouse. Nobody is waiting on a reply.
lib.adminTool.register('handOffCancel', 'invoke', function()
  if not handing then return end
  handing = false
  SetNuiFocus(true, true)
  fade(true, function() return lib.adminTool.isEditing() end)
  lib.hideInstructions()
end)

-- Any resource may hand the screen back; only a hand-off that is actually in
-- progress in THIS VM does anything with it.
AddEventHandler('dirk_lib:studioHandBack', function(result)
  handBack(result)
end)

AddEventHandler('dirk_lib:scriptConfigClosed', function()
  handing = false
end)
