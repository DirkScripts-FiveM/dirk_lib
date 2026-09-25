-- ─────────────────────────────────────────────────────────────────────────────
-- Linked account: the NUI's four calls, relayed to the server.
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
}

for nuiName, callback in pairs(CALLS) do
  RegisterNuiCallback(nuiName, function(_, cb)
    if not adminUiOpen() then cb({ success = false, _error = 'NotOpen' }) return end
    CreateThread(function()
      local ok, result, err = pcall(lib.callback.await, callback)
      if not ok or type(result) ~= 'table' then
        cb({ success = false, _error = (ok and err) or 'NoAnswer' })
        return
      end
      cb({ success = true, data = result })
    end)
  end)
end
