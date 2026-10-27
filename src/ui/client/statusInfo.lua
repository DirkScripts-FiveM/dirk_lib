--[[
type Status = {
  id: string; 
  title: string;
  icon?: string;
  description: string;
  time?: number;
  progress?: number; 
  progText?: string;
  color?: string; -- the edge + bar colour for this one (default: the script's accent)
}
]]

local StatusInfos = {}
local StatusInfo = {}
StatusInfo.__index = StatusInfo

function StatusInfo:serialize()
  return {
    id          = self.id,
    title       = self.title,
    icon        = self.icon,
    description = self.description,
    time        = self.time,
    progress    = self.progress,
    progText    = self.progText,
    color       = self.color,
    theme       = lib.uiTheme(self.resource),
  }
end

function StatusInfo:__init()
  -- Display it. 
  self.resource = GetInvokingResource() or GetCurrentResourceName() or 'unknown'
  SendNuiMessage(json.encode({
    action = 'ADD_STATUS',
    data   = self:serialize()
  }))
  
  AddEventHandler('onResourceStop', function(resource)
    if resource == self.resource then
      StatusInfo.destroy(self.id)
    end
  end)

end

function StatusInfo:__destroy()
  self.open = false
  SendNuiMessage(json.encode({
    action = 'REMOVE_STATUS',
    data     = self.id
  }))
end

function StatusInfo:update(data)
  for k, v in pairs(data) do
    self[k] = v
  end
  SendNuiMessage(json.encode({
    action = 'UPDATE_STATUS',
    data   = self:serialize()
  }))
end

RegisterNuiCallback('STATUS_TIMER_OVER', function(data, cb)
  local status = StatusInfo.get(data.id)
  if status then
    if status.onTimeUp then
      status.onTimeUp()
    end
    if status.destroyOnTimeUp == nil or status.destroyOnTimeUp then
      SetTimeout(2500, function()
        StatusInfo.destroy(data.id)
      end)
    end
  end
  cb({})
end)

StatusInfo.register = function(id, data)
  assert(id, "StatusInfo.register: id is nil")
  assert(data and type(data) == "table", "StatusInfo.register: data is nil or not a table")
  local self = setmetatable(data, StatusInfo)
  self.id = id
  self:__init()
  StatusInfos[id] = self
end 

StatusInfo.get = function(id)
  return StatusInfos[id]
end

StatusInfo.getAll = function()
  return StatusInfos
end

StatusInfo.destroy = function(id)
  local status = StatusInfo.get(id)
  if status then
    status:__destroy()
    StatusInfos[id] = nil
  end
end

StatusInfo.update = function(id, data)
  local status = StatusInfo.get(id)
  if status then
    status:update(data)
  end
end

local statusDisplayState = true
StatusInfo.hideAllStatus = function(toggle)
  if statusDisplayState == toggle then return end
  statusDisplayState = toggle
  SendNuiMessage(json.encode({
    action = 'HIDE_ALL_STATUS',
    data   = toggle
  }))
end

AddStateBagChangeHandler('hiddenHud', ('player:%s'):format(cache.serverId), function(_, _, value)
  if value == nil then return end
  StatusInfo.hideAllStatus(value)
end)


lib.registerStatusInfo = StatusInfo.register
lib.getStatusInfo      = StatusInfo.get
lib.getStatusInfos     = StatusInfo.getAll
lib.updateStatusInfo   = StatusInfo.update
lib.destroyStatusInfo  = StatusInfo.destroy