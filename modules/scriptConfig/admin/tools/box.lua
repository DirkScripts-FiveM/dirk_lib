-- Marking out an AREA, rather than placing a thing in one.
--
-- Third sibling of tools/position.lua and tools/object.lua, and deliberately
-- the same shape as both: release NUI focus, drop the blur, show an
-- instruction card, poll for confirm/cancel, answer the React picker through a
-- SendNuiMessage its promise is waiting on. Anything learned there applies
-- here.
--
-- ── why this is not the object picker ───────────────────────────────────────
--
-- A drop pile is not a prop. The prop picker answers "which laptop, and where
-- is it" — a model and a transform — and a pile of parcels has neither. What it
-- needs is a FOOTPRINT: a patch of ground with a size and a facing, that things
-- can then be arranged inside. Pointing the prop picker at it gave a single
-- point and no extent, so the pile had to guess how much room it had.
--
-- Written general on purpose. Any "things appear around here" field wants this
-- — a spawn area, a search patch, a no-build box, a crowd of peds. The tool
-- knows nothing about parcels.
--
-- ── why not a zone ──────────────────────────────────────────────────────────
--
-- `x-mapPaths` already draws polygons on the Script Studio map, and that is the
-- right tool for a REGION: a yard boundary is hundreds of metres and is drawn
-- from above, where a map is better than a pair of eyes. This is the opposite
-- end — two metres by three, against a wall, where the thing that matters is
-- what it looks like from standing in front of it. Drawing that on a map is
-- guessing.
--
-- ── two modes ───────────────────────────────────────────────────────────────
--
-- AIM is where you start: the box follows your crosshair onto whatever you are
-- looking at and sits on it, arrows turn it. Getting a patch roughly where it
-- goes is a pointing problem.
--
-- SIZE (G) stops it following you so the arrows can stretch it instead. The
-- two cannot share a mode — arrows that both turn and resize is a tool with a
-- hidden state, and a box that follows your eyes cannot be measured against
-- the wall you are trying to fit it to.
--
-- NUI surface (dispatched by id from admin/init.lua):
--   ADMIN_TOOL_BEGIN { id = 'captureBox', value?, instructions?,
--                      sizeInstructions?, min?, max? }
--
-- Answers with:
--   { action = 'captureBox_RESULT',
--     data = { x, y, z, w, length, width, height } }
--   { action = 'captureBox_CANCELLED' }
--
-- `x, y, z` is the CENTRE OF THE FLOOR, not the centre of the volume. Everything
-- that consumes one of these puts objects on the ground inside it, so the floor
-- is the number they all need — and a caller that wants the middle can add half
-- the height far more easily than one that wants the floor can guess it back
-- out.

local TOOL_ID = 'captureBox'

local placing = false
local placeCallback = nil

--- Was there a panel behind this, or was it started from a command?
--- Decides whether focus goes back at the end — same reasoning as the others.
local fromPanel = false

--- Controls, named once so the polling loop reads as English.
---
--- The same three keys do the same three things in both modes — confirm,
--- cancel, swap — so it reads as one panel changing rather than two panels
--- swapping. Everything else is the mode's own business.
---
--- Esc is POLLED, not key-mapped: the pause menu owns it and takes the press
--- first. Backspace is the one on the card; Esc is taken as well, silently,
--- because it is what half of people press first.
---   38  = INPUT_PICKUP (E)               · 191 = INPUT_FRONTEND_ACCEPT (Enter)
---   177 = INPUT_FRONTEND_CANCEL (⌫)      · 200 = INPUT_FRONTEND_PAUSE (Esc)
---   47  = INPUT_DETONATE (G)             · 21  = Shift
local KEY = {
  confirm    = 38,
  confirmAlt = 191,
  cancel     = 177,
  cancelAlt  = 200,
  mode       = 47,
  left       = 174,
  right      = 175,
  up         = 172,
  down       = 173,
  fine       = 21,
}

--- How far the aiming ray reaches. Long enough to place a pile across a yard,
--- short enough that pointing at the horizon does not put one in the sea.
local REACH = 30.0

--- Surfaces, vehicles and props — and NOT peds.
---
---   1 = INCLUDE_MOVER · 2 = INCLUDE_VEHICLE · 16 = INCLUDE_OBJECT
---
--- Objects have to be in here. Dropping them sounded right — a box is a patch
--- of floor, why would it land on a crate — and it made the tool unusable,
--- because plenty of what you stand on IS an object. A yard's concrete pad, a
--- loading bay, half of any built-up interior: the ray went straight through
--- all of it, found nothing inside its reach, and fell back to holding the box
--- in front of the camera. Which is why it followed you around instead of
--- going where you pointed.
---
--- Peds stay out: 511 includes your own body, which in third person sits right
--- where the camera is looking.
local RAY_FLAGS = 1 + 2 + 16

--- What the shapetest should skip. 4 = NO_COLLISION.
---
--- `lib.raycast.fromCamera(flags, ignore, distance)` takes an ignore MASK in
--- this slot, not an entity. Passing a handle here sends a garbage bitmask and
--- excludes nothing, which is a bug worth not repeating.
local IGNORE = 4

--- What a box may be, in metres.
---
--- The floor is not zero: a box with no extent is invisible and unrecoverable,
--- and somebody WILL hold the shrink key down. The ceiling stops a typo turning
--- a parcel pile into a district.
local LIMIT = { min = 0.5, max = 25.0 }

--- How much one press changes a side. Shift for the last few centimetres.
local STEP = { coarse = 0.25, fine = 0.05 }

--- How fast a held arrow turns the box, in degrees per frame.
local TURN = { coarse = 2.0, fine = 0.4 }

--- The box being drawn this frame: floor centre, heading, and its three sides.
local box = nil

--- Which half we are in. Aiming follows the crosshair; sizing stands still.
local sizing = false

--- Sample props standing in for whatever will really live here.
---
--- A wireframe tells you where the box IS; it does not tell you whether what
--- goes in it will look right there — whether it clips the wall, blocks the
--- door, or sits at a daft angle to the shutter. So the tool can be handed a
--- few models and it fills the box with them.
---
--- They are arranged by the SAME rule the box will be read with: spread across
--- the footprint. Preview a fan and place a grid and the tool has lied to you,
--- which is worse than showing nothing.
local sample = {}

--- Whether THIS placement is logging its aim. Resolved at start.
local aimLog = false

--- Say what the aiming ray is actually doing.
---
--- Read from a REPLICATED CONVAR rather than held as a local, because this file
--- is loaded once per resource that pulls the admin tools in — seven VMs on this
--- server — and a local would only ever be true in one of them. `/boxdebug`
--- registers its command seven times too, so whichever copy wins the
--- registration is the only one that hears it: the flag went on in one VM while
--- the tool ran in another, and the log stayed silent for a tool that was
--- working perfectly.
---
---   setr dirk_box_debug 1
---
--- Read once when a placement starts, not per frame: a convar lookup every
--- frame is a string compare nobody needs.
local debugAim = false

local function wantsAimLog()
  if debugAim then return true end
  return GetConvar('dirk_box_debug', '0') == '1'
end

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
--- Dying is the one that bites: the respawn flow takes the screen and puts the
--- instruction card away, but the loop underneath carries on drawing a box and
--- holding controls with nothing on screen to say why.
local function interrupted()
  if not fromPanel then return IsEntityDead(cache.ped) end
  return IsEntityDead(cache.ped) or not lib.adminTool.isEditing()
end

-- ── drawing ─────────────────────────────────────────────────────────────────

--- The eight corners, in world space.
---
--- Built from the heading rather than drawn axis-aligned, because
--- `DrawBox` cannot be rotated and a pile against a wall is never square to
--- the map. Two unit vectors — one along the box, one across it — and every
--- corner is the centre plus some combination of the two.
---
--- Returns floor corners first, then the four above them in the same order, so
--- the edge list below can pair them by index.
local function corners(b)
  local rad = math.rad(b.w)
  local sin, cos = math.sin(rad), math.cos(rad)

  -- Along the box's own length, and across its width.
  local fx, fy = -sin, cos
  local rx, ry = cos, sin

  local hl, hw = b.length * 0.5, b.width * 0.5
  local out = {}

  -- Order matters: 1→2→3→4 walks the rim, so consecutive pairs are edges.
  local signs = { { 1, 1 }, { 1, -1 }, { -1, -1 }, { -1, 1 } }
  for i = 1, 4 do
    local sl, sw = signs[i][1], signs[i][2]
    local x = b.x + fx * hl * sl + rx * hw * sw
    local y = b.y + fy * hl * sl + ry * hw * sw
    out[i]     = vector3(x, y, b.z)
    out[i + 4] = vector3(x, y, b.z + b.height)
  end
  return out
end

--- The box, as twelve lines and a floor.
---
--- A wireframe rather than a solid: you have to be able to see what is INSIDE
--- the box to judge whether it is in the right place, and a filled volume hides
--- exactly the thing you are trying to look at. The floor is filled, faintly,
--- because the footprint is the part that matters and an outline on the ground
--- is hard to read against paving.
local function draw(b, r, g, bl)
  local c = corners(b)

  -- Rim, ceiling, then the four uprights joining them.
  for i = 1, 4 do
    local nxt = i % 4 + 1
    DrawLine(c[i].x, c[i].y, c[i].z, c[nxt].x, c[nxt].y, c[nxt].z, r, g, bl, 220)
    DrawLine(c[i + 4].x, c[i + 4].y, c[i + 4].z, c[nxt + 4].x, c[nxt + 4].y, c[nxt + 4].z, r, g, bl, 120)
    DrawLine(c[i].x, c[i].y, c[i].z, c[i + 4].x, c[i + 4].y, c[i + 4].z, r, g, bl, 160)
  end

  -- The floor, as two triangles. Lifted a hair so it does not fight the ground
  -- for the same pixels — z-fighting on a surface you are staring at reads as
  -- the tool flickering.
  local lift = 0.02
  local f = {}
  for i = 1, 4 do f[i] = vector3(c[i].x, c[i].y, c[i].z + lift) end

  -- Drawn from both sides. `DrawPoly` is one-sided, so a floor wound one way
  -- vanishes the moment you walk around it — which looks like the box stopped
  -- existing.
  local tris = { { 1, 2, 3 }, { 1, 3, 4 }, { 3, 2, 1 }, { 4, 3, 1 } }
  for _, t in ipairs(tris) do
    local a, bb, cc = f[t[1]], f[t[2]], f[t[3]]
    DrawPoly(a.x, a.y, a.z, bb.x, bb.y, bb.z, cc.x, cc.y, cc.z, r, g, bl, 60)
  end
end

-- ── the sample ──────────────────────────────────────────────────────────────

--- Where the sample props should start.
---
--- Under your feet, not at the map origin. `box` is all zeroes before the
--- first aim lands, so props created from it spawned in the sea off the south
--- coast and flew in when the first frame moved them.
local function feet()
  local p = GetEntityCoords(cache.ped)
  return p.x, p.y, p.z - 0.9
end

--- A stable pseudo-random in 0..1 for a given index.
---
--- Stable is the whole requirement. `math.random` here would re-roll every
--- frame and the props would vibrate — so the scatter is a hash of the index,
--- which gives the same untidy-looking arrangement every time it is asked.
local function jitter(i, salt)
  local n = math.sin(i * 12.9898 + salt * 78.233) * 43758.5453
  return n - math.floor(n)
end

--- Lay the sample props out inside the footprint.
---
--- A loose grid rather than a heap: the question being answered is "does this
--- much stuff fit here", and a pile on one spot answers a different one. Rows
--- and columns are derived from the footprint's own proportions, so a long thin
--- box fills as a line and a square one as a square.
local function layoutSample()
  if #sample == 0 or not box then return end

  local n = #sample
  -- Columns across the WIDTH, rows along the LENGTH, in proportion.
  local ratio = box.width / math.max(box.length, 0.01)
  local cols = math.max(1, math.min(n, math.ceil(math.sqrt(n * ratio))))
  local rows = math.ceil(n / cols)

  local rad = math.rad(box.w)
  local sin, cos = math.sin(rad), math.cos(rad)
  local fx, fy = -sin, cos   -- along the length
  local rx, ry = cos, sin    -- across the width

  -- Kept off the wireframe so a prop never pokes through the side it is meant
  -- to be contained by.
  local inset = 0.8

  for i = 1, n do
    local obj = sample[i]
    if DoesEntityExist(obj) then
      local col = (i - 1) % cols
      local row = math.floor((i - 1) / cols)

      -- -0.5..0.5 across each axis, centred whatever the counts are.
      local u = cols > 1 and (col / (cols - 1) - 0.5) or 0.0
      local v = rows > 1 and (row / (rows - 1) - 0.5) or 0.0

      -- A nudge so it reads as dropped rather than set out for inspection.
      u = u + (jitter(i, 1.0) - 0.5) * 0.18
      v = v + (jitter(i, 2.0) - 0.5) * 0.18

      local dx = fx * (v * box.length * inset) + rx * (u * box.width * inset)
      local dy = fy * (v * box.length * inset) + ry * (u * box.width * inset)

      -- Unfrozen to move, frozen again after. A frozen entity does not reliably
      -- take a new position, which would leave every sample prop sat wherever
      -- it was created no matter where the box went.
      FreezeEntityPosition(obj, false)
      SetEntityCoords(obj, box.x + dx, box.y + dy, box.z, false, false, false, false)
      SetEntityHeading(obj, box.w + jitter(i, 3.0) * 90.0)
      FreezeEntityPosition(obj, true)
    end
  end
end

--- Bring the sample props into the world, once.
---
--- Loaded up front rather than per frame: `lib.request.model` yields, and a
--- yield inside the draw loop is a stutter every frame it happens on.
local function spawnSample(spec)
  local wanted = type(spec.sample) == 'table' and spec.sample or nil
  if not wanted then return end

  local models = type(wanted.models) == 'table' and wanted.models or nil
  if not models or #models == 0 then return end

  local count = math.floor(tonumber(wanted.count) or #models)
  if count < 1 then return end
  -- A cap, because this is a preview. Somebody will pass the real queue length.
  if count > 24 then count = 24 end

  CreateThread(function()
    for i = 1, count do
      if not placing then return end
      local model = models[((i - 1) % #models) + 1]
      local hash = type(model) == 'number' and model or joaat(model)
      if lib.request.model(hash, 5000) then
        -- Not networked: this is a preview only this admin should ever see.
        -- At your FEET, not at `box`. This runs before the first aim lands,
        -- when the box is still all zeroes — so props built from it appeared
        -- at the map origin and flew across the world on the next frame.
        local fx, fy, fz = feet()
        local obj = CreateObject(hash, fx, fy, fz, false, false, false)
        if obj and obj ~= 0 then
          FreezeEntityPosition(obj, true)
          SetEntityCollision(obj, false, false)
          sample[#sample + 1] = obj
        end
        SetModelAsNoLongerNeeded(hash)
      end
    end
    layoutSample()
  end)
end

local function clearSample()
  for _, obj in ipairs(sample) do
    if DoesEntityExist(obj) then DeleteEntity(obj) end
  end
  sample = {}
end

-- ── the card ────────────────────────────────────────────────────────────────

--- What the card says, given the mode and the size.
---
--- The dimensions go in the HINT, and that is the whole reason the card is
--- rebuilt as the box changes: sizing something you cannot read the size of is
--- guesswork, and a readout somewhere else on screen is a second thing to look
--- at while already looking at the box.
local function cardFor(spec, b)
  local supplied = sizing and spec.sizeInstructions or spec.instructions
  local size = ('%.2f × %.2f × %.2f m'):format(b.length, b.width, b.height)

  if supplied then
    -- A caller's own wording wins, but it still gets the numbers — it has no
    -- way to know them, and they change every frame it is being resized.
    local out = {}
    for k, v in pairs(supplied) do out[k] = v end
    out.hint = supplied.hint and ('%s  ·  %s'):format(supplied.hint, size) or size
    return out
  end

  if sizing then
    return {
      title = 'Size it',
      hint  = size,
      keys  = {
        { key = '← →',   action = 'Wider / narrower' },
        { key = '↑ ↓',   action = 'Longer / shorter' },
        { key = 'SHIFT', action = 'Finer' },
        { key = 'G',     action = 'Back to aiming' },
        { key = 'E',     action = 'Done' },
        { key = '⌫',     action = 'Cancel' },
      },
    }
  end

  return {
    title = 'Where does it go?',
    hint  = size,
    keys  = {
      { key = '← →',   action = 'Turn' },
      { key = 'SHIFT', action = 'Finer' },
      { key = 'G',     action = 'Size it' },
      { key = 'E',     action = 'Put it here' },
      { key = '⌫',     action = 'Cancel' },
    },
  }
end

-- ── lifecycle ───────────────────────────────────────────────────────────────

local function endPlace(success, payload)
  if not placing then return end
  placing = false
  clearSample()
  box = nil
  sizing = false

  -- Only if there is a panel to give it back to, and only if the player is in
  -- a state to use it. Handing focus back to a panel that has closed, or to
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

--- Where the floor should sit this frame: wherever you are looking.
---
--- No distance control. Scrolling a box nearer and further is a second thing to
--- operate while already aiming, and the surface you are pointing at already
--- knows how far away it is.
--- How close the box may get to the camera.
---
--- Aiming at your own feet is a real thing to do — a pile beside the ramp you
--- are stood at — but the box must never end up between you and the screen,
--- because then it is all you can see and there is nothing left to aim with.
local NEAREST = 1.2

--- Is this something the ray has no business stopping on?
---
--- Three kinds of thing, and the third is the one that actually broke this:
---
---   1. The sample props we just put in the box. They sit inside it, so the
---      ray aiming the box hits them and the box snaps to its own preview.
---
---   2. The player, and whatever they are sat in. Aiming out of a car should
---      not stop on the car.
---
---   3. ANYTHING ATTACHED TO THE PLAYER. This is what it turned out to be: a
---      constant entity handle, a constant 5.5m from the camera — which in
---      third person is exactly where the player's head is — following you
---      everywhere. Weapons and held props are OBJECTS, so flag 16 catches
---      them, and they ride along on the ped the mask carefully excludes.
---      The box was pinned to the player's own kit and that is why it sat on
---      his head no matter where he pointed.
---
--- A mask cannot say any of this, which is why it is asked per hit.
local function skipHit(entity)
  if not entity or entity == 0 then return false end

  if entity == cache.ped then return true end
  if entity == cache.vehicle then return true end

  for i = 1, #sample do
    if sample[i] == entity then return true end
  end

  -- Not a script entity at all. Map collision comes back with a non-zero
  -- handle that means nothing, and asking it questions crashes the client.
  if not DoesEntityExist(entity) then return false end

  -- Attached to us, whatever it is.
  local root = GetEntityAttachedTo(entity)
  if root and root ~= 0 and (root == cache.ped or root == cache.vehicle) then
    return true
  end

  return false
end

local function aimPoint()
  local cam = GetGameplayCamCoord()
  local hit, coords, entity = lib.raycast.fromCamera(RAY_FLAGS, IGNORE, REACH)

  -- ── see THROUGH our own preview ──────────────────────────────────────────
  --
  -- The sample props sit inside the box, so the ray aiming the box hits them:
  -- the box snapped to a parcel, the parcels moved to the box, and the cluster
  -- walked up the ray into the camera a few centimetres a frame.
  --
  -- Turning their collision off does not help, and taking objects out of the
  -- mask breaks every floor that is a prop. What DOES work is asking what was
  -- hit and, if it was one of ours, carrying on from just past it — which is
  -- the one thing a mask cannot express.
  --
  -- Bounded, because a stack of six parcels is at most six things to see
  -- through and an unbounded loop here is a frozen client.
  local step = 0
  while hit and skipHit(entity) and step < 8 do
    step = step + 1
    local away = coords - cam
    local len = #(away)
    if len <= 0.001 then break end
    local dir = away / len
    -- Resume a few centimetres beyond the parcel, otherwise the next cast
    -- starts on its surface and hits the very same face again.
    hit, coords, entity = lib.raycast.fromCoords(
      coords + dir * 0.08, cam + dir * REACH, RAY_FLAGS, IGNORE)
  end

  if aimLog then
    local d = hit and coords and #(coords - cam) or -1
    -- `DoesEntityExist` FIRST. A shapetest hands back a non-zero handle for
    -- map collision that is not a script entity, and calling GetEntityModel
    -- on it crashes the client inside gta-streaming-five.
    local real = entity and entity ~= 0 and DoesEntityExist(entity)
    local ped = GetEntityCoords(cache.ped)
    lib.print.info((
      '[box] hit=%s entity=%s real=%s dist=%.2f steps=%d | box=%.1f,%.1f,%.1f'
      .. ' ped=%.1f,%.1f,%.1f samples=%d')
      :format(tostring(hit), tostring(entity), tostring(real), d, step,
        box and box.x or -1, box and box.y or -1, box and box.z or -1,
        ped.x, ped.y, ped.z, #sample))
  end

  if hit and coords then
    -- Held off the lens, so the box can never end up between you and the
    -- screen with nothing left to aim with.
    if #(coords - cam) >= NEAREST then return coords end
    if aimLog then
      lib.print.warn(('[box] hit was %.2fm away, under the %.2fm minimum — using the fallback')
        :format(#(coords - cam), NEAREST))
    end
  end

  if aimLog then lib.print.warn('[box] no usable hit, holding it in front of the camera') end

  -- Pointing at the sky. Hold it at arm's length rather than firing it at the
  -- horizon, so there is always something on screen to aim with.
  local cam = GetGameplayCamCoord()
  local rot = GetGameplayCamRot(0)
  local yaw, pitch = math.rad(rot.z), math.rad(rot.x)
  local dir = vector3(-math.sin(yaw) * math.cos(pitch), math.cos(yaw) * math.cos(pitch), math.sin(pitch))
  return cam + dir * 3.0
end


local function clamp(n, lo, hi)
  if n < lo then return lo end
  if n > hi then return hi end
  return n
end

--- Start marking out a box.
---
--- @param spec table { value?, instructions?, sizeInstructions?, min?, max? }
--- @param cb? fun(result: table|nil)
local function startBox(spec, cb)
  if placing then return end
  spec = spec or {}

  placing = true
  placeCallback = cb
  fromPanel = lib.adminTool.isEditing()
  sizing = false
  aimLog = wantsAimLog()

  local lo = tonumber(spec.min) or LIMIT.min
  local hi = tonumber(spec.max) or LIMIT.max

  -- Editing an existing one starts from it. A box that resets to a default
  -- every time you open it cannot be nudged, only redrawn.
  local seed = type(spec.value) == 'table' and spec.value or nil
  box = {
    x = tonumber(seed and seed.x) or 0.0,
    y = tonumber(seed and seed.y) or 0.0,
    z = tonumber(seed and seed.z) or 0.0,
    w = tonumber(seed and seed.w) or 0.0,
    length = clamp(tonumber(seed and seed.length) or 2.0, lo, hi),
    width  = clamp(tonumber(seed and seed.width)  or 2.0, lo, hi),
    height = clamp(tonumber(seed and seed.height) or 1.0, lo, hi),
  }

  SetNuiFocus(false, false)
  fade(false)

  -- Whatever will really live here, so the box is judged with something in it.
  spawnSample(spec)

  local shown = nil
  local function refreshCard()
    local card = cardFor(spec, box)
    local stamp = ('%s|%s|%.2f|%.2f|%.2f'):format(
      tostring(sizing), card.title or '', box.length, box.width, box.height)
    if stamp == shown then return end
    shown = stamp
    lib.showInstructions(card)
  end
  refreshCard()

  CreateThread(function()
    while placing do
      Wait(0)

      if interrupted() then
        endPlace(false)
        return
      end

      -- Held down, because the whole tool is arrow keys and a card. Leaving
      -- these live meant the player walked out from under the box they were
      -- aiming at.
      DisableControlAction(0, KEY.left, true)
      DisableControlAction(0, KEY.right, true)
      DisableControlAction(0, KEY.up, true)
      DisableControlAction(0, KEY.down, true)
      DisableControlAction(0, KEY.cancelAlt, true)

      local fine = IsDisabledControlPressed(0, KEY.fine)
      local step = fine and STEP.fine or STEP.coarse
      local turn = fine and TURN.fine or TURN.coarse

      if sizing then
        -- Stretched from the CENTRE, both ways at once. Growing from one edge
        -- means the box wanders off the spot you just aimed it at, and you
        -- end up re-aiming after every resize.
        if IsDisabledControlPressed(0, KEY.right) then box.width  = clamp(box.width  + step, lo, hi) end
        if IsDisabledControlPressed(0, KEY.left)  then box.width  = clamp(box.width  - step, lo, hi) end
        if IsDisabledControlPressed(0, KEY.up)    then box.length = clamp(box.length + step, lo, hi) end
        if IsDisabledControlPressed(0, KEY.down)  then box.length = clamp(box.length - step, lo, hi) end
      else
        -- Aiming means FOLLOWING, seeded or not. A box that stayed put on the
        -- coordinates it was loaded with, in the mode whose whole job is to
        -- move it, reads as the tool being stuck.
        --
        -- Eased rather than snapped. A shapetest is noisy — the hit point
        -- wobbles a centimetre or two every frame even holding perfectly
        -- still — and a box pinned straight to it shivers. Following at 40% of
        -- the remaining distance per frame settles within a few frames of
        -- stopping, and is still immediate enough that it does not feel like
        -- dragging something on elastic.
        local point = aimPoint()
        local ease = 0.4
        box.x = box.x + (point.x - box.x) * ease
        box.y = box.y + (point.y - box.y) * ease
        box.z = box.z + (point.z - box.z) * ease

        -- ...but a first frame, or a jump right across the yard, is a MOVE and
        -- not a wobble. Easing those means watching the box fly there.
        if #(vector3(box.x, box.y, box.z) - point) > 4.0 then
          box.x, box.y, box.z = point.x, point.y, point.z
        end

        if IsDisabledControlPressed(0, KEY.left)  then box.w = (box.w - turn) % 360.0 end
        if IsDisabledControlPressed(0, KEY.right) then box.w = (box.w + turn) % 360.0 end
      end

      draw(box, 224, 122, 95)
      -- Every frame, because in aim mode the box moves every frame. Six
      -- SetEntityCoords is nothing next to the draw calls above it.
      layoutSample()
      refreshCard()

      if IsControlJustPressed(0, KEY.mode) then
        sizing = not sizing
        refreshCard()
      end

      if IsControlJustPressed(0, KEY.confirm) or IsControlJustPressed(0, KEY.confirmAlt) then
        endPlace(true, {
          x = box.x, y = box.y, z = box.z, w = box.w,
          length = box.length, width = box.width, height = box.height,
        })
        return
      end

      if IsControlJustPressed(0, KEY.cancel) or IsDisabledControlJustPressed(0, KEY.cancelAlt) then
        endPlace(false)
        return
      end
    end
  end)
end

-- ── public surface ──────────────────────────────────────────────────────────

--- Mark out a box in the world.
---
--- @param spec table { value?, instructions?, sizeInstructions?, min?, max? }
--- @param cb? fun(result: table|nil) `{ x, y, z, w, length, width, height }`
lib.adminTool.captureBox = function(spec, cb)
  startBox(spec, cb)
end

lib.adminTool.register(TOOL_ID, 'begin', function(data)
  startBox(data or {})
end)


-- ── trying it without a panel ───────────────────────────────────────────────
--
--   /boxtest        a two-metre square
--
-- Prints the result and copies it, so an area found this way can be pasted
-- straight into a schema default. No panel involved, which is the point: it
-- exercises the tool on its own rather than the whole settings round trip.
--
-- Deliberately NOT permission-gated, for the same reason the prop placer's
-- test command is not: it draws lines only this client can see and returns
-- numbers. There is nothing here a player could do to anyone else.
--- Turn the aim log on or off WITHOUT starting the test placer.
---
--- `/boxtest debug` could only ever log the test command's own run, which is
--- the path that works — the panel's is the one that does not, and it is
--- started from React rather than from here. So the switch is its own command
--- and survives until it is turned off.
RegisterCommand('boxdebug', function()
  debugAim = not debugAim
  lib.print.info(('[box] aim log %s'):format(debugAim and 'ON' or 'off'))
end, false)

RegisterCommand('boxtest', function(_, args)
  if args and args[1] == 'debug' then debugAim = true end
  startBox({
    -- Stock GTA parcels, so the test shows the tool doing the thing it was
    -- written for rather than an empty wireframe.
    sample = {
      models = {
        'prop_cardbordbox_02a', 'prop_cardbordbox_03a',
        'prop_cardbordbox_04a', 'prop_boxpile_07d',
      },
      count = 6,
    },
    instructions = {
      title = 'Marking out a box',
      hint  = 'Test run — the result is printed, nothing is saved.',
      keys  = {
        { key = '← →', action = 'Turn' },
        { key = 'G',   action = 'Size it' },
        { key = 'E',   action = 'Put it here' },
        { key = '⌫',   action = 'Cancel' },
      },
    },
    sizeInstructions = {
      title = 'Marking out a box',
      hint  = 'Test run — the result is printed, nothing is saved.',
      keys  = {
        { key = '← →',   action = 'Wider / narrower' },
        { key = '↑ ↓',   action = 'Longer / shorter' },
        { key = 'SHIFT', action = 'Finer' },
        { key = 'G',     action = 'Back to aiming' },
        { key = 'E',     action = 'Done' },
        { key = '⌫',     action = 'Cancel' },
      },
    },
  }, function(result)
    if not result then
      lib.print.info('[boxtest] cancelled')
      return
    end
    local line = ('{ x = %.4f, y = %.4f, z = %.4f, w = %.2f, length = %.2f, width = %.2f, height = %.2f }')
      :format(result.x, result.y, result.z, result.w, result.length, result.width, result.height)
    lib.print.info(('[boxtest] %s'):format(line))
    if lib.copyToClipboard then pcall(lib.copyToClipboard, line) end
  end)
end, false)

--- A stop mid-placement must not leave the player with no cursor and no card.
---
--- Watches dirk_lib as well as this resource, and that is the whole point: this
--- file runs in the VM of whoever pulled the admin tools in, so
--- `GetCurrentResourceName()` is the consuming resource — but the flow depends
--- on dirk_lib for the instruction card and the NUI.
AddEventHandler('onResourceStop', function(name)
  if (name ~= GetCurrentResourceName() and name ~= 'dirk_lib') or not placing then return end
  placing = false
  placeCallback = nil
  clearSample()
  box = nil
  SetNuiFocus(false, false)
  lib.hideInstructions()
  TriggerScreenblurFadeOut(0)
end)
