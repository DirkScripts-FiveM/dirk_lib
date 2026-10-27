-- lib.designs — where a studio product keeps its designs.
--
-- The store itself is dirk_lib's `src/designs/server.lua`, so the table is
-- created once rather than once per consuming resource. This is the proxy each
-- script actually calls, plus the one piece that HAS to run in the consumer's
-- own vm: resolving which design is live, which lives in that script's own
-- scriptConfig.
--
-- Usage, from a studio product's server:
--
--   lib.designs.seed(require 'designs.bundled')      -- on boot
--   local all  = lib.designs.list()                  -- metadata only
--   local one  = lib.designs.get('dirk-default')     -- one tree
--   lib.designs.save({ id = ..., screen = 'multichar', name = ..., data = ... })
--   lib.designs.setActive('multichar', 'cinematic')
--
-- Every call is scoped to the calling resource. A script cannot read or write
-- another script's designs, and does not have to say its own name.

local resource = GetCurrentResourceName()
local designs = {}

--- Which design is live, per screen.
---
--- Stored in THIS script's scriptConfig under `designs.active` as JSON, because
--- it is a setting: it belongs in the change history and it is two short
--- strings. The trees themselves are in the store; this is only the pointer.
--- Block until this script's scriptConfig has finished loading.
---
--- Both this and scriptConfig's own init wait on the database, and which
--- returns first is not decided anywhere - so a boot that seeds designs and
--- then reads the pointer could read it before the config existed. That looked
--- like a fresh install: the fallback re-pointed the screen at the first
--- shipped design and quietly undid whichever one the owner had chosen.
---
--- Only ever waits during boot; once loaded this is a nil check. Outside a
--- coroutine it cannot yield, so it answers honestly instead of erroring.
local function configLoaded()
  if lib.scriptConfig.get() then return true end
  if not coroutine.running() then return false end

  local waited = 0
  while not lib.scriptConfig.get() and waited < 15000 do
    Wait(50)
    waited = waited + 50
  end

  if not lib.scriptConfig.get() then
    lib.print.warn(('designs: %s has no scriptConfig after 15s - the live design cannot be read'):format(resource))
    return false
  end
  return true
end

local function pointer()
  if not configLoaded() then return {} end
  local cfg = lib.scriptConfig.get('designs')
  if type(cfg) ~= 'table' then return {} end
  local ok, parsed = pcall(json.decode, cfg.active or '{}')
  return (ok and type(parsed) == 'table') and parsed or {}
end

--- Every design this script owns, WITHOUT the trees — for a gallery.
function designs.list()
  return exports.dirk_lib:designs_list(resource)
end

--- Every design this script owns, WITH the trees.
---
--- For the panel's gallery only, which renders each card for real. Whoever
--- asked has the editor open and is about to edit one - players never take
--- this path, they get `live` and nothing else.
function designs.all()
  return exports.dirk_lib:designs_all(resource)
end

--- One design, tree and all. For opening it, never for listing.
function designs.get(id)
  return exports.dirk_lib:designs_get(resource, id)
end

--- Create or replace one. Returns `{ id, hash }`.
function designs.save(design)
  return exports.dirk_lib:designs_save(resource, design)
end

function designs.delete(id)
  return exports.dirk_lib:designs_delete(resource, id)
end

--- Seed the designs this resource SHIPS WITH, from `designs/bundled.json`.
---
--- Call this on boot. One line, every product, and the same file name in each
--- - so where a script's defaults live is never a thing anyone has to look up.
---
--- The file is generated from the studio seeds by `pnpm designs:export`, so the
--- defaults the panel shows and the defaults the server installs are the same
--- bytes rather than two lists that drift.
function designs.seedBundled()
  local raw = LoadResourceFile(resource, 'designs/bundled.json')
  if not raw then return 0 end
  local ok, parsed = pcall(json.decode, raw)
  if not ok or type(parsed) ~= 'table' then
    lib.print.warn(('designs: %s/designs/bundled.json is not valid JSON'):format(resource))
    return 0
  end
  return designs.seed(parsed)
end

--- Seed a list of designs this resource ships with.
---
--- Call it on boot with the contents of your `designs/` folder. Ids already in
--- the store are left alone unless they are still byte-identical to what was
--- last shipped — so an owner who has edited the default keeps their version,
--- and one who has not gets the update silently.
function designs.seed(bundled)
  return exports.dirk_lib:designs_seed(resource, bundled)
end

--- Which design is live for a screen.
function designs.active(screen)
  return pointer()[screen]
end

--- Make one live. Writes the pointer, not the design.
function designs.setActive(screen, id)
  if not configLoaded() then return false end
  local map = pointer()
  map[screen] = id
  lib.scriptConfig.set({ designs = { active = json.encode(map) } }, nil, { sectionReplace = true })
  return true
end

--- The live design for a screen, or nothing when the caller already has it.
---
--- `known` is the hash they are holding: matching hashes send NOTHING, which is
--- the common case. This is the ONE path that hands a tree to a client, and it
--- only does so for the design they are about to render.
function designs.live(screen, known)
  local id = designs.active(screen)
  if not id then return nil end
  return exports.dirk_lib:designs_live(resource, id, known)
end

-- ── patching ────────────────────────────────────────────────────────────────
--
-- Editing is a stream of small changes. Without this, nudging a button ten
-- times on a live design is ten whole trees to every player on the server;
-- with it, it is ten sets of four numbers.
--
-- Elements are a FLAT list carrying a parent id, not a literal tree, so depth
-- costs the diff nothing - moving a child between parents is one `set` of its
-- parent. Two rules keep it whole on the other side: a `remove` takes every
-- descendant with it, and an `add` arrives after its parent.

--- The last tree each screen was seen at, so a change can be expressed as a diff.
local lastSent = {}

local function byId(design)
  local out = {}
  for _, el in ipairs(type(design) == 'table' and design.elements or {}) do
    if el.id then out[el.id] = el end
  end
  return out
end

--- Ops that turn `from` into `to`, or nil when the whole thing has to go.
---
--- Anything outside `elements` - pages, the design's own settings, its name -
--- is small and structural, so a change there is a full send rather than a
--- second diff format nobody can read.
local function diff(from, to)
  if type(from) ~= 'table' or type(to) ~= 'table' then return nil end
  if json.encode(from.pages) ~= json.encode(to.pages) then return nil end
  if json.encode(from.settings) ~= json.encode(to.settings) then return nil end

  local was, now = byId(from), byId(to)
  local ops = {}

  for id, el in pairs(now) do
    local before = was[id]
    if not before then
      ops[#ops + 1] = { op = 'add', id = id, el = el }
    elseif json.encode(before) ~= json.encode(el) then
      ops[#ops + 1] = { op = 'set', id = id, el = el }
    end
  end
  for id in pairs(was) do
    if not now[id] then ops[#ops + 1] = { op = 'remove', id = id } end
  end

  -- A parent has to exist before its children land. Adds go shallowest first;
  -- sets and removes do not care.
  table.sort(ops, function(a, b)
    if a.op ~= b.op then return a.op < b.op end
    return tostring(a.id) < tostring(b.id)
  end)

  -- Past a certain size the patch is not saving anything and the full tree is
  -- simpler to reason about.
  if #ops > math.max(12, #(to.elements or {}) // 2) then return nil end
  return ops
end

--- Tell everyone the live design changed, as small a message as honest.
---
--- Clients holding the base hash apply the ops; anyone else asks for the tree.
function designs.pushLive(screen)
  local id = designs.active(screen)
  if not id then return end
  local row = exports.dirk_lib:designs_get(resource, id)
  if not row then return end

  local previous = lastSent[screen]
  local ops = nil
  if previous and previous.hash ~= row.hash then
    local okFrom, from = pcall(json.decode, previous.data)
    local okTo, to = pcall(json.decode, row.data)
    if okFrom and okTo then ops = diff(from, to) end
  end

  lastSent[screen] = { hash = row.hash, data = row.data }
  TriggerClientEvent(('%s:designs:changed'):format(resource), -1, {
    screen = screen,
    hash = row.hash,
    base = previous and previous.hash or nil,
    ops = ops,
  })
end

--- The client half asks through this. Namespaced by resource, so every studio
--- product gets its own and they cannot collide.
lib.callback.register(('%s:designs:live'):format(resource), function(_, payload)
  local screen = type(payload) == 'table' and payload.screen or nil
  if type(screen) ~= 'string' then return nil end
  return designs.live(screen, type(payload) == 'table' and payload.known or nil)
end)

return designs
