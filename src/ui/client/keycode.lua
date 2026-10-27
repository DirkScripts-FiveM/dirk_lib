local keycodePromise

lib.keycode = function(code, opts)
  if keycodePromise then return false end
  opts = opts or {}
  keycodePromise = promise.new()

  SetNuiFocus(true, true)
  SendNuiMessage(json.encode({
    action = 'OPEN_KEYCODE',
    data = {
      code          = tostring(code),
      title         = opts.title or 'Security Panel',
      description   = opts.description,
      multipleTries = opts.multipleTries == true,
      tries         = tonumber(opts.tries), -- optional: how many goes (the pad counts them down)
      allowCancel   = opts.allowCancel ~= false,
      length        = opts.length, -- optional fixed length, auto-submit when reached
      theme         = lib.uiTheme(GetInvokingResource() or GetCurrentResourceName()),
    },
  }))

  local result = Citizen.Await(keycodePromise)
  keycodePromise = nil
  SetNuiFocus(false, false)
  return result == true
end

RegisterNuiCallback('KEYCODE_RESULT', function(data, cb)
  cb({})
  if not keycodePromise then return end
  keycodePromise:resolve(data and data.correct == true)
end)
