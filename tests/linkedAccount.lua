-- ─────────────────────────────────────────────────────────────────────────────
-- Linked account + support bundles.
--
-- A support bundle leaves the server and lands on a ticket that the customer,
-- our staff and an MCP can all read. So the part worth pinning hardest is what
-- must NOT be in it: IPs, license keys, tokens, webhooks, passwords, player
-- identifiers, Script Studio secrets. Then that the problems it reports are the
-- ones an admin would want at the top, and that the shape is what the site's
-- POST /api/servers/bundle takes (dirkscripts-site `_planning/linked-servers.md`).
--
-- All pure: src/linkedAccount/support.lua takes plain values, so none of this
-- needs a player, the database or the network.
--
--   dirktest dirk_lib link
-- ─────────────────────────────────────────────────────────────────────────────

-- Required inside each test, not at the top: this file loads on the client too,
-- and the module is server-side only (it isn't in files{}).
local function support()
  return require '@dirk_lib.src.linkedAccount.support'
end

local function has(s, needle) return type(s) == 'string' and s:find(needle, 1, true) ~= nil end

-- ─── redaction ───────────────────────────────────────────────────────────────

lib.test.add('link: redaction blanks addresses but not versions', function(t)
  local r = support().redact
  t.expect(r('Connecting to 192.168.1.44:30120')).toBe('Connecting to [ip]:30120')
  t.expect(r('player from 8.8.8.8 joined')).toBe('player from [ip] joined')
  -- the harmless two stay, because "listening on 0.0.0.0" helps
  t.expect(r('listening on 0.0.0.0:30120 and 127.0.0.1')).toBe('listening on 0.0.0.0:30120 and 127.0.0.1')
  -- a version is not an address
  t.expect(r('FXServer-master v1.0.0.13227 win32')).toBe('FXServer-master v1.0.0.13227 win32')
  t.expect(r('build 1.2.3.4.5')).toBe('build 1.2.3.4.5')
  t.expect(r('not an ip 300.1.1.1')).toBe('not an ip 300.1.1.1')
  -- IPv6, full and short; times and MACs are not
  t.expect(r('from 2001:0db8:85a3:0000:0000:8a2e:0370:7334 ok')).toBe('from [ip] ok')
  t.expect(r('from fe80::1 ok')).toBe('from [ip] ok')
  t.expect(r('at 12:34:56 on aa:bb:cc:dd:ee:ff')).toBe('at 12:34:56 on aa:bb:cc:dd:ee:ff')
end, { context = 'server' })

lib.test.add('link: redaction blanks keys, tokens, webhooks and passwords', function(t)
  local r = support().redact

  local license = r('set sv_licenseKey "cfxk_1a2b3c4d5e6f7g8h_ABCDEF"')
  t.expect(has(license, 'cfxk_1a2b')).toBeFalsy()
  t.expect(has(license, 'sv_licenseKey')).toBeTruthy()
  t.expect(r('key is cfxk_abcdefghij_123')).toBe('key is cfxk_[redacted]')
  t.expect(r('sv_password letmein')).toBe('sv_password [redacted]')

  t.expect(r('Authorization: Bearer dsk_' .. ('x'):rep(43))).toBe('Authorization: Bearer [redacted]')
  t.expect(r('key dsk_' .. ('A'):rep(43) .. ' stored')).toBe('key dsk_[redacted] stored')
  t.expect(r('poll lnk_' .. ('b'):rep(43))).toBe('poll lnk_[redacted]')

  t.expect(r('hook https://discord.com/api/webhooks/123456789012345678/abcDEF_-xyz done'))
    .toBe('hook https://discord.com/api/webhooks/[redacted] done')

  -- a Discord bot token / JWT: three dot-separated parts
  local bot = r('token MTEzNDU2Nzg5MDEyMzQ1Njc4OQ.GaBcDe.abcdefghijklmnopqrstuvwxyz0123456789')
  t.expect(has(bot, 'MTEzNDU2')).toBeFalsy()

  t.expect(r('mysql://root:hunter2@localhost/qbx')).toBe('mysql://[redacted]@localhost/qbx')
  t.expect(r('password=hunter2 user=root')).toBe('password=[redacted] user=root')
  t.expect(r('{"api_key": "abc123"}')).toBe('{"api_key": "[redacted]"}')
  t.expect(r('secret: s3cr3t')).toBe('secret: [redacted]')
end, { context = 'server' })

lib.test.add('link: redaction blanks player identifiers, keeps ordinary lines', function(t)
  local r = support().redact
  t.expect(r('joined license:abc123def456 and discord:123456789')).toBe('joined license:[redacted] and discord:[redacted]')
  t.expect(r('steam:110000112345678 xbl:2535')).toBe('steam:[redacted] xbl:[redacted]')
  t.expect(r('license2:ffff0000')).toBe('license2:[redacted]')

  -- the lines we actually want to read must come through untouched
  local err = '[script:dirk_fishing] SCRIPT ERROR: @dirk_fishing/server/crabPots.lua:212: attempt to index a nil value (field \'pots\')'
  t.expect(r(err)).toBe(err)
  local started = '[           resources] Started resource dirk_lib (3 warnings)'
  t.expect(r(started)).toBe(started)
end, { context = 'server' })

lib.test.add('link: redactDeep redacts values, never keys, and copies', function(t)
  local s = support()
  local input = { name = 'Test 10.0.0.9', nested = { 'token=abc', 5, true }, ['10.0.0.9'] = 'x' }
  local out = s.redactDeep(input)
  t.expect(out.name).toBe('Test [ip]')
  t.expect(out.nested[1]).toBe('token=[redacted]')
  t.expect(out.nested[2]).toBe(5)
  t.expect(out.nested[3]).toBe(true)
  t.expect(out['10.0.0.9']).toBe('x')
  t.expect(input.name).toBe('Test 10.0.0.9')
end, { context = 'server' })

-- ─── the console ─────────────────────────────────────────────────────────────

lib.test.add('link: console lines are cleaned, capped and redacted', function(t)
  local s = support()
  local buffer = '\27[38;5;81m[  script:dirk_weedv2] \27[0mSCRIPT ERROR: boom\r\n'
    .. '^1[ERROR] ^7 from 1.2.3.4\n\n'
    .. ('x'):rep(1500) .. '\n'
    .. 'last line\n'
  local lines = s.consoleLines(buffer, 400)
  t.expect(#lines).toBe(4)
  t.expect(lines[1]).toBe('[  script:dirk_weedv2] SCRIPT ERROR: boom')
  t.expect(lines[2]).toBe('[ERROR]  from [ip]')
  t.expect(#lines[3]).toBe(s.LINE_MAX)
  t.expect(lines[4]).toBe('last line')

  -- only the newest N, oldest first
  local many = {}
  for i = 1, 10 do many[#many + 1] = 'line ' .. i end
  local kept = s.consoleLines(table.concat(many, '\n'), 3)
  t.expect(#kept).toBe(3)
  t.expect(kept[1]).toBe('line 8')
  t.expect(kept[3]).toBe('line 10')
end, { context = 'server' })

lib.test.add('link: console problems name the dirk script, fold repeats, skip others', function(t)
  local s = support()
  local known = { dirk_traphouses = true, dirk_fishing = true, dirk_projectCars = true, ox_inventory = true }
  local lines = {
    -- the console cuts channel names to fit its column
    '[script:dirk_traphous] SCRIPT ERROR: @dirk_traphouses/server/main.lua:66: attempt to index a nil value',
    '[script:dirk_traphous] > fn (@dirk_traphouses/server/main.lua:66)',
    '[script:dirk_traphous] SCRIPT ERROR: @dirk_traphouses/server/main.lua:66: attempt to index a nil value',
    '[script:ox_inventory] SCRIPT ERROR: @ox_inventory/modules/x.lua:1: not ours',
    '[script:dirk_projectC] [ERROR] \tAttempting to use stores but its not started',
    "[ citizen-server-impl] Couldn't start resource dirk_fishing.",
    '[ citizen-server-impl] Could not find dependency oxmysql for resource dirk_fishing.',
  }
  local problems = s.consoleProblems(lines, known)
  t.expect(#problems).toBe(4)

  t.expect(problems[1].kind).toBe('script_error')
  t.expect(problems[1].level).toBe('error')
  t.expect(problems[1].resource).toBe('dirk_traphouses')
  t.expect(problems[1].count).toBe(2)

  t.expect(problems[2].resource).toBe('dirk_projectCars')
  t.expect(problems[2].level).toBe('warning')
  t.expect(has(problems[2].message, 'Attempting to use stores')).toBeTruthy()

  t.expect(problems[3].resource).toBe('dirk_fishing')
  t.expect(has(problems[3].message, "couldn't start")).toBeTruthy()

  t.expect(problems[4].kind).toBe('missing_dependency')
  t.expect(problems[4].resource).toBe('oxmysql')
end, { context = 'server' })

lib.test.add('link: console problems work on GetConsoleBuffer text, which has no channel tags', function(t)
  -- Measured on a live server: the buffer keeps each message but drops the
  -- `[script:…]` column, so the resource has to come from the line itself.
  local s = support()
  local known = { dirk_fishing = true, dirk_projectCars = true }
  local problems = s.consoleProblems({
    'SCRIPT ERROR: @dirk_fishing/server/crabPots.lua:212: attempt to index a nil value',
    '> fn (@dirk_fishing/server/crabPots.lua:212)',
    '[ERROR] \tAttempting to use stores but its either not started or starting after dirk_projectCars',
    '[ERROR] something from a resource that is not ours',
    'SCRIPT ERROR: @ox_inventory/modules/x.lua:1: not ours',
  }, known)
  t.expect(#problems).toBe(2)
  t.expect(problems[1].resource).toBe('dirk_fishing')
  t.expect(problems[1].kind).toBe('script_error')
  t.expect(problems[2].resource).toBe('dirk_projectCars')
end, { context = 'server' })

-- ─── problems ────────────────────────────────────────────────────────────────

lib.test.add('link: problems list missing dependencies, bridges and stopped scripts', function(t)
  local s = support()
  local problems = s.problems({
    requested = 'dirk_fishing',
    requestedFound = true,
    scripts = {
      { name = 'dirk_fishing', version = '2.0.61', state = 'stopped' },
      { name = 'dirk_multichar', version = '1.5.0', state = 'stopped' },
      { name = 'dirk_lib', version = '1.3.7', state = 'started' },
    },
    dependencies = {
      { name = 'oxmysql', state = 'started' },
      { name = 'ox_lib', state = 'missing', neededBy = { 'dirk_fishing' } },
    },
    bridges = { framework = false, inventory = 'ox_inventory', target = false },
  })

  local by = {}
  for _, p in ipairs(problems) do by[(p.kind or '') .. ':' .. (p.resource or '')] = p end

  t.expect(by['missing_dependency:ox_lib']).notToBeNil()
  t.expect(by['missing_dependency:ox_lib'].level).toBe('error')
  t.expect(has(by['missing_dependency:ox_lib'].message, 'needed by dirk_fishing')).toBeTruthy()
  t.expect(by['missing_dependency:oxmysql']).toBeNil()

  t.expect(by['no_bridge:framework'].level).toBe('error')
  t.expect(by['no_bridge:target'].level).toBe('warning')
  t.expect(by['no_bridge:inventory']).toBeNil()

  -- the script the request is about being stopped is the headline; others are a note
  t.expect(by['other:dirk_fishing'].level).toBe('error')
  t.expect(by['other:dirk_multichar'].level).toBe('info')
  t.expect(by['other:dirk_lib']).toBeNil()

  -- errors first
  t.expect(problems[1].level).toBe('error')
  t.expect(problems[#problems].level).toBe('info')
end, { context = 'server' })

lib.test.add('link: a requested script that is not installed is said so', function(t)
  local problems = support().problems({
    requested = 'dirk_weedv2', requestedFound = false,
    scripts = {}, dependencies = {}, bridges = { framework = 'qbx_core', inventory = 'ox_inventory', target = 'ox_target' },
  })
  t.expect(#problems).toBe(1)
  t.expect(problems[1].resource).toBe('dirk_weedv2')
end, { context = 'server' })

-- ─── Script Studio overrides ─────────────────────────────────────────────────

lib.test.add('link: Studio overrides keep settings and blank secrets', function(t)
  local s = support()
  local schema = {
    type = 'object',
    properties = {
      discord = { type = 'object', properties = {
        botToken = { type = 'string', ['x-control'] = 'secret' },
        guildId = { type = 'string' },
      } },
      logger = { type = 'object', properties = {
        routes = { type = 'array', ['x-rowControls'] = { url = { control = 'secret' }, events = 'tags' },
          items = { type = 'object', properties = { url = { type = 'string' }, kind = { type = 'string' } } } },
        password = { type = 'string', ['x-control'] = 'secret' },
      } },
      crabPots = { type = 'object', properties = { maxPerPlayer = { type = 'number' } } },
    },
  }
  local spec = s.secretSpec(schema)
  t.expect(spec.paths['discord.botToken']).toBeTruthy()
  t.expect(spec.rowKeys['logger.routes'].url).toBeTruthy()

  local overrides, n = s.overrides({
    { path = 'discord.botToken', value = 'MTIz.abc.def' },
    { path = 'discord.guildId', value = '1234' },
    { path = 'logger.password', value = '' },
    { path = 'logger.routes', value = { { url = 'https://example.com/hook', kind = 'webhook' } } },
    { path = 'crabPots.maxPerPlayer', value = 8 },
    { path = 'shop.webhookUrl', value = 'https://example.com/x' },
    { path = 'shop.webhookEnabled', value = true },
  }, spec)

  t.expect(n).toBe(7)
  t.expect(overrides['discord.botToken']).toBe('[redacted]')
  t.expect(overrides['discord.guildId']).toBe('1234')
  -- an unset secret stays visibly unset: "no bot token" is the useful fact
  t.expect(overrides['logger.password']).toBe('')
  t.expect(overrides['logger.routes'][1].url).toBe('[redacted]')
  t.expect(overrides['logger.routes'][1].kind).toBe('webhook')
  t.expect(overrides['crabPots.maxPerPlayer']).toBe(8)
  -- by name, when the schema says nothing: only a string is blanked
  t.expect(overrides['shop.webhookUrl']).toBe('[redacted]')
  t.expect(overrides['shop.webhookEnabled']).toBe(true)
end, { context = 'server' })

lib.test.add('link: Studio overrides stop at the site cap', function(t)
  local s = support()
  local rows = {}
  for i = 1, s.MAX_OVERRIDES + 20 do rows[i] = { path = 'p' .. i, value = i } end
  local _, n = s.overrides(rows)
  t.expect(n).toBe(s.MAX_OVERRIDES)
end, { context = 'server' })

-- ─── the bundle ──────────────────────────────────────────────────────────────

local function sampleFacts(consoleLines)
  return {
    collectedAt = '2026-09-25T00:03:40Z',
    server = { name = 'Dirk RP 10.1.2.3', fxserver = 'FXServer-master v1.0.0.13227 win32', onesync = 'on', uptime = 120, players = 3, maxPlayers = 64, resources = 200, os = 'windows' },
    lib = { version = '1.3.7', language = 'en' },
    scripts = { { name = 'dirk_fishing', version = '2.0.61', state = 'started' } },
    dependencies = { { name = 'oxmysql', version = '2.14.1', state = 'started', neededBy = { 'dirk_lib' } } },
    bridges = { framework = 'qbx_core', inventory = 'ox_inventory', target = 'ox_target', fuel = false },
    ui = { notify = 'dirk_lib', progress = 'ox_lib' },
    requested = 'dirk_fishing', requestedFound = true,
    studio = { script = 'dirk_fishing', overrides = { ['crabPots.maxPerPlayer'] = 8 } },
    console = consoleLines or { 'oldest', 'newest' },
    consoleProblems = {},
  }
end

lib.test.add('link: the bundle has the shape the site takes', function(t)
  local b = support().build(sampleFacts())
  t.expect(b.version).toBe(1)
  t.expect(b.lib.version).toBe('1.3.7')
  t.expect(b.lib.language).toBe('en')
  t.expect(b.server.name).toBe('Dirk RP [ip]')
  t.expect(b.server.fxserver).toBe('FXServer-master v1.0.0.13227 win32')
  t.expect(#b.scripts).toBe(1)
  t.expect(b.scripts[1].state).toBe('started')
  -- neededBy is for our problem messages, not a field the site knows
  t.expect(b.dependencies[1].neededBy).toBeNil()
  t.expect(b.bridges.framework).toBe('qbx_core')
  -- Lua has no null in a table: "none found" travels as false
  t.expect(b.bridges.fuel).toBe(false)
  t.expect(b.studio.overrides['crabPots.maxPerPlayer']).toBe(8)
  t.expect(b.problems).toBeType('table')
  t.expect(#b.problems).toBe(0)
  t.expect(b.console[2]).toBe('newest')
end, { context = 'server' })

lib.test.add('link: an oversized bundle gives up its oldest console lines first', function(t)
  local s = support()
  local lines = {}
  for i = 1, 400 do lines[i] = ('%03d '):format(i) .. ('y'):rep(990) end
  local bundle = s.build(sampleFacts(lines))
  local body, dropped = s.encode('req_1', bundle, json.encode, 100 * 1024)

  t.expect(#body <= 100 * 1024).toBeTruthy()
  t.expect(dropped).toBeGreaterThan(0)
  -- the newest line always survives, the oldest goes
  t.expect(has(body, '400 yyy')).toBeTruthy()
  t.expect(has(body, '001 yyy')).toBeFalsy()
  t.expect(has(body, '"requestId":"req_1"')).toBeTruthy()
  -- the settings survive a console trim
  t.expect(has(body, 'crabPots.maxPerPlayer')).toBeTruthy()
end, { context = 'server' })

lib.test.add('link: a bundle under the cap is sent whole', function(t)
  local s = support()
  local body, dropped = s.encode('req_2', s.build(sampleFacts()), json.encode)
  t.expect(dropped).toBe(0)
  t.expect(has(body, '"oldest"')).toBeTruthy()
end, { context = 'server' })

lib.test.add('link: a bundle sent by hand is addressed to its ticket, not a request', function(t)
  local s = support()
  local body = s.encode({ ticketId = 'cm_ticket' }, s.build(sampleFacts()), json.encode)
  t.expect(has(body, '"ticketId":"cm_ticket"')).toBeTruthy()
  t.expect(has(body, 'requestId')).toBeFalsy()
  -- and trimmed to fit the same way
  local lines = {}
  for i = 1, 400 do lines[i] = ('%03d '):format(i) .. ('y'):rep(990) end
  local trimmed, dropped = s.encode({ ticketId = 'cm_ticket' }, s.build(sampleFacts(lines)), json.encode, 100 * 1024)
  t.expect(#trimmed <= 100 * 1024).toBeTruthy()
  t.expect(dropped).toBeGreaterThan(0)
  t.expect(has(trimmed, '"ticketId":"cm_ticket"')).toBeTruthy()
end, { context = 'server' })

lib.test.add('link: the script a ticket or request is about', function(t)
  local r = support().scriptResource
  t.expect(r({ name = 'Fishing Sim V2', resource = 'dirk_fishing' })).toBe('dirk_fishing')
  t.expect(r({ name = 'dirk_multichar' })).toBe('dirk_multichar')
  t.expect(r({ name = 'Fishing Sim V2' })).toBeNil()
  -- a resource name is a folder name, nothing that could reach a path or a query
  t.expect(r({ resource = '../dirk_lib' })).toBeNil()
  t.expect(r(nil)).toBeNil()
  t.expect(r('dirk_fishing')).toBeNil()
end, { context = 'server' })

lib.test.add('link: the ticket picker takes only well-formed tickets', function(t)
  local choices = support().ticketChoices
  local list = choices({
    { id = 'cm1', number = 1042, subject = 'Crab pots vanish', script = { name = 'Fishing Sim V2', resource = 'dirk_fishing' }, updatedAt = '2026-09-25T10:00:00Z', extra = 'dropped' },
    { id = 'cm2', number = '1043', subject = 'No script' },
    { subject = 'no id' },
    'not a ticket',
    { id = 'cm3', subject = ('x'):rep(300) },
  })
  t.expect(#list).toBe(3)
  t.expect(list[1].number).toBe(1042)
  t.expect(list[1].script.resource).toBe('dirk_fishing')
  t.expect(list[1].extra).toBeNil()
  t.expect(list[2].number).toBe(1043)
  t.expect(list[2].script).toBeNil()
  t.expect(list[3].number).toBeNil()
  t.expect(#list[3].subject).toBe(120)
  -- none: an empty table (JSON's [] or {}) or no list at all
  t.expect(#choices({})).toBe(0)
  t.expect(#choices(nil)).toBe(0)
  local many = {}
  for i = 1, 30 do many[i] = { id = 'cm' .. i, subject = 's' } end
  t.expect(#choices(many)).toBe(support().MAX_TICKETS)
end, { context = 'server' })

lib.test.add('link: what the panel says about a sent bundle', function(t)
  local r = support().sendResult
  local ok = r(200, { ok = true, summary = '1 warning · dirk_lib 1.3.7' })
  t.expect(ok.ok).toBe(true)
  t.expect(ok.summary).toBe('1 warning · dirk_lib 1.3.7')
  local soon = r(429, { error = 'This server sent that ticket a bundle under a minute ago.' })
  t.expect(soon.error).toBe('tooSoon')
  t.expect(soon.message).toBe('This server sent that ticket a bundle under a minute ago.')
  t.expect(r(409).error).toBe('closed')
  t.expect(r(404).error).toBe('notFound')
  t.expect(r(401).error).toBe('revoked')
  t.expect(r(0).error).toBe('unreachable')
  t.expect(r(502).error).toBe('unreachable')
  t.expect(r(400, { error = 'Invalid bundle' }).error).toBe('refused')
end, { context = 'server' })

lib.test.add('link: redacting a full console stays fast on the server thread', function(t)
  -- The bundle is built on the server's one thread. A redaction pattern that
  -- backtracks over a long word is quadratic in the line length, and the first
  -- version of the token rule hitched a live server for 21 seconds on exactly
  -- this input. Every line is one of the shapes that used to hurt.
  local s = support()
  local shapes = {
    ('y'):rep(990),
    ('1234567890'):rep(99),
    ('deadbeef'):rep(124),
    ('abc.'):rep(248),
    ('http://a'):rep(124),
    ('token=' .. ('z'):rep(100) .. ' '):rep(9),
  }
  local lines = {}
  for i = 1, s.CONSOLE_KEEP do lines[i] = shapes[(i % #shapes) + 1] end
  local pauses = 0
  local started = os.clock()
  local console = s.consoleLines(table.concat(lines, '\n'), s.CONSOLE_KEEP, function() pauses = pauses + 1 end)
  local bundle = s.build({ lib = { version = '1' }, console = console, bridges = { framework = 'qbx_core', inventory = 'x', target = 'y' } })
  s.encode('perf', bundle, json.encode)
  local took = os.clock() - started
  t.expect(#console).toBe(s.CONSOLE_KEEP)
  -- and it offers to yield on the way, so the server never does it in one go
  t.expect(pauses).toBe(s.CONSOLE_KEEP // 50)
  t.expect(took < 0.5).toBeTruthy()
end, { context = 'server' })

-- ─── wiring ──────────────────────────────────────────────────────────────────

lib.test.add('link: every link callback checks permission on the server', function(t)
  -- The NUI is a browser; anything reachable from it is reachable from devtools.
  -- So each callback asks `allowed(source)` itself, first thing.
  local src = LoadResourceFile('dirk_lib', 'src/linkedAccount/server.lua') or ''
  t.expect(#src > 0).toBeTruthy()
  local count = 0
  for _ in src:gmatch("lib%.callback%.register%('dirk_lib:link:") do count = count + 1 end
  t.expect(count).toBe(6)
  local guarded = 0
  for _ in src:gmatch("lib%.callback%.register%('dirk_lib:link:[%w_]+',%s*function%(source[%w_, ]*%)%s*\n%s*if not allowed%(source%) then return nil, 'NotAuthorized' end") do
    guarded = guarded + 1
  end
  t.expect(guarded).toBe(count)
end, { context = 'server' })

lib.test.add('link: a bundle sent by hand only goes to a ticket the panel was just offered', function(t)
  -- The NUI names the ticket; the server only sends to one the site listed for
  -- this account a moment ago, and the site checks the ticket is that account's.
  local src = LoadResourceFile('dirk_lib', 'src/linkedAccount/server.lua') or ''
  local body = src:match("lib%.callback%.register%('dirk_lib:link:send'(.-)\nend%)")
  t.expect(body).notToBeNil()
  t.expect(body:find('offered%[ticketId%]') ~= nil).toBeTruthy()
  t.expect(body:find('if not ticket then return', 1, true) ~= nil).toBeTruthy()
  -- and the list it was offered is replaced each time the picker asks
  t.expect(src:find('offered = {}', 1, true) ~= nil).toBeTruthy()
end, { context = 'server' })

lib.test.add('link: what the panel is sent never carries the key or poll secret', function(t)
  local src = LoadResourceFile('dirk_lib', 'src/linkedAccount/server.lua') or ''
  local body = src:match('local function status%(%)(.-)\nend\n')
  t.expect(body).notToBeNil()
  t.expect(body:find('%.key') == nil).toBeTruthy()
  t.expect(body:find('pollSecret', 1, true) == nil).toBeTruthy()
end, { context = 'server' })
