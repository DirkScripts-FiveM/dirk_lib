local objects = {}
local object = {}
object.__index = object

object.new = function(id, data)
  
  local self = setmetatable(data, object)
  self.id = id

  
  self:__init()

  objects[id] = self
  return self
end

object.get = function(id)
  return objects[id]
end

object.delete = function(id)
  local this = objects[id]
  if not this then return 
    lib.print.debug(('object %s does not exist'):format(id))
  end
  this:despawn()
  objects[id] = nil
  lib.zones.destroy(id)
end

function object:__init()
  self.resource = cache.resource
  assert(self.type, 'object must have a specified type : ped, vehicle, object, weapon')
  assert(self.model, 'object must have a model')
  assert(self.pos, 'object must have a position')
  self.renderDist = self.renderDist or 50.0

  local stock_funcs = {
    onEnter = function()
      -- `canSpawn and canSpawn() or true` was always true: a canSpawn returning false still spawned
      local can_spawn = not self.canSpawn or self.canSpawn()
      if not can_spawn then return end
      self:spawn()
    end,

    onExit = function()
      self:despawn()
    end, 

    onInside = function()
      if self.canSpawn then 
        local result = self.canSpawn()
        if not result then 
          self:despawn()
          return 
        end
      end

      self:spawn()
    end,
  }

  if type(self.pos) == 'table' then --\\ Poly? 
    local settings = {
      type   = 'poly', 
      points = self.pos,
    }
    settings.onEnter  = stock_funcs.onEnter
    settings.onExit   = stock_funcs.onExit
    settings.onInside = stock_funcs.onInside
    lib.zones.register(self.id, settings)
  else 
    local settings = {
      type   = 'circle', 
      pos    = self.pos,
      radius = self.renderDist,
    }
    settings.onEnter  = stock_funcs.onEnter
    settings.onExit   = stock_funcs.onExit
    settings.onInside = stock_funcs.onInside
    lib.zones.register(self.id, settings)
  end

  AddEventHandler('onResourceStop', function(resource)
    if self.resource == resource or resource == 'dirk_lib' then 
      self:despawn()
    end
  end)

  -- lib.print.debug(('object %s registered'):format(self.id))
end

function object:despawn()
  if not self.entity then return end
  DeleteEntity(self.entity)
  self.entity = nil

  if self.onDespawn then 
    self:onDespawn()
  end
end

function object:spawn()
  if self.entity and self.entity ~= 0 then return end
  -- self.model becomes the hash after the first spawn: joaat(number) hashes its DIGITS, so every respawn (leave the render
  -- distance and come back) asked for a model that does not exist and the assert below fired
  local model_hash = type(self.model) == 'number' and self.model or joaat(self.model)
  local model_loaded = false
  if self.type ~= 'weapon' then 
    model_loaded = lib.request.model(model_hash, 15000)
  else 
    model_loaded = lib.request.weaponAsset(model_hash, 15000)
  end

  assert(model_loaded, 'Failed to load model : ' .. self.model)
  self.model = model_hash
  if self.type == 'ped' then 
    self.entity = CreatePed(1, self.model, self.pos, false, false)
    if self.entity and cache.game == 'redm' then 
      SetPedDefaultOutfit(self.entity, true)
    end
  elseif self.type == 'vehicle' then
    self.entity = CreateVehicle(self.model, self.pos, false, false)
  elseif self.type == 'object' then
    -- Pass coords explicitly. self.pos is a vector4 and unpacking it into
    -- CreateObject(model, x, y, z, isNetwork, netMissionEntity, doorFlag)
    -- pushes the W (heading) component into the isNetwork slot, which
    -- silently spawns a networked entity whenever heading != 0 — every
    -- player in range then spawns their own networked copy, all visible
    -- to each other (stacked buoys / props).
    self.entity = CreateObject(self.model, self.pos.x, self.pos.y, self.pos.z, false, false, false)
  elseif self.type == 'weapon' then 
    self.entity = CreateWeaponObject(self.model, 1, self.pos, false, 0.0)
    RequestWeaponHighDetailModel(self.entity)
  end
  
  if self.pos.w then 
    SetEntityHeading(self.entity, self.pos.w)
  end

  while not DoesEntityExist(self.entity) do 
    Wait(0)
  end
  SetModelAsNoLongerNeeded(model_hash)

  if self.onSpawn then 
    self:onSpawn({
      entity = self.entity
    })
  end


  return self.entity
end

lib.objects = {
  register = function(id, new_data)
    if objects[id] then 
      lib.print.error(('object %s already exists'):format(id))
      return 
    end
    return object.new(id, new_data)
  end,

  get = function(id)
    return object.get(id)
  end,

  delete = function(id)
    return object.delete(id)
  end,

  destroy = function(id)
    return object.delete(id)
  end,
}



return lib.objects

