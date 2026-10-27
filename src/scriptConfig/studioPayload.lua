--- The pieces of a Script Studio open that are pure logic, kept apart from the
--- natives so a test can drive them.
---
--- Required by src/scriptConfig/client.lua (what goes to the panel) and
--- src/scriptConfig/server.lua (when the registry cache drops). Shared, so it
--- is listed in files{} - the client loads it through `require`.

local M = {}

--- The payload as the PANEL should get it: every entry, minus the schema text
--- the panel already holds.
---
--- Schemas are most of an open. Fishing's alone is a quarter of a megabyte,
--- and the old open re-sent every schema to the NUI every time - json-encoded
--- in Lua, copied across into CEF, parsed again there - to tell the panel what
--- it was already showing. The panel reports which hashes it holds (see
--- SCRIPT_STUDIO_HELD), so a matching hash means the text stays behind and
--- only the hash goes over.
---
--- Copies, never edits: the same gathered list is shared by everyone waiting
--- on one gather (see M.single), and the next send may need the text back.
---@param scripts table[] gathered entries, each with resource, hash and schemaJson
---@param held table<string, any> resource -> hash the panel holds
---@return table[]
function M.forPanel(scripts, held)
  local out = {}
  for i = 1, #scripts do
    local entry = scripts[i]
    local copy = {}
    for key, value in pairs(entry) do copy[key] = value end
    if entry.hash ~= nil and held[entry.resource] == entry.hash then
      copy.schemaJson = nil
    end
    out[i] = copy
  end
  return out
end

--- What the panel says it holds, cleaned up.
---
--- It comes from the NUI, so it is a claim and nothing more - but the only
--- thing a false claim can do is keep schema text away from the client making
--- it. Nothing here grants anything, so the cleaning is about shape: string
--- names, scalar hashes, and a cap so a junk table cannot grow without bound.
---@param reported any
---@return table<string, any>
function M.readHeld(reported)
  local out = {}
  if type(reported) ~= 'table' then return out end
  local count = 0
  for resource, hash in pairs(reported) do
    if type(resource) == 'string' and #resource <= 64
      and (type(hash) == 'number' or type(hash) == 'string') then
      out[resource] = hash
      count = count + 1
      if count >= 256 then break end
    end
  end
  return out
end

--- Overlay the server-only sliver onto the client-visible values, in place.
function M.mergeInto(target, extra)
  for key, value in pairs(extra) do
    if type(value) == 'table' and type(target[key]) == 'table' then
      M.mergeInto(target[key], value)
    else
      target[key] = value
    end
  end
  return target
end

--- Does a start or stop of `name` change the set of dirk scripts?
---
--- Every resource on the server starts and stops through the same two events,
--- and the registry cache used to drop on ALL of them - so restarting a map or
--- a car pack threw away the parsed schemas and the next open re-read and
--- re-decoded every schema.json on the server main thread.
---
--- It matters only for a script that declares the tag now, or one that is IN
--- the cached list (stopping, or restarted without its tag).
---@param name string?
---@param cached table[]? the registry cache, nil when there is none
---@param isTagged fun(name: string): boolean
function M.touchesRegistry(name, cached, isTagged)
  if type(name) ~= 'string' then return false end
  if type(cached) == 'table' then
    for i = 1, #cached do
      if cached[i].resource == name then return true end
    end
  end
  return isTagged(name) == true
end

--- Wrap `fn` so callers arriving while it runs share that run's answer.
---
--- The warm-up after joining, a Refresh and an open can all want the same
--- gather at once. Each used to be its own round trip and its own pass over
--- every script; a gather that started a moment ago is as fresh as a new one.
---
--- Must be called from a thread (it yields while waiting).
---@param fn fun(...): any
---@return fun(...): any
function M.single(fn)
  local running = nil
  return function(...)
    if running then
      local shared = Citizen.Await(running)
      return type(shared) == 'table' and shared.result or nil
    end
    local p = promise.new()
    running = p
    local ok, result = pcall(fn, ...)
    running = nil
    -- Wrapped, so a nil answer ("nothing for you") still reads as an answer
    -- to the waiters rather than as a promise with no value.
    p:resolve({ result = ok and result or nil })
    if not ok then
      lib.print.error(('[studio] gather failed: %s'):format(tostring(result)))
      return nil
    end
    return result
  end
end

return M
