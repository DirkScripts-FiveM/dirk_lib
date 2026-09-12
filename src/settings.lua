-- --------------------------------------------------
-- lib.settings — bootstrap
-- --------------------------------------------------
-- The single source of truth for dirk_lib configuration is schema.json
-- + scriptConfig (DB-backed, edited via /dirk_config and /dirk_lib).
-- This file just builds the initial `lib.settings` table at boot:
--
--   1. Hardcoded defaults that mirror schema.json (so dirk_lib can boot
--      even before scriptConfig has loaded its DB row).
--   2. Autodetected resource picks for any `bridging.*` key the schema
--      defaults to "auto" — picked from src/autodetect.lua at boot.
--   3. Legacy convar import: any `dirk_lib:*` convar still set by an
--      admin overrides the matching key (one-shot deprecation path —
--      remove from server.cfg and use the configurator going forward).
--
-- After this file returns, src/settingsOverlay/shared.lua hooks into
-- scriptConfig and overlays DB values on top, so admin edits in the
-- configurator are what wins at runtime.

local autodetected = require 'src.autodetect'

-- Convenience: read a possibly-set convar without forcing it through the
-- raw GetConvar default mechanism, so we can tell "admin set it" from
-- "convar absent". We use a sentinel to detect absence.
local CONVAR_SENTINEL = '\1__dirk_unset__\1'
local function readConvar(name)
  local v = GetConvar(name, CONVAR_SENTINEL)
  if v == CONVAR_SENTINEL then return nil end
  return v
end
local function readConvarBool(name)
  local v = readConvar(name)
  if v == nil then return nil end
  return v == 'true'
end
local function readConvarInt(name)
  local v = readConvar(name)
  if v == nil then return nil end
  return tonumber(v)
end

-- Resolve the "auto" placeholder for bridging.* values.
local function resolveAuto(category, value)
  if value ~= 'auto' then return value end
  local detected = autodetected[category]
  if not detected or detected == 'NOT FOUND' then return 'auto' end
  return detected
end

local settings = {
  -- ── appearance ─────────────────────────────────────────────────────
  primaryColor = 'dirk',
  primaryShade = 9,
  customTheme  = {
    "#f8edff", "#e9d9f6", "#d0b2e8", "#b588da", "#9e65cf",
    "#914ec8", "#8a43c6", "#7734af", "#692d9d", "#5c258b",
  },

  -- ── localization ───────────────────────────────────────────────────
  language = 'en',
  currency = '$',
  -- Display units live with currency because they are the same kind of thing:
  -- a presentation choice the whole server shares, not a per-script setting.
  weightUnit   = 'lb',
  distanceUnit = 'm',

  -- ── branding ───────────────────────────────────────────────────────
  serverName  = 'DirkRP',
  logo        = 'https://via.placeholder.com/150',
  itemImgPath = nil, -- resolved below from autodetected.itemImgPath

  -- ── bridging: UI providers (default ox_lib) ────────────────────────
  notify          = 'ox_lib',
  progress        = 'ox_lib',
  showTextUI      = 'ox_lib',
  contextMenu     = 'ox_lib',
  alertDialog     = 'ox_lib',
  inputDialog     = 'ox_lib',
  dialog          = 'dirk_lib', -- no ox equivalent

  -- ── bridging: resource providers (resolved from autodetect below) ──
  framework = resolveAuto('framework', 'auto'),
  inventory = resolveAuto('inventory', 'auto'),
  target    = resolveAuto('target', 'auto'),
  interact  = resolveAuto('interact', 'auto'),
  time      = resolveAuto('time', 'auto'),
  keys      = resolveAuto('keys', 'auto'),
  fuel      = resolveAuto('fuel', 'auto'),
  phone     = resolveAuto('phone', 'auto'),
  garage    = resolveAuto('garage', 'auto'),
  clothing  = resolveAuto('clothing', 'auto'),
  ambulance = resolveAuto('ambulance', 'auto'),
  prison    = resolveAuto('prison', 'auto'),
  dispatch  = resolveAuto('dispatch', 'auto'),
  doorlock  = resolveAuto('doorlock', 'auto'),
  skills    = resolveAuto('skills', 'auto'),
  housing   = resolveAuto('housing', 'auto'),

  -- ── advanced ───────────────────────────────────────────────────────
  primaryIdentifier = 'license',
  debug             = false,

  -- ── presentation knobs (kept as plain settings — not exposed in
  --     the configurator yet, but consumers still read them). ─────────
  notifyPosition     = 'top-right',
  notifyAudio        = true,
  progBarPosition    = 'bottom-center',
  showTextPosition   = 'bottom-center',
  contextClickSounds = true,
  contextHoverSounds = true,
  dialogClickSounds  = true,
  dialogHoverSounds  = true,

  -- ── groups ─────────────────────────────────────────────────────────
  groups = {
    maxMembers        = 5,
    maxDistanceInvite = 5,
    inviteValidTime   = 5,
    maxLogOffTime     = 5,
  },
}

settings.itemImgPath = autodetected.itemImgPath or 'nui://dirk_inventory/web/images/'

-- ── Legacy convar import ─────────────────────────────────────────────
-- Any `dirk_lib:*` convar that an admin set in server.cfg still wins
-- over hardcoded defaults — but the canonical path going forward is
-- /dirk_config. Remove the convar and use the configurator instead.
local convarMap = {
  -- appearance
  primaryColor    = { name = 'dirk_lib:primaryColor',    type = 'string' },
  primaryShade    = { name = 'dirk_lib:primaryShade',    type = 'int' },
  -- localization
  language        = { name = 'dirk_lib:language',        type = 'string' },
  currency        = { name = 'dirk_lib:currency',        type = 'string' },
  -- branding
  serverName      = { name = 'dirk_lib:serverName',      type = 'string' },
  logo            = { name = 'dirk_lib:logo',            type = 'string' },
  itemImgPath     = { name = 'dirk_lib:itemImgPath',     type = 'string' },
  -- bridging UI
  notify          = { name = 'dirk_lib:notify',          type = 'string' },
  progress        = { name = 'dirk_lib:progress',        type = 'string' },
  showTextUI      = { name = 'dirk_lib:showTextUI',      type = 'string' },
  contextMenu     = { name = 'dirk_lib:contextMenu',     type = 'string' },
  alertDialog     = { name = 'dirk_lib:alertDialog',     type = 'string' },
  inputDialog     = { name = 'dirk_lib:inputDialog',     type = 'string' },
  dialog          = { name = 'dirk_lib:dialog',          type = 'string' },
  -- presentation
  notifyPosition  = { name = 'dirk_lib:notifyPosition',  type = 'string' },
  notifyAudio     = { name = 'dirk_lib:notifyAudio',     type = 'bool' },
  progBarPosition = { name = 'dirk_lib:progBarPosition', type = 'string' },
  showTextPosition = { name = 'dirk_lib:showTextPosition', type = 'string' },
  contextClickSounds = { name = 'dirk_lib:contextClickSounds', type = 'bool' },
  contextHoverSounds = { name = 'dirk_lib:contextHoverSounds', type = 'bool' },
  dialogClickSounds  = { name = 'dirk_lib:dialogClickSounds',  type = 'bool' },
  dialogHoverSounds  = { name = 'dirk_lib:dialogHoverSounds',  type = 'bool' },
  -- advanced
  primaryIdentifier = { name = 'dirk_lib:primaryIdentifier', type = 'string' },
  debug             = { name = 'dirk_lib:debug',             type = 'bool' },
}

-- bridging resource providers — convar still wins, but we resolve "auto" via autodetect
local bridgingCategories = {
  'framework', 'inventory', 'target', 'interact', 'time', 'keys', 'fuel',
  'phone', 'garage', 'clothing', 'ambulance', 'prison', 'dispatch',
  'doorlock', 'skills', 'housing',
}
for _, cat in ipairs(bridgingCategories) do
  convarMap[cat] = { name = ('dirk_lib:%s'):format(cat), type = 'string', autoResolve = cat }
end

local importedKeys = {}
for key, spec in pairs(convarMap) do
  local raw
  if spec.type == 'bool' then
    raw = readConvarBool(spec.name)
  elseif spec.type == 'int' then
    raw = readConvarInt(spec.name)
  else
    raw = readConvar(spec.name)
  end
  if raw ~= nil then
    if spec.autoResolve then
      raw = resolveAuto(spec.autoResolve, raw)
    end
    settings[key] = raw
    importedKeys[#importedKeys + 1] = spec.name
  end
end

-- groups.* convars
local groupConvars = {
  maxMembers        = 'dirk_groups:maxMembers',
  maxDistanceInvite = 'dirk_groups:maxDistanceInvite',
  inviteValidTime   = 'dirk_groups:inviteValidTime',
  maxLogOffTime     = 'dirk_groups:maxLogOffTime',
}
for key, name in pairs(groupConvars) do
  local v = readConvarInt(name)
  if v ~= nil then
    settings.groups[key] = v
    importedKeys[#importedKeys + 1] = name
  end
end

if #importedKeys > 0 then
  print(('[dirk_lib] DEPRECATION: %d convar(s) still set in server.cfg. Convars now act as one-time defaults — manage these from /dirk_config (group "bridging" / "branding" / etc.) instead. Affected: %s')
    :format(#importedKeys, table.concat(importedKeys, ', ')))
end

return settings
