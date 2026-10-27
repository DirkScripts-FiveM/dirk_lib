--[[
  lib.prompt - the world prompt plate (Liam 03/10): the house "use this" card (dirk-cfx-react's WorldPrompt) laid FLAT in the
  world beside the thing it is for - a power panel, a door, a safe - with an arrow at it, fading in as you walk up; E uses it.
  Every resource's prompts draw the SAME page (web/dui/prompt, served by dirk_lib), so the plate looks the same everywhere and
  changes in one place. dirk_keypad keeps its own copy of this logic (it runs without dirk_lib); LSX's interactive MLOs have
  their own design.

  Cheap by design - nothing runs per frame unless a plate is being drawn:
    * a slow look (0.4 s) for the nearest prompt within reach + 3 m (squared distances, the near side only, canUse): the page
      wakes there, out of sight, and the plate eases in from nothing - never a pop however fast you walk up
    * the DUI is made only when one comes in reach, its page told to hide (nothing rendered, nothing animating) when none is,
      and the DUI freed after 30 s with nothing to show
    * drawn only while in reach, on its near side and ON SCREEN (IsSphereVisible); only the nearest one
    * the page is sent a message only when something on it changes

    local id = lib.prompt.add({
      entity = ent,                 -- the thing (its front looks along -Y, the way a wall-mounted model is built), OR
      size = vec2(0.41, 0.51),      --   (optional with an entity: its face's width / height when the model's own box is bigger -
      center = vec2(0.0, 0.0),      --    pipes, cables - and where that face's middle sits, x / z off the entity's origin)
      coords = vec3(), heading = 0.0, size = vec2(0.1, 0.16),   -- a spot on a wall + the thing's width / height
      title = 'Power panel', action = 'Work on it', icon = 'zap',  -- icon: dirk-cfx-react's WORLD_PROMPT_ICONS
      position = 'top-right',       -- top-left | top | top-right | left | right | bottom-left | bottom | bottom-right
      key = 38,                     -- the control that uses it (its label comes from the player's own binding; on a pad
                                    --   the cap shows that control's controller button, e.g. LB)
      show = 2.6, full = 1.4, use = 1.2,   -- metres: starts to show, fully shown, the key works
      width = 0.56,                 -- the plate's width in metres (its height is half)
      canUse = function() return true end,   -- false: no plate (busy, a door already open...)
      onUse = function() end,       -- run in its own thread
    })
    lib.prompt.update(id, { title = '...' })    lib.prompt.remove(id)
]]

lib.prompt = {}

local URL = 'nui://dirk_lib/web/dui/prompt/build/index.html'
local SIDE = { ['top-left'] = { -1, 1 }, top = { 0, 1 }, ['top-right'] = { 1, 1 }, left = { -1, 0 }, right = { 1, 0 },
               ['bottom-left'] = { -1, -1 }, bottom = { 0, -1 }, ['bottom-right'] = { 1, -1 } }
local DEF = { show = 2.6, full = 1.4, use = 1.2, width = 0.56, key = 38, position = 'top-right', icon = 'key-round' }
local GAP, OFF = 0.02, 0.002          -- metres: plate to the thing's edge; plate in front of its back plane (the wall)
local IDLE_MS = 30000                 -- the DUI is freed after this long with nothing to show
local PRESS_MS = 520                  -- the page's press + ease-out (WorldPrompt: 0.18 s + 0.3 s)
-- Liam 03/10: walking up fast the plate popped in (the look was once a second and the page was only made in reach). Now the
-- look reaches PRE metres past `show` and wakes the page there, unseen, and the plate's alpha eases (FADE_IN / FADE_OUT per
-- second) toward what the distance asks - it always fades, however fast you arrive
local PRE = 3.0
local FADE_IN, FADE_OUT = 3.0, 4.0

local prompts, nextId = {}, 0
local active                          -- the prompt being drawn (the fast loop runs only while there is one)
local plate                           -- { dui, ready, awake, sent = {}, themeKey, lastShown, pressedAt }

local function helpText(text)
  BeginTextCommandDisplayHelp('STRING')
  AddTextComponentSubstringPlayerName(text)
  EndTextCommandDisplayHelp(0, false, false, -1)
end

local function send(msg)
  if plate and plate.dui then plate.dui:sendMessage(msg) end
end

local function themeOf()
  local s = lib.settings or {}
  return { game = 'fivem', primaryColor = s.primaryColor, primaryShade = s.primaryShade, customTheme = s.customTheme }
end

-- the page: made the first time a prompt comes in reach (on the page itself - a DUI made on about:blank never navigated)
local function wake()
  if not plate then
    local p = { dui = lib.dui:new({ url = URL, width = 1024, height = 512 }), awake = true, sent = {} }
    plate = p
    CreateThread(function()
      local give = GetGameTimer() + 5000
      while not IsDuiAvailable(p.dui.duiObject) and GetGameTimer() < give do Wait(50) end
      Wait(600)                                              -- the page loads and its script starts
      if plate ~= p then return end
      p.ready = true
    end)
  elseif not plate.awake then
    plate.awake, plate.sent, plate.pressedAt = true, {}, nil
    send({ action = 'PLATE_SHOW' })
  end
  return plate
end

local function sleep()
  if not (plate and plate.awake) then return end
  send({ action = 'PLATE_HIDE' })
  plate.awake, plate.lastShown = false, GetGameTimer()
end

-- the thing's frame: where it is, its right / forward (into the wall) / up axes, half width, half height, centre height
local function frame(p)
  if p.entity then
    local e = p.entity
    if not DoesEntityExist(e) then return end
    local pos = GetEntityCoords(e)
    local right = GetOffsetFromEntityInWorldCoords(e, 1.0, 0.0, 0.0) - pos     -- (GetEntityMatrix's out names are swapped)
    local fwd = GetOffsetFromEntityInWorldCoords(e, 0.0, 1.0, 0.0) - pos
    local up = GetOffsetFromEntityInWorldCoords(e, 0.0, 0.0, 1.0) - pos
    if not p.dims then
      if p.size then                                       -- the face it was given
        p.dims = { p.size.x / 2, p.size.y / 2, p.center and p.center.y or 0.0, p.center and p.center.x or 0.0 }
      else
        local mn, mx = GetModelDimensions(GetEntityModel(e))
        p.dims = { (mx.x - mn.x) / 2, (mx.z - mn.z) / 2, (mx.z + mn.z) / 2, (mx.x + mn.x) / 2 }
      end
    end
    return pos + right * p.dims[4], right, fwd, up, p.dims[1], p.dims[2], p.dims[3]
  end
  if not p.coords then return end
  local h = math.rad(p.heading or 0.0)
  local size = p.size or vec2(0.1, 0.16)
  return p.coords, vec3(math.cos(h), math.sin(h), 0.0), vec3(-math.sin(h), math.cos(h), 0.0), vec3(0.0, 0.0, 1.0),
    size.x / 2, size.y / 2, 0.0
end

-- the plate's corners on the wall: its arrow tip (the page edge / corner nearest the thing) just off the thing's edge / corner
local function corners(p, pos, right, fwd, up, hx, hz, cz)
  local side = SIDE[p.position] or SIDE[DEF.position]
  local dx, dz = side[1], side[2]
  local w = p.width or DEF.width
  local h = w / 2
  local ax, az = dx * (hx + GAP), cz + dz * (hz + GAP)
  local x0 = dx > 0 and ax or dx < 0 and ax - w or -w / 2
  local z0 = dz > 0 and az or dz < 0 and az - h or cz - h / 2
  local function W(x, z) return pos + right * x - fwd * OFF + up * z end
  return W(x0, z0 + h), W(x0 + w, z0 + h), W(x0 + w, z0), W(x0, z0), W(x0 + w / 2, z0 + h / 2), w
end

local function draw(TL, TR, BR, BL, a)
  local txd, tex = plate.dui.dictName, plate.dui.txtName
  -- both windings (a sprite poly is one-sided); from behind it's mirrored, but the wall hides that side
  for _, t in ipairs({ { TL, BR, TR, 0, 0, 1, 1, 1, 0 }, { TL, BL, BR, 0, 0, 0, 1, 1, 1 },
                       { TL, TR, BR, 0, 0, 1, 0, 1, 1 }, { TL, BR, BL, 0, 0, 1, 1, 0, 1 } }) do
    local A, B, C = t[1], t[2], t[3]
    DrawSpritePoly(A.x, A.y, A.z, B.x, B.y, B.z, C.x, C.y, C.z, 255, 255, 255, a, txd, tex,
      t[4] + 0.0, t[5] + 0.0, 0.0, t[6] + 0.0, t[7] + 0.0, 0.0, t[8] + 0.0, t[9] + 0.0, 0.0)
  end
end

local function allowed(p)
  if not p.canUse then return true end
  local ok, res = pcall(p.canUse)
  return ok and res ~= false
end

local function keyLabel(control)
  local k = GetControlInstructionalButton(0, control, true)    -- the player's own binding ("t_E")
  return k and k:match('^t_(.+)$') or 'E'
end

-- the control's controller button ('LB' for 38), for the cap when the player is on a pad
local padOf = setmetatable({}, { __index = function(t, control)
  local k = lib.getKey(control)
  local v = k and k.xbox ~= '(NONE)' and k.xbox or false
  t[control] = v
  return v
end })

-- pushes what changed to the page (the words, the side, the key, the icon, the player's input, the theme)
local function sync(p)
  local s, key = plate.sent, keyLabel(p.key or DEF.key)
  local data = { title = p.title or '', action = p.action or '', key = key, position = p.position or DEF.position,
                 icon = p.icon or DEF.icon, pad = padOf[p.key or DEF.key] or nil,
                 mode = IsUsingKeyboard(0) and 'kb' or 'pad' }
  local changed = false
  for k, v in pairs(data) do if s[k] ~= v then changed = true break end end
  if changed then
    send({ action = 'PLATE', data = data })
    plate.sent = data
  end
  local th = themeOf()
  local tk = ('%s|%s|%s'):format(tostring(th.primaryColor), tostring(th.primaryShade), json.encode(th.customTheme or {}))
  if plate.themeKey ~= tk then
    send({ action = 'UPDATE_DIRK_LIB_SETTINGS', data = th })
    plate.themeKey = tk
  end
end

local function use(p)
  if not p.onUse then return end
  local ok, err = pcall(p.onUse)
  if not ok then print(('^1[dirk_lib] prompt onUse failed: %s^7'):format(tostring(err))) end
end

-- THE FAST LOOP: only while a prompt is in reach. Draws it (on screen only), takes the key, and stops when it leaves reach.
local function drawLoop()
  CreateThread(function()
    while active do
      local p = active
      local pos, right, fwd, up, hx, hz, cz = frame(p)
      local me = GetEntityCoords(cache.ped)
      local d = pos and #(me - pos) or math.huge
      local pressing = plate and plate.pressedAt and GetGameTimer() - plate.pressedAt < PRESS_MS
      local near = pos and d < (p.show or DEF.show) + PRE and ((me - pos).x * fwd.x + (me - pos).y * fwd.y) < 0.0
      if not prompts[p.id] or (not near and not pressing) or (not pressing and not allowed(p)) then
        active = nil
        p.fade = 0.0
        if not pressing then sleep() end
        break
      end
      local pl = wake()
      local TL, TR, BR, BL, C, w = corners(p, pos, right, fwd, up, hx, hz, cz)
      if pl.ready then
        sync(p)
        if pl.pressedAt and not pressing then              -- shown again after a press: back in place
          send({ action = 'PLATE_RESET' })
          pl.pressedAt = nil
        end
        local show, full = p.show or DEF.show, p.full or DEF.full
        local want = pressing and 1.0 or math.max(0.0, math.min(1.0, (show - d) / (show - full)))
        local a, dt = p.fade or 0.0, GetFrameTime()
        a = want > a and math.min(want, a + dt * FADE_IN) or math.max(want, a - dt * FADE_OUT)
        p.fade = a
        if a > 0.004 and IsSphereVisible(C.x, C.y, C.z, w * 0.6) then
          draw(TL, TR, BR, BL, math.floor(a * 255))
        end
      elseif d <= (p.use or DEF.use) then
        helpText(p.text or ('~INPUT_CONTEXT~ %s'):format(p.action or ''))   -- the page isn't up yet
      end
      if not pressing and d <= (p.use or DEF.use) and IsControlJustReleased(0, p.key or DEF.key) then
        if pl.ready then
          send({ action = 'PLATE_PRESS' })
          pl.pressedAt = GetGameTimer()
        end
        PlaySoundFrontend(-1, 'SELECT', 'HUD_FRONTEND_DEFAULT_SOUNDSET', true)
        CreateThread(function() use(p) end)
      end
      Wait(0)
    end
  end)
end

-- THE SLOW LOOK: every 0.4 s, the nearest prompt within reach + PRE (or nothing); frees the page after a while with nothing to show
CreateThread(function()
  while true do
    if next(prompts) and not active then
      local me = GetEntityCoords(cache.ped)
      local best, bestD
      for _, p in pairs(prompts) do
        local pos, _, fwd = frame(p)
        if pos then
          local v = me - pos
          local show = (p.show or DEF.show) + PRE                   -- woken early, out of sight: it fades in from there
          local d2 = v.x * v.x + v.y * v.y + v.z * v.z
          if d2 < show * show and v.x * fwd.x + v.y * fwd.y < 0.0 and (not bestD or d2 < bestD) and allowed(p) then
            best, bestD = p, d2
          end
        end
      end
      if best then
        active = best
        drawLoop()
      end
    end
    if plate and not plate.awake and not active and plate.lastShown and GetGameTimer() - plate.lastShown > IDLE_MS then
      plate.dui:remove()                                     -- nothing shown for a while: free the browser
      plate = nil
    end
    Wait(active and 1000 or (next(prompts) and 400 or 2500))
  end
end)

---@param opts table see the header
---@return integer id
function lib.prompt.add(opts)
  nextId = nextId + 1
  local p = {}
  for k, v in pairs(opts or {}) do p[k] = v end
  p.id = nextId
  prompts[nextId] = p
  return nextId
end

---@param id integer
---@param fields table any of add()'s options
function lib.prompt.update(id, fields)
  local p = prompts[id]
  if not p then return end
  for k, v in pairs(fields or {}) do p[k] = v end
  if fields and (fields.entity ~= nil or fields.size ~= nil or fields.center ~= nil) then p.dims = nil end
end

---@param id integer
function lib.prompt.remove(id)
  prompts[id] = nil
end

return lib.prompt
