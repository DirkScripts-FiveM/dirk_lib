local types = {
  ['error'] = {
    title     = 'Error',
    titleColor = 'rgba(155, 0, 0, 0.8)',
    icon      = 'fas fa-exclamation-circle',
    iconColor = 'rgba(155, 0, 0, 0.8)',
    iconBg    = 'rgba(155, 0, 0, 0.2)',
  },
  ['success'] = {
    title     = 'Success',
    titleColor = 'rgba(0, 155, 0, 0.8)',
    icon      = 'fas fa-check-circle',
    iconColor = 'rgba(0, 155, 0, 0.8)',
    iconBg    = 'rgba(0, 155, 0, 0.2)',
  },
  ['inform'] = {
    title      = 'Information',
    titleColor = 'rgba(0, 155, 0, 0.8)',
    icon       = 'fas fa-info-circle',
    iconColor  = 'rgba(0, 155, 0, 0.8)',
    iconBg     = 'rgba(0, 155, 0, 0.2)',
  },
  ['warning']  = {
    title      = 'Warning',
    titleColor = 'rgba(155, 155, 0, 0.8)',
    icon       = 'fas fa-exclamation-triangle',
    iconColor  = 'rgba(155, 155, 0, 0.8)',
    iconBg     = 'rgba(155, 155, 0, 0.2)',
  },
}


local cachedBridge, cachedProvider
local function getBridge()
  local provider = lib.settings.notify
  if not provider or provider == 'dirk_lib' then return nil end
  if cachedProvider ~= provider then
    cachedProvider = provider
    cachedBridge = lib.loadBridge('interface', provider, 'client')
  end
  return cachedBridge
end

lib.notify = function(data)
  if not cache.playerLoaded then return end
  data.title = data.title or (data.type and types[data.type] and types[data.type].title) or 'Notification'
  local b = getBridge()
  if b and b.notify then return b.notify(data) end

  while notification do Wait(0) end
  notification = true
  SetTimeout(100, function() notification = nil end)

  local settings = lib.settings
  if not settings.notify or settings.notify == 'dirk_lib' then
    local sound = settings.notifyAudio and data.sound
    data.title = data.title or (data.type and types[data.type]?.title) or 'Notification'
    data.position = data.position or settings.notifyPosition or 'top-right'
    -- the page colours each type itself (error red, success green, warning amber, inform = the script's accent)
    -- and draws its icon; a script's own icon / iconColor / titleColor still win
    data.theme = lib.uiTheme(GetInvokingResource() or GetCurrentResourceName())
    SendNuiMessage(json.encode({
      action = 'ADD_NOTIFICATION',
      data   = data
    }))

    if not sound then return end
    if sound.bank then lib.request.audioBank(sound.bank) end
    local soundId = GetSoundId()
    PlaySoundFrontend(soundId, sound.name, sound.set, true)
    ReleaseSoundId(soundId)
    if sound.bank then ReleaseNamedScriptAudioBank(sound.bank) end
  end
end

RegisterNetEvent('dirk_lib:notify', lib.notify)
RegisterNetEvent('dirk_lib:defaultNotify', lib.defaultNotify)

lib.defaultNotify = function(data)
  data.type = data.status
  if data.type == 'inform' then data.type = 'info' end
  return lib.notify(data)
end


local testNotifications = {
  {
    title = 'Unstyled Notification',
    description = 'This is an unstyled notification',
  },
  {
    title = 'Item Image Notification',
    description = 'This is an item image notification',
    icon = 'plastic_trowel',
  },
  {
    type = 'error',
    description = 'This is an error notification',
    sound = { name = 'ERROR', set = 'HUD_LIQUOR_STORE_SOUNDSET' }
  },
  {
    type = 'success',
    description = 'This is a success notification',
    sound = { name = 'NAV', set = 'HUD_LIQUOR_STORE_SOUNDSET' }
  },
  {
    type = 'inform',
    description = 'This is an inform notification',
    sound = { name = 'NAV', set = 'HUD_LIQUOR_STORE_SOUNDSET' }
  },
  {
    type = 'warning',
    description = 'This is a warning notification',
    sound = { name = 'NAV', set = 'HUD_LIQUOR_STORE_SOUNDSET' }
  },
  {
    title = 'Custom Notification',
    description = 'This is a custom notification with custom colors and icon',
    icon = 'fas fa-bell',
    iconColor = 'rgba(0, 155, 155, 0.8)',
    iconBg = 'rgba(0, 155, 155, 0.2)',
    titleColor = 'rgba(0, 155, 155, 0.8)',
    sound = { name = 'NAV', set = 'HUD_LIQUOR_STORE_SOUNDSET' } 
  }
}

-- Command to test all types of notifications
RegisterCommand('test_notify', function()
  for _, data in pairs(testNotifications) do
    lib.notify(data)
    Wait(500)
  end
end, false)



