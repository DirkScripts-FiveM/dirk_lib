-- lib.showInstructions — bottom-right "do this in-world" instruction card.
--
-- General-purpose primitive next to lib.notify / lib.showText / lib.progress.
-- Drives the <InstructionPanel> React component (from dirk-cfx-react) that's
-- mounted inside dirk_lib's own always-loaded NUI, so any resource — UI or
-- not — can show the same card without needing its own React tree.
--
-- Usage:
--   lib.showInstructions({
--     title = 'Pick Door',
--     hint  = 'Aim at a door in the world',
--     keys  = {
--       { key = 'LMB', action = 'Confirm' },
--       { key = 'ESC', action = 'Cancel'  },
--     },
--   })
--
-- With a RESOURCE BAR (what the player is holding and how much is left - a
-- watering can's litres, a bottle's ml): `bar` stacks a small card of the same
-- style on top of the instruction card:
--   lib.showInstructions({
--     title = 'Galvy Rose Can',
--     keys  = { { key = 'E', action = 'Water' } },
--     bar   = { value = 3.2, max = 5, label = 'Water', unit = 'L' },
--   })
-- Call it again as the value changes (last call wins); keep it to a few times
-- a second.
--   -- ... do the in-world work ...
--   lib.hideInstructions()
--
-- The React side ignores stale shows once hideInstructions has fired, and
-- a fresh show before hide replaces the visible card (no stacking).

local function send(action, data)
  SendNuiMessage(json.encode({
    action = action,
    data   = data,
  }))
end

-- Resource that opened the currently-showing card (nil when nothing is up).
-- Tracked so a mid-flow restart/stop of that resource can't leave the card
-- stranded on screen forever (it never gets to call hideInstructions).
local owner = nil

---@class InstructionKey
---@field key    string  -- short label inside the key cap, e.g. 'E', 'BACKSPACE', 'LMB' ('LMB / E' = either)
---@field action string  -- what the key does, e.g. 'Confirm', 'Cancel'
---@field pad    string? -- the controller button shown when the player is on a pad, e.g. 'A', 'RT',
---                      -- 'DPAD:lr'. Default: the usual one for `key` (E -> A, LMB -> RT, BACKSPACE -> B)

---@class InstructionBar
---@field value number                 -- how much is left
---@field max   number                 -- the full amount
---@field label string?                -- what it is, e.g. 'Water'
---@field unit  string?                -- e.g. 'L', 'ml'
---@field warn  boolean?               -- draw it in the warning colour (empty, overdosed, ...)

---@class InstructionSpec
---@field title string                 -- header line
---@field hint  string?                -- optional sub-text
---@field keys  InstructionKey[]?      -- optional list of key bindings
---@field bar   InstructionBar?        -- optional resource bar stacked on top of the card

---Show the bottom-right instruction card. Safe to call repeatedly — the
---last call wins, no stacking.
---@param spec InstructionSpec
function lib.showInstructions(spec)
  if type(spec) ~= 'table' or type(spec.title) ~= 'string' then
    lib.print.warn('[lib.showInstructions] spec.title (string) is required')
    return
  end
  owner = GetInvokingResource() or GetCurrentResourceName()
  send('DIRK_LIB_SHOW_INSTRUCTIONS', {
    title = spec.title,
    hint  = spec.hint,
    keys  = spec.keys,
    bar   = type(spec.bar) == 'table' and tonumber(spec.bar.value) and tonumber(spec.bar.max) and spec.bar or nil,
    theme = lib.uiTheme(owner),
  })
end

---Hide the bottom-right instruction card. No-op if nothing is showing.
function lib.hideInstructions()
  owner = nil
  send('DIRK_LIB_HIDE_INSTRUCTIONS', {})
end

-- If the resource that opened the card stops (a mid-flow restart, say), it never
-- gets to call hideInstructions — so hide it here or the card stays on screen
-- forever, which also visually strands the player.
AddEventHandler('onClientResourceStop', function(res)
  if owner and res == owner then
    owner = nil
    send('DIRK_LIB_HIDE_INSTRUCTIONS', {})
  end
end)
