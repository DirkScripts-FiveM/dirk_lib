-- CLIENT runner endpoint. The server's `dirktest ... +c` awaits this to run the
-- client/shared tests on this player and return the results (server -> client).
--
-- This callback only exists once lib.test has been touched on the client — so a
-- resource that wants client tests must either register a client test (which
-- touches lib.test) or declare `dirk_lib 'test'` in its fxmanifest to force-load
-- the module in both contexts. See dirk_lib/init.lua's metadata force-loader.

-- The runClient endpoint the server's `dirktest ... +c` awaits. It only responds
-- to the console-only server command, so no extra gate is needed here.
--
-- NAMESPACED BY RESOURCE, like its server counterpart. This module is loaded
-- into every consumer, so a single shared name meant each resource overwrote
-- the last one to register it: on a server running three of them, two were
-- simply unreachable and the third answered for everybody. The symptom was
-- every resource reporting `CLIENT[1] 0 passed` while its server half ran
-- fine - a client suite that had never once run, and looked merely empty
-- rather than broken.
lib.callback.register(('%s:test:runClient'):format(GetCurrentResourceName()), function(filter)
  if filter == '*' or filter == '' then filter = nil end
  -- On the client the "player" is us; pass our own server id (or true) so
  -- requiresPlayer client tests aren't skipped.
  return test.runLocal(filter, (cache and cache.serverId) or true)
end)

return test
