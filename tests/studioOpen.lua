-- ─────────────────────────────────────────────────────────────────────────────
-- How Script Studio opens.
--
-- An open used to read every cached schema out of KVP and decode it, ask the
-- server for the schemas, ask EVERY script for its server-only values in a
-- second round trip each (5 s deadline apiece), re-send every schema to the
-- NUI, and only then draw anything. Now the panel opens from what it holds and
-- fresh values merge in behind it, in one round trip that leaves out the
-- schemas the panel already has.
--
-- Each test below pins one of the pieces that makes that true, or one of the
-- ways it could quietly hand a schema-less script or a webhook URL to the
-- wrong place.
--
--   dirktest dirk_lib studioOpen
--   dirktest dirk_lib studioOpen 1 +c
-- ─────────────────────────────────────────────────────────────────────────────

local studioPayload = require '@dirk_lib.src.scriptConfig.studioPayload'

-- ── What goes to the panel ──────────────────────────────────────────────────

lib.test.add('studioOpen: a schema the panel holds is left out, a changed one is not', function(t)
  local scripts = {
    { resource = 'a', hash = 11, schemaJson = '{"a":1}' },
    { resource = 'b', hash = 22, schemaJson = '{"b":1}' },   -- held under an OLD hash
    { resource = 'c', hash = 33, schemaJson = '{"c":1}' },   -- never held
  }
  local out = studioPayload.forPanel(scripts, { a = 11, b = 21 })

  t.expect(out[1].schemaJson).toBeNil()
  t.expect(out[1].hash).toBe(11)              -- the hash still goes, so the panel can fill it
  t.expect(out[2].schemaJson).toBe('{"b":1}')
  t.expect(out[3].schemaJson).toBe('{"c":1}')
end)

lib.test.add('studioOpen: leaving a schema out does not take it from the gather', function(t)
  -- One gather is shared by everyone waiting on it (the warm-up, an open, a
  -- Refresh). If forPanel stripped the text in place, the second send would
  -- go out with no schema for a panel that does not hold it.
  local scripts = { { resource = 'a', hash = 11, schemaJson = '{"a":1}' } }
  studioPayload.forPanel(scripts, { a = 11 })
  t.expect(scripts[1].schemaJson).toBe('{"a":1}')

  local again = studioPayload.forPanel(scripts, {})
  t.expect(again[1].schemaJson).toBe('{"a":1}')
end)

lib.test.add('studioOpen: what the panel says it holds is cleaned, not trusted', function(t)
  local held = studioPayload.readHeld({
    dirk_fishing = 123,
    dirk_lib = 'abc',
    [5] = 1,                              -- not a resource name
    dirk_bad = { nested = true },         -- not a hash
  })
  t.expect(held.dirk_fishing).toBe(123)
  t.expect(held.dirk_lib).toBe('abc')
  t.expect(held[5]).toBeNil()
  t.expect(held.dirk_bad).toBeNil()

  t.expect(next(studioPayload.readHeld('junk'))).toBeNil()

  local big = {}
  for i = 1, 600 do big['r' .. i] = i end
  local n = 0
  for _ in pairs(studioPayload.readHeld(big)) do n = n + 1 end
  t.expect(n <= 256).toBeTruthy()
end)

lib.test.add('studioOpen: the server-only sliver merges into the values, deep', function(t)
  local values = { logger = { level = 'info', routes = {} }, basic = { debug = false } }
  studioPayload.mergeInto(values, { logger = { routes = { { url = 'x' } } } })
  t.expect(values.logger.level).toBe('info')        -- the client-visible half survives
  t.expect(values.logger.routes[1].url).toBe('x')
  t.expect(values.basic.debug).toBe(false)
end)

-- ── When the registry cache drops ───────────────────────────────────────────

lib.test.add('studioOpen: only a dirk script restarting drops the registry cache', function(t)
  local cached = { { resource = 'dirk_fishing' }, { resource = 'dirk_lib' } }
  local tagged = { dirk_fishing = true, dirk_lib = true, dirk_new = true }
  local isTagged = function(name) return tagged[name] == true end

  t.expect(studioPayload.touchesRegistry('some_car_pack', cached, isTagged)).toBe(false)
  t.expect(studioPayload.touchesRegistry('dirk_new', cached, isTagged)).toBe(true)
  -- In the cache but no longer tagged (restarted without it): still a change.
  tagged.dirk_fishing = nil
  t.expect(studioPayload.touchesRegistry('dirk_fishing', cached, isTagged)).toBe(true)
  t.expect(studioPayload.touchesRegistry(nil, cached, isTagged)).toBe(false)
  -- No cache yet: only the tag can say.
  t.expect(studioPayload.touchesRegistry('dirk_new', nil, isTagged)).toBe(true)
end)

-- ── One gather, however many ask ────────────────────────────────────────────

lib.test.add('studioOpen: callers arriving mid-gather share it', function(t)
  local runs = 0
  local slow = studioPayload.single(function()
    runs = runs + 1
    Wait(60)
    return { n = runs }
  end)

  local a, b
  CreateThread(function() a = slow() end)
  CreateThread(function() b = slow() end)
  local waited = 0
  while (not a or not b) and waited < 2000 do Wait(10); waited = waited + 10 end

  t.expect(runs).toBe(1)
  t.expect(a).notToBeNil()
  t.expect(a).toBe(b)

  -- Finished means finished: the next call runs again rather than replaying.
  slow()
  t.expect(runs).toBe(2)
end)

lib.test.add('studioOpen: a gather that finds nothing still releases its waiters', function(t)
  -- "No scripts for you" is nil. A waiter left asleep on it would hold an open
  -- shut for ever.
  local empty = studioPayload.single(function() Wait(40); return nil end)
  local finished = 0
  for _ = 1, 3 do
    CreateThread(function()
      local got = empty()
      if got == nil then finished = finished + 1 end
    end)
  end
  local waited = 0
  while finished < 3 and waited < 2000 do Wait(10); waited = waited + 10 end
  t.expect(finished).toBe(3)
end)

-- ── The sliver through the script's own check ───────────────────────────────

lib.test.add('studioOpen: the server-only export answers the console with server-only keys only', function(t)
  local ok, reply = pcall(function() return exports.dirk_lib:dirkStudioServerOnly(0) end)
  t.expect(ok).toBeTruthy()
  t.expect(reply).toBeType('table')
  t.expect(reply.clientVersion).notToBeNil()

  -- Nothing client-visible rides along: the client already has it, and the
  -- panel merges this over the top. `basic` is entirely client-visible.
  if reply.serverOnly then
    t.expect(reply.serverOnly.basic).toBeNil()
    t.expect(reply.serverOnly.appearance).toBeNil()
  end
end, { context = 'server' })

lib.test.add('studioOpen: the server-only export refuses someone who may not edit', function(t)
  -- A source no player holds: no ACE, no identifiers, no admin row. Getting
  -- anything but a refusal here is the whole leak this path exists to avoid.
  local ok, reply, err = pcall(function() return exports.dirk_lib:dirkStudioServerOnly(65000) end)
  t.expect(ok).toBeTruthy()
  t.expect(reply).toBeNil()
  -- The reason rides as a second return, if the export bridge keeps it.
  if err ~= nil then t.expect(err).toBe('NoPermission') end
end, { context = 'server' })

lib.test.add('studioOpen: the panel does not open without its own NUI callbacks', function(t)
  -- The open path posts to these from the NUI. A callback renamed on one side
  -- only would fail quietly: fetchNui answers a missing callback with its
  -- fallback, which looks exactly like "nothing to do".
  local body = LoadResourceFile('dirk_lib', 'src/scriptConfig/client.lua') or ''
  for _, name in ipairs({ 'GET_SCRIPT_STUDIO', 'SCRIPT_STUDIO_HELD', 'GET_STUDIO_LOCALES' }) do
    t.expect(body:find(("RegisterNUICallback('%s'"):format(name), 1, true)).notToBeNil()
  end
  t.expect(body:find("action = 'SCRIPT_STUDIO_DATA'", 1, true)).notToBeNil()
end, { context = 'server' })
