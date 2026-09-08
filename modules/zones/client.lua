local glm = require 'glm'

local zones = {}
local zone = {}
zone.__index = zone

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

-- grid config
local CELL_SIZE = 500.0
local Grids = {}

local function getCellIndex(coords)
  local cellX = math.floor(coords.x / CELL_SIZE)
  local cellY = math.floor(coords.y / CELL_SIZE)
  return cellX, cellY
end

local function getOrCreateCell(x, y)
  if not Grids[x] then Grids[x] = {} end
  if not Grids[x][y] then Grids[x][y] = {} end
  return Grids[x][y]
end

local function getBoundingBox(z)
  if z.type == 'poly' then
    local minX, minY = math.huge, math.huge
    local maxX, maxY = -math.huge, -math.huge
    for i, pt in ipairs(z.points) do
      minX = math.min(minX, pt.x)
      maxX = math.max(maxX, pt.x)
      minY = math.min(minY, pt.y)
      maxY = math.max(maxY, pt.y)
    end
    return minX, maxX, minY, maxY
  elseif z.type == 'circle' or z.type == 'circle2D' then
    local r = z.radius or 0
    return z.pos.x - r, z.pos.x + r, z.pos.y - r, z.pos.y + r
  elseif z.type == 'box' then
    local sx, sy = z.size.x / 2, z.size.y / 2
    return z.pos.x - sx, z.pos.x + sx, z.pos.y - sy, z.pos.y + sy
  else
    return z.pos.x, z.pos.x, z.pos.y, z.pos.y
  end
end

local function insertZoneIntoGrid(z)
  local minX, maxX, minY, maxY = getBoundingBox(z)
  local cMinX, cMinY = getCellIndex(vector3(minX, minY, 0))
  local cMaxX, cMaxY = getCellIndex(vector3(maxX, maxY, 0))

  z._cells = {}
  for cx = cMinX, cMaxX do
    for cy = cMinY, cMaxY do
      local cell = getOrCreateCell(cx, cy)
      cell[z.id] = z
      table.insert(z._cells, {x = cx, y = cy})
    end
  end
end

local function removeZoneFromGrid(z)
  if not z._cells then return end
  for _, c in ipairs(z._cells) do
    if Grids[c.x] and Grids[c.x][c.y] then
      Grids[c.x][c.y][z.id] = nil
    end
  end
  z._cells = nil
end

local function getNearbyCells(coords)
  local cx, cy = getCellIndex(coords)
  local out = {}
  for dx = -1, 1 do
    for dy = -1, 1 do
      local cell = Grids[cx+dx] and Grids[cx+dx][cy+dy]
      if cell then
        for _, z in pairs(cell) do
          out[#out+1] = z
        end
      end
    end
  end
  return out
end

-- zone constructors
zone.new = function(id, data)
  local self = setmetatable(data, zone)
  self.id = id
  zones[id] = self
  self:__init()
  insertZoneIntoGrid(self)
  return self
end

zone.get = function(id)
  return zones[id]
end

zone.delete = function(id)
  local z = zones[id]
  if not z then return end
  removeZoneFromGrid(z)
  zones[id] = nil
end

function zone:__init()
  assert(self.type, 'zone must have a specified type : circle, circle2D, poly, box, game_zone, all_game_zone')

  if self.type == 'circle' then
    assert(self.pos and self.radius, 'circle zone must have pos and radius')
  end
  if self.type == 'circle2D' then
    assert(self.pos and self.radius, 'circle2D zone must have pos and radius')
  end
  
  if self.type == 'poly' then
    assert(self.points, 'poly zone must have points')

    -- normalize points: allow vector2 or vector3
    self.points = sanitizePolyPoints(self.points)

    self.height = self.height or 5.0
    self.pos = lib.zones.getCenter(self.points)

    -- now safe
    self.polygon = glm.polygon.new(self.points)
  end

  if self.type == 'box' then
    assert(self.pos and self.size, 'box zone must have pos and size')
    self.size.z = self.size.z or 99999.999
  end
  if self.type == 'game_zone' then
    assert(self.game_zone, 'game_zone must have a game_zone')
  end
  if self.type == 'all_game_zone' then
    assert(self.onChange, 'all_game_zone must have an onChange function')
  end

  local myPos = GetEntityCoords(cache.ped)
  if self:is_inside({pos = myPos}) then
    self.inside = true
    if self.onEnter then self.onEnter({pos = myPos}) end
  end
end

function zone:is_inside(data)
  local current_pos = data.pos
  if self.type == 'circle2D' then
    return #(current_pos.xy - self.pos.xy) <= self.radius
  elseif self.type == 'circle' then
    return #(current_pos.xyz - self.pos.xyz) <= self.radius
  elseif self.type == 'poly' then
    return self.polygon:contains(current_pos, self.height)
  elseif self.type == 'box' then
    return current_pos.x >= (self.pos.x - self.size.x/2) and current_pos.x <= (self.pos.x + self.size.x/2)
      and current_pos.y >= (self.pos.y - self.size.y/2) and current_pos.y <= (self.pos.y + self.size.y/2)
      and current_pos.z >= (self.pos.z - self.size.z/2) and current_pos.z <= (self.pos.z + self.size.z/2)
  elseif self.type == 'game_zone' then
    return self.game_zone == (cache.game == 'fivem' and GetNameOfZone(current_pos.x,current_pos.y,current_pos.z) or GetMapZoneAtCoords(current_pos.x,current_pos.y,current_pos.z))
  end
  return false
end

function zone:enter(data)
  if self.inside then return false end
  self.inside = true
  if self.onEnter then self.onEnter(data) end
end

function zone:exit(data)
  if not self.inside then return false end
  self.inside = false
  if self.onExit then self.onExit(data) end
end

-- Drawing
local DrawPoly = DrawPoly
local DrawLine = DrawLine

local drawPolygon = function(polygon, height, color)
  for i = 1, #polygon do
    local thickness = vector3(0, 0, height)
    local a = polygon[i] + thickness
    local b = polygon[i] - thickness
    local c = (polygon[i+1] or polygon[1]) + thickness
    local d = (polygon[i+1] or polygon[1]) - thickness
    DrawLine(a.x,a.y,a.z,b.x,b.y,b.z,color.r,color.g,color.b,225)
    DrawLine(a.x,a.y,a.z,c.x,c.y,c.z,color.r,color.g,color.b,225)
    DrawLine(b.x,b.y,b.z,d.x,d.y,d.z,color.r,color.g,color.b,225)
    DrawPoly(a.x,a.y,a.z,b.x,b.y,b.z,c.x,c.y,c.z,color.r,color.g,color.b,color.a)
    DrawPoly(c.x,c.y,c.z,b.x,b.y,b.z,a.x,a.y,a.z,color.r,color.g,color.b,color.a)
    DrawPoly(b.x,b.y,b.z,c.x,c.y,c.z,d.x,d.y,d.z,color.r,color.g,color.b,color.a)
    DrawPoly(d.x,d.y,d.z,c.x,c.y,c.z,b.x,b.y,b.z,color.r,color.g,color.b,color.a)
  end
end

function zone:draw(data)
  if not self.drawZone then return false end
  local dist = #(data.pos - self.pos)
  if dist > 50.0 then return false end

  if self.type == 'circle' or self.type == 'circle2D' then
    local circle = self.type == 'circle'
    DrawMarker(1,self.pos.x,self.pos.y,circle and self.pos.z-1 or 0,0,0,0,0,0,0,self.radius*2,self.radius*2,circle and self.radius*2 or 5000,255,0,0,200,0,0,0,0)
  elseif self.type == 'poly' then
    drawPolygon(self.points, self.height, {r=255,g=0,b=0,a=200})
  elseif self.type == 'box' then
    -- optional: draw box for debug
  end
  return true
end

-- Main loop
CreateThread(function()
  while true do
    local wait_time = 1000
    local ply = cache.ped
    local my_pos = GetEntityCoords(ply)
    local gta_zone = cache.game == 'fivem' and GetNameOfZone(my_pos.x,my_pos.y,my_pos.z) or GetMapZoneAtCoords(my_pos.x,my_pos.y,my_pos.z)
    local current_state = {pos=my_pos, game_zone=gta_zone}

    local zonesToCheck = getNearbyCells(my_pos)
    -- debug
    for _, z in ipairs(zonesToCheck) do
      if z.type == 'all_game_zone' then z:handleGameZone(current_state.game_zone) end
      wait_time = z:draw(current_state) and 0 or wait_time
      if z:is_inside(current_state) then
        z:enter(current_state)
        if z.onInside then z.onInside(current_state) end
      else
        z:exit(current_state)
      end
    end

    Wait(wait_time)
  end
end)

-- Library
lib.zones = {
  register = function(name, data) return zone.new(name, data) end,
  get      = function(name) return zone.get(name) end,
  delete   = function(name) return zone.delete(name) end,
  destroy  = function(name) return zone.delete(name) end,

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
