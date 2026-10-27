-- ─────────────────────────────────────────────────────────────────────────────
-- Keyboard or controller.
--
-- Every key cap dirk_lib draws shows the keyboard key, or the controller button
-- when the player is on a pad. The page can't tell on its own, so this watches
-- IsUsingKeyboard and tells it - only when it changes, never per frame.
--
-- lib.inputMode() -> 'kb' | 'pad', for any script that wants to label its own
-- keys the same way.
-- ─────────────────────────────────────────────────────────────────────────────

local mode = 'kb'

--- 'kb' or 'pad' from the native's answer. Split out so lib.test can pin it.
local function modeOf(usingKeyboard)
  return usingKeyboard and 'kb' or 'pad'
end

lib.inputMode = function()
  return mode
end

-- the page asks once when it loads: a switch made before it was up was lost
RegisterNuiCallback('GET_INPUT_MODE', function(_, cb)
  cb(mode)
end)

CreateThread(function()
  while true do
    local now = modeOf(IsUsingKeyboard(0))
    if now ~= mode then
      mode = now
      SendNuiMessage(json.encode({ action = 'SET_INPUT_MODE', data = mode }))
      TriggerEvent('dirk_lib:inputMode', mode)
    end
    Wait(400)
  end
end)

-- for lib.test only (rawset: not an export)
rawset(lib, '_inputModeOf', modeOf)
