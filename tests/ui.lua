-- ─────────────────────────────────────────────────────────────────────────────
-- The 19/10 UI restyle: the Lua halves of the parts.
--
-- The pages are checked in the browser against the mock; these pin what Lua
-- decides and sends: the input mode, the key strip's merge + send-on-change,
-- where each part goes by default, and the new fields the pages draw.
--
--   dirktest "ui:" 1 +c
-- ─────────────────────────────────────────────────────────────────────────────

local function source(path)
  return LoadResourceFile('dirk_lib', path) or ''
end

local CLIENT = { context = 'client' }

-- ── input mode ──────────────────────────────────────────────────────────────

lib.test.add('ui: input mode is kb on a keyboard, pad on a controller', function(t)
  t.expect(lib._inputModeOf(true)).toBe('kb')
  t.expect(lib._inputModeOf(false)).toBe('pad')
  t.expect(lib.inputMode()).toBeType('string')
end, CLIENT)

-- ── lib.showKeys / lib.updateKeys ───────────────────────────────────────────

lib.test.add('ui: key strip draws no functions or control ids', function(t)
  local K = lib._keyInputs
  local v = K.visualOf({ qwerty = 'E', pad = 'A', label = 'Open', control = 38, action = function() end, hl = true })
  t.expect(v.qwerty).toBe('E')
  t.expect(v.pad).toBe('A')
  t.expect(v.hl).toBe(true)
  t.expect(v.control).toBeNil()
  t.expect(v.action).toBeNil()
end, CLIENT)

lib.test.add('ui: key strip sees a changed flag, and nothing when nothing changed', function(t)
  local K = lib._keyInputs
  local a = { K.visualOf({ qwerty = 'E', label = 'Open' }) }
  local b = { K.visualOf({ qwerty = 'E', label = 'Open' }) }
  local c = { K.visualOf({ qwerty = 'E', label = 'Open', pulse = true }) }
  t.expect(K.sameList(a, b)).toBe(true)
  t.expect(K.sameList(a, c)).toBe(false)
  t.expect(K.sameList(a, {})).toBe(false)
end, CLIENT)

lib.test.add('ui: an update replaces the flags and keeps what it does not name', function(t)
  local K = lib._keyInputs
  local cur = { key = 'A', qwerty = 'A', label = 'Steer left', down = true, note = 'Now' }
  K.mergeKey(cur, { hl = true }, 1, true)
  t.expect(cur.hl).toBe(true)
  t.expect(cur.down).toBeNil()   -- a flag left out is off
  t.expect(cur.note).toBeNil()
  t.expect(cur.label).toBe('Steer left')
  K.mergeKey(cur, { key = 'D', label = 'Steer right' }, 1, true)
  t.expect(cur.qwerty).toBe('D')
  t.expect(cur.label).toBe('Steer right')
end, CLIENT)

lib.test.add('ui: a real key gets its pad button unless the script named one', function(t)
  local K = lib._keyInputs
  local own = K.prepControl({ key = 'E', pad = 'RB' }, 1)
  t.expect(own.pad).toBe('RB')
  local found = K.prepControl({ key = 'E' }, 1)
  t.expect(found.qwerty).notToBeNil()
  t.expect(found.control).toBeType('number')
  local info = lib.getKey('E')
  if info.xbox ~= '(NONE)' then t.expect(found.pad).toBe(info.xbox) end
end, CLIENT)

lib.test.add('ui: lib.updateKeys sends only when the strip changed', function(t)
  lib.showKeys({ displayOnly = true, position = 'bottom-center', inputs = { { key = 'A', label = 'Test' } } })
  local first = lib.updateKeys({ { hl = true } })
  local again = lib.updateKeys({ { hl = true } })
  local off = lib.updateKeys({ {} })
  lib.hideKeys()
  t.expect(first).toBe(true)
  t.expect(again).toBe(false)
  t.expect(off).toBe(true)
  t.expect(lib.updateKeys({ { hl = true } })).toBe(false) -- closed: nothing to update
end, CLIENT)

-- ── who draws what ──────────────────────────────────────────────────────────

lib.test.add('ui: notify, progress, text UI, context, alert and input default to dirk_lib', function(t)
  local body = source('src/settings.lua')
  t.expect(#body > 0).toBeTruthy()
  for _, k in ipairs({ 'notify', 'progress', 'showTextUI', 'contextMenu', 'alertDialog', 'inputDialog' }) do
    t.expect(body:find(k .. "%s*=%s*'dirk_lib'")).notToBeNil()
  end
end)

lib.test.add('ui: notify leaves the type colours to the page', function(t)
  -- the page colours error / success / warning itself and inform in the script's accent;
  -- Lua used to fill iconColor / iconBg / titleColor from the type, which beat the page's
  local body = source('src/ui/client/notify.lua')
  t.expect(#body > 0).toBeTruthy()
  t.expect(body:find('data.iconColor = data.iconColor or types', 1, true)).toBeNil()
  t.expect(body:find('data.titleColor = data.titleColor or types', 1, true)).toBeNil()
  t.expect(body:find('data.theme = lib.uiTheme', 1, true)).notToBeNil()
end)

-- ── the new fields ──────────────────────────────────────────────────────────

lib.test.add('ui: progress shows a cancel key only when it can be cancelled', function(t)
  local of = lib._progressCancelKeyOf
  t.expect(of({ canCancel = false })).toBeNil()
  t.expect(of({})).toBeNil()
  local key = of({ canCancel = true })
  t.expect(key == nil or type(key) == 'string').toBe(true)
end, CLIENT)

lib.test.add('ui: alert, keycode and status send what their pages count down / colour', function(t)
  local alert = source('src/ui/client/alertDialog.lua')
  t.expect(alert:find('payload.timeout = timeout', 1, true)).notToBeNil()
  -- a copy goes, so the caller's table never keeps one call's theme / timeout
  t.expect(alert:find('data.theme = theme', 1, true)).toBeNil()
  t.expect(source('src/ui/client/keycode.lua'):find('tries%s*=%s*tonumber%(opts.tries%)')).notToBeNil()
  t.expect(source('src/ui/client/statusInfo.lua'):find('color%s*=%s*self.color')).notToBeNil()
end)
