-- Placing a PROP, rather than standing somewhere.
--
-- Sibling of tools/position.lua, and deliberately the same shape: release NUI
-- focus, drop the blur, show an instruction card, poll for confirm/cancel, hand
-- the answer back to the React picker through a SendNuiMessage the promise is
-- waiting on. Anything learned there applies here.
--
-- ── why not lib.placeEntity ─────────────────────────────────────────────────
--
-- dirk_lib already has two of these. `lib.placeEntity` aims from the camera and
-- drops; `lib.positionEntity` drags gizmo handles. Both are console-command
-- tools written for a developer with a clipboard — placeEntity literally copies
-- a Lua snippet to your clipboard and returns, which is the opposite of what a
-- settings field wants. Neither knows about the admin-tool router, the blur,
-- the instruction card, or answering a React promise.
--
-- So this is the third, and it is the one Script Studio uses.
--
-- ── two modes ───────────────────────────────────────────────────────────────
--
-- ROUGH is where you start: the prop follows your crosshair onto whatever you
-- are looking at, and the arrows turn and tilt it. Getting a thing roughly
-- where it goes is a pointing problem, and pointing is what a mouse is for.
--
-- PRECISE (G) hands the same prop to `lib.gizmo`. It stops following you and
-- sits still with handles on it, camera free to orbit, so the last few
-- centimetres are dragged rather than aimed. Confirming there finishes the
-- placement; cancelling there comes back to rough with the position intact.
--
-- The split exists because one interaction cannot do both. A prop that
-- follows your eyes can never be nudged a centimetre, and a gizmo is a
-- miserable way to cross a car park.
--
-- ── what it does NOT do ─────────────────────────────────────────────────────
--
-- It does not tilt the prop to match the surface you are pointing at. A laptop
-- on a desk, a radio on a shelf, a box on a floor - all flat, all the common
-- case - and the pitch nudges plus the gizmo cover a slope. Deriving a
-- rotation from a surface normal is easy to write and hard to get right, and
-- wrong rotation maths reads as "the tool is broken" rather than "that
-- surface is odd".
--
-- NUI surface (dispatched by id from admin/init.lua):
--   ADMIN_TOOL_BEGIN { id = 'captureObject', model, value?,
--                      instructions?, preciseInstructions? }
--
-- Answers with:
--   { action = 'captureObject_RESULT', data = { x, y, z, w, rx, ry, rz } }
--   { action = 'captureObject_CANCELLED' }

local TOOL_ID = 'captureObject'

local placing = false
local placeCallback = nil
local preview = nil

--- Was there a panel behind this, or was it started from a command?
---
--- It decides whether focus goes back at the end. Restoring focus with nothing
--- open hands the cursor to a page that is not there, and you are left unable
--- to move with no way to explain why.
local fromPanel = false

--- Controls, named once so the polling loop reads as English.
---
--- Height is Shift plus the tilt arrows rather than the obvious Q and E: E is
--- already confirm, and putting raise on the key that ends the placement means
--- the first thing anyone tries also finishes the job.
--- One scheme, both modes.
---
--- Enter places, Esc cancels, G swaps mode — the same three keys doing the
--- same three things whichever half you are in, so it reads as one panel
--- changing rather than two panels swapping. Everything else is the mode's
--- own business.
---
--- Esc is POLLED, not key-mapped: the pause menu owns it and takes the press
--- first, so `RegisterKeyMapping` can never have it. Disabling the control and
--- reading it directly is the only way to offer the key people expect.
--- Backspace is the one on the card; Esc is taken as well, silently, because
--- it is what half of people press first and refusing it teaches nothing.
--- E confirms, because E is what "interact with the thing in front of me"
--- means everywhere else in the game and in the walk-there picker. Enter still
--- works, unadvertised, for the same reason Esc does.
---   38  = INPUT_PICKUP (E)               · 191 = INPUT_FRONTEND_ACCEPT (Enter)
---   177 = INPUT_FRONTEND_CANCEL (⌫)      · 200 = INPUT_FRONTEND_PAUSE (Esc)
---   47  = INPUT_DETONATE (G)
local KEY = {
  confirm  = 38,
  confirmAlt = 191,
  cancel   = 177,
  cancelAlt = 200,
  mode     = 47,
  yawLeft  = 174,  -- arrow left
  yawRight = 175,  -- arrow right
  pitchUp  = 172,  -- arrow up
  pitchDn  = 173,  -- arrow down
  fine     = 21,   -- Shift
}

--- Blur on or off, waiting its turn — same reasoning as tools/position.lua:
--- the natives ignore a fade while one is running, and a queued fade must
--- re-check that it is still wanted before it lands.
local function fade(on, still)
  CreateThread(function()
    while IsScreenblurFadeRunning() do Wait(0) end
    if still and not still() then return end
    if on then TriggerScreenblurFadeIn(0) else TriggerScreenblurFadeOut(0) end
  end)
end

--- Something ended this that was not a key.
---
--- Dying is the one that bit: the respawn flow takes the screen and puts the
--- instruction card away, but the loop underneath carried on outlining props
--- and holding controls with nothing on screen to say why. The panel closing
--- for its own reasons is the other — a tool that outlives the thing that
--- started it has no way back.
local function interrupted()
  if not fromPanel then return IsEntityDead(cache.ped) end
  return IsEntityDead(cache.ped) or not lib.adminTool.isEditing()
end

local function destroyPreview()
  if preview and DoesEntityExist(preview) then DeleteEntity(preview) end
  preview = nil
end

local function endPlace(success, payload)
  if not placing then return end
  placing = false
  destroyPreview()

  -- Only if there was a panel to give it back to. Started from a command
  -- there is nothing behind this, and taking focus for a page that is not
  -- open leaves you stuck with a cursor and no way out.
  -- Not just "was there a panel" — is there one NOW, and is the player in a
  -- state to use it. Handing focus back to a panel that has closed, or to
  -- someone watching a respawn, leaves a cursor over nothing and no way out.
  if fromPanel and not interrupted() then
    SetNuiFocus(true, true)
    fade(true, function() return lib.adminTool.isEditing() end)
  end
  lib.hideInstructions()

  SendNuiMessage(json.encode(success
    and { action = TOOL_ID .. '_RESULT', data = payload }
    or  { action = TOOL_ID .. '_CANCELLED' }))

  if type(placeCallback) == 'function' then pcall(placeCallback, success and payload or nil) end
  placeCallback = nil
end

--- How far the aiming ray reaches. Long enough to place something across a
--- yard, short enough that pointing at the horizon does not put a laptop in
--- the sea.
local REACH = 30.0

--- Surfaces, vehicles and props — and NOT peds.
---
--- 511 is everything, which includes your own body. In third person the camera
--- sits behind your head, so the ray hit the back of it and the prop rode
--- around on your skull. Nobody wants to place a laptop on a person, so peds
--- come out of the mask entirely rather than being ignored one at a time.
---   1 = the world · 2 = vehicles · 16 = objects
local RAY_FLAGS = 1 + 2 + 16

--- Where it should sit this frame: wherever you are looking.
---
--- No distance control. Scrolling a prop nearer and further is a second thing
--- to operate while already aiming, and the surface you are pointing at
--- already knows how far away it is.
---
--- The preview is still ignored explicitly — it is an object, so the mask
--- above would otherwise catch its own front face and walk it up the ray into
--- the camera a few centimetres a frame.
--- What the shapetest should skip. 4 = NO_COLLISION.
---
--- `lib.raycast.fromCamera(flags, ignore, distance)` takes an ignore MASK
--- here, not an entity — the preview handle used to be passed in this slot,
--- which sent a garbage bitmask and never excluded anything. The preview has
--- its collision turned off the moment it is made, so NO_COLLISION is what
--- actually skips it.
local IGNORE = 4

local function aimPoint()
  local hit, coords = lib.raycast.fromCamera(RAY_FLAGS, IGNORE, REACH)
  if hit and coords then return coords end

  -- Pointing at the sky. Hold it at arm's length rather than firing it at the
  -- horizon, so there is always something on screen to aim with.
  local cam = GetGameplayCamCoord()
  local rot = GetGameplayCamRot(0)
  local yaw, pitch = math.rad(rot.z), math.rad(rot.x)
  local dir = vector3(-math.sin(yaw) * math.cos(pitch), math.cos(yaw) * math.cos(pitch), math.sin(pitch))
  return cam + dir * 3.0
end

--- What is under the crosshair.
---
--- A plain shapetest, and `entityHit` is the answer. INCLUDE_MOVER is in the
--- mask so the ray also stops on world geometry — pointing at a wall should
--- find nothing rather than punching through it at whatever is behind.
local function objectUnderCrosshair()
  local _, _, entity = lib.raycast.fromCamera(1 + 2 + 16, IGNORE, REACH)
  -- Type 3 is an object. Vehicles are in the mask so the ray stops on them,
  -- not so they can be picked.
  if entity and entity ~= 0 and DoesEntityExist(entity) and GetEntityType(entity) == 3 then
    return entity
  end
  return nil
end

--- Point at something that is already there.
---
--- The other half of placing a prop: plenty of map interiors already have the
--- thing you were about to spawn sat on a desk, and putting a second one on
--- top of it is worse than useless. This aims at the world, tells you what is
--- under the crosshair, and hands back its model and where it is.
---
--- No preview entity, because the entity is the point. The outline is drawn on
--- whatever is being aimed at so there is never a doubt about which of three
--- props on a bench you are about to take.
local function startPick(spec, cb)
  if placing then return end
  placing = true
  placeCallback = cb
  fromPanel = lib.adminTool.isEditing()

  SetNuiFocus(false, false)
  fade(false)

  local card = spec.instructions or {
    title = 'Pick an object',
    hint  = 'Look at the one you want.',
    keys  = {
      { key = 'E', action = 'Use this one' },
      { key = '⌫', action = 'Cancel' },
    },
  }

  --- The card, with the confirm key only offered when it would DO something.
  ---
  --- The panel has no faded-key state, so the key is withheld rather than
  --- greyed: a cap you can press that does nothing is worse than one that is
  --- not there, and the hint says why it is missing. Re-shown only when the
  --- answer changes — `showInstructions` swaps the contents of the card that
  --- is already up, but doing it every frame is still sixty messages a second
  --- for a card that has not changed.
  local shownUsable = nil
  local function showCard(usable)
    if shownUsable == usable then return end
    shownUsable = usable
    local keys = {}
    for i = 1, #(card.keys or {}) do
      local k = card.keys[i]
      -- Everything except the confirm. Cancel is always available.
      if usable or not (k.key == 'E' or k.key == 'ENTER') then
        keys[#keys + 1] = k
      end
    end
    lib.showInstructions({
      title = card.title,
      hint = usable and card.hint or (card.hintNone or 'Nothing here this can use.'),
      keys = keys,
    })
  end
  showCard(false)

  local lit = nil

  CreateThread(function()
    while placing do
      Wait(0)

      if interrupted() then
        if lit and DoesEntityExist(lit) then SetEntityDrawOutline(lit, false) end
        endPlace(false)
        return
      end

      DisableControlAction(0, KEY.confirm, true)
      DisableControlAction(0, KEY.confirmAlt, true)
      DisableControlAction(0, KEY.cancel, true)
      DisableControlAction(0, KEY.cancelAlt, true)
      DisableControlAction(0, 24, true)
      DisableControlAction(0, 25, true)

      local found = objectUnderCrosshair()

      -- Is it something the caller can actually use?
      --
      -- The consumer knows which models it has a screen texture for; this does
      -- not, and should not. It is handed the list and only checks membership.
      -- Without it you can point at a wheelie bin, press Enter, and find out
      -- much later that nothing ever appears on it.
      local foundName = nil
      local usable = found ~= nil
      if found and spec.allow then
        local m = GetEntityModel(found)
        usable = false
        for _, name in ipairs(spec.allow) do
          if joaat(name) == m then usable = true foundName = name break end
        end
      end

      showCard(usable)

      if found ~= lit then
        if lit and DoesEntityExist(lit) then SetEntityDrawOutline(lit, false) end
        lit = found
        if lit then
          SetEntityDrawOutlineShader(0)
          SetEntityDrawOutline(lit, true)
        end
      end
      -- Green for one you can take, red for one you cannot — so the refusal is
      -- visible BEFORE you press the key rather than after.
      if lit then
        local r, g, b = 120, 230, 130
        if not usable then r, g, b = 230, 110, 90 end
        SetEntityDrawOutlineColor(r, g, b, 255)

        -- A chevron over it as well as the outline.
        --
        -- Belt and braces: the outline native is unreliable on props the MAP
        -- placed, which are exactly the ones this mode is for, and an outline
        -- that silently does not draw is indistinguishable from a ray that
        -- found nothing. The marker always draws.
        local c = GetEntityCoords(lit)
        -- Two returns, min then max — not a status code and then the pair.
        local _, dimMax = GetModelDimensions(GetEntityModel(lit))
        DrawMarker(20, c.x, c.y, c.z + (dimMax and dimMax.z or 0.2) + 0.35,
          0.0, 0.0, 0.0, 180.0, 0.0, 0.0, 0.16, 0.16, 0.16,
          r, g, b, 190, true, false, 2, false, nil, nil, false)
      end

      if (IsDisabledControlJustPressed(0, KEY.confirm)
        or IsDisabledControlJustPressed(0, KEY.confirmAlt)) and found and usable then
        local pos = GetEntityCoords(found)
        local rot = GetEntityRotation(found, 2)
        SetEntityDrawOutline(found, false)
        endPlace(true, {
          x = pos.x, y = pos.y, z = pos.z,
          w = rot.z % 360.0,
          rx = rot.x, ry = rot.y, rz = rot.z % 360.0,
          -- What it IS, so the consumer can find it again at runtime, and the
          -- flag that says not to spawn one of its own.
          -- The name we matched, not one read back off the entity:
          -- `GetEntityArchetypeName` is not on every build, and we only got
          -- here by matching against the caller's own list anyway.
          model = foundName,
          modelHash = GetEntityModel(found),
          existing = true,
        })
        return
      elseif IsDisabledControlJustPressed(0, KEY.cancel)
        or IsDisabledControlJustPressed(0, KEY.cancelAlt) then
        if lit and DoesEntityExist(lit) then SetEntityDrawOutline(lit, false) end
        endPlace(false)
        return
      end
    end

    if lit and DoesEntityExist(lit) then SetEntityDrawOutline(lit, false) end
  end)
end

local function startPlace(spec, cb)
  if placing then return end

  local model = spec and spec.model
  if type(model) ~= 'string' or model == '' then
    lib.print.warn('[captureObject] no model given, nothing to place')
    if type(cb) == 'function' then cb(nil) end
    return
  end

  local hash = joaat(model)
  if not lib.request.model(hash, 15000) then
    lib.print.error(('[captureObject] model failed to load: %s'):format(model))
    if type(cb) == 'function' then cb(nil) end
    return
  end

  placing = true
  placeCallback = cb
  fromPanel = lib.adminTool.isEditing()

  local start = GetEntityCoords(cache.ped)
  preview = CreateObject(hash, start.x, start.y, start.z, false, false, false)
  SetEntityCollision(preview, false, false)
  FreezeEntityPosition(preview, true)
  SetEntityAlpha(preview, 180, false)
  SetModelAsNoLongerNeeded(hash)

  -- Carry on from where the field already points, so re-opening a placed
  -- object nudges it rather than starting again from your feet.
  local held = type(spec.value) == 'table' and spec.value or {}
  local yaw   = tonumber(held.w)  or GetEntityHeading(cache.ped)
  local pitch = tonumber(held.rx) or 0.0
  local roll  = tonumber(held.ry) or 0.0
  local lift  = 0.0

  SetNuiFocus(false, false)
  fade(false)

  --- The card, and re-showing it after the gizmo has had the screen.
  ---
  --- The WORDS come from the caller. This file is required into the consuming
  --- resource's VM, so `locale()` here would read dirk_projectCars' locale
  --- file for keys that live in dirk_lib's - which is how you ship a card
  --- reading `object.place` in eight languages. React already holds the studio
  --- locale, so it builds the card and passes it down, exactly as the
  --- walk-there picker does.
  ---
  --- The English below is the fallback for a direct Lua call and for
  --- `/placetest`, and is the only English in the flow.
  ---
  --- Note `action`, not `label`. The React card renders the key cap from `key`
  --- and the words beside it from `action`; anything else draws a cap with
  --- nothing next to it, which is exactly what it looked like.
  local card = spec.instructions or {
    title = 'Place it',
    hint  = 'Rough — it follows where you look.',
    keys  = {
      { key = '← →',       action = 'Turn' },
      { key = '↑ ↓',       action = 'Tilt' },
      { key = 'SHIFT ↑ ↓', action = 'Raise / lower' },
      { key = 'G',         action = 'Fine tune' },
      { key = 'ENTER',     action = 'Place it here' },
      { key = 'ESC',       action = 'Cancel' },
    },
  }

  --- The gizmo's own card, when the caller has words for it. Same reason as
  --- above: the locale lives with whoever called, not here.
  local preciseCard = spec.preciseInstructions

  local function roughCard() lib.showInstructions(card) end

  roughCard()

  CreateThread(function()
    while placing do
      Wait(0)

      if interrupted() then
        endPlace(false)
        return
      end

      for _, control in pairs(KEY) do DisableControlAction(0, control, true) end

      -- ── precise ──────────────────────────────────────────────────────────
      --
      -- Hand the prop to the gizmo and stop aiming entirely: it is no longer
      -- following your eyes, it is sat still with handles on it and the camera
      -- is yours to orbit. `lib.gizmo` yields until it is confirmed or
      -- cancelled, and it brings its own overlay, so ours comes down first.
      --
      -- Cancelling the gizmo returns you to rough rather than throwing the
      -- placement away — it reverts the entity itself, so nothing is lost, and
      -- a mis-hit on the wrong key should not cost you the position you had.
      if IsDisabledControlJustPressed(0, KEY.mode) then
        -- NOT hidden first. The gizmo shows the precise card, which replaces
        -- the contents of the one already up; hiding it here made the panel
        -- fade out and back in, which is most of why two modes read as two
        -- panels rather than one changing.
        local result = lib.gizmo(preview, { instructions = preciseCard })
        if not placing then return end

        if result == 'back' then
          -- Stepped back on purpose. The entity is left exactly where the
          -- gizmo left it, so aiming resumes from the position you tuned
          -- rather than throwing that work away.
          local back = GetEntityRotation(preview, 2)
          pitch, roll, yaw = back.x, back.y, back.z % 360.0
          roughCard()
          goto continue
        elseif result then
          local rot = result.rot
          endPlace(true, {
            x = result.pos.x, y = result.pos.y, z = result.pos.z,
            w = rot.z % 360.0,
            rx = rot.x, ry = rot.y, rz = rot.z % 360.0,
          })
          return
        end

        -- Cancelled outright. Esc means the same in both modes: the whole
        -- placement is off, not just the fine tuning.
        endPlace(false)
        return
      end

      -- ── rough ────────────────────────────────────────────────────────────
      do
        local fine = IsDisabledControlPressed(0, KEY.fine)
        local turn = fine and 0.5 or 2.0
        local step = fine and 0.005 or 0.02

        if IsDisabledControlPressed(0, KEY.yawLeft)  then yaw = (yaw - turn) % 360.0 end
        if IsDisabledControlPressed(0, KEY.yawRight) then yaw = (yaw + turn) % 360.0 end

        if fine and IsDisabledControlPressed(0, KEY.pitchUp)     then lift = lift + step
        elseif fine and IsDisabledControlPressed(0, KEY.pitchDn) then lift = lift - step
        elseif IsDisabledControlPressed(0, KEY.pitchUp)          then pitch = pitch + turn
        elseif IsDisabledControlPressed(0, KEY.pitchDn)          then pitch = pitch - turn end

        local at = aimPoint()
        SetEntityCoords(preview, at.x, at.y, at.z + lift, false, false, false, false)
        -- Order 2 is the ZXY the game uses everywhere else; anything else looks
        -- right until the prop is tilted and then does not.
        SetEntityRotation(preview, pitch, roll, yaw, 2, true)

        if IsDisabledControlJustPressed(0, KEY.confirm)
          or IsDisabledControlJustPressed(0, KEY.confirmAlt) then
          local pos = GetEntityCoords(preview)
          local rot = GetEntityRotation(preview, 2)
          endPlace(true, {
            x = pos.x, y = pos.y, z = pos.z,
            -- `w` is the heading, so a field that only wants four numbers reads
            -- the same as one filled by the walk-there picker.
            w = rot.z % 360.0,
            rx = rot.x, ry = rot.y, rz = rot.z % 360.0,
          })
          return
        elseif IsDisabledControlJustPressed(0, KEY.cancel)
          or IsDisabledControlJustPressed(0, KEY.cancelAlt) then
          endPlace(false)
          return
        end
      end

      ::continue::
    end
  end)
end

lib.adminTool.captureObject = function(spec, cb)
  if not lib.adminTool.isEditing() then
    if type(cb) == 'function' then cb(nil) end
    return
  end
  startPlace(spec, cb)
end

lib.adminTool.register(TOOL_ID, 'begin', function(data)
  -- One tool, two jobs. `mode` decides whether we are creating a prop or
  -- adopting one, because from the panel's side it is the same field either
  -- way — it just wants to know where the thing is.
  if data and data.mode == 'pick' then
    startPick(data)
  else
    startPlace(data)
  end
end)

-- ── trying it without a panel ────────────────────────────────────────────────
--
--   /placetest              a laptop, the field this was written for
--   /placetest <model>      anything else
--
-- Prints the result and copies it, so a position found this way can be pasted
-- straight into a schema default. No panel involved, which is the point: it
-- exercises the placer on its own rather than the whole settings round trip.
--
-- Deliberately NOT permission-gated. It spawns a preview only this client can
-- see, with no collision, and returns numbers — there is nothing here a player
-- could do to anyone else. Gating it would mean a permission round trip on a
-- tool whose whole value is that it is one keystroke away.
RegisterCommand('placetest', function(_, args)
  local model = args[1] or 'prop_laptop_01a'
  startPlace({
    model = model,
    instructions = {
      title = ('Placing %s'):format(model),
      hint  = 'Test run — the result is printed, nothing is saved.',
      keys  = {
        { key = '← →',       action = 'Turn' },
        { key = '↑ ↓',       action = 'Tilt' },
        { key = 'SHIFT ↑ ↓', action = 'Raise / lower' },
        { key = 'G',         action = 'Fine tune' },
        { key = 'ENTER',     action = 'Place it here' },
        { key = 'ESC',       action = 'Cancel' },
      },
    },
  }, function(result)
    if not result then
      lib.print.info('[placetest] cancelled')
      return
    end
    local line = ('{ x = %.4f, y = %.4f, z = %.4f, w = %.2f, rx = %.2f, ry = %.2f }')
      :format(result.x, result.y, result.z, result.w, result.rx, result.ry)
    lib.print.info(('[placetest] %s  %s'):format(model, line))
    if lib.copyToClipboard then pcall(lib.copyToClipboard, line) end
  end)
end, false)

--- A stop mid-placement must not leave a floating prop and no cursor.
---
--- Watches dirk_lib as well as this resource, and that is the whole point.
--- This file runs in the VM of whoever pulled the admin tools in, so
--- `GetCurrentResourceName()` is dirk_projectCars, not dirk_lib - and the flow
--- depends on dirk_lib for the instruction card, the NUI and the gizmo. Restart
--- dirk_lib mid-placement and the card went with it while the ghost prop and
--- the gizmo handles stayed on screen with nothing left driving them.
AddEventHandler('onResourceStop', function(name)
  if (name ~= GetCurrentResourceName() and name ~= 'dirk_lib') or not placing then return end
  placing = false
  placeCallback = nil
  destroyPreview()
  SetNuiFocus(false, false)
  lib.hideInstructions()
  TriggerScreenblurFadeOut(0)
end)
