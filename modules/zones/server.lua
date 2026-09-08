local glm = require 'glm'

local sanitizePolyPoints = function(points)
  local fixedPoints = {}

  for i, pt in ipairs(points) do
    -- if it's vector2, force z = 0
    if pt.z == nil then
      fixedPoints[i] = vector3(pt.x, pt.y, 0.0)
    else
      fixedPoints[i] = pt
    end
  end

  return fixedPoints
end

lib.zones = {
  getCenter = function(poly)
    local x,y,z = 0,0,0
    for i=1,#poly do
      x = x + poly[i].x
      y = y + poly[i].y
      z = z + poly[i].z
    end
    return vector3(x/#poly,y/#poly,z/#poly)
  end,

  --- Is this point inside a polygon?
  ---
  --- FLAT by default. A polygon is defined by x/y — it is a shape on a map —
  --- and its points routinely carry z 0 because that is what a map editor
  --- stores. The default used to be a five-metre band, which meant a point at
  --- any real world height was outside a boundary drawn at zero: every "is
  --- this inside" answered no, and nothing said why.
  ---
  --- dirk_fishing had already worked around it at all three of its call sites
  --- by passing `9999.0`; dirk_projectCars had not, and its drop rules and
  --- scrapyard boundaries silently refused everywhere.
  ---
  --- Pass a `height` when you genuinely mean a volume — a floor of a building,
  --- a depth band. Leaving it out means the shape, at any height.
  ---
  --- @param poly table    the ring
  --- @param pos vector3
  --- @param height number|nil  a band around the polygon's own z; omit for flat
  isPointInside = function(poly, pos, height)
    poly = sanitizePolyPoints(poly)
    pos = vector3(pos.x, pos.y, pos.z or 0)
    return glm.polygon.new(poly):contains(pos, height or 100000.0)
  end
}

return lib.zones
