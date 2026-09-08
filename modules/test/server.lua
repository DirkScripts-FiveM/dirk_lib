-- SERVER runner: the `dirktest` console command.
--
--   dirktest [filter] [playerId] [+c]
--
-- Runs this resource's server/shared tests. With `+c` it also runs the
-- client/shared tests on the target player (server -> client via lib.callback) —
-- that leg needs lib.test loaded on the CLIENT too, which is what declaring
-- `dirk_lib 'test'` in the consumer fxmanifest guarantees (force-loads the module
-- in both contexts; see the loader in dirk_lib/init.lua).
--
-- NOTE: the test registry is per-VM, so `dirktest` runs the tests of the
-- resource that owns this command. Keep a suite's tests in one resource.

-- SECURITY: `dirktest` is CONSOLE-ONLY. The `source ~= 0` guard below means only
-- the server console (the owner/admin) can ever run it — a connected player
-- cannot, no matter their permissions. It's also a `restricted` command (ace
-- command.dirktest). So no gating convar is needed: the runner is safe to have
-- present; it simply does nothing when a resource ships no tests.
local function resolvePlayer(explicit)
  if explicit then return explicit end
  local players = GetPlayers()
  return players[1] and tonumber(players[1]) or nil
end

--- `dirktest [resource] [filter] [playerId] [+c]`
---
--- ── why a resource argument, and why an event ───────────────────────────────
---
--- Every resource declaring `dirk_lib 'test'` loads this file into its OWN VM
--- and registers this command. FiveM keeps one handler per command name, so the
--- last resource to start silently took ownership of `dirktest` and ran only
--- its own suite — with two test-carrying scripts installed, which suite you
--- got came down to restart order, and nothing said so.
---
--- So the surviving handler is a DISPATCHER. It parses the line and fires an
--- event; every VM listens and runs only if it was named. Whichever copy won
--- the registration, the run reaches all of them.
---
--- Still console-only. A suite is allowed side effects — fishing's adds and
--- removes real items to prove the inventory bridge works — so it must not be
--- reachable by a player, and `source ~= 0` is the whole of that.
--- Did any VM take the last dispatch?
---
--- Server events run their handlers INLINE, so by the time `TriggerEvent`
--- returns below, every resource that was going to answer already has. That is
--- what lets the dispatcher tell "nobody ships tests" apart from "it ran and
--- printed nothing", which are the same silence otherwise.
local claimed = false
AddEventHandler('dirk_lib:test:claimed', function() claimed = true end)

RegisterCommand('dirktest', function(source, args)
  if source ~= 0 then return end -- console only, and deliberately so

  local resource, resourceState, filter, player, withClient
  for _, a in ipairs(args) do
    if a == '+c' then withClient = true
    elseif tonumber(a) then player = tonumber(a)
    elseif a ~= '*' and a ~= '' then
      -- A resource NAME selects a suite; anything else is a name filter.
      -- Checked in that order so `dirktest dirk_fishing levels` reads the way
      -- it looks.
      --
      -- "Does this resource exist", NOT "is it started". Matching on started
      -- meant a script that was stopped, or still starting, quietly became a
      -- FILTER instead — so `dirktest dirk_projectCars` ran fishing's suite
      -- looking for tests with "dirk_projectCars" in the name, found none, and
      -- reported `0 passed · 0 failed` as though the script had no tests.
      local state = GetResourceState(a)
      if not resource and state ~= 'missing' and state ~= 'unknown' then
        resource, resourceState = a, state
      elseif not filter then filter = a end
    end
  end

  if resource and resourceState ~= 'started' then
    print(('^3[lib.test]^7 %s is %s, not started — nothing to run.'):format(resource, resourceState))
    return
  end

  claimed = false
  TriggerEvent('dirk_lib:test:runSuite', resource, filter, player, withClient)

  -- Say so rather than printing nothing. A script that ships no tests and a
  -- script whose fxmanifest forgot `dirk_lib 'test'` look identical from here,
  -- so the message names both.
  if not claimed then
    if resource then
      print(('^3[lib.test]^7 %s did not answer — it ships no tests, or its fxmanifest is missing `dirk_lib \'test\'`.'):format(resource))
    else
      print('^3[lib.test]^7 no started script on this server ships tests.')
    end
  end
end, true)

--- One resource's answer to the dispatch above.
---
--- Runs when it was named, or when nothing was — so a bare `dirktest` still
--- runs everything, which is what it always did.
AddEventHandler('dirk_lib:test:runSuite', function(resource, filter, player, withClient)
  if resource and resource ~= GetCurrentResourceName() then return end
  if test.count() == 0 then return end

  -- Answered. Fired INLINE, before the thread below, so the dispatcher knows
  -- somebody took it by the time its own TriggerEvent returns.
  TriggerEvent('dirk_lib:test:claimed', GetCurrentResourceName())

  local target = resolvePlayer(player)

  CreateThread(function()
    print(('^5[lib.test]^7 %s: running %s%s%s'):format(
      GetCurrentResourceName(),
      filter and ('filter="' .. filter .. '" ') or 'all ',
      target and ('player=' .. target .. ' ') or '(no player) ',
      withClient and '+client' or ''))

    test.report('SERVER', test.runLocal(filter, target))

    if withClient then
      if not target then
        print('^3[lib.test]^7 +c requested but no player connected — client tests skipped')
        return
      end
      -- Per-resource, so each consumer's client suite is reachable rather than
      -- whichever one happened to register the shared name last.
      local ok, clientRes = pcall(lib.callback.await,
        ('%s:test:runClient'):format(GetCurrentResourceName()), target, filter or '*')
      if ok and type(clientRes) == 'table' then
        test.report('CLIENT[' .. target .. ']', clientRes)
      else
        print("^3[lib.test]^7 client tests unavailable — is lib.test loaded on the client? (declare `dirk_lib 'test'`)")
      end
    end
  end)
end)

-- ── Running a suite from Script Studio ───────────────────────────────────
--
-- The registry is per-VM, so dirk_lib cannot run another resource's tests: it
-- has to ask that resource. Every consumer declaring `dirk_lib 'test'` loads
-- this file, so every one of them answers on its own name.
--
-- A DELIBERATE loosening of the console-only stance above, and worth being
-- explicit about: `dirktest` is restricted to the server console because a
-- suite can have side effects - fishing's adds and removes items to prove the
-- inventory bridge works. This callback is gated on permission to EDIT that
-- script's config, which is a higher bar than being an admin and is already
-- enough to change any setting in it. Someone who can retune the whole script
-- can also run its tests.
lib.callback.register(('%s:test:run'):format(GetCurrentResourceName()), function(source, payload)
  if not source or source <= 0 then return false, 'InvalidSource' end

  local allowed = false
  local ok, result = pcall(function()
    return exports.dirk_lib:canEditScriptConfig(source, GetCurrentResourceName())
  end)
  if ok then allowed = result == true end
  if not allowed then return false, 'NoPermission' end

  local filter = type(payload) == 'table' and payload.filter or nil
  if filter == '' then filter = nil end

  -- One run at a time, across every admin on the server, with a short
  -- cooldown after. dirk_lib holds the lock because it is the one place that
  -- knows about every consumer.
  local resource = GetCurrentResourceName()
  local began, reason, detail = exports.dirk_lib:beginTestRun(resource, source)
  if not began then return false, reason or 'Busy', detail end

  local ok, res = pcall(test.runLocal, filter, source)
  if not ok or type(res) ~= 'table' then
    exports.dirk_lib:endTestRun(resource, nil)
    return false, 'NoTests'
  end

  local payloadOut = {
    passed = res.passed,
    failed = res.failed,
    skipped = res.skipped,
    cases = res.cases,
  }

  -- Cached from HERE rather than reported by the client: the result is what
  -- this VM actually produced, and nothing in between gets to edit it.
  exports.dirk_lib:endTestRun(resource, payloadOut)

  return true, nil, payloadOut
end)

return test
