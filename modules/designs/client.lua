-- lib.designs — the client half.
--
-- A client holds exactly one design per screen: the live one. It asks for it
-- once, keeps the hash, and from then on receives PATCHES rather than trees.
--
-- Usage, from a studio product's client:
--
--   local design = lib.designs.live('multichar')         -- fetch + cache
--   lib.designs.onChange('multichar', function(design)   -- live edits
--     render(design)
--   end)

local resource = GetCurrentResourceName()
local designs = {}

--- What we hold, per screen: the parsed design and the hash it came at.
local held = {}
local listeners = {}

local function announce(screen)
  local entry = held[screen]
  for _, fn in ipairs(listeners[screen] or {}) do
    pcall(fn, entry and entry.design or nil)
  end
end

--- Rebuild the element list from a patch.
---
--- Elements are a flat list carrying a parent id, so this never has to walk a
--- tree. Two rules keep it whole: a `remove` takes every descendant with it -
--- otherwise a deleted frame leaves its children floating at the root - and an
--- `add` is placed at the end, since order in the list is not draw order.
local function apply(design, ops)
  local elements = design.elements or {}
  local index = {}
  for i, el in ipairs(elements) do
    if el.id then index[el.id] = i end
  end

  for _, op in ipairs(ops) do
    if op.op == 'set' and index[op.id] then
      elements[index[op.id]] = op.el
    elseif op.op == 'add' and not index[op.id] then
      elements[#elements + 1] = op.el
      index[op.id] = #elements
    elseif op.op == 'remove' then
      -- Everything under it goes too, however deep. Repeat until nothing more
      -- is orphaned, because a child may appear before its parent in the list.
      local doomed = { [op.id] = true }
      local again = true
      while again do
        again = false
        for _, el in ipairs(elements) do
          if el.parent and doomed[el.parent] and not doomed[el.id] then
            doomed[el.id] = true
            again = true
          end
        end
      end
      local kept = {}
      for _, el in ipairs(elements) do
        if not doomed[el.id] then kept[#kept + 1] = el end
      end
      elements = kept
      index = {}
      for i, el in ipairs(elements) do
        if el.id then index[el.id] = i end
      end
    end
  end

  design.elements = elements
  return design
end

--- The live design for a screen.
---
--- Cached: a second call costs nothing, and a call after a patch returns the
--- patched design rather than asking again.
function designs.live(screen)
  local entry = held[screen]
  if entry then return entry.design end

  local reply = lib.callback.await(('%s:designs:live'):format(resource), false, {
    screen = screen,
    known = nil,
  })
  if type(reply) ~= 'table' or type(reply.data) ~= 'string' then return nil end

  local ok, design = pcall(json.decode, reply.data)
  if not ok or type(design) ~= 'table' then return nil end

  held[screen] = { hash = reply.hash, design = design }
  return design
end

--- Called whenever the live design for a screen changes, with the new one.
function designs.onChange(screen, fn)
  listeners[screen] = listeners[screen] or {}
  listeners[screen][#listeners[screen] + 1] = fn
end

--- Throw away what we hold, so the next `live` fetches fresh.
function designs.forget(screen)
  if screen then held[screen] = nil else held = {} end
end

--- The live design changed on the server.
---
--- A patch is applied when our base hash matches what it was built against.
--- Anything else - a client that joined late, one that missed a change, a
--- change too big to be worth diffing - re-fetches the whole thing, which is
--- the same path a fresh join takes.
RegisterNetEvent(('%s:designs:changed'):format(resource), function(payload)
  if type(payload) ~= 'table' or type(payload.screen) ~= 'string' then return end
  local screen = payload.screen
  local entry = held[screen]

  -- Not holding this screen yet: nothing to patch and nothing to announce.
  -- Whoever renders it will fetch it when they need it.
  if not entry then return end

  if payload.ops and payload.base and entry.hash == payload.base then
    entry.design = apply(entry.design, payload.ops)
    entry.hash = payload.hash
    announce(screen)
    return
  end

  held[screen] = nil
  designs.live(screen)
  announce(screen)
end)

return designs
