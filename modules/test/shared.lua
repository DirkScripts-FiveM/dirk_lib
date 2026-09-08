-- lib.test — a tiny Jest-style test harness for dirk_lib and its consumers.
--
-- Write tests anywhere with `lib.test.add(name, fn, opts)` and run them from the
-- SERVER console with:  dirktest [filter] [playerId] [+c]
--   filter    substring match on test name ('*' or omitted = all)
--   playerId  target player src for requiresPlayer tests (default: first online)
--   +c        also run client/shared tests on that player (server -> client)
--
-- Each test fn runs inside a coroutine, so it can `lib.callback.await(...)`
-- (c<->s), call lib.inventory/lib.player, and yield freely. It receives ctx:
--   ctx.expect(value) -> chainable matchers, each errors on failure
--   ctx.player        -> target src (server requiresPlayer) / local serverId (client)
--   ctx.fail(msg)     -> force-fail with a message
--
-- opts (all optional):
--   context = 'server' | 'client' | 'shared'   (default 'shared'; only runs in a matching context)
--   requiresPlayer = true                        (needs a connected player; SKIPPED if none)
--   skip = true                                  (reported as skipped)
--
-- ⚠️ LAZY-LOAD GOTCHA: this module only registers its console command (server)
-- and its runClient callback (client) the first time `lib.test` is TOUCHED in
-- that context. A resource wanting server->client tests MUST reference lib.test
-- on the client too (its client test file calling lib.test.add does this). If it
-- only registers server tests, the client half never loads — which is fine, the
-- default `dirktest` run is server-only; the `+c` leg is what needs both halves.

local COL = { pass = '^2', fail = '^1', skip = '^3', dim = '^8', head = '^5', reset = '^7' }

-- Compact value formatter for assertion messages (tables shallow-dumped).
local function fmt(v)
  local t = type(v)
  if t == 'string' then return ('%q'):format(v) end
  if t ~= 'table' then return tostring(v) end
  local parts, n = {}, 0
  for k, val in pairs(v) do
    n = n + 1
    if n > 8 then parts[#parts + 1] = '…'; break end
    parts[#parts + 1] = ('%s=%s'):format(tostring(k), type(val) == 'table' and '{…}' or tostring(val))
  end
  return '{' .. table.concat(parts, ', ') .. '}'
end

local function deepEqual(a, b)
  if a == b then return true end
  if type(a) ~= 'table' or type(b) ~= 'table' then return false end
  for k, v in pairs(a) do if not deepEqual(v, b[k]) then return false end end
  for k in pairs(b) do if a[k] == nil then return false end end
  return true
end

-- expect(actual):toBe(x):toBeTruthy()...  — each matcher errors (level 3 = the
-- test's own line) on failure, which the runner's pcall captures.
local function expect(actual)
  local api = {}
  local function ok(cond, msg) if not cond then error(msg, 3) end return api end
  function api.toBe(e)             return ok(actual == e, ('expected %s to be %s'):format(fmt(actual), fmt(e))) end
  function api.toEqual(e)          return ok(deepEqual(actual, e), ('expected %s to deep-equal %s'):format(fmt(actual), fmt(e))) end
  function api.toBeTruthy()        return ok(actual and true or false, ('expected %s to be truthy'):format(fmt(actual))) end
  function api.toBeFalsy()         return ok(not actual, ('expected %s to be falsy'):format(fmt(actual))) end
  function api.toBeNil()           return ok(actual == nil, ('expected %s to be nil'):format(fmt(actual))) end
  function api.notToBeNil()        return ok(actual ~= nil, 'expected value not to be nil') end
  function api.toBeType(ty)        return ok(type(actual) == ty, ('expected type %s, got %s'):format(ty, type(actual))) end
  function api.toBeGreaterThan(n)  return ok(type(actual) == 'number' and actual > n, ('expected %s > %s'):format(fmt(actual), fmt(n))) end
  function api.toBeGreaterOrEqual(n) return ok(type(actual) == 'number' and actual >= n, ('expected %s >= %s'):format(fmt(actual), fmt(n))) end
  function api.toContain(v)
    if type(actual) ~= 'table' then return ok(false, ('expected a table containing %s'):format(fmt(v))) end
    for _, x in pairs(actual) do if x == v then return api end end
    return ok(false, ('expected table to contain %s'):format(fmt(v)))
  end
  return api
end

local registry = {}

local function add(name, fn, opts)
  registry[#registry + 1] = { name = tostring(name), fn = fn, opts = opts or {} }
end

-- Run every matching test in THIS context. `player` is the src passed to
-- requiresPlayer tests. Returns a structured result (also sent over the wire
-- for the s->c leg, so keep it plain data).
local function runLocal(filter, player)
  local res = { context = lib.context, passed = 0, failed = 0, skipped = 0, cases = {} }
  local lf = filter and filter:lower() or nil
  for _, t in ipairs(registry) do
    local ctxOpt = t.opts.context or 'shared'
    local match = (ctxOpt == 'shared' or ctxOpt == lib.context)
      and (not lf or t.name:lower():find(lf, 1, true))
    if match then
      if t.opts.skip then
        res.skipped = res.skipped + 1
        res.cases[#res.cases + 1] = { name = t.name, status = 'skip', reason = 'marked skip' }
      elseif t.opts.requiresPlayer and not player then
        res.skipped = res.skipped + 1
        res.cases[#res.cases + 1] = { name = t.name, status = 'skip', reason = 'no player connected' }
      else
        local ctx = { player = player, expect = expect, fail = function(m) error(m or 'failed', 2) end }
        local t0 = GetGameTimer()
        local success, err = pcall(t.fn, ctx)
        local ms = GetGameTimer() - t0
        if success then
          res.passed = res.passed + 1
          res.cases[#res.cases + 1] = { name = t.name, status = 'pass', ms = ms }
        else
          res.failed = res.failed + 1
          res.cases[#res.cases + 1] = { name = t.name, status = 'fail', ms = ms, err = tostring(err) }
        end
      end
    end
  end
  return res
end

-- Print a result set to the console.
local function report(title, res)
  if not res then return end
  print(('%s──── %s ── %s%d passed%s · %s%d failed%s · %s%d skipped %s────%s'):format(
    COL.head, title, COL.pass, res.passed, COL.reset, COL.fail, res.failed, COL.reset,
    COL.skip, res.skipped, COL.head, COL.reset))
  for _, c in ipairs(res.cases) do
    if c.status == 'pass' then
      print(('  %s✓%s %s %s(%dms)%s'):format(COL.pass, COL.reset, c.name, COL.dim, c.ms or 0, COL.reset))
    elseif c.status == 'skip' then
      print(('  %s−%s %s %s(%s)%s'):format(COL.skip, COL.reset, c.name, COL.dim, c.reason or 'skipped', COL.reset))
    else
      print(('  %s✗ %s%s'):format(COL.fail, c.name, COL.reset))
      print(('      %s%s%s'):format(COL.fail, c.err or 'failed', COL.reset))
    end
  end
end

-- `test` is a local shared by the concatenated server.lua / client.lua chunk,
-- which add their context bits and `return test`.
local test = {
  add       = add,
  expect    = expect,
  runLocal  = runLocal,
  report    = report,
  --- How many tests this VM has. Lets the dispatcher skip a resource that
  --- loaded lib.test but ships no suite, rather than printing an empty result
  --- for it on every bare `dirktest`.
  count     = function() return #registry end,
}
