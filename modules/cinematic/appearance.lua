local appearance = {}

--- Capturing and restoring exactly how a ped looked.
---
--- A recorded take has to put the same person back, and "same" means the
--- clothes and the face, not just the model — a freemode ped rebuilt from its
--- model hash alone comes back as the default bald mannequin.
---
--- Part of lib.cinematic; see client.lua.

local COMPONENTS = { 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11 }
local PROPS      = { 0, 1, 2, 6, 7 }
local OVERLAYS   = 12   -- 0..12
local FEATURES   = 19   -- 0..19

local FREEMODE = {
  [joaat('mp_m_freemode_01')] = true,
  [joaat('mp_f_freemode_01')] = true,
}

--- GetPedHeadBlendData is documented as returning (boolean, any) but hands back
--- the struct as a table in Lua. Take whichever return value is the table.
local function headBlend(ped)
  local a, b = GetPedHeadBlendData(ped)
  local t = type(a) == 'table' and a or (type(b) == 'table' and b or nil)
  if not t then return nil end
  return {
    t.shapeFirst or 0, t.shapeSecond or 0, t.shapeThird or 0,
    t.skinFirst or 0, t.skinSecond or 0, t.skinThird or 0,
    t.shapeMix or 0.0, t.skinMix or 0.0, t.thirdMix or 0.0,
  }
end

--- Everything needed to rebuild this ped later, as plain serialisable data.
function appearance.capture(ped)
  local model = GetEntityModel(ped)
  local a = { model = model, components = {}, props = {} }

  for _, c in ipairs(COMPONENTS) do
    a.components[#a.components + 1] = {
      c,
      GetPedDrawableVariation(ped, c),
      GetPedTextureVariation(ped, c),
      GetPedPaletteVariation(ped, c),
    }
  end

  for _, p in ipairs(PROPS) do
    local idx = GetPedPropIndex(ped, p)
    if idx ~= -1 then
      a.props[#a.props + 1] = { p, idx, GetPedPropTextureIndex(ped, p) }
    end
  end

  -- face data only exists on the freemode models; on an NPC ped it's noise
  if FREEMODE[model] then
    a.blend    = headBlend(ped)
    a.hair     = { GetPedHairColor(ped), GetPedHairHighlightColor(ped) }
    a.eyes     = GetPedEyeColor(ped)
    a.overlays = {}
    a.face     = {}

    for i = 0, OVERLAYS do
      local ok, value, colourType, c1, c2, opacity = GetPedHeadOverlayData(ped, i)
      if ok and value ~= 255 then
        a.overlays[#a.overlays + 1] = { i, value, colourType or 0, c1 or 0, c2 or 0, opacity or 0.0 }
      end
    end

    for i = 0, FEATURES do
      local scale = GetPedFaceFeature(ped, i)
      if scale and scale ~= 0.0 then
        a.face[#a.face + 1] = { i, scale }
      end
    end
  end

  return a
end

function appearance.apply(ped, a)
  if not a then return end

  -- head blend first: it resets the head, so anything applied before it is lost
  if a.blend then
    local b = a.blend
    SetPedHeadBlendData(ped, b[1], b[2], b[3], b[4], b[5], b[6], b[7] + 0.0, b[8] + 0.0, b[9] + 0.0, false)
  end

  for _, o in ipairs(a.overlays or {}) do
    SetPedHeadOverlay(ped, o[1], o[2], o[6] + 0.0)
    SetPedHeadOverlayColor(ped, o[1], o[3], o[4], o[5])
  end

  for _, f in ipairs(a.face or {}) do
    SetPedFaceFeature(ped, f[1], f[2] + 0.0)
  end

  if a.hair then SetPedHairColor(ped, a.hair[1], a.hair[2]) end
  if a.eyes then SetPedEyeColor(ped, a.eyes) end

  for _, c in ipairs(a.components or {}) do
    SetPedComponentVariation(ped, c[1], c[2], c[3], c[4] or 0)
  end

  for _, p in ipairs(a.props or {}) do
    SetPedPropIndex(ped, p[1], p[2], p[3], true)
  end
end

--- Snapshot of everyone in a vehicle, driver first, so playback can put the
--- same people back in the same seats.
function appearance.captureOccupants(veh)
  if not IsEntityAVehicle(veh) then return nil end

  local out   = {}
  local seats = GetVehicleModelNumberOfSeats(GetEntityModel(veh))

  for seat = -1, (seats or 1) - 2 do
    local ped = GetPedInVehicleSeat(veh, seat)
    if ped and ped ~= 0 and DoesEntityExist(ped) then
      out[#out + 1] = {
        seat       = seat,
        appearance = appearance.capture(ped),
      }
    end
  end

  return #out > 0 and out or nil
end

--- Rebuilds them and sits them down. Returns the handles so the caller can
--- clean up. Yields (model loading), so call it off the timeline.
function appearance.spawnOccupants(veh, occupants)
  local peds = {}
  if not occupants then return peds end

  for _, o in ipairs(occupants) do
    local a = o.appearance or {}
    local model = type(a.model) == 'string' and joaat(a.model) or a.model
    RequestModel(model)
    local deadline = GetGameTimer() + 8000
    while not HasModelLoaded(model) and GetGameTimer() < deadline do Wait(0) end
    if HasModelLoaded(model) then
      local c = GetEntityCoords(veh)
      local ped = CreatePed(4, model, c.x, c.y, c.z, 0.0, false, false)
      SetModelAsNoLongerNeeded(model)

      appearance.apply(ped, a)
      SetPedIntoVehicle(ped, veh, o.seat)

      -- an extra who must not react to anything, ever
      SetEntityInvincible(ped, true)
      SetBlockingOfNonTemporaryEvents(ped, true)
      SetPedCanBeDraggedOut(ped, false)
      SetPedCanRagdoll(ped, false)
      SetPedConfigFlag(ped, 251, true)   -- won't flee the vehicle
      SetPedKeepTask(ped, true)

      peds[#peds + 1] = ped
    end
  end

  return peds
end

return appearance
