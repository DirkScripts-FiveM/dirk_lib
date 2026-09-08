if cache.game == 'redm' then return end

-- DataView implementation (credit: citizenfx/lua dataview.lua)
local dataview = setmetatable({
  EndBig = ">",
  EndLittle = "<",
  Types = {
    Float32 = { code = "f", size = 4 },
  },
}, {
  __call = function(_, length)
    return dataview.ArrayBuffer(length)
  end
})
dataview.__index = dataview

function dataview.ArrayBuffer(length)
  return setmetatable({
    blob = string.blob(length),
    length = length,
    offset = 1,
    cangrow = true,
  }, dataview)
end

function dataview:Buffer() return self.blob end

local function ef(big) return (big and dataview.EndBig) or dataview.EndLittle end

local function packblob(self, offset, value, code)
  local packed = self.blob:blob_pack(offset, code, value)
  if self.cangrow or packed == self.blob then
    self.blob = packed
    self.length = packed:len()
    return true
  end
  return false
end

for label, datatype in pairs(dataview.Types) do
  if not datatype.size then
    datatype.size = string.packsize(datatype.code)
  end

  dataview["Get" .. label] = function(self, offset, endian)
    offset = offset or 0
    if offset >= 0 then
      local o = self.offset + offset
      local v, _ = self.blob:blob_unpack(o, ef(endian) .. datatype.code)
      return v
    end
    return nil
  end

  dataview["Set" .. label] = function(self, offset, value, endian)
    if offset >= 0 and value then
      local o = self.offset + offset
      local v_size = (datatype.size < 0 and value:len()) or datatype.size
      if self.cangrow or ((o + (v_size - 1)) <= self.length) then
        if not packblob(self, o, value, ef(endian) .. datatype.code) then
          error("cannot grow subview")
        end
      else
        error("cannot grow dataview")
      end
    end
    return self
  end
end

local gizmoEnabled = false
local activeGizmoObj = nil
local gizmoConfirmPressed = false
local gizmoCancelPressed = false

RegisterCommand('+gizmoConfirm', function() gizmoConfirmPressed = true end, false)
RegisterCommand('-gizmoConfirm', function() end, false)
RegisterKeyMapping('+gizmoConfirm', 'Confirm gizmo editing', 'keyboard', 'RETURN')

RegisterCommand('+gizmoCancel', function() gizmoCancelPressed = true end, false)
RegisterCommand('-gizmoCancel', function() end, false)
RegisterKeyMapping('+gizmoCancel', 'Cancel gizmo editing', 'keyboard', 'BACK')

-- Controls to disable while gizmo is active (everything except camera)
local DISABLED_CONTROLS = {
  21, 24, 25, -- sprint, lmb, rmb
  36, 37,     -- stealth, select weapon
  44, 45,     -- cover, reload
  47,         -- weapon
  58, 59, 60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 70, -- ped/action controls
  73, 74, 75, -- veh enter
  140, 141, 142, 143, -- melee
  199, 200,   -- pause menus
  245,        -- chat
  249,        -- push to talk
  257, 258, 259, 260, 261, 262, -- quickselect/weapon wheel
  288, 289, 303, -- phone
  322, 323, 324, 325, 326, 327, 328, 329, 330, -- HUD/map
  344,        -- interaction
}

local function normalize(x, y, z)
  local length = math.sqrt(x * x + y * y + z * z)
  if length == 0 then return 0, 0, 0 end
  return x / length, y / length, z / length
end

local function makeEntityMatrix(entity)
  local f, r, u, a = GetEntityMatrix(entity)
  local view = dataview.ArrayBuffer(60)

  view:SetFloat32(0, r[1])
    :SetFloat32(4, r[2])
    :SetFloat32(8, r[3])
    :SetFloat32(12, 0)
    :SetFloat32(16, f[1])
    :SetFloat32(20, f[2])
    :SetFloat32(24, f[3])
    :SetFloat32(28, 0)
    :SetFloat32(32, u[1])
    :SetFloat32(36, u[2])
    :SetFloat32(40, u[3])
    :SetFloat32(44, 0)
    :SetFloat32(48, a[1])
    :SetFloat32(52, a[2])
    :SetFloat32(56, a[3])
    :SetFloat32(60, 1)

  return view
end

local function applyEntityMatrix(entity, view)
  local x1, y1, z1 = view:GetFloat32(16), view:GetFloat32(20), view:GetFloat32(24)
  local x2, y2, z2 = view:GetFloat32(0), view:GetFloat32(4), view:GetFloat32(8)
  local x3, y3, z3 = view:GetFloat32(32), view:GetFloat32(36), view:GetFloat32(40)
  local tx, ty, tz = view:GetFloat32(48), view:GetFloat32(52), view:GetFloat32(56)

  x1, y1, z1 = normalize(x1, y1, z1)
  x2, y2, z2 = normalize(x2, y2, z2)
  x3, y3, z3 = normalize(x3, y3, z3)

  SetEntityMatrix(entity,
    x1, y1, z1,
    x2, y2, z2,
    x3, y3, z3,
    tx, ty, tz
  )
end

local function clearEntityDraw(entity)
  if DoesEntityExist(entity) then SetEntityDrawOutline(entity, false) end
end

--- Keys polled rather than key-mapped. See the loop for why ESC cannot be a
--- binding; G joins it so the whole way-out scheme is read from one place.
---   200 = INPUT_FRONTEND_PAUSE (ESC) · 47 = INPUT_DETONATE (G)
---   38  = INPUT_PICKUP (E)
---
--- E is polled ALONGSIDE the RETURN keymapping rather than replacing it: a
--- keymapping's default only applies the first time it is registered, so
--- changing it would leave everyone who has already run this on RETURN while
--- the card told them to press E.
local CONTROL = { cancel = 200, back = 47, confirm = 38 }

--- Gizmo editor for an entity. Yields until confirmed, stepped back, or cancelled.
---
--- @param entity number The entity handle to manipulate
--- @param options? table { disableControls = boolean (default true) }
--- @return table|nil { entity: number, pos: vector3, rot: vector3 } or nil if cancelled
function lib.gizmo(entity, options)
  options = options or {}
  local shouldDisable = options.disableControls ~= false

  local p = promise.new()
  activeGizmoObj = { entity = entity, close = nil }

  gizmoEnabled = true
  gizmoConfirmPressed = false
  gizmoCancelPressed = false
  EnterCursorMode()

  -- Store original position/rotation for cancel revert
  local originalPos = GetEntityCoords(entity)
  local originalRot = GetEntityRotation(entity, 2)

  -- The SAME card every other in-world tool uses.
  --
  -- This had a hand-rolled overlay of its own (`dirk_lib:showGizmoControls`
  -- and a React component to match), which meant two panels in one flow: a
  -- placer would show the standard instruction card, hand over to the gizmo,
  -- and the card would be replaced by a different-looking one saying the same
  -- kind of thing. `lib.showInstructions` is the primitive for exactly this,
  -- so the gizmo uses it and the transition is now just the keys changing.
  --
  -- `options.instructions` lets the caller supply its own wording - which is
  -- also how it gets translated, since the caller holds the locale and this
  -- module has no business knowing what language anyone reads.
  --
  -- The keys are read from the real bindings rather than written out, so
  -- rebinding the gizmo changes the card with it.
  --
  -- Local/world axes is deliberately NOT on the card. It is a real setting -
  -- it decides whether the handles follow the map's axes or the object's own -
  -- but it lives inside the native, which is why `+gizmoLocal` has a key
  -- mapping and no command behind it. We cannot set its default or turn it
  -- off, so advertising a toggle we do not control, for a distinction that is
  -- invisible until the object is rotated, costs a line and teaches nothing.
  -- L still works for anyone who wants it.
  -- Who owns the card.
  --
  -- A caller that supplied its own wording is running a flow with more than
  -- one step in it, and hiding the card on the way out makes it fade away and
  -- fade back for the next step - two panels, visibly. Left alone, the next
  -- `showInstructions` just swaps the contents of the one already on screen.
  --
  -- So the gizmo only takes the card down if the card was its own.
  local ownsCard = options.instructions == nil

  lib.showInstructions(options.instructions or {
    title = 'Place it',
    hint  = 'Fine — drag the handles.',
    keys  = {
      { key = lib.getCommandKey('+gizmoSelect'),      action = 'Grab a handle' },
      { key = lib.getCommandKey('+gizmoTranslation'), action = 'Move' },
      { key = lib.getCommandKey('+gizmoRotation'),    action = 'Rotate' },
      { key = 'G',     action = 'Back to aiming' },
      { key = 'ENTER', action = 'Place it here' },
      { key = 'ESC',   action = 'Cancel' },
    },
  })

  local resetPedAlpha = false
  if IsEntityAPed(entity) then
    resetPedAlpha = true
    SetEntityAlpha(entity, 200)
  else
    SetEntityDrawOutline(entity, true)
  end

  -- Three ways out, not two.
  --
  -- A gizmo that only confirms or cancels cannot say "I am done fiddling, put
  -- me back to aiming" — and that is a different thing from "forget the whole
  -- placement". Conflating them meant backing out of fine tuning threw away
  -- the position you had spent a minute getting right.
  --
  --   confirmed → the caller gets pos/rot
  --   stepped   → the caller gets 'back', entity left exactly as it is
  --   cancelled → the caller gets nil, entity reverted
  local outcome = 'confirmed'

  local function finish(how)
    outcome = how or 'confirmed'
    gizmoEnabled = false
  end

  activeGizmoObj.close = finish

  CreateThread(function()
    while gizmoEnabled and DoesEntityExist(entity) do
      Wait(0)

      -- Dying takes the screen and puts the card away; without this the gizmo
      -- carries on holding the mouse behind the respawn with nothing to say
      -- why. Treated as a cancel, so the entity goes back where it was.
      if IsEntityDead(cache.ped) then
        finish('cancelled')
        break
      end

      -- E (or Enter) to confirm
      if gizmoConfirmPressed then
        gizmoConfirmPressed = false
        finish('confirmed')
        break
      end

      -- Backspace to cancel
      if gizmoCancelPressed then
        gizmoCancelPressed = false
        finish('cancelled')
        break
      end

      -- ESC and G, polled rather than key-mapped.
      --
      -- `RegisterKeyMapping` cannot have ESC: the pause menu owns it and takes
      -- the press first. Disabling the control and reading it directly is the
      -- only way to offer the key everyone expects to mean "get me out", so
      -- both live here rather than half the scheme being bindings and half
      -- being polls.
      DisableControlAction(0, CONTROL.cancel, true)
      DisableControlAction(0, CONTROL.back, true)
      DisableControlAction(0, CONTROL.confirm, true)

      if IsDisabledControlJustPressed(0, CONTROL.confirm) then
        finish('confirmed')
        break
      elseif IsDisabledControlJustPressed(0, CONTROL.cancel) then
        finish('cancelled')
        break
      elseif IsDisabledControlJustPressed(0, CONTROL.back) then
        finish('back')
        break
      end

      -- ALT used to drop cursor mode here so the gameplay camera could turn.
      -- It never worked: the gizmo native holds the mouse for its handles, so
      -- letting go of the cursor changed nothing you could see, and it read as
      -- a key that does nothing. Gone rather than left in.
      --
      -- Which leaves precise mode with no camera control at all - you frame
      -- the shot in rough mode and then work on it. The real answer is an
      -- orbit camera locked to the entity; until that exists, an honest
      -- limitation beats a key that pretends.
      DisableControlAction(0, 19, true)

      do
        if shouldDisable then
          for i = 1, #DISABLED_CONTROLS do
            DisableControlAction(0, DISABLED_CONTROLS[i], true)
          end
        else
          DisableControlAction(0, 24, true)
          DisableControlAction(0, 25, true)
          DisableControlAction(0, 140, true)
        end
        DisablePlayerFiring(cache.playerId, true)

        local matrixBuffer = makeEntityMatrix(entity)
        local changed = Citizen.InvokeNative(0xEB2EDCA2, matrixBuffer:Buffer(), 'Editor1', Citizen.ReturnResultAnyway())

        if changed then
          applyEntityMatrix(entity, matrixBuffer)
        end
      end
    end

    -- ONCE. Cursor mode is counted, not a boolean: this used to leave twice
    -- against a single enter to mop up the ALT orbit, which entered and left
    -- on its own. With ALT gone the second call pushed the count below zero,
    -- so the NEXT gizmo drew its handles with no cursor to grab them — which
    -- only ever showed up on the second visit, after switching modes twice.
    LeaveCursorMode()
    if ownsCard then lib.hideInstructions() end
    clearEntityDraw(entity)
    if resetPedAlpha and DoesEntityExist(entity) then SetEntityAlpha(entity, 255) end

    -- If cancelled, revert entity to original position/rotation
    if outcome == 'cancelled' and DoesEntityExist(entity) then
      SetEntityCoords(entity, originalPos.x, originalPos.y, originalPos.z, false, false, false, false)
      SetEntityRotation(entity, originalRot.x, originalRot.y, originalRot.z, 2, false)
    end

    local result = nil
    if outcome == 'back' then
      -- A string, not a table, so a caller that only checks truthiness still
      -- does something sensible and one that cares can tell the difference.
      result = 'back'
    elseif outcome == 'confirmed' then
      result = {
        entity = entity,
        pos = DoesEntityExist(entity) and GetEntityCoords(entity) or vector3(0, 0, 0),
        rot = DoesEntityExist(entity) and GetEntityRotation(entity, 2) or vector3(0, 0, 0),
      }
    end

    activeGizmoObj = nil
    p:resolve(result)
  end)

  return Citizen.Await(p)
end

--- A stop must not leave the handles up and the cursor captured.
---
--- dirk_lib as well as this resource: the gizmo is a dirk_lib module running
--- inside whichever resource required it, and it draws through dirk_lib's NUI.
--- Restarting dirk_lib underneath an open gizmo left it drawing over a panel
--- that no longer existed, with cursor mode still held.
AddEventHandler('onResourceStop', function(name)
  if name ~= GetCurrentResourceName() and name ~= 'dirk_lib' then return end
  if not activeGizmoObj then return end
  if activeGizmoObj.close then pcall(activeGizmoObj.close, true) end
  gizmoEnabled = false
  LeaveCursorMode()
end)

RegisterKeyMapping('+gizmoSelect', 'Selects the currently highlighted gizmo', 'MOUSE_BUTTON', 'MOUSE_LEFT')
RegisterKeyMapping('+gizmoTranslation', 'Sets mode of the gizmo to translation', 'keyboard', 'T')
RegisterKeyMapping('+gizmoRotation', 'Sets mode for the gizmo to rotation', 'keyboard', 'R')
RegisterKeyMapping('+gizmoScale', 'Sets mode for the gizmo to scale', 'keyboard', 'S')
RegisterKeyMapping('+gizmoLocal', 'Sets gizmo to be local to the entity instead of world', 'keyboard', 'L')

return lib.gizmo

-- Thanks to AvarianKnight for the gizmo code.
-- https://github.com/Andyyy7666/ox_lib/blob/master/imports/gizmo/client.lua
