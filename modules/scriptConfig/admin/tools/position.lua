-- Position-related admin tools.
--
-- Exposes:
--   lib.adminTool.capturePosition(cb?)
--     Releases NUI focus, fades blur out, polls E (confirm) / Backspace
--     (cancel). On confirm calls cb({x,y,z,w}) and sends a NUI message
--     that resolves the React picker promise. On cancel cb(nil) and sends
--     the cancel message. cb is optional — the NUI flow works on its own.
--
--   lib.adminTool.gotoCoord({x, y, z, w})
--     Teleports the player to the given world coords. Used by the Goto
--     button next to position fields, and callable directly from Lua for
--     any admin-only "jump to coord" flow.
--
-- NUI surface (registered centrally in admin/init.lua, dispatched by id):
--   ADMIN_TOOL_BEGIN { id = 'capturePosition' }    → starts capture flow
--   ADMIN_TOOL_INVOKE { id = 'gotoCoord', value }  → teleport
--
-- React side fires SendNuiMessage events back:
--   { action = 'capturePosition_RESULT',    data = {x,y,z,w} }
--   { action = 'capturePosition_CANCELLED' }

local TOOL_ID = 'capturePosition'

local capturing = false
local captureCallback = nil

--- Blur on or off, waiting its turn.
---
--- The blur natives IGNORE a new fade while one is still running, and the panel
--- fades in the moment it opens - so clicking Set promptly enough had the
--- fade-out silently dropped and left the world blurred for the whole walk,
--- with nothing to clear it. `openSettingsUi` already waits for exactly this
--- reason; the capture never did.
---
--- In its own thread because the entry points are NUI callbacks, which are no
--- place to sit and yield.
---
--- ── and why it re-checks before it acts ─────────────────────────────────────
---
--- A thread that waits and then blurs is a thread that can blur AFTER the thing
--- it was blurring for has gone. Close the panel while this is still waiting on
--- a fade already in flight, and the fade-in lands on an empty screen with
--- nothing left open to clear it - the world stays blurred until you restart.
--- Which is worse than the bug it was added to fix.
---
--- So the fade-in only happens if we are still the reason for it. `still` is
--- checked at the moment of acting, not the moment of asking.
local function fade(on, still)
  CreateThread(function()
    while IsScreenblurFadeRunning() do Wait(0) end
    if still and not still() then return end
    if on then TriggerScreenblurFadeIn(0) else TriggerScreenblurFadeOut(0) end
  end)
end

local function endCapture(success, payload)
  if not capturing then return end
  capturing = false
  SetNuiFocus(true, true)
  -- Only re-blur if the panel is still there to be blurred BEHIND.
  fade(true, function() return lib.adminTool.isEditing() end)
  lib.hideInstructions()
  if success then
    SendNuiMessage(json.encode({
      action = TOOL_ID .. '_RESULT',
      data = payload,
    }))
    if type(captureCallback) == 'function' then
      pcall(captureCallback, payload)
    end
  else
    SendNuiMessage(json.encode({
      action = TOOL_ID .. '_CANCELLED',
    }))
    if type(captureCallback) == 'function' then
      pcall(captureCallback, nil)
    end
  end
  captureCallback = nil
end

local function startCapture(cb, instructions)
  if capturing then return end
  capturing = true
  captureCallback = cb

  SetNuiFocus(false, false)
  fade(false)

  if type(instructions) == 'table' and instructions.title then
    lib.showInstructions(instructions)
  end

  CreateThread(function()
    while capturing do
      Wait(0)
      -- INPUT_CONTEXT (E, 38) and INPUT_FRONTEND_CANCEL (Backspace, 177).
      -- Disable so vanilla bindings don't also fire (e.g. enter vehicle on E).
      DisableControlAction(0, 38, true)
      DisableControlAction(0, 177, true)

      if IsDisabledControlJustPressed(0, 38) then
        local ply = PlayerPedId()
        local pos = GetEntityCoords(ply)
        endCapture(true, {
          x = pos.x,
          y = pos.y,
          -- The GROUND, not your middle.
          --
          -- `GetEntityCoords` on a standing ped reads about a metre above the
          -- floor, so storing it raw made every saved position a metre high -
          -- and everything that SPAWNS at one hovered. Every consumer was
          -- quietly working around that with its own grounding call.
          --
          -- Fixed where it is captured instead, so the stored number is the
          -- place itself. `gotoCoord` therefore does NOT subtract any more:
          -- one offset, applied once, here.
          z = pos.z - 1.0,
          w = GetEntityHeading(ply),
        })
        return
      elseif IsDisabledControlJustPressed(0, 177) then
        endCapture(false)
        return
      end
    end
  end)
end

lib.adminTool.capturePosition = function(cb)
  if not lib.adminTool.isEditing() then
    if type(cb) == 'function' then cb(nil) end
    return
  end
  startCapture(cb)
end

lib.adminTool.gotoCoord = function(v)
  if not lib.adminTool.isEditing() then return end
  if type(v) ~= 'table' then return end
  local x = tonumber(v.x) or 0.0
  local y = tonumber(v.y) or 0.0
  local z = tonumber(v.z) or 0.0
  local w = tonumber(v.w) or 0.0
  local ply = PlayerPedId()
  -- No offset. The capture above already stores the ground, so the number is
  -- where you want to stand. This used to subtract a metre to undo the metre
  -- the capture added; both halves are gone.
  SetEntityCoords(ply, x + 0.0, y + 0.0, z + 0.0, false, false, false, false)
  SetEntityHeading(ply, w % 360.0)
end

-- Wire the NUI dispatchers to this tool.
lib.adminTool.register(TOOL_ID, 'begin', function(data)
  -- React side just wants the result via SendNuiMessage; no direct cb.
  -- `data.instructions` is the {title, hint, keys} spec from the React
  -- WorldPositionPicker — drives the bottom-right card via showInstructions.
  startCapture(nil, data and data.instructions)
end)

lib.adminTool.register('gotoCoord', 'invoke', function(data)
  lib.adminTool.gotoCoord(data and data.value)
end)

-- Safety: if the resource stops mid-capture, restore focus so the admin
-- isn't left cursorless. NUI is gone so SendNuiMessage no-ops anyway.
AddEventHandler('onResourceStop', function(name)
  if name == GetCurrentResourceName() and capturing then
    capturing = false
    captureCallback = nil
    SetNuiFocus(false, false)
    lib.hideInstructions()
    TriggerScreenblurFadeOut(0)
  end
end)

--- The panel closed. Whatever was mid-flight, the screen is clear.
---
--- The backstop for every way a blur can be left behind: a capture running when
--- the panel shut, a fade still queued, a resource restarted underneath one. A
--- stuck blur has no way out from inside the game, so it is worth one
--- unconditional clear on the one event that means "nothing is open".
AddEventHandler('dirk_lib:scriptConfigClosed', function()
  if capturing then
    capturing = false
    captureCallback = nil
    lib.hideInstructions()
  end
  CreateThread(function()
    while IsScreenblurFadeRunning() do Wait(0) end
    TriggerScreenblurFadeOut(0)
  end)
end)
