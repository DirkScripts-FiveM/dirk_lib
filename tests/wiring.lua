-- ─────────────────────────────────────────────────────────────────────────────
-- The things that break quietly because nothing errors.
--
-- Every test here pins a real bug found by a customer reading our code, not by
-- us running it. They share a shape: the script keeps working, so nothing shows
-- up in a log, and the damage only appears somewhere else entirely.
--
--   dirktest dirk_lib wiring
--   dirktest dirk_lib wiring 1 +c
-- ─────────────────────────────────────────────────────────────────────────────

local function source(path)
  return LoadResourceFile('dirk_lib', path) or ''
end

-- ── State-bag keys are a shared namespace ───────────────────────────────────

lib.test.add('wiring: progress props do not use ox_lib\'s state-bag key', function(t)
  -- We set `lib:progressProps` - which is ox_lib's own key, not a generic one.
  -- On any server running both libraries (most of them), ox_lib's handler fired
  -- on our writes and spawned its own copy, so every progress bar with a prop
  -- produced two. Nothing errored; the prop just looked wrong.
  local body = source('src/ui/client/progress.lua')
  t.expect(#body > 0).toBeTruthy()
  t.expect(body:find("'lib:progressProps'", 1, true)).toBeNil()
  t.expect(body:find("'dirk_lib:progressProps'", 1, true)).notToBeNil()
end)

-- ── One name, one handler ───────────────────────────────────────────────────

lib.test.add('wiring: dirk_lib:getOnlinePlayers is registered exactly once', function(t)
  -- It was registered twice, in two files, with DIFFERENT permission checks and
  -- different return shapes. FiveM keeps the last registration, so which gate
  -- applied came down to file load order, and the other was dead code that
  -- still read like the real thing.
  local files = {
    'src/helpers/players/server.lua',
    'src/scriptConfig/server.lua',
  }
  local count = 0
  for _, path in ipairs(files) do
    for _ in source(path):gmatch("callback%.register%('dirk_lib:getOnlinePlayers'") do
      count = count + 1
    end
  end
  t.expect(count).toBe(1)
end, { context = 'server' })

-- ── Cross-resource calls are not free ───────────────────────────────────────

lib.test.add('wiring: the framework object is cached, not re-fetched per access', function(t)
  -- `lib.FW.x` used to call the framework's export on EVERY property access, so
  -- anything reading the framework in a loop paid a cross-resource call per
  -- read. Correct, and quietly expensive.
  for _, path in ipairs({ 'src/init.lua', 'init.lua' }) do
    local body = source(path)
    if body:find('lib%.FW%s*=%s*setmetatable') then
      t.expect(body:find('fwObj = fwObj or', 1, true)).notToBeNil()
    end
  end
end)

lib.test.add('wiring: lib.FW hands back the same object twice running', function(t)
  -- The behavioural half of the test above: two reads must be the same table,
  -- which is only true if it is being cached.
  local a = lib.FW and lib.FW.GetPlayers
  local b = lib.FW and lib.FW.GetPlayers
  if a ~= nil then t.expect(a).toBe(b) end
end, { context = 'server' })

-- ── React only to what you actually use ─────────────────────────────────────

lib.test.add('wiring: the ESX cache filters player-data events by key', function(t)
  -- The handler took `key` and ignored it, rebuilding the entire cache - plus an
  -- export call into es_extended - on every esx:setPlayerData, whatever changed.
  -- A customer measured dirk_lib waking on every step while walking.
  local body = source('src/cache/client/esxCache.lua')
  t.expect(#body > 0).toBeTruthy()
  t.expect(body:find('CACHED_KEYS', 1, true)).notToBeNil()
end)

-- ── A migration must not be able to kill the script ─────────────────────────

lib.test.add('wiring: the blob migration upserts and cannot abort init', function(t)
  -- A plain INSERT threw on a duplicate (script, path). That killed scriptConfig
  -- init, and the rows it HAD written then suppressed the migration on every
  -- later boot - a permanently half-migrated config, with clients reporting
  -- only "Callback getScriptConfig timed out".
  local body = source('modules/scriptConfig/server.lua')
  t.expect(#body > 0).toBeTruthy()

  -- Slice to the next top-level declaration rather than matching a closing
  -- `end`. Every file in this repo is CRLF, so a `\nend\n` pattern matches
  -- nothing at all and the test passes/fails for the wrong reason.
  local from = body:find('local function migrateBlobToOverrides', 1, true)
  t.expect(from).notToBeNil()

  local nextDecl = body:find('\nlocal function ', from + 1, true) or #body
  local migrate = body:sub(from, nextDecl)
  t.expect(migrate:find('ON DUPLICATE KEY UPDATE', 1, true)).notToBeNil()

  -- And the call site must be guarded, so a failure degrades instead of aborting.
  t.expect(body:find('pcall(migrateBlobToOverrides', 1, true)).notToBeNil()
end, { context = 'server' })

-- ── Silence is the worst possible answer ────────────────────────────────────

lib.test.add('wiring: a config request that is never answered says why', function(t)
  -- `lib.callback.await` REJECTS after five minutes; unwrapped, that killed the
  -- retry thread and left the client on defaults for the session with a bare
  -- "timed out" in F8. Every server path replies - even NotReady - so silence
  -- means the event was dropped before it arrived, which is an anti-cheat.
  local body = source('modules/scriptConfig/client.lua')
  t.expect(#body > 0).toBeTruthy()
  t.expect(body:find('pcall(lib.callback.await', 1, true)).notToBeNil()
  t.expect(body:find('__dirk_cb_', 1, true)).notToBeNil()
end, { context = 'client' })

lib.test.add('wiring: the anti-cheat probe is present and answers itself', function(t)
  -- The probe only proves anything if the server half is registered. If this
  -- pair ever drifts, every client reports a dropped event on a healthy server.
  --
  -- Server context only, and not for taste: a CLIENT's LoadResourceFile can
  -- only see files the client was actually sent, so reading a server_scripts
  -- file from the client leg returns an empty string and the test fails on a
  -- perfectly healthy resource. The server can read both halves. Any test here
  -- that reads a `server.lua` needs this flag - the ones without it read files
  -- that ship to the client (`src/**/client.lua`, `init.lua`) and run in both.
  local server = source('src/anticheat/server.lua')
  local client = source('src/anticheat/client.lua')
  t.expect(#server > 0).toBeTruthy()
  t.expect(#client > 0).toBeTruthy()
  t.expect(server:find('__dirk_cb_dirk_lib:probe', 1, true)).notToBeNil()
  t.expect(client:find('__dirk_cb_dirk_lib:probe', 1, true)).notToBeNil()
  t.expect(server:find('dirk_lib:probe:reply', 1, true)).notToBeNil()
  t.expect(client:find('dirk_lib:probe:reply', 1, true)).notToBeNil()
end, { context = 'server' })

lib.test.add('wiring: the client half of the probe actually shipped', function(t)
  -- The client leg's share of the test above. A client CAN read its own files,
  -- so an empty read here means the probe never reached the client - which is
  -- indistinguishable, from the customer's side, from the anti-cheat eating it.
  local client = source('src/anticheat/client.lua')
  t.expect(#client > 0).toBeTruthy()
  t.expect(client:find('__dirk_cb_dirk_lib:probe', 1, true)).notToBeNil()
end, { context = 'client' })
