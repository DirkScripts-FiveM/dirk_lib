-- The design store.
--
-- Where a studio product's designs live, and deliberately NOT scriptConfig.
--
-- scriptConfig is built for settings: a few hundred small values, hydrated to
-- every client on join and broadcast on save. A design is none of those things
-- - one character-select design is larger than every setting in every dirk
-- script put together - so keeping designs in the config would make every
-- config read on the server carry them. They get a table of their own, and the
-- config keeps only the POINTER: which design is live, per screen.
--
-- THE RULE: a design tree is only ever sent to someone about to render it or
-- edit it. A code path that can send one to a client doing neither is a bug,
-- not a setting to tune.
--
-- Shape:
--   resource  which script owns it              dirk_multichar
--   screen    which of that script's screens    multichar | spawn
--   id        stable, and the install code       dirk-default
--   data      the design JSON, as a string       {"pages":[...],...}
--   hash      content hash of `data`             used for patching + caching
--
-- This lives in dirk_lib's OWN vm and is reached through exports, so the table
-- is created once rather than once per consuming resource. `lib.designs` in
-- modules/ is the thin proxy every script actually calls.

local TABLE = 'dirk_designs'

--- Content hash of a design's JSON.
---
--- Not a checksum for integrity - it is how a client says "this is the version
--- I already have" so the server can send a patch instead of the whole tree,
--- and send nothing at all when they match.
local function hashOf(data)
  if type(data) ~= 'string' or data == '' then return '0' end
  -- FNV-1a, 32-bit. Small, fast, and stable across restarts - which a Lua
  -- table address or `tostring` would not be.
  local h = 2166136261
  for i = 1, #data do
    h = h ~ data:byte(i)
    h = (h * 16777619) & 0xFFFFFFFF
  end
  return ('%08x'):format(h)
end

-- ── the table ───────────────────────────────────────────────────────────────

local ready = false

local function ensureTable()
  if ready then return true end

  -- One consumer per boot does the schema work; the rest skip straight past.
  -- Every statement is idempotent and pcall'd anyway, so two resources booting
  -- together cannot take each other down.
  if GlobalState.dirk_designsSchemaReady then ready = true return true end

  local exists = pcall(MySQL.scalar.await, ('SELECT 1 FROM %s LIMIT 1'):format(TABLE))
  if not exists then
    lib.print.info('Creating dirk_designs table...')
    local _, err = pcall(MySQL.query.await, ([[
      CREATE TABLE IF NOT EXISTS `%s` (
        `id`          VARCHAR(64)  NOT NULL,
        `resource`    VARCHAR(64)  NOT NULL,
        `screen`      VARCHAR(64)  NOT NULL,
        `name`        VARCHAR(120) NOT NULL DEFAULT 'Untitled',
        `description` TEXT         DEFAULT NULL,
        `thumbnail`   LONGTEXT     DEFAULT NULL,
        `data`        LONGTEXT     NOT NULL,
        `hash`        VARCHAR(16)  NOT NULL DEFAULT '0',
        `source`      VARCHAR(16)  NOT NULL DEFAULT 'local',
        `updated`     TIMESTAMP    NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
        PRIMARY KEY (`resource`, `id`),
        KEY `by_screen` (`resource`, `screen`)
      )
    ]]):format(TABLE))

    -- Re-probe rather than trusting the pcall: a concurrent consumer may have
    -- created it a moment ago, which is a perfectly good outcome.
    if not pcall(MySQL.scalar.await, ('SELECT 1 FROM %s LIMIT 1'):format(TABLE)) then
      lib.print.error(('could not create the `%s` table: %s'):format(TABLE, tostring(err)))
      lib.print.error('Designs are stored here. Without it the Designs tab cannot load or save, and scripts fall back to their bundled default.')
      lib.print.error('Check your database user has CREATE permission, then restart.')
      return false
    end
  end

  GlobalState.dirk_designsSchemaReady = true
  ready = true
  return true
end

-- ── reading ─────────────────────────────────────────────────────────────────

--- Every design a script owns, WITHOUT the trees.
---
--- This is what a gallery renders: names, descriptions, thumbnails and which
--- screen each belongs to. A hundred designs is still a small reply, because
--- the one thing that is actually big is left out.
local function list(resource)
  if type(resource) ~= 'string' or not ensureTable() then return {} end
  local rows = MySQL.query.await(
    ('SELECT `id`, `screen`, `name`, `description`, `thumbnail`, `hash`, `source`, `updated` FROM %s WHERE `resource` = ? ORDER BY `name`'):format(TABLE),
    { resource }
  )
  return rows or {}
end

--- Every design a script owns, WITH the trees.
---
--- For the editor's gallery, which draws each card by actually rendering the
--- design - a thumbnail that is not the real thing is a picture of a different
--- program. That is allowed under the rule because whoever asked has the panel
--- open and is about to edit one; it is PLAYERS who only ever receive the live
--- design. Everything else should use `list`.
local function all(resource)
  if type(resource) ~= 'string' or not ensureTable() then return {} end
  return MySQL.query.await(
    ('SELECT * FROM %s WHERE `resource` = ? ORDER BY `name`'):format(TABLE),
    { resource }
  ) or {}
end

--- One design, tree and all. Fetched when it is opened, never in a list.
local function get(resource, id)
  if type(resource) ~= 'string' or type(id) ~= 'string' or not ensureTable() then return nil end
  local row = MySQL.single.await(
    ('SELECT * FROM %s WHERE `resource` = ? AND `id` = ?'):format(TABLE),
    { resource, id }
  )
  return row
end

--- NOTE ON THE POINTER
---
--- Which design is live is NOT stored here. It lives in the owning script's
--- own scriptConfig under `designs.active`, keyed by screen, because that
--- genuinely is a setting: two short strings that belong in the change history
--- and ride along with everything else the panel saves.
---
--- dirk_lib cannot read another resource's config from its own vm, and should
--- not want to - so the consumer resolves the id in ITS vm (where
--- `lib.scriptConfig.get('designs')` works) and passes it in. See
--- modules/designs/server.lua.

-- ── writing ─────────────────────────────────────────────────────────────────

--- Store a design. Creates or replaces by (resource, id).
---
--- `data` arrives as a table or a string; it is stored as a string either way,
--- because the tree is opaque to this module and re-encoding it would change
--- the hash for no reason.
local function save(resource, design)
  if type(resource) ~= 'string' or type(design) ~= 'table' or not ensureTable() then return nil end
  local id = type(design.id) == 'string' and design.id or nil
  if not id or id == '' then return nil end

  local data = design.data
  if type(data) == 'table' then data = json.encode(data) end
  if type(data) ~= 'string' then return nil end

  local hash = hashOf(data)
  MySQL.query.await(([[
    INSERT INTO %s (`id`, `resource`, `screen`, `name`, `description`, `thumbnail`, `data`, `hash`, `source`)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      `screen` = VALUES(`screen`), `name` = VALUES(`name`),
      `description` = VALUES(`description`), `thumbnail` = VALUES(`thumbnail`),
      `data` = VALUES(`data`), `hash` = VALUES(`hash`), `source` = VALUES(`source`)
  ]]):format(TABLE), {
    id, resource,
    type(design.screen) == 'string' and design.screen or 'default',
    type(design.name) == 'string' and design.name or 'Untitled',
    type(design.description) == 'string' and design.description or nil,
    type(design.thumbnail) == 'string' and design.thumbnail or nil,
    data, hash,
    type(design.source) == 'string' and design.source or 'local',
  })

  return { id = id, hash = hash }
end

local function delete(resource, id)
  if type(resource) ~= 'string' or type(id) ~= 'string' or not ensureTable() then return false end
  MySQL.query.await(('DELETE FROM %s WHERE `resource` = ? AND `id` = ?'):format(TABLE), { resource, id })
  return true
end

--- Seed the designs a resource ships with.
---
--- The bundled set is the OFFLINE FLOOR: a fresh install has to work with no
--- internet, no account and nothing linked, and the shipped default IS the
--- compatibility promise - it is the screen the script used to draw, so it has
--- to be versioned with the code that renders it.
---
--- An id already in the store is left alone UNLESS it is still marked
--- `bundled` - which it stops being the moment anyone saves over it, because a
--- save from the panel writes `source = 'local'`. That is the whole trick: an
--- owner who edited the default keeps their version through every update, and
--- one who never touched it gets the new one silently.
local function seed(resource, designs)
  if type(resource) ~= 'string' or type(designs) ~= 'table' or not ensureTable() then return 0 end

  local existing = {}
  for _, row in ipairs(list(resource)) do existing[row.id] = row end

  local written = 0
  for _, design in ipairs(designs) do
    local have = design.id and existing[design.id]
    local data = design.data
    if type(data) == 'table' then
      -- Encodable, but the hash then depends on whatever key order this run's
      -- json.encode produced - so the row looks changed on every boot and gets
      -- rewritten forever. A shipped design must arrive as the BYTES it was
      -- exported as (`pnpm designs:export` writes them as strings).
      lib.print.warn(('designs: %s seeded "%s" as a table, not JSON text - it will be rewritten on every boot. Re-run `pnpm designs:export`.'):format(resource, tostring(design.id)))
      data = json.encode(data)
    end
    if type(data) == 'string' then
      local incoming = hashOf(data)
      -- Still `bundled` means nobody has saved over it. The panel's own save
      -- writes `local`, so an edit is recorded by the act of editing rather
      -- than by comparing against a hash we would have to remember shipping.
      local untouched = have and have.source == 'bundled'
      if not have or (untouched and have.hash ~= incoming) then
        design.source = 'bundled'
        if save(resource, design) then written = written + 1 end
      end
    end
  end
  return written
end

-- ── what a client gets ──────────────────────────────────────────────────────

--- One design for a client, or nothing when they already have it.
---
--- `known` is the hash the client is holding. Matching hashes send NOTHING,
--- which is the common case: a returning player on a server whose design has
--- not changed since they last saw it.
local function live(resource, id, known)
  if type(id) ~= 'string' or id == '' then return nil end
  local row = get(resource, id)
  if not row then return nil end
  if known and known == row.hash then return { unchanged = true, hash = row.hash } end
  return { id = row.id, screen = row.screen, hash = row.hash, data = row.data }
end

exports('designs_list', function(resource) return list(resource) end)
exports('designs_all', function(resource) return all(resource) end)
exports('designs_get', function(resource, id) return get(resource, id) end)
exports('designs_save', function(resource, design) return save(resource, design) end)
exports('designs_delete', function(resource, id) return delete(resource, id) end)
exports('designs_seed', function(resource, designs) return seed(resource, designs) end)
exports('designs_live', function(resource, id, known) return live(resource, id, known) end)
exports('designs_hash', function(data) return hashOf(data) end)
