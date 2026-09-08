local blips = {}
local blip = {}
blip.__index = blip

blip.new = function(id, data)
  local self = setmetatable(data, blip)
  self.id = id
  self:__init()
  blips[id] = self
  return self
end

blip.get = function(id)
  return blips[id]
end

blip.delete = function(id)
  local blip = blips[id]
  if blip then
    blip:hide()
  end
  blips[id] = nil
end

--- Change a live blip.
---
--- Taken off and put back rather than edited in place: the shape can change as
--- well as the look — a coord blip becoming an area or a radius one — and those
--- are different natives, not different arguments.
---
--- `foundBlip`, NOT `blip`. This read `blip:hide()` and `blip:render()`, which
--- are the CLASS, not the instance. The class has no `self.blip`, so `hide` bailed
--- immediately and left the real blip on the map with nothing pointing at it any
--- more, and `render` then went looking for `self.pos` on the class and threw. So
--- every call errored AND leaked a blip, which is why callers stopped using it.
blip.update = function(id, data)
  local foundBlip = blips[id]
  if not foundBlip then return end

  for k, v in pairs(data) do
    foundBlip[k] = v
  end

  foundBlip:hide()
  foundBlip:render()
  return foundBlip
end


function blip:__init()
  assert(self.pos, 'blip must have a position')
  assert(self.name, 'blip must have a name')
  assert(self.sprite, 'blip must have a sprite')
  assert(self.display, 'blip must have a display')
  assert(self.scale, 'blip must have a scale')
  assert(self.color, 'blip must have a color')

  assert(not self.area or self.area?.width, 'blip area must have a width')
  assert(not self.area or self.area?.height, 'blip area must have a height')

  assert(not self.radius or type(self.radius) == 'number', 'blip radius must be a number')

  assert(not self.entity or type(self.entity) == 'number', 'blip entity must be a number')
  self:render()
end

--- Should this blip be on the map right now?
---
--- A blip with no `canSee` is always on — that is every blip in every resource
--- today, so this is the answer that has to stay cheap and unsurprising.
---
--- This used to end in `or true`, which is true whenever the left side is false.
--- So it answered YES unconditionally and `canSee` did nothing at all: a blip
--- meant to appear only while you are on the job was on the map permanently.
--- The old shape also compared against `nil`, so a `canSee` returning `false`
--- read as visible — the one answer it exists to give.
function blip:canRender()
  if not self.canSee then return true end
  return self.canSee() and true or false
end


function blip:render()
  if self.blip then return end
  if not self:canRender() then return end
  local blip
  if self.area then
    blip = AddBlipForArea(self.pos.x, self.pos.y, self.pos.z, self.area.width, self.area.height)
  elseif self.radius then
    blip = AddBlipForRadius(self.pos.x, self.pos.y, self.pos.z, self.radius)
  elseif self.entity then
    blip = AddBlipForEntity(self.entity)
  else
    blip = AddBlipForCoord(self.pos.x, self.pos.y, self.pos.z)
  end

  if not self.radius then 
    SetBlipSprite(blip, self.sprite or 1)
    SetBlipScale(blip, self.scale or 1.0)
  end 

  if cache.game == 'fivem' then
    SetBlipDisplay(blip, self.display or 4)
    SetBlipColour(blip, self.color or 1)
    -- `x ~= nil and x or true` is the classic Lua and/or trap: with `x` false it
    -- reads `(true and false) or true`, which is TRUE. So short-range could be
    -- asked for but never turned off, and a blip meant to show across the whole
    -- map only appeared once you were near it.
    SetBlipAsShortRange(blip, self.shortRange ~= false)
    SetBlipCategory(blip, self.category or 1)
    SetBlipAlpha(blip, self.alpha or 255)
  end

  if self.rotation then SetBlipRotation(blip, self.rotation or 0) end

  if self.route then
    SetBlipRoute(blip, true)
  end

  if cache.game == 'redm' then 
    Citizen.InvokeNative(0x9CB1A1623062F402 , blip, self.name or 'Blip')
  elseif cache.game == 'fivem' then
    AddTextEntry(self.id, self.name or 'Blip')
    BeginTextCommandSetBlipName(self.id)
    EndTextCommandSetBlipName(blip)
  end

  self.blip = blip
end

--- Take it off the map, but keep the registration.
---
--- This is what `canSee` needs and `destroy` cannot give it: a blip that comes
--- back. Destroying forgets the blip entirely, so there is nothing left to
--- re-render when the player is back on the job. A caller switching a blip off
--- for good wants `lib.blip.destroy`.
function blip:hide()
  if not self.blip then return end
  RemoveBlip(self.blip)
  self.blip = nil
end

--- ONE handler for every blip, registered once when the module loads.
---
--- This used to be registered inside `render`, so a blip was handed a fresh
--- handler every time it was drawn — and a `canSee` blip is drawn again every
--- time it comes back into view. Handlers are never removed, so a blip that
--- flickered on and off for an hour left an hour's worth of them behind.
---
--- `modules/*` load into the CONSUMER's VM, so `GetCurrentResourceName` here is
--- the resource that owns these blips, which is exactly what should clear them.
AddEventHandler('onResourceStop', function(resource)
  if resource ~= GetCurrentResourceName() and resource ~= 'dirk_lib' then return end
  for _, v in pairs(blips) do v:hide() end
end)


CreateThread(function()
  while true do
    local wait_time = 1000
    for k,v in pairs(blips) do
      if v.canSee then
        if v:canRender() then
          v:render()
        else
          v:hide()
        end
      end
    end


    Wait(wait_time)
  end
end)




lib.blip = {
  register = function(id, data)
    if blips[id] then
      lib.print.error(('blip %s already exists'):format(id))
      return
    end
    return blip.new(id, data)
  end,

  destroy = function(id)
    return blip.delete(id)
  end,

  get = function(id)
    return blip.get(id)
  end,

  update = function(id, data)
    return blip.update(id, data)
  end
}

return lib.blip

