-- THANKS TO THE DIVA AT OX FOR BACKEND OF PROG BARS LAZY BOI HERE https://github.com/overextended/ox_lib/blob/master/resource/interface/client/progress.lua
local cachedBridge, cachedProvider
local function getBridge()
  local provider = lib.settings.progress
  if not provider or provider == 'dirk_lib' then return nil end
  if cachedProvider ~= provider then
    cachedProvider = provider
    cachedBridge = lib.loadBridge('interface', provider, 'client')
  end
  return cachedBridge
end

local progress
local DisableControlAction = DisableControlAction
local DisablePlayerFiring = DisablePlayerFiring
local playerState = LocalPlayer.state
local createdProps = {}

---@class ProgressPropProps
---@field model string
---@field bone? number
---@field pos vector3
---@field rot vector3
---@field rotOrder? number

---@class ProgressProps
---@field label? string
---@field duration number
---@field position? 'middle' | 'bottom'
---@field useWhileDead? boolean
---@field allowRagdoll? boolean
---@field allowCuffed? boolean
---@field allowFalling? boolean
---@field allowSwimming? boolean
---@field canCancel? boolean
---@field anim? { dict?: string, clip: string, flag?: number, blendIn?: number, blendOut?: number, duration?: number, playbackRate?: number, lockX?: boolean, lockY?: boolean, lockZ?: boolean, scenario?: string, playEnter?: boolean }
---@field prop? ProgressPropProps | ProgressPropProps[]
---@field disable? { move?: boolean, sprint?: boolean, car?: boolean, combat?: boolean, mouse?: boolean }

local function createProp(ped, prop)
  lib.request.model(prop.model)
  local coords = GetEntityCoords(ped)
  local object = CreateObject(prop.model, coords.x, coords.y, coords.z, false, false, false)

  AttachEntityToEntity(object, ped, GetPedBoneIndex(ped, prop.bone or 60309), prop.pos.x, prop.pos.y, prop.pos.z, prop.rot.x, prop.rot.y, prop.rot.z, true, true, false, true, prop.rotOrder or 0, true)
  SetModelAsNoLongerNeeded(prop.model)

  return object
end

local function interruptProgress(data)
  if not data.useWhileDead and IsEntityDead(cache.ped) then return true end
  if not data.allowRagdoll and IsPedRagdoll(cache.ped) then return true end
  if not data.allowCuffed and IsPedCuffed(cache.ped) then return true end
  if not data.allowFalling and IsPedFalling(cache.ped) then return true end
  if not data.allowSwimming and IsPedSwimming(cache.ped) then return true end
end

local isFivem = cache.game == 'fivem'

local controls = {
  INPUT_LOOK_LR = isFivem and 1 or 0xA987235F,
  INPUT_LOOK_UD = isFivem and 2 or 0xD2047988,
  INPUT_SPRINT = isFivem and 21 or 0x8FFC75D6,
  INPUT_AIM = isFivem and 25 or 0xF84FA74F,
  INPUT_MOVE_LR = isFivem and 30 or 0x4D8FB4C1,
  INPUT_MOVE_UD = isFivem and 31 or 0xFDA83190,
  INPUT_DUCK = isFivem and 36 or 0xDB096B85,
  INPUT_VEH_MOVE_LEFT_ONLY = isFivem and 63 or 0x9DF54706,
  INPUT_VEH_MOVE_RIGHT_ONLY = isFivem and 64 or 0x97A8FD98,
  INPUT_VEH_ACCELERATE = isFivem and 71 or 0x5B9FD4E2,
  INPUT_VEH_BRAKE = isFivem and 72 or 0x6E1F639B,
  INPUT_VEH_EXIT = isFivem and 75 or 0xFEFAB9B4,
  INPUT_VEH_MOUSE_CONTROL_OVERRIDE = isFivem and 106 or 0x39CCABD5
}

local function startProgress(data)
  playerState.invBusy = true
  progress = data
  local anim = data.anim

  if anim then
    if anim.dict then
      lib.request.animDict(anim.dict)

      TaskPlayAnim(cache.ped, anim.dict, anim.clip, anim.blendIn or 3.0, anim.blendOut or 1.0, anim.duration or -1, anim.flag or 49, anim.playbackRate or 0, anim.lockX, anim.lockY, anim.lockZ)
      RemoveAnimDict(anim.dict)
    elseif anim.scenario then
      TaskStartScenarioInPlace(cache.ped, anim.scenario, 0, anim.playEnter ~= nil and anim.playEnter or true)
    end
  end

  if data.prop then
      playerState:set('dirk_lib:progressProps', data.prop, true)
  end

  local disable = data.disable

  while progress do
    if disable then
      if disable.mouse then
        DisableControlAction(0, controls.INPUT_LOOK_LR, true)
        DisableControlAction(0, controls.INPUT_LOOK_UD, true)
        DisableControlAction(0, controls.INPUT_VEH_MOUSE_CONTROL_OVERRIDE, true)
      end

      if disable.move then
        DisableControlAction(0, controls.INPUT_SPRINT, true)
        DisableControlAction(0, controls.INPUT_MOVE_LR, true)
        DisableControlAction(0, controls.INPUT_MOVE_UD, true)
        DisableControlAction(0, controls.INPUT_DUCK, true)
      end

      if disable.sprint and not disable.move then
        DisableControlAction(0, controls.INPUT_SPRINT, true)
      end

      if disable.car then
        DisableControlAction(0, controls.INPUT_VEH_MOVE_LEFT_ONLY, true)
        DisableControlAction(0, controls.INPUT_VEH_MOVE_RIGHT_ONLY, true)
        DisableControlAction(0, controls.INPUT_VEH_ACCELERATE, true)
        DisableControlAction(0, controls.INPUT_VEH_BRAKE, true)
        DisableControlAction(0, controls.INPUT_VEH_EXIT, true)
      end

      if disable.combat then
        DisableControlAction(0, controls.INPUT_AIM, true)
        DisablePlayerFiring(cache.playerId, true)
      end
    end

    if interruptProgress(progress) then
      progress = false
    end

    Wait(0)
  end

  if data.prop then
    playerState:set('dirk_lib:progressProps', nil, true)
  end

  if anim then
    if anim.dict then
      StopAnimTask(cache.ped, anim.dict, anim.clip, 1.0)
      Wait(0) -- This is needed here otherwise the StopAnimTask is cancelled
    else
      ClearPedTasks(cache.ped)
    end
  end

  playerState.invBusy = false

  if progress == false then
    SendNUIMessage({ action = 'CANCEL_PROGRESS' })
    return false
  end

  return true
end

---@param data ProgressProps
---@return boolean?
function lib.progressBar(data)
  -- Read FIRST. `GetInvokingResource` answers only for the frame that crossed
  -- the export boundary, and the wait below ends that frame — after it, every
  -- progress bar would come back as dirk_lib's.
  local theme = lib.uiTheme(GetInvokingResource() or GetCurrentResourceName())

  local b = getBridge()
  if b and b.progressBar then return b.progressBar(data) end

  while progress ~= nil do Wait(0) end

  if not interruptProgress(data) then
    SendNUIMessage({
      action = 'SHOW_PROGRESS',
      data = {
        label = data.label,
        duration = data.duration,
        position = data.position or lib.settings.progBarPosition or 'bottom-center',
        icon     = data.icon,
        description = data.description,
        theme    = theme,
      }
    })

    return startProgress(data)
  end
end

---@param data ProgressProps
---@return boolean?
function lib.progressCircle(data)
  -- Read FIRST, same reason as the bar: the wait below ends the frame that
  -- carried the invoking resource.
  local theme = lib.uiTheme(GetInvokingResource() or GetCurrentResourceName())

  local b = getBridge()
  if b and b.progressCircle then return b.progressCircle(data) end

  while progress ~= nil do Wait(0) end

  if not interruptProgress(data) then
    SendNUIMessage({
      action = 'circleProgress',
      data = {
        duration = data.duration,
        position = data.position or lib.settings.progBarPosition or 'bottom-center',
        label = data.label,
        theme = theme,
      }
    })

    return startProgress(data)
  end
end

function lib.cancelProgress()
  local b = getBridge()
  if b and b.cancelProgress then return b.cancelProgress() end

  if not progress then
    error('No progress bar is active')
  end

  progress = false
end

---@return boolean
function lib.progressActive()
  local b = getBridge()
  if b and b.progressActive then return b.progressActive() end

  return progress and true
end

RegisterNUICallback('PROGRESS_COMPLETE', function(data, cb)
  cb(1)
  progress = nil
end)

RegisterCommand('cancel_lib_progress', function()
  if progress?.canCancel then 
    progress = false 
  end
end)

if isFivem then
  RegisterKeyMapping('cancel_lib_progress', locale('CancelProgress'), 'keyboard', 'x')
end

local function deleteProgressProps(serverId)
  local playerProps = createdProps[serverId]
  if not playerProps then return end
  for i = 1, #playerProps do
    local prop = playerProps[i]
    if DoesEntityExist(prop) then
      DeleteEntity(prop)
    end
  end
  createdProps[serverId] = nil
end

RegisterNetEvent('onPlayerDropped', function(serverId)
  deleteProgressProps(serverId)
end)

AddStateBagChangeHandler('dirk_lib:progressProps', nil, function(bagName, key, value, reserved, replicated)
  if replicated then return end

  local ply = GetPlayerFromStateBagName(bagName)
  if ply == 0 then return end

  local ped = GetPlayerPed(ply)
  local serverId = GetPlayerServerId(ply)
  
  if not value then
    return deleteProgressProps(serverId)
  end
  
  createdProps[serverId] = {}
  local playerProps = createdProps[serverId]
  
  if value.model then
    playerProps[#playerProps+1] = createProp(ped, value)
  else
    for i = 1, #value do
      local prop = value[i]

      if prop then
        playerProps[#playerProps+1] = createProp(ped, prop)
      end
    end
  end
end)


RegisterCommand('test_progress', function()
  lib.progressBar({
    label = 'Testing Progress',
    duration = 10000,
    anim = { dict = 'amb@world_human_drinking@beer@male@idle_a', clip = 'idle_c', flag = 49 },
    prop = { model = 'prop_amb_beer_bottle', bone = 28422, pos = vector3(0.0, 0.0, 0.0), rot = vector3(0.0, 0.0, 0.0) },
    disable = { move = true, combat = true }
  })
end)