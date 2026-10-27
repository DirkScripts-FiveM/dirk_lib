local cachedBridge, cachedProvider
local function getBridge()
  local provider = lib.settings.alertDialog or lib.settings.dialog
  if not provider or provider == 'dirk_lib' then return nil end
  if cachedProvider ~= provider then
    cachedProvider = provider
    cachedBridge = lib.loadBridge('interface', provider, 'client')
  end
  return cachedBridge
end

---@type promise?
local alert = nil
local alertId = 0

---@class AlertDialogProps
---@field header string
---@field content string
---@field centered? boolean
---@field size? 'xs' | 'sm' | 'md' | 'lg' | 'xl'
---@field overflow? boolean
---@field cancel? boolean
---@field labels? {cancel?: string, confirm?: string}

---@param data AlertDialogProps
---@param timeout? number Force the dialog to auto-close after `x` milliseconds.
---@return 'cancel' | 'confirm' | nil
function lib.alertDialog(data, timeout)
    local theme = lib.uiTheme(GetInvokingResource() or GetCurrentResourceName())

    local b = getBridge()
    if b and b.alertDialog then return b.alertDialog(data, timeout) end

    if alert then return end

    local id = alertId + 1
    alertId = id
    alert = promise.new()

    SetNuiFocus(true, true)
    -- a copy, so the caller's table doesn't keep this call's theme / timeout
    local payload = {}
    for k, v in pairs(data) do payload[k] = v end
    payload.theme = theme
    payload.timeout = timeout -- the dialog shows the countdown; Lua still does the closing
    SendNuiMessage(json.encode({
        action = 'SHOW_ALERT_DIALOG',
        data = payload
    }))

    if timeout then
        SetTimeout(timeout, function()
            if id == alertId then lib.closeAlertDialog('timeout') end
        end)
    end

    return Citizen.Await(alert)
end

---@param reason? string An optional reason for the dialog to be closed.
function lib.closeAlertDialog(reason)
    if not alert then return end

    SetNuiFocus(false, false)
    SendNuiMessage(json.encode({
        action = 'CLOSE_ALERT_DIALOG'
    }))

    local p = alert
    alert = nil

    if reason then p:reject(reason) else p:resolve() end
end

RegisterNuiCallback('ALERT_DIALOG_RESULT', function(data, cb)
    cb(1)
    SetNuiFocus(false, false)

    local p = alert --[[@as promise]]
    alert = nil

    if p then
        p:resolve(data)
    end
end)
