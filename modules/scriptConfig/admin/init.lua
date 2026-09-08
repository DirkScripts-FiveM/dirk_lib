-- Bootstrap for the admin-tool subsystem.
--
-- Required by modules/scriptConfig/client.lua at startup. This file runs
-- inside the consumer's resource VM (because @dirk_lib/init.lua is loaded
-- via shared_script). Result: every consumer with `dirk_lib 'scriptConfig'`
-- in their fxmanifest gets the admin tools registered automatically — no
-- per-consumer Lua, no fxmanifest tweaks, no manual hooks.
--
-- Tools live under tools/* and each one:
--   • Calls `lib.adminTool.register(id, kind, fn)` to plug into the
--     central NUI dispatcher — no per-tool RegisterNUICallback needed.
--   • Adds its public Lua API (if any) to the `lib.adminTool.*` namespace.
--   • Self-guards on `lib.adminTool.isEditing()` so a NUI iframe that
--     somehow stays alive after the admin closes the panel can't fire
--     tools.
--
-- `lib` has a __index lazy loader that returns a loader-function for any
-- key not already present (so `lib.foo` tries to load `modules/foo`). That
-- means `lib.adminTool = lib.adminTool or {}` would see the loader function
-- (truthy) and never assign the empty table. rawset bypasses the metatable.
if type(rawget(lib, 'adminTool')) ~= 'table' then
  rawset(lib, 'adminTool', {})
end

local adminEditing = false

--- Is dirk_lib's OWN panel open?
---
--- The local flag is set by this VM's `dirk_lib:scriptConfigOpened`, which
--- fires for the resource whose settings were opened. Script Studio is one
--- panel over every script, so dirk_lib's own VM can be hosting the page for
--- somebody else's settings and never see that event. Asking dirk_lib
--- directly covers that; the local flag covers a consumer's own UI.
---
--- pcall'd because this file also loads on the server, where the export does
--- not exist and a hard error would take the caller with it.
local function libPanelOpen()
  local ok, open = pcall(function() return exports.dirk_lib:isDirkAdminUiOpen() end)
  return ok and open == true
end

---@return boolean editing True while a scriptConfig admin panel is open.
function lib.adminTool.isEditing()
  return adminEditing or libPanelOpen()
end

AddEventHandler('dirk_lib:scriptConfigOpened', function()
  adminEditing = true
end)

AddEventHandler('dirk_lib:scriptConfigClosed', function()
  adminEditing = false
end)

-- ── Central handler registry + NUI dispatchers ───────────────────────────
-- One entry per (kind, id). `kind` reflects the NUI lifecycle the React
-- side expects:
--   begin  — long-running flow (capture position, pick door). React fires
--            ADMIN_TOOL_BEGIN, Lua does work, sends back <id>_RESULT or
--            <id>_CANCELLED via SendNuiMessage when it's done.
--   invoke — fire-and-forget (gotoCoord). React fires ADMIN_TOOL_INVOKE,
--            Lua does the work, no reply.
--   query  — sync request/response (validateModels). React fires
--            ADMIN_TOOL_QUERY, fetchNui resolves with the return value.
local handlers = { begin = {}, invoke = {}, query = {} }

---Register a handler for one admin-tool NUI dispatch.
---@param id     string  Tool id. Matches `data.id` from the React fetchNui call.
---@param kind   '"begin"'|'"invoke"'|'"query"'
---@param fn     function Handler. begin/invoke receive `data`; query receives `data` and returns the response value.
function lib.adminTool.register(id, kind, fn)
  if type(id) ~= 'string' or id == '' then
    lib.print.warn('[lib.adminTool.register] id (string) is required')
    return
  end
  if not handlers[kind] then
    lib.print.warn(('[lib.adminTool.register] unknown kind "%s" — expected begin|invoke|query'):format(tostring(kind)))
    return
  end
  if type(fn) ~= 'function' then
    lib.print.warn(('[lib.adminTool.register] handler for [%s/%s] must be a function'):format(kind, id))
    return
  end
  handlers[kind][id] = fn
end

--- Why a dispatch went nowhere.
---
--- Every refusal below used to be a bare `return`, which is right for the
--- SECURITY case — a devtools call should get nothing back — and wrong for
--- everyone else, because the two failures that actually happen in
--- development look identical to it from the UI: the panel is not registered
--- as open, or nothing ever registered that tool id. Both present as "the
--- button does nothing", with not one line anywhere saying so.
---
--- Warn, do not error: this is reachable from the NUI, so it must not become
--- a way to spam the console into uselessness. One line, naming the id.
local function refuse(kind, id, why)
  lib.print.warn(('[adminTool] %s "%s" ignored — %s'):format(kind, tostring(id), why))
end

RegisterNUICallback('ADMIN_TOOL_BEGIN', function(data, cb)
  cb({})
  local id = type(data) == 'table' and data.id or nil
  if not lib.adminTool.isEditing() then return refuse('begin', id, 'the config panel is not open') end
  if type(id) ~= 'string' then return refuse('begin', id, 'no tool id was sent') end
  local handler = handlers.begin[id]
  if type(handler) ~= 'function' then return refuse('begin', id, 'no tool registered under that id') end
  handler(data)
end)

RegisterNUICallback('ADMIN_TOOL_INVOKE', function(data, cb)
  cb({})
  local id = type(data) == 'table' and data.id or nil
  if not lib.adminTool.isEditing() then return refuse('invoke', id, 'the config panel is not open') end
  if type(id) ~= 'string' then return refuse('invoke', id, 'no tool id was sent') end
  local handler = handlers.invoke[id]
  if type(handler) ~= 'function' then return refuse('invoke', id, 'no tool registered under that id') end
  handler(data)
end)

RegisterNUICallback('ADMIN_TOOL_QUERY', function(data, cb)
  local id = type(data) == 'table' and data.id or nil
  if not lib.adminTool.isEditing() then refuse('query', id, 'the config panel is not open') return cb(nil) end
  if type(id) ~= 'string' then refuse('query', id, 'no tool id was sent') return cb(nil) end
  local handler = handlers.query[id]
  if type(handler) ~= 'function' then refuse('query', id, 'no tool registered under that id') return cb(nil) end
  local ok, result = pcall(handler, data)
  if not ok then
    lib.print.warn(('adminTool query [%s] errored: %s'):format(data.id, tostring(result)))
    return cb(nil)
  end
  cb(result)
end)

-- Load every tool. Adding a new one = drop a new file in tools/ and add
-- one require line below — no central registry to wire up.
require '@dirk_lib/modules/scriptConfig/admin/tools/position'
require '@dirk_lib/modules/scriptConfig/admin/tools/object'
require '@dirk_lib/modules/scriptConfig/admin/tools/models'
require '@dirk_lib/modules/scriptConfig/admin/tools/players'

-- ── pickDoor forwarder ────────────────────────────────────────────────
-- The picker logic lives in dirk_lib's own VM (src/tools/client/
-- pickDoorTool.lua) so it draws sphere/outline natives from a clean
-- render context. This consumer-side forwarder just relays:
--
--   ADMIN_TOOL_BEGIN {id='pickDoor'} → dirk_lib:adminTool:pickDoor:begin
--                                         (handled in dirk_lib's VM)
--   ↓ picker runs ↓
--   dirk_lib:adminTool:pickDoor:result → SendNuiMessage to this
--                                         consumer's NUI so the React
--                                         promise resolver settles
--
-- Two thin lines per direction, zero picker logic in the consumer.
lib.adminTool.register('pickDoor', 'begin', function()
  -- SetNuiFocus is per-resource. The admin clicked Pick Door from THIS
  -- consumer's NUI, so this consumer owns the focus — dirk_lib calling
  -- SetNuiFocus(false, false) from its own VM wouldn't release it.
  -- Release here, regrab on result below.
  SetNuiFocus(false, false)
  TriggerScreenblurFadeOut(0)
  TriggerEvent('dirk_lib:adminTool:pickDoor:begin', cache.resource)
end)

AddEventHandler('dirk_lib:adminTool:pickDoor:result', function(originResource, payload)
  -- Only relay results meant for THIS consumer — every consumer's init
  -- runs in its own VM and listens to the same global event, so we
  -- filter on the origin tag the tool fired with.
  if originResource ~= cache.resource then return end
  SetNuiFocus(true, true)
  TriggerScreenblurFadeIn(0)
  SendNuiMessage(json.encode({
    action = payload and 'pickDoor_RESULT' or 'pickDoor_CANCELLED',
    data   = payload,
  }))
end)
