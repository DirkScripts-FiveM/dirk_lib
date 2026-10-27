-- ─────────────────────────────────────────────────────────────────────────────
-- lib.showKeys / lib.updateKeys / lib.hideKeys: a strip of keys on screen.
--
-- lib.showKeys({
--   position    = 'bottom-center',   -- or any side/corner, or { x = 0.5, y = 0.93 } (a screen point,
--                                    -- the strip centred on it), or { top, right, bottom, left, transform }
--   direction   = 'row',             -- 'row' | 'column' | 'row-reverse' | 'column-reverse' (default 'column')
--   displayOnly = false,             -- true: just draw the keys. No controls are read or disabled, no
--                                    -- actions fire, and `key` can be any label ('LMB', 'A', 'LS ◀')
--   inputs = {
--     {
--       key   = 'E',                 -- the key (a lib.getKey name); any string when displayOnly
--       label = 'Open',
--       pad   = 'A',                 -- optional: the controller button to show on a pad. Default: the
--                                    -- button the game reads for that control (lib.getKey(key).xbox)
--       delay = 1000,                -- optional: hold this long (ms) to use it; the cap fills as you hold
--       -- optional look, all off by default:
--       dim   = true,                -- greyed out
--       hl    = true,                -- red plate
--       pulse = true,                -- pulses red
--       down  = true,                -- shown pressed (green cap)
--       note  = 'No hook',           -- a small red tag hung above the key (the row never changes width)
--       hold  = 0.4,                 -- 0..1, the cap filled that far (a hold you time yourself)
--       miss  = true,                -- words only, no key
--       hidden = true,               -- not drawn
--       -- what pressing it does (not when displayOnly):
--       action = function() end, clientEvent = '', serverEvent = '', export = '', args = {},
--     },
--   },
-- })
--
-- lib.updateKeys(inputs) changes the open strip IN PLACE: no re-show, nothing
-- slides in again. inputs[i] updates key i: its look flags (dim, hl, pulse,
-- down, note, hold, hidden, miss) are replaced by what you pass (leave one out
-- and it goes off); key, label and pad are kept unless you pass them. A sparse
-- table ({ [2] = { hl = true } }) touches only those keys. On a displayOnly
-- strip, a list of a different length replaces the keys outright. It only
-- sends to the screen when something actually changed, so calling it every
-- frame costs nothing. Returns true if it sent, false if nothing changed or no
-- strip is open.
-- ─────────────────────────────────────────────────────────────────────────────

local invoking_resource = nil
AddEventHandler('onResourceStop', function(resource)
  if resource == invoking_resource then
    lib.hideKeys()
  end
end)

local keyInputOpen = false
local openId = 0
local current = nil -- the open strip: { inputs, position, direction, displayOnly }
local sentSnap = nil -- what the page was last sent, to send only on change

-- the look a script can set per key: replaced on every update
local FLAGS = { 'dim', 'hl', 'pulse', 'down', 'note', 'hold', 'hidden', 'miss' }
-- what the page draws, beyond the flags
local SHOWN = { 'qwerty', 'pad', 'label', 'pressed', 'holding', 'delay' }

--- One key as the page draws it: no functions, no control ids.
local function visualOf(v)
  local out = {}
  for _, f in ipairs(SHOWN) do out[f] = v[f] end
  for _, f in ipairs(FLAGS) do out[f] = v[f] end
  return out
end

local function visualList(inputs)
  local out = {}
  for i, v in ipairs(inputs) do out[i] = visualOf(v) end
  return out
end

--- Two drawn lists the same? (field by field: cheaper than encoding both)
local function sameList(a, b)
  if not a or not b or #a ~= #b then return false end
  for i = 1, #a do
    local x, y = a[i], b[i]
    for _, f in ipairs(SHOWN) do if x[f] ~= y[f] then return false end end
    for _, f in ipairs(FLAGS) do if x[f] ~= y[f] then return false end end
  end
  return true
end

--- Fill in a key the strip will READ (a real control): asserts it, finds its control + pad button.
local function prepControl(v, k)
  assert(type(v.key) == 'string', 'data.inputs['..k..'].key must be a string for lib.showKeys even if its a number just put it in quotes')
  local key_info = lib.getKey(v.key)
  assert(key_info, 'data.inputs['..k..'].key must be a valid key for lib.showKeys')
  v.qwerty  = key_info.qwerty
  v.control = key_info.control
  if v.pad == nil and key_info.xbox ~= '(NONE)' then v.pad = key_info.xbox end
  return v
end

--- Fill in a key the strip only DRAWS: any label will do.
local function prepDisplay(v, k)
  assert(v.miss or type(v.key) == 'string' or type(v.key) == 'number', 'data.inputs['..k..'].key must be a string for lib.showKeys')
  v.qwerty = v.key ~= nil and tostring(v.key) or nil
  return v
end

--- Merge an update into one key (see lib.updateKeys above).
local function mergeKey(cur, upd, k, displayOnly)
  for _, f in ipairs(FLAGS) do cur[f] = upd[f] end
  if upd.label ~= nil then cur.label = upd.label end
  if upd.pad ~= nil then cur.pad = upd.pad end
  if upd.key ~= nil and upd.key ~= cur.key then
    cur.key = upd.key
    if displayOnly then prepDisplay(cur, k) else cur.pad = upd.pad; prepControl(cur, k) end
  end
  return cur
end

--- Send the strip if it changed. `show` = a fresh show (slides in), else an in-place update.
local function sendKeys(show)
  if not current then return false end
  local list = visualList(current.inputs)
  if not show and sameList(list, sentSnap) then return false end
  sentSnap = list
  if show then
    SendNuiMessage(json.encode({
      action = 'SET_KEY_INPUTS',
      data = {
        position  = current.position,
        inputs    = list,
        direction = current.direction,
        theme     = lib.uiTheme(invoking_resource),
      }
    }, {sort_keys = true}))
  else
    SendNuiMessage(json.encode({ action = 'UPDATE_KEY_INPUTS', data = { inputs = list } }, {sort_keys = true}))
  end
  return true
end

lib.showKeys = function(data)
  invoking_resource = GetInvokingResource()
  if keyInputOpen then
    lib.hideKeys()
  end
  assert(type(data) == 'table', 'arg must be a table for lib.showKeys')
  assert(data.position == nil or type(data.position) == 'string' or type(data.position) == 'table', 'data.position must be a string or table for lib.showKeys')
  assert(type(data.inputs) == 'table', 'data.inputs must be a table for lib.showKeys')
  assert(#data.inputs > 0, 'data.inputs must have at least one input for lib.showKeys')

  local displayOnly = data.displayOnly == true
  for k,v in ipairs(data.inputs) do
    assert(type(v.label) == 'string', 'data.inputs['..k..'].label must be a string for lib.showKeys')
    assert(v.icon == nil or type(v.icon) == 'string', 'data.inputs['..k..'].icon must be a string or nil for lib.showKeys')
    assert(type(v.delay) == 'number' or v.delay == nil, 'data.inputs['..k..'].delay must be a number or nil for lib.showKeys')

    if displayOnly then
      prepDisplay(v, k)
    else
      prepControl(v, k)
      v.canInteract    = v.canInteract and msgpack.unpack(msgpack.pack(v.canInteract)) or nil
      if not v.action then
        v.action = function()
          if v.clientEvent then
            TriggerEvent(v.clientEvent, v.args and table.unpack(v.args) or nil)
          elseif v.serverEvent then
            TriggerServerEvent(v.serverEvent, v.args and table.unpack(v.args) or nil)
          elseif v.export then
            exports[v.export](v.args and table.unpack(v.args) or nil)
          end
        end
      end
      v.action         = v.action and msgpack.unpack(msgpack.pack(v.action)) or nil
    end
  end

  keyInputOpen = true
  openId = openId + 1
  local myId = openId
  current = {
    inputs      = data.inputs,
    position    = data.position or 'bottom-center',
    direction   = data.direction or 'column',
    displayOnly = displayOnly,
  }
  sendKeys(true)

  -- a strip that only draws reads nothing
  if displayOnly then return end

  CreateThread(function()
    while keyInputOpen and openId == myId do
      local changed_inputs = false
      for index, control in pairs(data.inputs) do
        local is_hidden  = control.canIneract and not control.canIneract() or false
        DisableControlAction(1, tonumber(control.control), not is_hidden)
        local is_pressed = IsDisabledControlPressed(1, tonumber(control.control))

        if is_pressed and not control.delay then
          control.action()
        end

        -- hold to use: fires once when held `delay` ms (the cap fills meanwhile);
        -- let go and press again to fire again
        if control.delay then
          local holding = control.holding or false
          if is_pressed and not control.pressed then
            control.holdStart, control.fired, holding = GetGameTimer(), false, true
          end
          if is_pressed and holding and not control.fired and GetGameTimer() - control.holdStart >= control.delay then
            control.fired, holding = true, false
            control.action()
          end
          if not is_pressed then holding = false end
          if (control.holding or false) ~= holding then
            changed_inputs = true
            control.holding = holding
          end
        end

        if control.pressed ~= is_pressed then
          changed_inputs = true
          control.pressed = is_pressed
        end

        if control.hidden ~= is_hidden then
          changed_inputs = true
          control.hidden = is_hidden
        end
      end

      if changed_inputs then
        if #data.inputs == 0 then
          lib.hideKeys()
        else
          if not keyInputOpen or openId ~= myId then return end
          sendKeys(false)
        end
      end

      Wait(0)
    end
  end)
end

lib.updateKeys = function(inputs)
  if not keyInputOpen or not current then return false end
  assert(type(inputs) == 'table', 'inputs must be a table for lib.updateKeys')
  local list = current.inputs
  if current.displayOnly and #inputs > 0 and #inputs ~= #list then
    -- a different set of keys: take them whole
    local fresh = {}
    for k, v in ipairs(inputs) do
      assert(type(v.label) == 'string', 'inputs['..k..'].label must be a string for lib.updateKeys')
      fresh[k] = prepDisplay(v, k)
    end
    current.inputs = fresh
  else
    for k, v in pairs(inputs) do
      local cur = type(k) == 'number' and list[k]
      if cur and type(v) == 'table' then
        mergeKey(cur, v, k, current.displayOnly)
      end
    end
  end
  return sendKeys(false)
end

lib.hideKeys = function()
  keyInputOpen = false
  current = nil
  sentSnap = nil
  SendNuiMessage(json.encode({
    action = 'HIDE_KEY_INPUTS'
  }))
end

lib.isKeysOpen = function()
  return keyInputOpen
end

-- for lib.test only (rawset: not an export)
rawset(lib, '_keyInputs', {
  visualOf = visualOf,
  sameList = sameList,
  mergeKey = mergeKey,
  prepDisplay = prepDisplay,
  prepControl = prepControl,
  FLAGS = FLAGS,
})
