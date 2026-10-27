-- ─────────────────────────────────────────────────────────────────────────────
-- Who is a master, and does anyone actually qualify?
--
-- This one cost an afternoon on a fresh ESX box. `/dirk_config` opened and
-- reported no scripts the admin was allowed to edit, on a server where that
-- admin was `add_principal`'d into group.admin four different ways.
--
-- The cause is a FiveM fact that reads backwards: being a PRINCIPAL of
-- group.admin does NOT make the ACE "group.admin" allowed. Measured on that
-- server, for a player holding every identifier we had granted:
--
--     group.admin   deny
--     admin         deny
--     command       ALLOW      <- only because of `add_ace group.admin command allow`
--
-- `isMasterEditor` loops the `dirk_lib_master_group` convar calling
-- IsPlayerAceAllowed on each value, so on that box nothing in the list
-- resolved and it granted nobody - silently, with the panel simply looking
-- empty. The fix is one line in the SERVER's cfg, not a wider default:
--
--     add_ace group.admin admin allow
--
-- `command` is deliberately NOT trusted (see the test below), so "the admin
-- can run commands" is never mistaken for "the admin owns the config".
--
-- What WAS a bug: the two defaults in this repo disagreed.
--   src/scriptConfig/server.lua  'group.admin,admin'            <- gates access
--   src/init.lua                 'group.admin,admin,command'    <- only informs the UI
-- The client half advertised a group the gate did not honour, so the Admins
-- page and the actual verdict could never agree on a stock server.
--
--   dirktest dirk_lib access
--   dirktest dirk_lib access 1 +c
-- ─────────────────────────────────────────────────────────────────────────────

local SERVER_DEFAULT = 'group.admin,admin'

lib.test.add('access: the master-group default is the same on both sides', function(t)
  -- The server default decides access; the client default only feeds the Admins
  -- page. When they drift, the page says one thing and the gate does another,
  -- and the gate is the half nobody can see.
  local server = LoadResourceFile('dirk_lib', 'src/scriptConfig/server.lua') or ''
  local client = LoadResourceFile('dirk_lib', 'src/init.lua') or ''
  t.expect(#server > 0).toBeTruthy()
  t.expect(#client > 0).toBeTruthy()

  local serverDefault = server:match("local DEFAULT_MASTER%s*=%s*'([^']+)'")
  local clientDefault = client:match("GetConvar%('dirk_lib_master_group',%s*'([^']+)'%)")

  t.expect(serverDefault).notToBeNil()
  t.expect(clientDefault).notToBeNil()
  t.expect(serverDefault).toBe(clientDefault)
end, { context = 'server' })

lib.test.add('access: the default never trusts the `command` ace', function(t)
  -- Deliberate, and worth a test so nobody "fixes" it the way I nearly did.
  --
  -- `command` is the one token an operator may hand to a non-admin, so treating
  -- it as proof of master access would silently widen the panel to anyone
  -- allowed to run any command. Admins reach master through `group.admin` or
  -- `admin` instead - which means a server.cfg needs one of:
  --     add_ace group.admin admin allow
  --     add_ace group.admin group.admin allow
  -- Being add_principal'd into group.admin is NOT enough on its own: principal
  -- membership does not make the matching ACE allowed. Measured on a stock ESX
  -- box - group.admin deny, admin deny - which is what an admin staring at an
  -- empty Script Studio is actually looking at.
  local server = LoadResourceFile('dirk_lib', 'src/scriptConfig/server.lua') or ''
  local serverDefault = server:match("local DEFAULT_MASTER%s*=%s*'([^']+)'") or ''
  t.expect(#serverDefault > 0).toBeTruthy()

  local names = {}
  for value in serverDefault:gmatch('[^,]+') do
    names[value:match('^%s*(.-)%s*$')] = true
  end
  t.expect(names['command']).toBeNil()
  t.expect(names['group.admin']).toBeTruthy()
  t.expect(names['admin']).toBeTruthy()
end, { context = 'server' })

lib.test.add('access: the console is always a master', function(t)
  -- src 0 is the server console. It must never be locked out - it is the way
  -- back in when a config change locks out everyone else.
  t.expect(exports.dirk_lib:canEditScriptConfig(0, 'dirk_lib')).toBeTruthy()
  t.expect(exports.dirk_lib:canViewScriptConfig(0, 'dirk_lib')).toBeTruthy()
end, { context = 'server' })

lib.test.add('access: a real player resolves to a real verdict', function(t)
  -- Not asserting the player IS an admin - that depends on the server's ACEs.
  -- Asserting the check ANSWERS: returns a boolean rather than erroring or
  -- handing back nil, which is what a broken identifier context looked like.
  local src = t.player
  local canEdit = exports.dirk_lib:canEditScriptConfig(src, 'dirk_lib')
  local canView = exports.dirk_lib:canViewScriptConfig(src, 'dirk_lib')

  t.expect(type(canEdit) == 'boolean').toBeTruthy()
  t.expect(type(canView) == 'boolean').toBeTruthy()

  -- Edit implies view. A grant that lets someone save but not look would be a
  -- bug in the level ladder.
  if canEdit then t.expect(canView).toBeTruthy() end
end, { context = 'server', requiresPlayer = true })

lib.test.add('access: every master-group entry is asked of the native', function(t)
  -- The contract isMasterEditor relies on: ANY one entry passing is enough.
  -- If a player passes an ace, they must come out a master - this catches a
  -- future refactor that only tests the first entry, or trims the list.
  local src = t.player
  local convar = GetConvar('dirk_lib_master_group', SERVER_DEFAULT)

  local anyAllowed = false
  for value in convar:gmatch('[^,]+') do
    value = value:match('^%s*(.-)%s*$')
    if value ~= '' and IsPlayerAceAllowed(src, value) then anyAllowed = true end
  end

  if anyAllowed then
    t.expect(exports.dirk_lib:canEditScriptConfig(src, 'dirk_lib')).toBeTruthy()
  end
end, { context = 'server', requiresPlayer = true })
