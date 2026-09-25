-- ─────────────────────────────────────────────────────────────────────────────
-- Linked account: the NUI's calls, relayed to the server.
--
-- Nothing is decided here. The server checks the player may edit dirk_lib's
-- settings on every call, and the answers carry no secret (the key and the poll
-- secret never leave the server). The admin-UI check is only the outer door,
-- the same one src/nuiBridge.lua puts in front of everything that acts: without
-- it these are one `fetch` away from anyone with CEF devtools open.
-- ─────────────────────────────────────────────────────────────────────────────

local function adminUiOpen()
  local ok, open = pcall(function() return exports.dirk_lib:isDirkAdminUiOpen() end)
  return ok and open == true
end

local CALLS = {
  LINK_STATUS = 'dirk_lib:link:status',
  LINK_START  = 'dirk_lib:link:start',
  LINK_CANCEL = 'dirk_lib:link:cancel',
  LINK_UNLINK = 'dirk_lib:link:unlink',
  LINK_TICKETS = 'dirk_lib:link:tickets',
  LINK_SEND   = 'dirk_lib:link:send',
}

for nuiName, callback in pairs(CALLS) do
  RegisterNuiCallback(nuiName, function(data, cb)
    if not adminUiOpen() then cb({ success = false, _error = 'NotOpen' }) return end
    -- the one argument any of them takes: which ticket LINK_SEND sends to (the
    -- server only sends to a ticket it just offered, so this can't be steered)
    local ticketId = type(data) == 'table' and type(data.ticketId) == 'string' and data.ticketId or nil
    CreateThread(function()
      local ok, result, err = pcall(lib.callback.await, callback, ticketId)
      if not ok or type(result) ~= 'table' then
        cb({ success = false, _error = (ok and err) or 'NoAnswer' })
        return
      end
      cb({ success = true, data = result })
    end)
  end)
end
