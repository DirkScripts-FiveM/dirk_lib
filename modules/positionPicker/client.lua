--- Interactive position picker with raycast, ghost marker, and heading rotation.
--- Returns { x, y, z, h } or nil if cancelled.
---@param options? table { markerType?: number, markerColor?: table, markerScale?: table, text?: string }
---@return table|nil position { x, y, z, h }
local function positionPicker(options)
  options = options or {}
  local markerType = options.markerType or 1
  local mr, mg, mb, ma = 165, 138, 105, 120
  if options.markerColor then
    mr = options.markerColor[1] or mr
    mg = options.markerColor[2] or mg
    mb = options.markerColor[3] or mb
    ma = options.markerColor[4] or ma
  end
  local sx, sy, sz = 0.5, 0.5, 0.5
  if options.markerScale then
    sx = options.markerScale[1] or sx
    sy = options.markerScale[2] or sy
    sz = options.markerScale[3] or sz
  end

  local text = options.text or '[LMB] Place  [Scroll] Rotate  [ESC] Cancel'
  lib.showText(text, { position = 'top-center' })

  local heading = 0.0
  local lastCoords = nil
  local picking = true

  lib.disableControls:Add(24, 25, 140, 141, 142, 199, 200)

  while picking do
    Wait(0)
    lib.disableControls()

    -- `hit, endCoords` — in that order.
    --
    -- This read `hit, _, endCoords`, which skips the real endCoords and binds
    -- the ENTITY HANDLE to it instead: a number, where the lines below expect
    -- a vector. It never blew up because `lib.raycast` had a separate bug that
    -- made `hit` false on every call, so the branch under it never ran at all —
    -- one bug hiding another, and this picker silently drawing nothing.
    local hit, endCoords = lib.raycast.fromCamera(511, 4, 100.0)

    if hit and endCoords then
      lastCoords = endCoords

      DrawMarker(markerType, endCoords.x, endCoords.y, endCoords.z,
        0.0, 0.0, 0.0,
        0.0, 0.0, heading,
        sx, sy, sz,
        mr, mg, mb, ma,
        false, false, 2, false, nil, nil, false)

      -- Heading indicator line
      local rad = math.rad(heading)
      local dx = math.cos(rad) * 1.0
      local dy = math.sin(rad) * 1.0
      DrawLine(endCoords.x, endCoords.y, endCoords.z + 0.1,
        endCoords.x + dx, endCoords.y + dy, endCoords.z + 0.1,
        mr, mg, mb, 200)
    end

    -- Scroll to rotate
    if IsDisabledControlPressed(0, 241) then
      heading = (heading + 2.0) % 360.0
    elseif IsDisabledControlPressed(0, 242) then
      heading = (heading - 2.0) % 360.0
    end

    -- LMB confirm
    if IsDisabledControlJustPressed(0, 24) then
      picking = false
      lib.disableControls:Remove(24, 25, 140, 141, 142, 199, 200)
      lib.hideText()

      local finalCoords = lastCoords or GetEntityCoords(cache.ped)
      return {
        x = math.round(finalCoords.x, 2),
        y = math.round(finalCoords.y, 2),
        z = math.round(finalCoords.z, 2),
        h = math.round(heading, 2),
      }
    end

    -- ESC cancel
    if IsDisabledControlJustPressed(0, 200) or IsDisabledControlJustPressed(0, 199) then
      picking = false
      lib.disableControls:Remove(24, 25, 140, 141, 142, 199, 200)
      lib.hideText()
      return nil
    end
  end
end

return positionPicker
