-- Camera-shot admin tool.
--
-- Exposes:
--   ADMIN_TOOL_BEGIN { id = 'captureCamera', value?, instructions? }
--     Opens a free camera - at the saved shot when `value` has one, else at
--     the gameplay camera - and hands the panel's focus to the game. The admin
--     flies it into place and confirms.
--
-- Replies (routed by cfx-react's AdminOverlays into the pending picker):
--   { action = 'captureCamera_RESULT', data = { pos = {x,y,z}, rot = {x,y,z}, fov } }
--   { action = 'captureCamera_CANCELLED' }
--
-- Ported from dirk_multichar's scene-camera picker, which only worked inside
-- multichar's own panel. The stored numbers are WORLD position and rotation,
-- no offsets, so a consumer can hand them straight to SetCamCoord/SetCamRot.
--
-- Keys: mouse look · W/A/S/D fly along the view · Shift faster · Alt finer ·
-- Q/E step the field of view · F use this shot · Backspace cancel.
-- F (INPUT_VEH_ENTER) rather than E because E steps the zoom, and rather than
-- Enter because INPUT_ENTER can fire off Space and ended the old picker every
-- time someone tried to fly up.

local TOOL_ID = 'captureCamera'

local FOV_PRESETS = { 25.0, 35.0, 50.0, 70.0, 90.0 }

local active = false

local function closestFov(fov)
  local best, delta = 3, math.huge
  for i, v in ipairs(FOV_PRESETS) do
    local d = math.abs(v - fov)
    if d < delta then best, delta = i, d end
  end
  return best
end

--- Blur waits its turn: the natives drop a new fade while one is running.
local function fade(on, still)
  CreateThread(function()
    while IsScreenblurFadeRunning() do Wait(0) end
    if still and not still() then return end
    if on then TriggerScreenblurFadeIn(0) else TriggerScreenblurFadeOut(0) end
  end)
end

local function vec3(v, fallback)
  if type(v) ~= 'table' then return fallback end
  return {
    x = tonumber(v.x) or 0.0,
    y = tonumber(v.y) or 0.0,
    z = tonumber(v.z) or 0.0,
  }
end

local function finish(payload)
  SetNuiFocus(true, true)
  fade(true, function() return lib.adminTool.isEditing() end)
  lib.hideInstructions()
  if payload then
    SendNuiMessage(json.encode({ action = TOOL_ID .. '_RESULT', data = payload }))
  else
    SendNuiMessage(json.encode({ action = TOOL_ID .. '_CANCELLED' }))
  end
end

local function start(data)
  if active then return end
  active = true

  local saved = type(data) == 'table' and type(data.value) == 'table' and data.value or nil
  local pos = saved and vec3(saved.pos) or nil
  local rot = saved and vec3(saved.rot) or nil
  local hasSaved = pos and (pos.x ~= 0 or pos.y ~= 0 or pos.z ~= 0)

  local camX, camY, camZ, pitch, yaw, fov
  if hasSaved and pos and saved then
    camX, camY, camZ = pos.x + 0.0, pos.y + 0.0, pos.z + 0.0
    pitch, yaw = (rot and rot.x or 0.0) + 0.0, (rot and rot.z or 0.0) + 0.0
    fov = tonumber(saved.fov) or 50.0
  else
    local gp = GetGameplayCamCoord()
    local gr = GetGameplayCamRot(2)
    camX, camY, camZ = gp.x, gp.y, gp.z
    pitch, yaw = gr.x, gr.z
    fov = GetGameplayCamFov()
  end
  local fovIdx = closestFov(fov)

  SetNuiFocus(false, false)
  fade(false)
  if type(data) == 'table' and type(data.instructions) == 'table' and data.instructions.title then
    lib.showInstructions(data.instructions)
  end

  local cam = CreateCam('DEFAULT_SCRIPTED_CAMERA', true)
  SetCamCoord(cam, camX, camY, camZ)
  SetCamRot(cam, pitch, 0.0, yaw, 2)
  SetCamFov(cam, FOV_PRESETS[fovIdx])
  SetCamActive(cam, true)
  RenderScriptCams(true, false, 400, true, true)

  -- The player would otherwise stand in the shot they are framing.
  local ped = PlayerPedId()
  local wasVisible = IsEntityVisible(ped)
  SetEntityVisible(ped, false, false)
  FreezeEntityPosition(ped, true)

  CreateThread(function()
    local sensitivity, base, fast, fine = 9.0, 0.3, 4.0, 0.25
    local result

    while active do
      DisableAllControlActions(0)
      EnableControlAction(0, 1, true) -- look left/right
      EnableControlAction(0, 2, true) -- look up/down

      yaw = yaw - GetDisabledControlNormal(0, 1) * sensitivity
      pitch = math.max(-89.0, math.min(89.0, pitch - GetDisabledControlNormal(0, 2) * sensitivity))
      SetCamRot(cam, pitch, 0.0, yaw, 2)

      local ry, rp = math.rad(yaw), math.rad(pitch)
      local fx, fy, fz = -math.sin(ry) * math.cos(rp), math.cos(ry) * math.cos(rp), math.sin(rp)
      local rx, rgy = math.cos(ry), math.sin(ry)

      local speed = base
      if IsDisabledControlPressed(0, 21) then speed = base * fast       -- Shift
      elseif IsDisabledControlPressed(0, 19) then speed = base * fine end -- Alt

      local fwd, side = 0, 0
      if IsDisabledControlPressed(0, 32) then fwd = fwd + 1 end   -- W
      if IsDisabledControlPressed(0, 33) then fwd = fwd - 1 end   -- S
      if IsDisabledControlPressed(0, 35) then side = side + 1 end -- D
      if IsDisabledControlPressed(0, 34) then side = side - 1 end -- A

      camX = camX + (fx * fwd + rx * side) * speed
      camY = camY + (fy * fwd + rgy * side) * speed
      camZ = camZ + fz * fwd * speed
      SetCamCoord(cam, camX, camY, camZ)
      -- Stream what the camera sees, not what the (frozen) player stands in.
      SetFocusPosAndVel(camX, camY, camZ, 0.0, 0.0, 0.0)

      if IsDisabledControlJustPressed(0, 44) then -- Q: wider
        fovIdx = math.min(#FOV_PRESETS, fovIdx + 1)
        SetCamFov(cam, FOV_PRESETS[fovIdx])
      elseif IsDisabledControlJustPressed(0, 38) then -- E: tighter
        fovIdx = math.max(1, fovIdx - 1)
        SetCamFov(cam, FOV_PRESETS[fovIdx])
      end

      if IsDisabledControlJustPressed(0, 23) then -- F: use this shot
        result = {
          pos = { x = camX, y = camY, z = camZ },
          rot = { x = pitch, y = 0.0, z = yaw },
          fov = FOV_PRESETS[fovIdx],
        }
        active = false
      elseif IsDisabledControlJustPressed(0, 177) then -- Backspace
        active = false
      end

      Wait(0)
    end

    RenderScriptCams(false, true, 400, true, true)
    DestroyCam(cam, false)
    ClearFocus()
    SetEntityVisible(ped, wasVisible, false)
    FreezeEntityPosition(ped, false)
    finish(result)
  end)
end

lib.adminTool.register(TOOL_ID, 'begin', start)

-- The panel closed mid-shot: stop, and the loop's own cleanup restores the
-- player and the camera.
AddEventHandler('dirk_lib:scriptConfigClosed', function()
  active = false
end)

AddEventHandler('onResourceStop', function(name)
  if name ~= GetCurrentResourceName() or not active then return end
  active = false
  RenderScriptCams(false, false, 0, true, true)
  ClearFocus()
  local ped = PlayerPedId()
  SetEntityVisible(ped, true, false)
  FreezeEntityPosition(ped, false)
  SetNuiFocus(false, false)
  lib.hideInstructions()
end)
