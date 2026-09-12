local scriptName = GetCurrentResourceName()

-- Routes through lib.print.debug, which is gated by lib.settings.debug.
-- Flip dirk_lib's `debug` setting in the script-config UI to enable.
local function debugLog(message)
  lib.print.debug(('[scriptConfig:%s] %s'):format(scriptName, message))
end

-- --------------------------------------------------
-- PATH VISIBILITY
-- --------------------------------------------------

local serverOnlyPaths = {}

--- Paths present in the DB but absent from the schema.
---
--- These are PRESERVED rather than deleted (see smartMerge), and withheld from
--- clients: a key the schema doesn't declare has no declared visibility, and
--- "don't broadcast" is the only safe reading of that.
local undeclaredPaths = {}

local function isPathServerOnly(path)
  for _, locked in ipairs(serverOnlyPaths) do
    if path == locked or path:sub(1, #locked + 1) == locked .. '.' then
      return true
    end
  end
  for _, unknown in ipairs(undeclaredPaths) do
    if path == unknown or path:sub(1, #unknown + 1) == unknown .. '.' then
      return true
    end
  end
  return false
end

local function filterByVisibility(data, basePath, allowServerOnly)
  if type(data) ~= 'table' then return data end

  local out = {}

  for key, value in pairs(data) do
    local path = basePath and (basePath .. '.' .. key) or key
    local locked = isPathServerOnly(path)

    if allowServerOnly or not locked then
      if type(value) == 'table' then
        local sub = filterByVisibility(value, path, allowServerOnly)
        -- Drop a table only when the FILTER emptied it (every child was
        -- server-only). A table that was empty to begin with is a value - an
        -- admin cleared that list - and dropping it made the key vanish from
        -- what every client receives, so the panel and the players fell back
        -- to the shipped default. Delete all seven random rewards, save, and
        -- watch all seven come back: the server held [] the whole time.
        if next(sub) ~= nil or next(value) == nil then
          out[key] = sub
        end
      else
        out[key] = value
      end
    end
  end

  return out
end

-- INVERSE of filterByVisibility(data, _, false): returns ONLY the
-- server-only/locked subtree, stripping every client-visible leaf. This is the
-- "sliver" the admin editor tops up onto its already-cached client-visible
-- view to reconstruct the full config without re-fetching the whole thing.
--
-- A key is KEPT when its path is server-only (the whole subtree below it is
-- locked, so it passes through verbatim) OR when a nested descendant is
-- server-only (recurse; keep only if the filtered child is non-empty). A leaf
-- whose own path is NOT server-only is dropped — that's the client-visible data
-- the editor already holds, and it must never be duplicated here.
local function filterServerOnly(data, basePath)
  if type(data) ~= 'table' then return {} end

  local out = {}

  for key, value in pairs(data) do
    local path = basePath and (basePath .. '.' .. key) or key

    if isPathServerOnly(path) then
      -- This path (and everything under it) is locked → include as-is.
      out[key] = value
    elseif type(value) == 'table' then
      -- Not locked itself, but may contain a locked descendant — recurse and
      -- keep only if the filtered subtree retained anything.
      local sub = filterServerOnly(value, path)
      if next(sub) ~= nil then
        out[key] = sub
      end
    end
    -- else: a client-visible leaf — intentionally dropped from the sliver.
  end

  return out
end

-- --------------------------------------------------
-- VERSION HELPERS
-- --------------------------------------------------

local function parseVersion(v)
  local parts = {}
  for n in (v or '0.0.0'):gmatch('%d+') do parts[#parts + 1] = tonumber(n) end
  return parts
end

local function versionLt(a, b)
  local pa, pb = parseVersion(a), parseVersion(b)
  for i = 1, math.max(#pa, #pb) do
    local ai, bi = pa[i] or 0, pb[i] or 0
    if ai < bi then return true end
    if ai > bi then return false end
  end
  return false
end

local function runMigrations(data, fromVersion, toVersion, migrations)
  if not migrations or not next(migrations) then return data end
  local steps = {}
  for version in pairs(migrations) do
    if versionLt(fromVersion, version) and not versionLt(toVersion, version) then
      steps[#steps + 1] = version
    end
  end
  table.sort(steps, versionLt)
  for _, version in ipairs(steps) do
    lib.print.info(('Running migration to %s for %s'):format(version, scriptName))
    data = migrations[version](data)
  end
  return data
end

-- --------------------------------------------------
-- SCHEMA UTILITIES
-- --------------------------------------------------

-- Hoisted forward declaration. Assigned in registerScriptConfig (search
-- 'settingsSchema = schema'). Several functions above the assignment site
-- (collectChangedLeaves, etc.) reference this — without the early local,
-- they'd close over an undefined global and always see nil, defeating the
-- implicit-default suppression check in the diff path.
local settingsSchema = nil

-- Recursively extracts default values from a JSON Schema node.
-- • Objects without an explicit 'default': recurse into 'properties'
-- • Everything else (arrays, primitives, objects with explicit 'default'): return schema.default
local function extractDefaults(schema)
  if type(schema) ~= 'table' then return nil end
  if schema['default'] ~= nil then return schema['default'] end
  if schema.type == 'object' and schema.properties then
    local result = {}
    for k, propSchema in pairs(schema.properties) do
      local val = extractDefaults(propSchema)
      if val ~= nil then result[k] = val end
    end
    return next(result) and result or nil
  end
  return nil
end

-- Detected-from-convar defaults (`x-autoDefault`). Shared with dirk_lib's
-- Script Studio callback so the panel shows the same default the engine holds.
local resolveAutoDefaults = require '@dirk_lib.src.autoDefaults'

-- Collects all dot-paths marked with 'x-serverOnly' in the schema.
local function extractServerOnly(schema, path, result)
  result = result or {}
  if type(schema) ~= 'table' then return result end
  if schema['x-serverOnly'] and path then
    result[#result + 1] = path
  end
  if schema.properties then
    for k, propSchema in pairs(schema.properties) do
      extractServerOnly(propSchema, path and (path .. '.' .. k) or k, result)
    end
  end
  return result
end

-- Collects all 'x-renamedFrom' mappings: { [newDotPath] = oldDotPath }
local function extractRenames(schema, path, result)
  result = result or {}
  if type(schema) ~= 'table' then return result end
  if schema['x-renamedFrom'] and path then
    result[path] = schema['x-renamedFrom']
  end
  if schema.properties then
    for k, propSchema in pairs(schema.properties) do
      extractRenames(propSchema, path and (path .. '.' .. k) or k, result)
    end
  end
  return result
end

-- Collects all 'x-adoptFromConsumers' paths: settings that used to live in a
-- consumer's own config and have since moved into the shared one.
local function extractAdoptions(schema, path, result)
  result = result or {}
  if type(schema) ~= 'table' then return result end
  if schema['x-adoptFromConsumers'] and path then
    result[#result + 1] = path
  end
  if schema.properties then
    for k, propSchema in pairs(schema.properties) do
      extractAdoptions(propSchema, path and (path .. '.' .. k) or k, result)
    end
  end
  return result
end

local function getNestedValue(tbl, dotPath)
  local current = tbl
  for segment in dotPath:gmatch('[^.]+') do
    if type(current) ~= 'table' then return nil end
    current = current[segment]
  end
  return current
end

local function getSchemaNode(schema, dotPath)
  local current = schema

  for segment in dotPath:gmatch('[^.]+') do
    if type(current) ~= 'table' then return nil end

    -- Arrays in JSON Schema describe per-element shape via `items`, not
    -- `properties`. A path segment that lands on an array node represents
    -- an array index (or `x-arrayKey` value) — there's no per-index schema,
    -- so descend into `items` and consume the segment.
    --
    -- Without this, any path through an array (e.g. `labs.1.access.public`)
    -- returned nil and the implicit-default check in collectChangedLeaves
    -- couldn't see the schema default — producing phantom "undefined → false"
    -- change-log entries every time you saved an array item.
    if current.type == 'array' then
      if type(current.items) ~= 'table' then return nil end
      current = current.items
    else
      if type(current.properties) ~= 'table' then return nil end
      current = current.properties[segment]
    end
  end

  return current
end

local function getDefaultForPath(schema, dotPath)
  local node = getSchemaNode(schema, dotPath)
  if type(node) ~= 'table' then return nil end
  return extractDefaults(node)
end

local function setNestedValue(tbl, dotPath, value)
  local segments = {}
  for s in dotPath:gmatch('[^.]+') do segments[#segments + 1] = s end
  local current = tbl
  for i = 1, #segments - 1 do
    local s = segments[i]
    if type(current[s]) ~= 'table' then current[s] = {} end
    current = current[s]
  end
  current[segments[#segments]] = value
end

-- Copies values from renamed old paths to new paths then clears the old paths.
local function applyRenames(data, renames)
  for newPath, oldPath in pairs(renames) do
    local val = getNestedValue(data, oldPath)
    if val ~= nil then
      setNestedValue(data, newPath, val)
      setNestedValue(data, oldPath, nil)
      lib.print.info(('scriptConfig [%s]: migrated key "%s" → "%s"'):format(scriptName, oldPath, newPath))
    end
  end
  return data
end

-- --------------------------------------------------
-- SMART MERGE
-- --------------------------------------------------

-- True for tables with sequential integer keys 1..N (Lua array convention).
-- Used to identify nested arrays when no JSON-Schema info is available so
-- we don't accidentally object-merge them by index — that's how user-deleted
-- entries silently come back from defaults.
local function isArrayLike(t)
  if type(t) ~= 'table' then return false end
  local n = #t
  if n == 0 then return next(t) == nil end
  for k in pairs(t) do
    if type(k) ~= 'number' or k < 1 or k > n or math.floor(k) ~= k then
      return false
    end
  end
  return true
end

-- Schema-aware merge of defaultData (source of truth) and dbData:
-- • New keys in defaults   → filled from defaults
-- • Keys removed in defaults → pruned from result
-- • Type mismatch            → defaults wins, warning logged
-- • Arrays with 'x-arrayKey' → merged by identity key; missing entries added, removed entries pruned
local function smartMerge(defaultData, dbData, schemaNode, _path)
  _path = _path or ''
  if type(defaultData) ~= 'table' or type(dbData) ~= 'table' then
    return dbData
  end
  local result = {}

  -- DB keys the schema doesn't declare are KEPT, not dropped.
  --
  -- They used to be deleted on every load, which meant a schema that had
  -- fallen behind silently destroyed real data — whole arrays gone on a
  -- restart, with nothing but a debug line to say so. A stale key costs a few
  -- bytes; a deleted one costs the data.
  --
  -- They're recorded so they can be withheld from clients: undeclared means no
  -- declared visibility, and the safe reading of that is "server-side only".
  -- If the schema regains the key later it simply starts being used again.
  for k, dbVal in pairs(dbData) do
    if defaultData[k] == nil then
      local fullPath = _path ~= '' and (_path .. '.' .. k) or k
      debugLog(('KEEP key "%s" — in DB but not in schema defaults; preserved, server-side only'):format(fullPath))
      undeclaredPaths[#undeclaredPaths + 1] = fullPath
      result[k] = dbVal
    end
  end

  for k, defaultVal in pairs(defaultData) do
    local dbVal = dbData[k]
    local childSchema = schemaNode and schemaNode.properties and schemaNode.properties[k]
    local fullPath = _path ~= '' and (_path .. '.' .. k) or k
    if dbVal == nil then
      debugLog(('FILL key "%s" — not in DB, using schema default'):format(fullPath))
      result[k] = defaultVal
    elseif type(defaultVal) == 'table' and type(dbVal) == 'table' then
      local mergeKey = childSchema and childSchema['x-arrayKey']
      local isArraySchema = childSchema and childSchema.type == 'array'
      -- Without explicit JSON-Schema info, infer arrays from structure so
      -- nested user-managed arrays (e.g. store.locations inside an
      -- x-arrayKey'd store) treat the DB as source of truth instead of
      -- being object-merged by index — that's how user-deleted entries
      -- come back from defaults silently.
      local looksLikeArray = (not childSchema) and (isArrayLike(dbVal) or isArrayLike(defaultVal))
      if (isArraySchema and not mergeKey) or looksLikeArray then
        -- Plain array (schema'd or inferred): DB is the source of truth.
        result[k] = dbVal
      elseif mergeKey then
        -- Iterate the DB array — it's the source of truth for which items exist
        -- (user can delete seed items without them being re-added on every load).
        -- For each DB item, if a default with the same key exists, recursively
        -- merge so newly-added schema fields show up but nested arrays inside
        -- (e.g. store.locations) follow the "DB wins" rule above. DB-only items
        -- (no default counterpart) pass through verbatim. Net-new seed items in
        -- defaults are NOT auto-added here — that's a migration concern.
        local itemSchema = childSchema and childSchema.items
        local defaultIndex = {}
        for _, item in ipairs(defaultVal) do
          if item[mergeKey] then defaultIndex[item[mergeKey]] = item end
        end
        result[k] = {}
        for _, dbItem in ipairs(dbVal) do
          local key = dbItem[mergeKey]
          if key then
            local defaultItem = defaultIndex[key]
            if defaultItem then
              result[k][#result[k] + 1] = smartMerge(defaultItem, dbItem, itemSchema, fullPath .. '[' .. tostring(key) .. ']')
            else
              result[k][#result[k] + 1] = dbItem
            end
          else
            result[k][#result[k] + 1] = dbItem
          end
        end
      else
        result[k] = smartMerge(defaultVal, dbVal, childSchema, fullPath)
      end
    else
      if type(defaultVal) == type(dbVal) then
        result[k] = dbVal
      else
        debugLog(('RESET key "%s" — type mismatch (default: %s, stored: %s), forcing default'):format(fullPath, type(defaultVal), type(dbVal)))
        lib.print.warn(('scriptConfig [%s]: type mismatch for key "%s" (default: %s, stored: %s) — resetting to default.'):format(scriptName, k, type(defaultVal), type(dbVal)))
        result[k] = defaultVal
      end
    end
  end
  return result
end

local function isEqualValue(a, b)
  if type(a) ~= type(b) then return false end
  if type(a) ~= 'table' then return a == b end
  return lib.table.compare(a, b) and lib.table.compare(b, a)
end

-- Records every leaf under a removed subtree as {path, old, new=nil}. Used by
-- collectChangedLeaves' removal pass below. Empty tables record the container
-- path itself so a cleared-to-empty list still registers as a change.
-- ── Override-row storage ──────────────────────────────────────────────────
--
-- Values live as ONE ROW PER OVERRIDDEN PATH rather than one blob per script.
--
-- The blob pinned every value the moment a server saved anything: smartMerge
-- sees a stored value and keeps it, so a better default shipped in an update
-- never reached an existing install. Storing only what an admin deliberately
-- changed means untouched settings track the code, which is the whole point.
--
-- It also makes deletion expressible. `collectChangedLeaves` walks the NEW
-- config, so a removed value has no leaf to find - the "can't delete the last
-- store" report. Under rows, removing an override is a DELETE.
--
-- GRANULARITY RULE: a row is written at the SHALLOWEST path whose value
-- differs from the default, and the walk never descends into arrays. So
-- `basic.debug` is its own row, and a fish edit stores the whole `fish` array
-- as one row. Per-element rows would be finer, but our arrays merge by
-- `x-arrayKey` and their indices shift - a row keyed `fish.12.biteChance`
-- silently retargets the moment someone deletes fish #3.

-- Hoisted above the override diff, which compares canonical JSON rather than
-- raw values: two doubles can differ in their last bits yet serialise to the
-- same bytes, and a difference that cannot be stored is not an override.

-- Canonical JSON string with sorted keys so the hash is stable across restarts.
-- Lua's pairs() iteration order is non-deterministic, so json.encode(tbl) can
-- produce different strings for the same data on different runs.  This function
-- always walks object keys in sorted order, giving a deterministic output.
local function canonicalJson(val)
  if val == nil then return 'null' end
  local t = type(val)
  if t == 'boolean' then return val and 'true' or 'false' end
  if t == 'number'  then return tostring(val) end
  if t == 'string'  then return json.encode(val) end -- handles escaping
  if t ~= 'table'   then return 'null' end

  -- Detect array vs object (same heuristic as json.encode: sequential integer keys from 1)
  local isArray = true
  local n = #val
  if n == 0 then
    -- Could be empty array or empty object — check for any key
    if next(val) ~= nil then isArray = false end
  else
    for k in pairs(val) do
      if type(k) ~= 'number' or k < 1 or k > n or math.floor(k) ~= k then
        isArray = false
        break
      end
    end
  end

  if isArray then
    local parts = {}
    for i = 1, n do
      parts[i] = canonicalJson(val[i])
    end
    return '[' .. table.concat(parts, ',') .. ']'
  else
    local keys = {}
    local keyMap = {} -- sorted string -> original key (preserves type for table lookup)
    for k in pairs(val) do
      local sk = tostring(k)
      keys[#keys + 1] = sk
      keyMap[sk] = k
    end
    table.sort(keys)
    local parts = {}
    for i = 1, #keys do
      local sk = keys[i]
      parts[i] = json.encode(sk) .. ':' .. canonicalJson(val[keyMap[sk]])
    end
    return '{' .. table.concat(parts, ',') .. '}'
  end
end

local OVERRIDES_TABLE = 'dirk_scriptConfig_overrides'

local function ensureOverridesTable()
  if GlobalState.dirk_scriptConfigOverridesReady then return true end

  if not pcall(MySQL.scalar.await, ('SELECT 1 FROM %s LIMIT 1'):format(OVERRIDES_TABLE)) then
    local ok, createErr = pcall(MySQL.query.await, ([[
      CREATE TABLE IF NOT EXISTS `%s` (
        `script`     VARCHAR(50)  NOT NULL,
        `path`       VARCHAR(191) NOT NULL,
        `value`      LONGTEXT     DEFAULT NULL,
        `updated_by` LONGTEXT     DEFAULT NULL,
        `updated_at` timestamp    NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
        PRIMARY KEY (`script`, `path`)
      )
    ]]):format(OVERRIDES_TABLE))

    -- Re-probe rather than trusting the pcall: a concurrent consumer may have
    -- created it a moment ago, which is a perfectly good outcome.
    if not pcall(MySQL.scalar.await, ('SELECT 1 FROM %s LIMIT 1'):format(OVERRIDES_TABLE)) then
      lib.print.error(('scriptConfig: could not create `%s`: %s'):format(OVERRIDES_TABLE, tostring(createErr)))
      return false
    end
  end

  GlobalState.dirk_scriptConfigOverridesReady = true
  return true
end

--- The first leaf where two values disagree, as `path = a vs b`.
--- Diagnostic only: an override row says WHAT differs, never why, and on a
--- 13KB array "zones differs" is not an answer anyone can act on.
local function firstDifference(a, b, path)
  if type(a) ~= type(b) then
    return ('%s: %s vs %s'):format(path ~= '' and path or '<root>', type(a), type(b))
  end
  if type(a) ~= 'table' then
    if a == b then return nil end
    return ('%s: %s vs %s'):format(path ~= '' and path or '<root>', tostring(a), tostring(b))
  end
  local seen = {}
  for k in pairs(a) do seen[k] = true end
  for k in pairs(b) do seen[k] = true end
  for k in pairs(seen) do
    local child = path ~= '' and (path .. '.' .. tostring(k)) or tostring(k)
    local diff = firstDifference(a[k], b[k], child)
    if diff then return diff end
  end
  return nil
end

--- Every path where `data` differs from `defaults`, shallowest-first.
--- Arrays are never descended into - see the granularity rule above.
local function collectOverridePaths(data, defaults, path, out)
  out = out or {}

  if type(data) ~= 'table' or type(defaults) ~= 'table' or isArrayLike(data) or isArrayLike(defaults) then
    -- Compare what would be STORED, not the raw values. A polygon coordinate
    -- that has been through the DB round-trips to a double differing in its
    -- last bits, so `4267.0837770711` compared unequal to `4267.0837770711`
    -- and pinned fishing's entire 13KB `zones` array as an override it never
    -- was - which would have stopped improved default zones ever reaching a
    -- server again. A difference that cannot be serialised is not a difference.
    if canonicalJson(data) ~= canonicalJson(defaults) then
      out[#out + 1] = path
      debugLog(('override "%s" — first difference: %s'):format(
        path ~= '' and path or '<root>',
        firstDifference(data, defaults, path) or 'none found (equal by value?)'))
    end
    return out
  end

  -- keys present in either side; a key the defaults dropped is still an
  -- override until someone prunes it
  local seen = {}
  for key in pairs(data) do seen[key] = true end
  for key in pairs(defaults) do seen[key] = true end

  for key in pairs(seen) do
    local childPath = path ~= '' and (path .. '.' .. key) or key
    collectOverridePaths(data[key], defaults[key], childPath, out)
  end

  return out
end

--- Read this script's overrides back into the nested shape the rest of the
--- pipeline already expects, so renames / migrations / smartMerge are unchanged.
local function loadOverrides(scriptName)
  local rows = MySQL.query.await(
    ('SELECT path, value FROM %s WHERE script = ?'):format(OVERRIDES_TABLE),
    { scriptName }
  ) or {}

  local data = {}
  for i = 1, #rows do
    local row = rows[i]
    local ok, decoded = pcall(json.decode, row.value or 'null')
    if ok then
      setNestedValue(data, row.path, decoded)
    else
      lib.print.warn(('scriptConfig [%s]: override `%s` is not valid JSON, ignoring'):format(scriptName, row.path))
    end
  end
  return data, #rows
end

--- Take over a value a CONSUMER already had, for a setting that has since
--- moved into the shared config.
---
--- `weightUnit` and `distanceUnit` used to live in dirk_fishing. Moving them up
--- into dirk_lib without this would quietly reset every server that had chosen
--- kilograms back to pounds: the value is still in the database, just filed
--- under a script that no longer declares it, so nothing would error and the
--- units would simply be wrong one restart later.
---
--- Only fills a path this script has NOT set, and MOVES the value rather than
--- copying it: the consumer's rows are deleted once adopted.
---
--- That last part is what makes this one-time, and it is not optional. An
--- override row only exists for a value that DIFFERS from the default, so an
--- admin who deliberately picks the default has no row - indistinguishable
--- from never having chosen. Copy instead of move and the sequence is:
--- adopt kg, admin sets lb, lb equals the default so its row is dropped, next
--- restart re-adopts kg. Their choice silently reverts on every boot and reads
--- as "the setting will not save". Moving leaves nothing to re-adopt.
--- Does `resource`'s own schema.json still describe `path`? Read from disk,
--- not from a running instance: the consumer may not have started yet when
--- dirk_lib boots, and an unstarted script still owns its rows.
local function consumerDeclaresPath(resource, path)
  local raw = LoadResourceFile(resource, 'schema.json')
  if not raw then return false end
  local ok, schema = pcall(json.decode, raw)
  if not ok or type(schema) ~= 'table' then return false end

  local node = schema
  for segment in tostring(path):gmatch('[^.]+') do
    local props = type(node) == 'table' and node.properties
    if type(props) ~= 'table' or props[segment] == nil then return false end
    node = props[segment]
  end
  return true
end

local function adoptFromConsumers(scriptName, data, paths)
  if not paths or #paths == 0 then return 0 end
  local adopted = 0

  for i = 1, #paths do
    local path = paths[i]
    -- Already answered here. Nothing to inherit.
    if getNestedValue(data, path) == nil then
      local rows = MySQL.query.await(
        ('SELECT script, value FROM %s WHERE path = ? AND script != ?'):format(OVERRIDES_TABLE),
        { path, scriptName }
      ) or {}

      -- Count the distinct answers rather than taking the first row: two
      -- scripts CAN disagree, and picking by row order would make which one
      -- wins depend on insertion order.
      local tally, best, bestCount = {}, nil, 0
      for j = 1, #rows do
        local raw = rows[j].value
        if raw then
          tally[raw] = (tally[raw] or 0) + 1
          if tally[raw] > bestCount then best, bestCount = raw, tally[raw] end
        end
      end

      if best then
        local ok, decoded = pcall(json.decode, best)
        if ok and decoded ~= nil then
          setNestedValue(data, path, decoded)
          adopted = adopted + 1

          local sources = {}
          for j = 1, #rows do sources[#sources + 1] = rows[j].script end

          -- Move, not copy - but only from a script that has stopped asking.
          -- A consumer whose schema STILL declares this path is an older build
          -- that reads its own row, and taking the row away from it resets that
          -- script to its default. That is how updating dirk_lib on its own
          -- would have turned every kilogram server back to pounds until
          -- fishing was updated too. So: copy now, and the row moves the first
          -- time this boots after the consumer has dropped the key.
          -- (The "already answered" check above means this never re-adopts, so
          -- a row left behind cannot overrule the admin later.)
          local stillDeclared = {}
          for j = 1, #rows do
            if consumerDeclaresPath(rows[j].script, path) then
              stillDeclared[#stillDeclared + 1] = rows[j].script
            end
          end

          if #stillDeclared == 0 then
            MySQL.query.await(
              ('DELETE FROM %s WHERE path = ? AND script != ?'):format(OVERRIDES_TABLE),
              { path, scriptName }
            )
            lib.print.info(('scriptConfig [%s]: adopted `%s` = %s from %s (moved, not copied)')
              :format(scriptName, path, best, table.concat(sources, ', ')))
          else
            lib.print.info(('scriptConfig [%s]: adopted `%s` = %s from %s (copied - %s still declares it and keeps its own row until updated)')
              :format(scriptName, path, best, table.concat(sources, ', '), table.concat(stillDeclared, ', ')))
          end

          -- Disagreement is worth saying out loud - the winner is a guess, and
          -- an admin who sees this can settle it in one click.
          local distinct = 0
          for _ in pairs(tally) do distinct = distinct + 1 end
          if distinct > 1 then
            lib.print.warn(('scriptConfig [%s]: `%s` disagreed across scripts, took %s (%d of %d)')
              :format(scriptName, path, best, bestCount, #rows))
          end
        end
      end
    end
  end

  return adopted
end

--- One-time move of a legacy whole-blob row into override rows.
---
--- Only paths that DIFFER from the shipped defaults become rows - copying the
--- blob verbatim would re-pin every value and throw away the reason for doing
--- this. The blob is deliberately left in place: it is the rollback, and this
--- runs once because the presence of rows is what suppresses it.
local function migrateBlobToOverrides(scriptName, blob, defaults, editor)
  if type(blob) ~= 'table' or not next(blob) then return 0 end

  local paths = collectOverridePaths(blob, defaults, '', {})
  if #paths == 0 then
    lib.print.info(('scriptConfig [%s]: stored config matches defaults, nothing to migrate.'):format(scriptName))
    return 0
  end

  local inserts = {}
  for i = 1, #paths do
    local path = paths[i]
    inserts[#inserts + 1] = {
      scriptName,
      path,
      json.encode(getNestedValue(blob, path)),
      editor,
    }
  end

  -- Upsert, not insert. A plain INSERT threw `Duplicate entry ... for key
  -- 'PRIMARY'` the moment any (script, path) row already existed - which it
  -- does after a previous attempt died partway, or when a second consumer
  -- booting in the same batch beat this one to a shared path. That throw
  -- killed the whole init, and the presence of the rows it did manage to write
  -- then suppressed the migration on every later boot: permanently half a
  -- config, and nothing but "Callback getScriptConfig timed out" to show for it.
  MySQL.prepare.await(
    ([[INSERT INTO %s (script, path, value, updated_by) VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE value = VALUES(value), updated_by = VALUES(updated_by)]]):format(OVERRIDES_TABLE),
    inserts
  )

  lib.print.info(('scriptConfig [%s]: migrated %d overridden path(s) from the legacy blob.'):format(scriptName, #paths))
  -- Say WHY each one is an override. A migration is one-time and this is the
  -- only moment anyone can check that a 13KB array really was edited rather
  -- than being flagged by a comparison quirk.
  for i = 1, #paths do
    lib.print.info(('  %s — %s'):format(
      paths[i],
      firstDifference(getNestedValue(blob, paths[i]), getNestedValue(defaults, paths[i]), paths[i]) or 'no leaf difference found'))
  end
  return #paths
end

--- Write the current config as override rows: upsert what differs from the
--- defaults, DELETE the rows for anything that no longer does.
---
--- The delete half is what makes "revert to default" and "remove the last list
--- item" actually persist.
local function writeOverrides(scriptName, config, defaults, editor)
  local paths = collectOverridePaths(config, defaults, '', {})

  local keep = {}
  local upserts = {}
  for i = 1, #paths do
    local path = paths[i]
    keep[path] = true
    upserts[#upserts + 1] = {
      scriptName,
      path,
      json.encode(getNestedValue(config, path)),
      editor,
    }
  end

  if #upserts > 0 then
    MySQL.prepare.await(
      ([[INSERT INTO %s (script, path, value, updated_by) VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE value = VALUES(value), updated_by = VALUES(updated_by)]]):format(OVERRIDES_TABLE),
      upserts
    )
  end

  -- anything stored that is no longer an override is back at its default
  local existing = MySQL.query.await(
    ('SELECT path FROM %s WHERE script = ?'):format(OVERRIDES_TABLE),
    { scriptName }
  ) or {}

  local drop = {}
  for i = 1, #existing do
    local path = existing[i].path
    if not keep[path] then drop[#drop + 1] = { scriptName, path } end
  end

  if #drop > 0 then
    MySQL.prepare.await(
      ('DELETE FROM %s WHERE script = ? AND path = ?'):format(OVERRIDES_TABLE),
      drop
    )
  end

  return #upserts, #drop
end

--- Overrides whose path the schema no longer declares.
---
--- Reported, never removed on their own: a rename that forgot `x-renamedFrom`
--- would otherwise destroy the value silently. The panel offers a prune button
--- for when they really are dead.
local function unknownOverridePaths(scriptName, schema)
  local rows = MySQL.query.await(
    ('SELECT path FROM %s WHERE script = ?'):format(OVERRIDES_TABLE),
    { scriptName }
  ) or {}

  local unknown = {}
  for i = 1, #rows do
    local path = rows[i].path
    if not getSchemaNode(schema, path) then unknown[#unknown + 1] = path end
  end
  return unknown
end

local function collectRemovedLeaves(oldValue, path, out)
  if type(oldValue) ~= 'table' or next(oldValue) == nil then
    out[#out + 1] = { path = path, old = oldValue, new = nil }
    return out
  end
  for key, v in pairs(oldValue) do
    collectRemovedLeaves(v, path .. '.' .. key, out)
  end
  return out
end

-- The default for a leaf inside an array row, taken from the array's own
-- `default` list.
--
-- Rows are matched by `x-arrayKey` where the array declares one, falling back
-- to position. Index is not reliable on its own: a customer who deletes a row
-- shifts every row after it, so index 3 in a saved config is not necessarily
-- index 3 in the defaults.
local function defaultFromRow(dotPath)
  if not settingsSchema then return nil end

  local segments = {}
  for seg in dotPath:gmatch('[^.]+') do segments[#segments + 1] = seg end
  if #segments < 3 then return nil end

  -- Walk down looking for the LAST array crossed, remembering where it was.
  local node, arrayNode, arrayAt = settingsSchema, nil, nil
  for i = 1, #segments do
    if type(node) ~= 'table' then return nil end
    if node.type == 'array' then
      arrayNode, arrayAt = node, i          -- segments[i] indexes this array
      node = node.items
    else
      if type(node.properties) ~= 'table' then return nil end
      node = node.properties[segments[i]]
      if node == nil then return nil end
    end
  end
  if not arrayNode or type(arrayNode.default) ~= 'table' then return nil end

  local rows = arrayNode.default
  local index = tonumber(segments[arrayAt])
  if not index then return nil end

  local row = rows[index]
  local key = arrayNode['x-arrayKey']
  if key then
    -- Prefer identity over position when we can resolve the live row's key.
    local liveRow = getNestedValue(scriptConfig, table.concat(segments, '.', 1, arrayAt))
    local wanted = type(liveRow) == 'table' and liveRow[key] or nil
    if wanted ~= nil then
      row = nil
      for i = 1, #rows do
        if type(rows[i]) == 'table' and rows[i][key] == wanted then row = rows[i] break end
      end
    end
  end
  if type(row) ~= 'table' then return nil end

  -- Everything after the index is the path to the leaf within the row.
  local value = row
  for i = arrayAt + 1, #segments do
    if type(value) ~= 'table' then return nil end
    value = value[segments[i]]
  end
  return value
end

local function collectChangedLeaves(partial, previous, path, out)
  if type(partial) ~= 'table' then return out end
  out = out or {}

  for key, value in pairs(partial) do
    local nextPath = path and (path .. '.' .. key) or key
    local oldValue = type(previous) == 'table' and previous[key] or nil

    if type(value) == 'table' then
      collectChangedLeaves(value, oldValue, nextPath, out)
    else
      -- NOT `schema and lookup(...) or nil`: that idiom collapses on `false`.
      -- Every boolean whose default is false came back nil, so writing false
      -- to one looked like a change from nothing, and saving anything at all
      -- logged "debug: default -> false" alongside whatever you actually
      -- edited. Half the booleans in every schema default to false.
      local defaultValue
      if settingsSchema then defaultValue = getDefaultForPath(settingsSchema, nextPath) end

      -- A field inside an array row usually has no `default` of its own - the
      -- shipped value lives in the array's default ROW, not on the property.
      -- Without this, saving any row logged every such field as
      -- "default -> <value>" even when the value was exactly what shipped:
      -- baitDig.tools.3.useScenario read as "default -> off" when off IS the
      -- default. 116 fields in fishing alone have no property-level default.
      if defaultValue == nil then
        defaultValue = defaultFromRow(nextPath)
      end
      local isImplicitDefault = oldValue == nil and defaultValue ~= nil and isEqualValue(defaultValue, value)

      if not isImplicitDefault and not isEqualValue(oldValue, value) then
        out[#out + 1] = {
          path = nextPath,
          old = oldValue,
          new = value,
        }
      end
    end
  end

  -- Removal-aware pass: a key/element present in `previous` but absent from the
  -- new config is a deletion. Without this a pure removal (e.g. clearing the
  -- last item of a list) yields zero changed leaves and is silently dropped by
  -- setScriptConfig's no-change early-return — never persisted/broadcast/logged,
  -- so it reverts on restart.
  if type(previous) == 'table' then
    for key, oldValue in pairs(previous) do
      if partial[key] == nil then
        collectRemovedLeaves(oldValue, path and (path .. '.' .. key) or key, out)
      end
    end
  end

  return out
end

local function getPlayerIdentifier(src)
  local identifiers = GetPlayerIdentifiers(src)
  for _, prefix in ipairs({ 'license:', 'fivem:', 'discord:', 'steam:' }) do
    for _, id in ipairs(identifiers) do
      if id:sub(1, #prefix) == prefix then
        return id
      end
    end
  end
  return identifiers[1]
end

local function buildEditorMeta(src)
  if not src or src == 0 then
    return {
      source = 0,
      name = 'console',
      identifier = 'console',
    }
  end

  return {
    source = src,
    name = GetPlayerName(src) or ('player:%s'):format(src),
    identifier = getPlayerIdentifier(src),
  }
end

-- --------------------------------------------------
-- CONTENT HASH
-- --------------------------------------------------


-- Produces a stable, content-derived 31-bit positive integer from a table.
-- Using a hash instead of an incrementing counter means server resets and
-- stale KVP data can never cause spurious VersionConflict errors — the
-- same settings always produce the same version value.
local function hashSettings(data)
  local s = canonicalJson(data)
  local h = 5381
  for i = 1, #s do
    h = (h * 33 + string.byte(s, i)) % 2147483647
  end
  return h == 0 and 1 or h  -- keep non-zero; 0 is used as the "unset" sentinel
end

-- --------------------------------------------------
-- STATE
-- --------------------------------------------------

local defaults = {}
-- settingsSchema is declared early at the top of the SCHEMA UTILITIES
-- block so it's visible to functions defined above this point (notably
-- collectChangedLeaves). Don't re-declare here — a second `local` would
-- shadow the hoisted one and bring back the always-nil bug.
scriptConfig = nil
local client_version = 0
local currentVer     = '0.0.0'
local canEditScript  = function() return true end
local canViewScript  = function() return true end
local changeLog = {}
local lastEditorMeta = nil
local scriptConfigWatchers = {}
local nextScriptConfigWatcherId = 0
local CHANGE_LOG_MAX = 100
local lastPersistedHash = 0
-- Cached client-visible view: filterByVisibility(scriptConfig, nil, false).
-- This full filtered tree only changes when scriptConfig changes (boot +
-- setScriptConfig), so we cache it instead of re-walking the tree on every
-- hydrating client. Refreshed UNCONDITIONALLY after any config change.
local clientVisibleView = nil

-- --------------------------------------------------
-- PER-SCRIPT ACCESS OVERRIDES (push to dirk_lib)
-- --------------------------------------------------
-- A consumer can declare an `access` block in its own schema.json
-- ({ groups = string[], identifiers = string[] }). We PUSH the current value
-- to dirk_lib so its access check (canEditScriptConfig) can grant edit rights
-- to those groups/identifiers WITHOUT any manual wiring in the consumer beyond
-- declaring the block. This module runs in the consumer's VM, so
-- GetCurrentResourceName() is the consumer.
--
-- This now includes dirk_lib's OWN config: with the central overrides removed,
-- dirk_lib is gated like any other resource (master + its own pushed `access`
-- block), so it pushes its access block too.
local EMPTY_ACCESS = { groups = {}, identifiers = {} }

local function pushAccessOverrides()
  local access = (type(scriptConfig) == 'table' and type(scriptConfig.access) == 'table')
    and scriptConfig.access or EMPTY_ACCESS

  -- pcall: dirk_lib's export may not exist yet at first boot (resource order),
  -- or dirk_lib may be reloading. A failed push is retried by the caller.
  local ok = pcall(function()
    exports.dirk_lib:registerScriptConfigOverrides(scriptName, access)
  end)
  return ok
end

-- Push, retrying briefly if dirk_lib's export isn't ready yet. Fire-and-forget
-- thread so callers (config load / change) never block on it.
local function pushAccessOverridesWithRetry()
  if scriptName == 'dirk_lib' then return end
  CreateThread(function()
    for _ = 1, 20 do
      if pushAccessOverrides() then return end
      Wait(500)
    end
    debugLog('failed to push access overrides to dirk_lib after retries')
  end)
end

local function persistPayloadHash()
  return hashSettings({
    data = scriptConfig,
    client_version = client_version,
    resource_version = currentVer,
    change_log = changeLog,
    last_editor = lastEditorMeta,
  })
end

local function cloneValue(value)
  if type(value) ~= 'table' then return value end
  return lib.table.deepClone(value)
end

local function getValueAtPath(data, path)
  if path == '*' or path == '' or path == nil then
    return data
  end

  local current = data
  for segment in path:gmatch('[^.]+') do
    if type(current) ~= 'table' then return nil end
    current = current[segment]
  end

  return current
end

local function pathsOverlap(watchPath, changedPath)
  if watchPath == '*' then return true end
  if watchPath == changedPath then return true end
  if not changedPath or changedPath == '' then return false end

  return watchPath:sub(1, #changedPath + 1) == changedPath .. '.'
    or changedPath:sub(1, #watchPath + 1) == watchPath .. '.'
end

local function notifyWatcher(watcher, current, previous, changedPaths, source, forceInitial)
  if forceInitial then
    if not watcher.immediate or watcher.initialDelivered then
      return false
    end
  elseif #changedPaths == 0 then
    return false
  end

  local newValue = cloneValue(getValueAtPath(current, watcher.path))
  local oldValue = cloneValue(getValueAtPath(previous, watcher.path))

  -- Never hand a watcher nil for a path that exists in the schema.
  --
  -- The idiom every consumer uses is `on('basic', function(new) basic = new or
  -- {} end)`, so one nil delivery replaces a live snapshot with an empty table
  -- and every read off it is nil from then on. dirk_multichar spent an
  -- afternoon calling `lib.table.includes(nil, ...)` for exactly this reason,
  -- after dirk_lib was restarted underneath it.
  --
  -- A momentarily unavailable config is not news a watcher can act on. Staying
  -- quiet leaves the consumer holding the last good value, which is the only
  -- useful thing it could do anyway.
  if newValue == nil and getValueAtPath(defaults, watcher.path) ~= nil then
    return false
  end

  if not forceInitial and watcher.path ~= '*' and isEqualValue(oldValue, newValue) then
    return false
  end

  local ok, err = pcall(watcher.cb, newValue, oldValue, {
    path = watcher.path,
    changedPaths = changedPaths,
    source = source,
    current = current,
    previous = previous,
  })

  if not ok then
    lib.print.error(('[scriptConfig:%s] watcher for "%s" failed: %s'):format(scriptName, watcher.path, tostring(err)))
  end

  watcher.initialDelivered = true
  return watcher.once == true
end

local function dispatchScriptConfigWatchers(current, previous, changedLeaves, source, forceInitial)
  if not next(scriptConfigWatchers) then return end

  for watcherId, watcher in pairs(scriptConfigWatchers) do
    local changedPaths = {}

    if not forceInitial then
      for i = 1, #(changedLeaves or {}) do
        local changedPath = changedLeaves[i].path
        if pathsOverlap(watcher.path, changedPath) then
          changedPaths[#changedPaths + 1] = changedPath
        end
      end
    end

    if notifyWatcher(watcher, current, previous, changedPaths, source, forceInitial) then
      scriptConfigWatchers[watcherId] = nil
    end
  end
end

local function onScriptConfig(path, cb, options)
  assert(type(path) == 'string' and path ~= '', 'scriptConfig.on requires a non-empty path string')
  assert(type(cb) == 'function', 'scriptConfig.on requires a callback function')

  options = options or {}
  nextScriptConfigWatcherId = nextScriptConfigWatcherId + 1

  local watcher = {
    id = nextScriptConfigWatcherId,
    path = path,
    cb = cb,
    once = options.once == true,
    immediate = options.immediate ~= false,
    initialDelivered = false,
  }

  scriptConfigWatchers[watcher.id] = watcher

  if scriptConfig and watcher.immediate then
    if notifyWatcher(watcher, scriptConfig, nil, { path }, 'initial', true) then
      scriptConfigWatchers[watcher.id] = nil
    end
  elseif scriptConfig then
    watcher.initialDelivered = true
  end

  return function()
    scriptConfigWatchers[watcher.id] = nil
  end
end

-- --------------------------------------------------
-- REGISTRATION
-- --------------------------------------------------

local function registerScriptConfig(schema, canEditFn, rules)
  -- Before anything reads a default: some of them are detected from the
  -- server's own convars rather than written into the schema.
  resolveAutoDefaults(schema)
  local defaultData    = extractDefaults(schema) or {}
  settingsSchema       = schema
  defaults             = defaultData
  -- Save permission honours the same access model the chooser/open path uses
  -- (master ACE convar + per-resource overrides) — without this, /dirk_config
  -- could open the editor for an admin but their save would silently fail
  -- with NoPermission. Custom canEditFn is purely additive (cannot lock out
  -- the master) for backward compat.
  --
  -- We go through dirk_lib's `canEditScriptConfig` export rather than reading
  -- the global directly: this file runs in EVERY consumer's VM, but the
  -- access-resolution code lives in `src/scriptConfig/server.lua` which is
  -- dirk_lib-scope only. Without the cross-VM hop, the lookup is nil for
  -- consumers and save silently denies even for masters.
  canEditScript = function(src)
    local ok, allowed = pcall(function()
      return exports.dirk_lib:canEditScriptConfig(src, scriptName)
    end)
    if ok and allowed then return true end
    if canEditFn then return canEditFn(src) end
    return false
  end

  -- May OPEN the script and read its settings. Everyone who can edit can
  -- view; a view-level admin can do this and nothing else.
  --
  -- Split from canEditScript because the two guard genuinely different things:
  -- reading the config, versus changing it or being handed the server-only
  -- values. Before levels existed there was nothing to split.
  canViewScript = function(src)
    if canEditScript(src) then return true end
    local ok, allowed = pcall(function()
      return exports.dirk_lib:canViewScriptConfig(src, scriptName)
    end)
    return ok and allowed == true
  end
  serverOnlyPaths      = extractServerOnly(schema, nil)
  local renames        = extractRenames(schema, nil)
  local migrations     = rules and rules.migrations or nil
  currentVer           = GetResourceMetadata(scriptName, 'version', 0) or '0.0.0'

  if not canEditFn then
    lib.print.debug(
      ('[scriptConfig:%s] no extra permission function — relying on master ACE + overrides only.')
      :format(scriptName)
    )
  end

  -- Yield until MySQL global is injected by oxmysql
  local attempts = 0
  while not MySQL do
    Wait(100)
    attempts = attempts + 1
    if attempts % 20 == 0 then
      lib.print.warn(('[scriptConfig:%s] still waiting for MySQL global (%ds)...'):format(scriptName, attempts / 10))
    end
  end

  -- Ensure table + columns exist. This shared table is probed by EVERY dirk
  -- resource, but the module runs in each consumer's VM — so without a guard all
  -- N consumers re-run these ~4 schema probes on boot. Gate behind a server-wide
  -- GlobalState flag: only the first consumer this boot checks/migrates the
  -- schema, the rest skip straight to their own row.
  --
  -- Every statement below is BOTH idempotent (`IF NOT EXISTS`, probe-guarded
  -- ALTERs) and pcall'd. The flag is only set once the migration finishes, so two
  -- resources booting in the same batch can both enter this block. Previously the
  -- bare `CREATE TABLE` was neither: the loser of that race — or ANY database
  -- failure (no CREATE grant, unsupported DDL) — threw, silently killed this
  -- resource's scriptConfig init, and left every consumer reporting a cryptic
  -- "Callback <resource>:getScriptConfig timed out" instead of the real SQL error.
  if not GlobalState.dirk_scriptConfigSchemaReady then
    local tableExists = pcall(MySQL.scalar.await, 'SELECT 1 FROM dirk_scriptConfig LIMIT 1')

    if not tableExists then
      lib.print.info('Creating dirk_scriptConfig table...')
      local _, createErr = pcall(MySQL.query.await, [[
        CREATE TABLE IF NOT EXISTS `dirk_scriptConfig` (
          `script`           VARCHAR(50)  NOT NULL,
          `data`             longtext     DEFAULT NULL,
          `client_version`   INT          DEFAULT 0,
          `resource_version` VARCHAR(20)  DEFAULT '0.0.0',
          `change_log`       LONGTEXT     DEFAULT NULL,
          `last_editor`      LONGTEXT     DEFAULT NULL,
          `lastupdated`      timestamp    NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
          PRIMARY KEY (`script`)
        )
      ]])

      -- Re-probe rather than trusting the pcall result: a concurrent consumer may
      -- have created the table a moment ago, which is a perfectly good outcome.
      if not pcall(MySQL.scalar.await, 'SELECT 1 FROM dirk_scriptConfig LIMIT 1') then
        lib.print.error(('could not create the `dirk_scriptConfig` table: %s'):format(tostring(createErr)))
        lib.print.error('Every dirk script stores its config in this table. Without it configs cannot load or save, and clients report "Callback <resource>:getScriptConfig timed out".')
        lib.print.error('Check your database user has CREATE permission, then restart. You can also create the table by hand from the CREATE TABLE statement in dirk_lib/modules/scriptConfig/server.lua.')
        error(('scriptConfig [%s]: dirk_scriptConfig table unavailable — see the errors above.'):format(scriptName))
      end
    else
      -- Add columns to pre-existing tables if missing. Probe-guarded AND pcall'd,
      -- so a concurrent consumer running the same ALTER (duplicate column) can't
      -- take this one down.
      local function ensureColumn(column, ddl)
        local probe = ('SELECT %s FROM dirk_scriptConfig LIMIT 1'):format(column)
        if pcall(MySQL.scalar.await, probe) then return end

        local ok, alterErr = pcall(MySQL.query.await, ddl)
        if ok then
          lib.print.info(('Added %s column to dirk_scriptConfig.'):format(column))
        elseif not pcall(MySQL.scalar.await, probe) then
          -- Still missing after the ALTER failed — a real problem, not a race.
          lib.print.warn(('scriptConfig [%s]: could not add `%s` column: %s'):format(scriptName, column, tostring(alterErr)))
        end
      end

      ensureColumn('resource_version', "ALTER TABLE `dirk_scriptConfig` ADD COLUMN `resource_version` VARCHAR(20) DEFAULT '0.0.0'")
      ensureColumn('change_log',       "ALTER TABLE `dirk_scriptConfig` ADD COLUMN `change_log` LONGTEXT DEFAULT NULL")
      ensureColumn('last_editor',      "ALTER TABLE `dirk_scriptConfig` ADD COLUMN `last_editor` LONGTEXT DEFAULT NULL")
    end

    GlobalState.dirk_scriptConfigSchemaReady = true
  end

  -- Values live here now; `dirk_scriptConfig` keeps the per-resource META
  -- (versions, change log, last editor) and its `data` column becomes the
  -- legacy blob we migrate from.
  ensureOverridesTable()

  -- Insert defaults if this resource has no row yet
  local rowExists = MySQL.scalar.await(
    'SELECT COUNT(*) FROM dirk_scriptConfig WHERE script = ?',
    { scriptName }
  ) or 0

  if rowExists == 0 then
    lib.print.info(('Inserting default settings for %s into database.'):format(scriptName))
    MySQL.query.await(
      'INSERT INTO dirk_scriptConfig (script, data, client_version, resource_version) VALUES (?, ?, ?, ?)',
      { scriptName, json.encode(defaultData), client_version, currentVer }
    )
  end

  local loadedData = MySQL.single.await(
    'SELECT data, client_version, resource_version, change_log, last_editor FROM dirk_scriptConfig WHERE script = ?',
    { scriptName }
  ) or {}

  local legacyBlob = json.decode(loadedData?.data or '{}') or {}
  client_version  = loadedData?.client_version  or 0
  local storedVer = loadedData?.resource_version or '0.0.0'
  changeLog = json.decode(loadedData?.change_log or '[]') or {}
  lastEditorMeta = json.decode(loadedData?.last_editor or 'null')

  -- Overrides are the source of truth. A server that has never run this
  -- version has none yet, so the legacy blob is exploded into rows ONCE -
  -- keeping only the paths that actually differ from the shipped defaults, or
  -- the migration would re-pin every value and defeat the point. The blob is
  -- left where it is: it is the rollback.
  local rawData, overrideCount = loadOverrides(scriptName)
  if overrideCount == 0 and next(legacyBlob) then
    -- Never let this kill init. An unguarded throw here left the callback
    -- registered but the config nil forever, and every client on defaults with
    -- nothing in the server console pointing at the migration. Whatever did
    -- land is reloaded below; the blob is untouched, so the next boot simply
    -- tries again - and with the upsert above, it now succeeds.
    local ok, err = pcall(migrateBlobToOverrides, scriptName, legacyBlob, defaultData, json.encode({ name = 'migration' }))
    if not ok then
      lib.print.error(('scriptConfig [%s]: migrating the legacy config blob failed: %s'):format(scriptName, tostring(err)))
      lib.print.error(('scriptConfig [%s]: the blob is still in dirk_scriptConfig.data and will be retried next restart. Until then some settings may show their defaults.'):format(scriptName))
    end
    rawData = loadOverrides(scriptName)
  end

  -- Hash of the state we just loaded from the DB, captured BEFORE any rename /
  -- migration / merge mutates rawData or recomputes client_version. Compared
  -- against the post-merge payload below so a clean restart can skip the
  -- boot-time UPDATE — that write is the single biggest startup stall
  -- (~0.9s on an idle server, several seconds under DB contention).
  local loadedHash = hashSettings({
    data             = rawData,   -- now the override set, not the blob
    client_version   = client_version,
    resource_version = storedVer,
    change_log       = changeLog,
    last_editor      = lastEditorMeta,
  })

  -- 1. Apply declarative renames from schema x-renamedFrom
  rawData = applyRenames(rawData, renames)

  -- 1.5 Adopt settings that moved UP into this config from a consumer's own.
  -- Deliberately after the hash above, so an adoption is seen as a change and
  -- gets written - inheriting a value and then not persisting it would repeat
  -- the lookup on every boot and lose the moment an admin edits the old row.
  adoptFromConsumers(scriptName, rawData, extractAdoptions(schema))

  -- 2. Run any code migrations (handles complex structural transforms)
  rawData = runMigrations(rawData, storedVer, currentVer, migrations)

  -- 3. Smart merge: schema-driven, new keys filled from defaults, undeclared keys
  --    preserved (server-side only), arrays by key
  -- Rebuilt per init, or a reload would keep paths from a previous schema.
  undeclaredPaths = {}
  scriptConfig = smartMerge(defaultData, rawData, schema)

  -- Log a summary of values that changed from what was in DB. Only emits when
  -- DB and schema diverge, so it stays useful (silent on a clean restart).
  local resetCount = 0
  local function diffLog(def, db, merged, path)
    if type(def) ~= 'table' then return end
    for k, defVal in pairs(def) do
      local fp = path ~= '' and (path .. '.' .. k) or k
      local dbVal = type(db) == 'table' and db[k] or nil
      local mergedVal = type(merged) == 'table' and merged[k] or nil
      if type(defVal) == 'table' and type(mergedVal) == 'table' then
        diffLog(defVal, dbVal, mergedVal, fp)
      elseif dbVal ~= nil and not isEqualValue(dbVal, mergedVal) then
        resetCount = resetCount + 1
        debugLog(('CHANGED on merge "%s": DB had %s → now %s'):format(fp, tostring(dbVal), tostring(mergedVal)))
      end
    end
  end
  diffLog(defaultData, rawData, scriptConfig, '')
  if resetCount > 0 then
    debugLog(('=== INIT: %d value(s) changed from DB during smartMerge ==='):format(resetCount))
  end

  -- Recompute version as a content hash — discards the stored integer counter
  -- so a manual DB reset or resource restart never causes drift.
  local fullClientView = filterByVisibility(scriptConfig, nil, false)
  client_version = hashSettings(fullClientView)
  -- Seed the client-visible cache with the freshly-filtered view (same object
  -- we just hashed) so the first hydrating clients don't each re-walk the tree.
  clientVisibleView = fullClientView

  -- Only persist when the merge / migration / version bump actually changed
  -- something vs what we loaded. On a clean restart (same version, no schema
  -- drift) this is byte-identical, so we skip the write and the stall with it.
  -- Still awaited in the rare case it IS needed, so the new state is durable
  -- before clients read it.
  local bootHash = persistPayloadHash()
  if bootHash ~= loadedHash then
    writeOverrides(scriptName, scriptConfig, defaultData, json.encode(lastEditorMeta))
    -- The blob is still written for one release so a rollback has something to
    -- read. It is a MIRROR now, not the source of truth - the load path reads
    -- rows. Drop this column write once the migration has shipped and settled.
    MySQL.prepare.await(
      'UPDATE dirk_scriptConfig SET data = ?, client_version = ?, resource_version = ?, change_log = ?, last_editor = ? WHERE script = ?',
      { json.encode(scriptConfig), client_version, currentVer, json.encode(changeLog), json.encode(lastEditorMeta), scriptName }
    )
  end

  -- Overrides the schema no longer declares. Reported, never removed on their
  -- own: a rename that forgot `x-renamedFrom` would otherwise destroy the value
  -- silently. The panel offers a prune for when they really are dead.
  local orphaned = unknownOverridePaths(scriptName, schema)
  if #orphaned > 0 then
    lib.print.warn(('scriptConfig [%s]: %d stored override(s) are not in the schema and were KEPT: %s'):format(
      scriptName, #orphaned, table.concat(orphaned, ', ')))
  end
  lastPersistedHash = bootHash
  dispatchScriptConfigWatchers(scriptConfig, nil, nil, 'load', true)

  -- Tell everyone already connected that there is now something to fetch.
  --
  -- A resource restarting under live players starts BOTH halves at once, so a
  -- client asked before this point and was told 'NotReady'. It then sat out a
  -- backoff and asked again - a wasted attempt, a second of running on
  -- defaults, and a "config arrived after 2 attempts" line on every restart.
  -- The server knows the exact moment it can answer, so it says so, and a
  -- waiting client fetches immediately. The backoff stays as the fallback for
  -- anyone who missed the event (joining mid-boot, say).
  TriggerClientEvent(('%s:scriptConfigReady'):format(scriptName), -1)

  -- Push this consumer's `access` block (if any) to dirk_lib so its access
  -- check honours per-script overrides. Retries because dirk_lib's export may
  -- not be ready this early in boot.
  pushAccessOverridesWithRetry()

  -- Generate INSTALLATION/itemsToAdd/{ox,qb,esx} from any x-installItem /
  -- x-installItemList annotations in this consumer's schema. Same
  -- annotations also drive the missing-items audit, so consumers don't
  -- duplicate item lists across install.lua + audit code anymore.
  -- @dirk_lib/... forces resolution against the lib's resource folder rather
  -- than the consumer's (this file runs in the consumer's VM via the lazy
  -- module loader, so a bare path would look in the wrong place).
  do
    local ok, err = pcall(function()
      require '@dirk_lib/modules/scriptConfig/installItems'.regenerate(schema, scriptConfig)
    end)
    if not ok then
      lib.print.warn(('[scriptConfig:%s] install-file generation failed: %s'):format(scriptName, tostring(err)))
    end
  end

  -- Console missing-items warning. Deferred a few seconds — the inventory
  -- bridge isn't always fully wired up at scriptConfig load time, and an
  -- eager audit would falsely report every item as missing.
  CreateThread(function()
    Wait(5000)
    local ok, err = pcall(function()
      require '@dirk_lib/modules/scriptConfig/installItems'.logAuditWarning(schema, scriptConfig)
    end)
    if not ok then
      lib.print.warn(('missing-items audit log failed: %s'):format(tostring(err)))
    end
  end)

  lib.print.debug(('Script config loaded for %s (stored v%s → current v%s)'):format(scriptName, storedVer, currentVer))

  -- Per-resource shortcut command — opens this script's Live Configurator
  -- directly, skipping the /dirk_config chooser. Access is gated through
  -- the global access model (master ACE via dirk_lib_master_group convar
  -- + per-resource overrides from dirk_lib's scriptConfig). No `restricted`
  -- field — we let everyone run the command and silently no-op if they're
  -- not allowed, so the chooser can surface the same access logic to a
  -- /dirk_config invocation.
  lib.addCommand(scriptName, {
    help = ('Open the Live Configurator for %s'):format(scriptName),
  }, function(source)
    if source == 0 then
      lib.print.info(('[scriptConfig:%s] /%s must be run by a player'):format(scriptName, scriptName))
      return
    end
    -- Global access check from src/scriptConfig/server.lua. Falls back to
    -- the legacy canEditScript hook (if a consumer registered a custom
    -- canEditFn via lib.scriptConfig.register) for backward compat.
    if type(CanEditScriptConfigResource) == 'function' then
      if not CanEditScriptConfigResource(source, scriptName) then return end
    end
    if not canViewScript(source) then
      return
    end
    -- Opens Script Studio focused on this script, rather than this script's
    -- own bespoke panel. Every script's settings live in the one shared panel
    -- now, so /<resourceName> is a deep link into it, not a separate UI.
    TriggerClientEvent('dirk_lib:openScriptStudio', source, scriptName)
  end)

  return scriptConfig
end

-- --------------------------------------------------
-- SETTER
-- --------------------------------------------------

local function setScriptConfig(data, forceVers, ctx)
  local previous = lib.table.deepClone(scriptConfig)
  if ctx and ctx.sectionReplace then
    -- Section-delta apply: WHOLESALE overwrite each supplied top-level key,
    -- leaving every other section untouched. Distinct from fullReplace (which
    -- clones the entire `data`) and from the deep-merge branch — a wholesale
    -- per-section overwrite expresses deletions inside a section (e.g. a
    -- removed store), which lib.table.merge cannot (it never truncates arrays).
    for k, v in pairs(data) do
      scriptConfig[k] = lib.table.deepClone(v)
    end
  elseif ctx and ctx.fullReplace then
    scriptConfig = lib.table.deepClone(data)
  else
    scriptConfig = lib.table.merge(scriptConfig, data, false)
  end

  -- Compare actual state change (post-merge vs pre-merge) to avoid phantom
  -- changelog entries from stale or redundant UI data.
  local changedLeaves = collectChangedLeaves(scriptConfig, previous, nil, {})

  -- Re-push the (possibly changed) access block to dirk_lib BEFORE the
  -- no-change early-return below. collectChangedLeaves walks the NEW config's
  -- leaves, so it can MISS a leaf that was removed (e.g. clearing
  -- access.identifiers back to []) and report zero changes — gating the push on
  -- it would then leave dirk_lib's overridesByResource stale and keep granting
  -- access that was just revoked. scriptConfig is already merged here, and
  -- pushAccessOverrides is cheap + idempotent + pcall-guarded.
  pushAccessOverrides()

  -- Nothing actually changed and no forced version — skip persist/broadcast entirely.
  if #changedLeaves == 0 and not forceVers then
    return {
      client_version = client_version,
      changed_paths = {},
      last_editor = lastEditorMeta,
    }
  end

  -- Recompute client version from full client-visible state.
  -- IMPORTANT: the clientVisibleView cache must be refreshed on BOTH branches.
  -- The forceVers branch skips the filter/hash, so refreshing only in the else
  -- branch would leave the cache stale after a forced-version write. We refresh
  -- it UNCONDITIONALLY below, reusing the freshly-filtered view in the else
  -- branch and filtering once in the forceVers branch.
  if forceVers then
    client_version = forceVers
    clientVisibleView = filterByVisibility(scriptConfig, nil, false)
  else
    local fullClientView = filterByVisibility(scriptConfig, nil, false)
    client_version = hashSettings(fullClientView)
    clientVisibleView = fullClientView
  end

  local editor = buildEditorMeta(ctx and ctx.src)
  if #changedLeaves > 0 then
    local logEntry = {
      at_unix = os.time(),
      at_utc = os.date('!%Y-%m-%dT%H:%M:%SZ'),
      script = scriptName,
      admin = editor,
      expected_version = ctx and ctx.expectedVersion or nil,
      applied_version = client_version,
      changes = changedLeaves,
    }

    changeLog[#changeLog + 1] = logEntry
    while #changeLog > CHANGE_LOG_MAX do
      table.remove(changeLog, 1)
    end
  end

  lastEditorMeta = editor

  local payloadHash = persistPayloadHash()
  if payloadHash ~= lastPersistedHash then
    -- Rows first: this is what a restart reads back. `writeOverrides` DELETES
    -- rows for anything now back at its default, which is what finally makes
    -- "revert to default" and "remove the last list item" survive a restart -
    -- the blob could only ever be rewritten, never have a value taken out of
    -- it in a way `collectChangedLeaves` could see.
    writeOverrides(scriptName, scriptConfig, defaults, json.encode(lastEditorMeta))

    MySQL.prepare.await(
      'UPDATE dirk_scriptConfig SET data = ?, client_version = ?, change_log = ?, last_editor = ? WHERE script = ?',
      { json.encode(scriptConfig), client_version, json.encode(changeLog), json.encode(lastEditorMeta), scriptName }
    )
    lastPersistedHash = payloadHash
  end

  -- Only send shared paths to clients. For a section-delta this is the
  -- visibility-filtered changed sections only — not the whole config — which
  -- is the entire point of the optimisation.
  local clientData = filterByVisibility(data, nil, false)
  if next(clientData) then
    -- Broadcast apply-mode args (kept additive — old clients ignore the 4th):
    --   fullReplace  (3rd): client replaces its ENTIRE config with `clientData`
    --   sectionReplace (4th): client WHOLESALE-overwrites just the supplied
    --                         top-level keys, leaving other sections intact.
    -- Neither set ⇒ legacy deep-merge.
    TriggerClientEvent(
      ('%s:updateScriptConfig'):format(scriptName),
      -1,
      clientData,
      client_version,
      ctx and ctx.fullReplace or false,
      ctx and ctx.sectionReplace or false
    )
  end

  dispatchScriptConfigWatchers(scriptConfig, previous, changedLeaves, 'update', false)

  -- Re-emit install files when item-bearing fields might have changed.
  do
    local ok, err = pcall(function()
      require '@dirk_lib/modules/scriptConfig/installItems'.regenerate(settingsSchema, scriptConfig)
    end)
    if not ok then
      lib.print.warn(('[scriptConfig:%s] install-file regen failed: %s'):format(scriptName, tostring(err)))
    end
  end

  return {
    client_version = client_version,
    changed_paths = changedLeaves,
    last_editor = lastEditorMeta,
  }
end

local function toSafeString(value)
  if value == nil then return '' end
  if type(value) == 'string' then return value end
  return tostring(value)
end

local function matchesHistoryFilters(entry, filters)
  if filters.fromUnix and (entry.at_unix or 0) < filters.fromUnix then
    return false
  end

  if filters.toUnix and (entry.at_unix or 0) > filters.toUnix then
    return false
  end

  if filters.admin and filters.admin ~= '' then
    local adminName = toSafeString(entry.admin and entry.admin.name):lower()
    local adminIdentifier = toSafeString(entry.admin and entry.admin.identifier):lower()
    if not adminName:find(filters.admin, 1, true) and not adminIdentifier:find(filters.admin, 1, true) then
      return false
    end
  end

  if filters.path and filters.path ~= '' then
    local foundPath = false
    for i = 1, #(entry.changes or {}) do
      local changedPath = toSafeString(entry.changes[i].path)
      if changedPath:find(filters.path, 1, true) then
        foundPath = true
        break
      end
    end
    if not foundPath then
      return false
    end
  end

  if filters.query and filters.query ~= '' then
    local q = filters.query
    local adminName = toSafeString(entry.admin and entry.admin.name):lower()
    local adminIdentifier = toSafeString(entry.admin and entry.admin.identifier):lower()
    local atUtc = toSafeString(entry.at_utc):lower()

    if adminName:find(q, 1, true) or adminIdentifier:find(q, 1, true) or atUtc:find(q, 1, true) then
      return true
    end

    for i = 1, #(entry.changes or {}) do
      local change = entry.changes[i]
      local path = toSafeString(change.path):lower()
      local oldVal = toSafeString(change.old):lower()
      local newVal = toSafeString(change.new):lower()
      if path:find(q, 1, true) or oldVal:find(q, 1, true) or newVal:find(q, 1, true) then
        return true
      end
    end

    return false
  end

  return true
end

local function getScriptConfigHistory(payload)
  local args = type(payload) == 'table' and payload or {}

  local offset = math.max(0, tonumber(args.offset) or 0)
  local limit = math.floor(math.max(1, math.min(100, tonumber(args.limit) or 25)))

  local filters = {
    query = toSafeString(args.query):lower(),
    path = toSafeString(args.path):lower(),
    admin = toSafeString(args.admin):lower(),
    fromUnix = args.fromUnix and tonumber(args.fromUnix) or nil,
    toUnix = args.toUnix and tonumber(args.toUnix) or nil,
  }

  local filtered = {}
  for i = #changeLog, 1, -1 do
    local entry = changeLog[i]
    if matchesHistoryFilters(entry, filters) then
      filtered[#filtered + 1] = entry
    end
  end

  -- Sorted HERE, not in the panel. Ordering a page of results client-side only
  -- orders that page: "oldest first" would have shown the oldest of the newest
  -- 25. The whole filtered set is in hand at this point, so the order is right
  -- across every page.
  local sort = toSafeString(args.sort)
  if sort == 'oldest' then
    local reversed = {}
    for i = #filtered, 1, -1 do reversed[#reversed + 1] = filtered[i] end
    filtered = reversed
  elseif sort == 'changes' then
    table.sort(filtered, function(a, b)
      local ac, bc = #(a.changes or {}), #(b.changes or {})
      if ac ~= bc then return ac > bc end
      return (a.at_unix or 0) > (b.at_unix or 0)
    end)
  elseif sort == 'admin' then
    table.sort(filtered, function(a, b)
      local an = (a.admin and a.admin.name or ''):lower()
      local bn = (b.admin and b.admin.name or ''):lower()
      if an ~= bn then return an < bn end
      return (a.at_unix or 0) > (b.at_unix or 0)
    end)
  end
  -- anything else keeps the newest-first walk above

  local total = #filtered
  local startIndex = offset + 1
  local endIndex = math.min(offset + limit, total)

  local items = {}
  for i = startIndex, endIndex do
    items[#items + 1] = filtered[i]
  end

  local nextOffset = nil
  if endIndex < total then
    nextOffset = endIndex
  end

  return {
    items = items,
    total = total,
    limit = limit,
    offset = offset,
    nextOffset = nextOffset,
  }
end


-- --------------------------------------------------
-- CALLBACKS
-- --------------------------------------------------

--- How long a client's first ask will wait for a config that is still being
--- built, before being told to come back later.
local READY_WAIT_MS = 20000

lib.callback.register(('%s:getScriptConfig'):format(scriptName), function(src, client_ver)
  -- Wait rather than refuse.
  --
  -- A resource restarting under live players starts its server and client
  -- halves at once, so the client's first ask ALWAYS lands before the server
  -- has merged its config. Answering 'NotReady' made that a wasted round trip
  -- plus a backoff the client had to sit out - a second on defaults, and a
  -- "config arrived after 2 attempts" line on every single restart.
  --
  -- Broadcasting a ready event was tried first and is not enough on its own:
  -- the server can finish before the client has even registered a handler, so
  -- the client misses it and falls back to the backoff anyway. Holding the
  -- callback open has no such race - the client is already waiting on an
  -- answer, so it simply gets a slightly later one, and only on the first ask
  -- after a restart.
  --
  -- Callbacks run in their own coroutine, so this yields rather than blocking
  -- the server. The cap exists so a config that never builds (a broken schema)
  -- surfaces as NotReady instead of a request that hangs forever.
  if not scriptConfig then
    local waited = 0
    while not scriptConfig and waited < READY_WAIT_MS do
      Wait(50)
      waited = waited + 50
    end
  end

  if not scriptConfig then return nil, 'NotReady' end
  client_ver = tonumber(client_ver) or -1
  -- Use equality: hash ordering is meaningless, client is up-to-date iff hashes match.
  if client_ver == client_version then return nil end
  return {
    client_version = client_version,
    -- Served from the cached client-visible view (refreshed on every config
    -- change) so a mass reconnect doesn't trigger N back-to-back tree walks.
    -- Fallback to a live filter on the (unexpected) chance the cache is unset.
    data = clientVisibleView or filterByVisibility(scriptConfig, nil, false),
  }
end)

lib.callback.register(('%s:getFullScriptConfig'):format(scriptName), function(src)
  if not scriptConfig then return nil, 'NotReady' end
  if not canViewScript(src) then return nil, 'NoPermission' end
  return true, nil, { config = scriptConfig, clientVersion = client_version }
end)

-- Server-only "sliver" for the admin editor. Returns ONLY the locked
-- (x-serverOnly) subtree — the inverse of the client-visible view the NUI
-- already holds (pushed by Lua + cached in KVP). The editor MERGES this onto
-- that cached view to reconstruct the full config without ever re-fetching the
-- whole thing.
--
-- SECURITY: gated by canEditScript (the SAME permission gate as
-- getFullScriptConfig), so server-only fields never reach a non-admin. The
-- sliver is computed fresh per request and returned in-memory only — it is
-- never written to the client KVP cache (which holds client-visible data
-- exclusively). When the schema declares no server-only paths the sliver is an
-- empty object, which json.encode renders as `{}` (the NUI merges it as a
-- no-op).
lib.callback.register(('%s:getServerOnlyScriptConfig'):format(scriptName), function(src)
  if not scriptConfig then return nil, 'NotReady' end
  if not canEditScript(src) then return nil, 'NoPermission' end
  local sliver = filterServerOnly(scriptConfig, nil)

  -- NIL, never an empty table. An empty Lua table crosses the NUI boundary as
  -- a JSON ARRAY ([]), and the panel deep-merges the sliver over the whole
  -- form config — merging an array replaces the object outright, so a script
  -- with no server-only branches got its entire form wiped to [] the moment
  -- the panel opened: every field read as undefined and no change ever
  -- counted, which is why Save stayed disabled. The JS side already treats
  -- nil as "nothing extra".
  if next(sliver) == nil then sliver = nil end

  return true, nil, {
    serverOnly = sliver,
    clientVersion = client_version,
  }
end)

-- Missing-items audit. Walks the schema's x-installItem / x-installItemList
-- annotations, cross-references against `lib.inventory.item(name)`, and
-- returns the missing names plus rendered install snippets for them. Drives
-- the admin panel's MissingItemsBanner.
lib.callback.register(('%s:getMissingItems'):format(scriptName), function(src)
  if not scriptConfig then return false, 'NotReady' end
  if not canViewScript(src) then return false, 'NoPermission' end

  local ok, result = pcall(function()
    return require '@dirk_lib/modules/scriptConfig/installItems'.audit(settingsSchema, scriptConfig)
  end)
  if not ok then
    lib.print.warn(('[scriptConfig:%s] missing-items audit failed: %s'):format(scriptName, tostring(result)))
    return false, 'AuditFailed'
  end
  return true, nil, result
end)

lib.callback.register(('%s:getScriptConfigHistory'):format(scriptName), function(src, payload)
  if not scriptConfig then return nil, 'NotReady' end
  if not canViewScript(src) then return nil, 'NoPermission' end

  return getScriptConfigHistory(payload)
end)

lib.callback.register(('%s:giveScriptConfigItem'):format(scriptName), function(src, payload)
  if not src or src <= 0 then return false, 'InvalidSource' end
  if not canEditScript(src) then return false, 'NoPermission' end

  local args = type(payload) == 'table' and payload or {}
  local itemName = type(args.itemName) == 'string' and args.itemName or nil
  local itemAmount = math.max(1, math.floor(tonumber(args.itemAmount) or 1))
  -- Optional metadata pass-through. Lets consumers (e.g. dirk_fishing) spawn
  -- items that need real metadata to behave normally — a fish with no
  -- `fishWeight` metadata can't be sold/gutted properly. Caller is trusted
  -- since they've already passed canEditScript.
  local itemMetadata = type(args.metadata) == 'table' and args.metadata or nil

  if not itemName or itemName == '' then
    return false, 'InvalidItem'
  end

  local added = lib.inventory.addItem(src, itemName, itemAmount, itemMetadata)
  if not added then
    return false, 'AddItemFailed'
  end

  -- An admin handing themselves items is exactly the sort of thing the logs
  -- exist for. `warn`, not `info`: it is not wrong, but it is worth seeing
  -- in a channel rather than only on request.
  pcall(function()
    -- lib.logger is a CALLABLE - (source, event, message, ...tags) - and the
    -- level rides the varargs as a `level:` tag rather than an options table.
    -- The resource is filled in from the calling VM, so it is not passed.
    lib.logger(src, 'admin:giveItem',
      ('%s gave themselves %dx %s'):format(GetPlayerName(src) or '?', itemAmount, itemName),
      'level:warn', ('item:%s'):format(itemName), ('amount:%d'):format(itemAmount))
  end)

  return true
end)


lib.callback.register(('%s:updateScriptConfig'):format(scriptName), function(src, payload)
  if not scriptConfig then return false, 'NotReady' end
  if not canEditScript(src) then return false, 'NoPermission' end

  local newSettings = payload
  local expectedVersion = nil
  -- Section-delta save: the NUI sends only the changed top-level sections
  -- (each as its full current value) plus sectionReplace=true. We then
  -- WHOLESALE-overwrite just those keys (see setScriptConfig's sectionReplace
  -- branch) so deletions inside a section propagate. Absent the flag we keep
  -- the legacy full-replace behaviour for older NUI builds.
  local sectionReplace = false

  if type(payload) == 'table' and payload.data ~= nil then
    newSettings = payload.data
    expectedVersion = payload.expectedVersion
    sectionReplace = payload.sectionReplace == true
  end

  if type(newSettings) ~= 'table' then
    return false, 'InvalidPayload'
  end

  if expectedVersion ~= nil and tonumber(expectedVersion) ~= tonumber(client_version) then
    return false, 'VersionConflict', {
      latestVersion = client_version,
      lastEditor = lastEditorMeta,
      -- Same full client-visible view as getScriptConfig — served from cache.
      latestData = clientVisibleView or filterByVisibility(scriptConfig, nil, false),
    }
  end

  local meta = setScriptConfig(newSettings, nil, {
    src = src,
    expectedVersion = expectedVersion,
    -- sectionReplace and fullReplace are mutually exclusive apply modes.
    -- A section-delta replaces only the supplied top-level keys; a full
    -- save still replaces the entire config.
    fullReplace = not sectionReplace,
    sectionReplace = sectionReplace,
  })

  return true, nil, meta
end)

lib.callback.register(('%s:resetScriptConfig'):format(scriptName), function(src)
  lib.print.warn(('[scriptConfig:%s] RESET TO DEFAULTS triggered by player %s (%s)'):format(scriptName, tostring(src), GetPlayerName(src) or 'unknown'))
  if not scriptConfig then return false, 'NotReady' end
  if not canEditScript(src) then return false, 'NoPermission' end
  local meta = setScriptConfig(defaults, nil, { src = src, fullReplace = true })
  return true, nil, meta
end)

-- --------------------------------------------------
-- PUBLIC API
-- --------------------------------------------------

local toRet = {
  set = setScriptConfig,

  get = function(path)
    if not path or path == '' then
      return scriptConfig
    end

    return cloneValue(getValueAtPath(scriptConfig, path))
  end,

  ---@function lib.scriptConfig.clientView
  ---@description What a PLAYER receives - the visibility-filtered config that
  --- is broadcast and cached, as opposed to `get`, which is what the server
  --- holds. The two are meant to differ only by server-only keys; when they
  --- differ by anything else, that is the bug. Read-only, for tests and
  --- diagnostics.
  clientView = function()
    return cloneValue(clientVisibleView or filterByVisibility(scriptConfig, nil, false))
  end,

  on = onScriptConfig,

  -- Authorize a consumer's own config-related callbacks with the SAME access
  -- model as the panel (master ACE convar + per-resource overrides + console).
  -- This module runs in the CONSUMER's VM, so GetCurrentResourceName() resolves
  -- to the calling resource — exactly the resource whose edit-access we want to
  -- check. canEditScriptConfig handles src == 0 / console → true.
  hasPerm = function(src)
    return exports.dirk_lib:canEditScriptConfig(src, GetCurrentResourceName())
  end,

  -- May LOOK. Everyone who can edit can view; a view-level admin can do this
  -- and nothing else. Use this to guard reads, and hasPerm to guard writes -
  -- guarding a read with hasPerm locks view admins out of pages they are
  -- meant to be able to see.
  canView = function(src)
    return exports.dirk_lib:canViewScriptConfig(src, GetCurrentResourceName())
  end,

  reset = function()
    lib.print.warn(('[scriptConfig:%s] reset() called — all settings reverted to defaults'):format(scriptName))
    setScriptConfig(defaults, nil, { fullReplace = true })
  end,
}

setmetatable(toRet, {
  __call = function(_, schema, canEditFn, rules)
    registerScriptConfig(schema, canEditFn, rules)
  end,
})

-- --------------------------------------------------
-- AUTO-REGISTRATION
-- Consumer only needs `dirk_lib 'scriptConfig'` in fxmanifest + schema.json.
-- Explicit lib.scriptConfig(schema, canEdit, rules) still works and wins this race.
-- --------------------------------------------------
CreateThread(function()
  Wait(500)
  if scriptConfig then return end

  local rawSchema = LoadResourceFile(scriptName, 'schema.json')
  if not rawSchema then
    lib.print.warn(('[scriptConfig:%s] declared dirk_lib "scriptConfig" but no schema.json found at the resource root — skipping auto-registration.'):format(scriptName))
    return
  end

  local ok, schema = pcall(json.decode, rawSchema)
  if not ok or type(schema) ~= 'table' then
    lib.print.warn(('[scriptConfig:%s] schema.json could not be parsed — skipping auto-registration.'):format(scriptName))
    return
  end

  -- No default canEditFn: auto-registered configs are gated PURELY by the
  -- master ACE convar (dirk_lib_master_group) + per-resource overrides, via
  -- dirk_lib's canEditScriptConfig export. Injecting a bare
  -- IsPlayerAceAllowed(src,'admin') here would let any 'admin'-ACE player edit
  -- configs even when an operator deliberately set the master group to EXCLUDE
  -- 'admin' — and canEditScript falls through to this fn whenever the export
  -- denies or is briefly unavailable, so it would silently undermine the master
  -- gate (and fail OPEN during a dirk_lib restart). A resource that wants extra
  -- additive access still passes an explicit canEditFn via
  -- lib.scriptConfig(schema, canEditFn, rules).
  registerScriptConfig(schema, nil, {})
end)

-- Clear this consumer's pushed access overrides from dirk_lib's map when this
-- resource stops, so a stale block can't keep granting access after the
-- resource is gone. (dirk_lib's own onResourceStop also clears the entry as a
-- backstop — whichever fires first wins, both are idempotent.) Guard on the
-- resource name: onResourceStop fires for every resource, but we only care
-- about our own.
AddEventHandler('onResourceStop', function(stopped)
  if stopped ~= scriptName then return end
  pcall(function()
    exports.dirk_lib:unregisterScriptConfigOverrides(scriptName)
  end)
end)

-- dirk_lib RESTARTING takes this resource's registration down with it: the map
-- of who may edit which config lives in dirk_lib's VM, so a restart leaves this
-- script registered nowhere and its panel unreachable until it is restarted
-- too. Restarting every consumer by hand after every dirk_lib restart is not a
-- workflow, it is a chore, so the push is simply repeated.
--
-- Guarded on the name: onResourceStart fires for every resource on the server.
AddEventHandler('onResourceStart', function(started)
  if started ~= 'dirk_lib' then return end
  if not scriptConfig then return end

  -- dirk_lib is "started" before its own exports are registered, so the retry
  -- loop below is doing the real work; this is just what kicks it off.
  pushAccessOverridesWithRetry()
end)

-- Admin-tool server-side counterparts now live under dirk_lib's own
-- src/helpers/ tree and load via the `src/**/server.lua` glob in
-- fxmanifest — no manual require needed here. Kept this comment as a
-- breadcrumb in case future grep brings someone looking for the old
-- require path.

return toRet
