-- ─────────────────────────────────────────────────────────────────────────────
-- What a PLAYER receives, versus what the server holds.
--
-- These two are meant to differ by exactly one thing: keys marked server-only.
-- When they differ by anything else, settings silently stop working for
-- everyone except the admin looking at the panel - and the admin is the one
-- person who cannot see the problem.
--
-- The bug that earned this file: an admin cleared a list, saved, refreshed, and
-- every entry was back. The server had stored the empty list perfectly. The
-- step that builds the client-visible copy dropped any table that came out
-- empty, so the key vanished from the broadcast, and both the players and the
-- panel fell back to the shipped default. Reported by a customer as "changes
-- are not saved" - three days of looking at the save path, which was fine.
--
--   dirktest dirk_lib config
-- ─────────────────────────────────────────────────────────────────────────────

lib.test.add('config: dirk_lib has a config of its own to serve', function(t)
  local cfg = lib.scriptConfig.get()
  t.expect(cfg).toBeType('table')
  t.expect(cfg.basic).toBeType('table')
end, { context = 'server' })

lib.test.add('config: the client view exposes what it should and hides the rest', function(t)
  -- clientView is the exact payload broadcast to players. It must carry the
  -- shared presentation settings, because every consumer reads them from here.
  local view = lib.scriptConfig.clientView()
  t.expect(view).toBeType('table')
  t.expect(view.basic).toBeType('table')
  t.expect(view.basic.language).notToBeNil()
end, { context = 'server' })

lib.test.add('config: an emptied list survives into the client view', function(t)
  -- THE regression. An empty table is still a value: "the admin cleared this".
  -- Dropping it is indistinguishable from "never set", and the default comes
  -- back.
  --
  -- The probe path MUST be one the schema declares. An undeclared key is
  -- treated as server-only by design (isPathServerOnly consults
  -- undeclaredPaths), so a made-up scratch key is stripped from the client view
  -- for an entirely different and correct reason - which is how my first
  -- version of this test "found" a bug that wasn't there.
  --
  -- appearance.customTheme is the safe declared array: a cosmetic ten-colour
  -- palette that only applies when primaryColor is 'dirk'. Emptying access.*
  -- here could lock the panel out mid-test.
  local appearance = lib.scriptConfig.get('appearance')
  t.expect(appearance).toBeType('table')
  local original = appearance.customTheme

  appearance.customTheme = {}
  lib.scriptConfig.set({ appearance = appearance }, nil, { sectionReplace = true })
  Wait(60)

  local view = lib.scriptConfig.clientView()
  local got = view and view.appearance and view.appearance.customTheme

  -- Restore before asserting, so a failure cannot leave the palette cleared.
  appearance = lib.scriptConfig.get('appearance')
  appearance.customTheme = original
  lib.scriptConfig.set({ appearance = appearance }, nil, { sectionReplace = true })
  Wait(60)

  t.expect(got).notToBeNil()
  t.expect(got).toBeType('table')
  t.expect(next(got) == nil).toBeTruthy()
end, { context = 'server' })

lib.test.add('config: a server-only key never reaches the client view', function(t)
  -- The other side of the same filter, and the reason it exists. logger.routes
  -- is x-serverOnly: it holds webhook URLs. If this ever passes into the client
  -- view, every player on the server has been handed them.
  local held = lib.scriptConfig.get('logger')
  local view = lib.scriptConfig.clientView()

  if held and held.routes ~= nil then
    t.expect(view.logger and view.logger.routes).toBeNil()
  end
end, { context = 'server' })

lib.test.add('config: a view-only admin is never handed the server-only values', function(t)
  -- getFullScriptConfig answered anyone who could VIEW a script with the whole
  -- config, webhooks and keys included - while the sliver that carries the
  -- same values was gated on EDIT. The full config must only follow the edit
  -- check; a viewer gets the client view.
  local src = LoadResourceFile('dirk_lib', 'modules/scriptConfig/server.lua') or ''
  local body = src:match("getFullScriptConfig'%):format%(scriptName%), function%(src%)(.-)\nend%)")
  t.expect(body).notToBeNil()
  body = body or ''

  local editGate = body:find('canEditScript%(src%)')
  local fullReturn = body:find('config = scriptConfig')
  t.expect(editGate).notToBeNil()
  t.expect(fullReturn).notToBeNil()
  t.expect(editGate and fullReturn and editGate < fullReturn).toBeTruthy()
  t.expect(body:find('clientVisibleView')).notToBeNil()
end, { context = 'server' })

lib.test.add('config: an empty list is encoded as a list, not an object', function(t)
  -- Lua cannot tell {} the empty list from {} the empty object, and JSON can.
  -- A list that arrives as {} makes every consumer's #list and ipairs silently
  -- do nothing, which looks like "the feature is off" rather than an error.
  local encoded = json.encode({ list = {} })
  local isList = encoded:find('"list":[]', 1, true) ~= nil
  local isObject = encoded:find('"list":{}', 1, true) ~= nil

  -- Documents which way this runtime goes; the assert is that it is decidable
  -- and that anything shipping an empty list knows to force the array form.
  t.expect(isList or isObject).toBeTruthy()
end, { context = 'server' })

lib.test.add('config: settings reach the client', function(t)
  -- The other half of the same story. The panel is a client; if the client has
  -- no config, every symptom looks like a save bug.
  t.expect(lib.settings).toBeType('table')
  t.expect(lib.settings.framework).toBeType('string')
end, { context = 'client' })

lib.test.add('config: shared presentation settings are delivered, not defaulted', function(t)
  -- currency/units/language were missing from what dirk_lib handed its
  -- consumers. Invisible, because every consumer has its own defaults - a
  -- server set to EUR still showed $ everywhere and nothing errored.
  for _, key in ipairs({ 'language', 'currency', 'weightUnit', 'distanceUnit' }) do
    t.expect(lib.settings[key]).notToBeNil()
  end
end, { context = 'client' })
