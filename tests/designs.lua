-- ─────────────────────────────────────────────────────────────────────────────
-- The design store, and the thing it exists to prevent.
--
-- Designs are kept OUT of scriptConfig because a design tree is larger than
-- every setting in every dirk script put together, and the config is hydrated
-- to every client on join. Put one in there and every config read carries it.
--
-- So these tests are less about "does the table work" and more about the two
-- promises that make the separation worth having:
--
--   a design only travels when someone is about to render or edit it, and
--   a live change costs a handful of properties rather than a whole tree.
--
--   dirktest dirk_lib designs
-- ─────────────────────────────────────────────────────────────────────────────

local RES = 'dirk_lib_designtest'

--- A design, in the shape the runtime stores: a flat element list where nesting
--- is a parent id, not a literal tree. That is what makes a patch cheap.
local function design(elements, pages)
  return {
    pages = pages or { { id = 'main', label = 'Main' } },
    settings = {},
    elements = elements,
  }
end

lib.test.add('designs: a stored design comes back byte-identical', function(t)
  local body = json.encode(design({
    { id = 'root', type = 'frame' },
    { id = 'title', type = 'text', parent = 'root', text = 'Hello' },
  }))

  local saved = exports.dirk_lib:designs_save(RES, {
    id = 'roundtrip', screen = 'main', name = 'Round trip', data = body,
  })
  t.expect(saved).notToBeNil()
  t.expect(saved.hash).toBe(exports.dirk_lib:designs_hash(body))

  local back = exports.dirk_lib:designs_get(RES, 'roundtrip')
  t.expect(back).notToBeNil()
  -- Byte-identical matters: the hash is of the STORED string, so any
  -- re-encoding on the way in or out would change it and every client holding
  -- the old hash would re-fetch a design that had not actually changed.
  t.expect(back.data).toBe(body)

  exports.dirk_lib:designs_delete(RES, 'roundtrip')
end)

lib.test.add('designs: listing a gallery does NOT carry the trees', function(t)
  local big = {}
  for i = 1, 80 do big[i] = { id = 'el' .. i, type = 'frame', text = ('x'):rep(200) } end
  exports.dirk_lib:designs_save(RES, {
    id = 'heavy', screen = 'main', name = 'Heavy', data = json.encode(design(big)),
  })

  local rows = exports.dirk_lib:designs_list(RES)
  t.expect(#rows > 0).toBeTruthy()

  -- THE promise of the whole store. A gallery of a hundred designs has to stay
  -- a small reply, and it only does if the one thing that is actually large is
  -- left out of the query.
  for _, row in ipairs(rows) do
    t.expect(row.data).toBeNil()
  end

  exports.dirk_lib:designs_delete(RES, 'heavy')
end)

lib.test.add('designs: a client holding the current hash is sent nothing', function(t)
  local body = json.encode(design({ { id = 'root', type = 'frame' } }))
  local saved = exports.dirk_lib:designs_save(RES, {
    id = 'cached', screen = 'main', name = 'Cached', data = body,
  })

  local fresh = exports.dirk_lib:designs_live(RES, 'cached', nil)
  t.expect(fresh.data).toBe(body)

  -- The common case: a returning player on a server whose design has not
  -- changed. It has to cost nothing, or the separation buys us less than it
  -- should on a busy server.
  local again = exports.dirk_lib:designs_live(RES, 'cached', saved.hash)
  t.expect(again.unchanged).toBeTruthy()
  t.expect(again.data).toBeNil()

  exports.dirk_lib:designs_delete(RES, 'cached')
end)

lib.test.add('designs: a bundled default is not overwritten once it is edited', function(t)
  local shipped = json.encode(design({ { id = 'root', type = 'frame', fill = 'solid' } }))
  exports.dirk_lib:designs_seed(RES, {
    { id = 'seed-default', screen = 'main', name = 'Default', data = shipped },
  })

  -- The owner changes it.
  local theirs = json.encode(design({ { id = 'root', type = 'frame', fill = 'glass' } }))
  exports.dirk_lib:designs_save(RES, {
    id = 'seed-default', screen = 'main', name = 'Default', data = theirs, source = 'local',
  })

  -- A later release ships a new version of the same id. Their work survives:
  -- the shipped default is the compatibility promise, not a licence to
  -- overwrite whatever someone has spent an evening on.
  local updated = json.encode(design({ { id = 'root', type = 'frame', fill = 'image' } }))
  exports.dirk_lib:designs_seed(RES, {
    { id = 'seed-default', screen = 'main', name = 'Default', data = updated },
  })

  local row = exports.dirk_lib:designs_get(RES, 'seed-default')
  t.expect(row.data).toBe(theirs)

  exports.dirk_lib:designs_delete(RES, 'seed-default')
end)

lib.test.add('designs: seeding is idempotent on an untouched default', function(t)
  local shipped = json.encode(design({ { id = 'root', type = 'frame' } }))
  local bundled = { { id = 'seed-clean', screen = 'main', name = 'Clean', data = shipped } }

  t.expect(exports.dirk_lib:designs_seed(RES, bundled)).toBe(1)
  -- Every boot runs this. Re-writing an unchanged row each time would churn the
  -- table and bump `updated` for no reason.
  t.expect(exports.dirk_lib:designs_seed(RES, bundled)).toBe(0)

  exports.dirk_lib:designs_delete(RES, 'seed-clean')
end)
