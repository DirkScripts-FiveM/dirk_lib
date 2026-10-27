fx_version 'cerulean'
lua54 'yes'
games { 'rdr3', 'gta5' }
rdr3_warning 'I acknowledge that this is a prerelease build of RedM, and I am aware my resources *will* become incompatible once RedM ships.'
use_experimental_fxv2_oal 'yes'
name         'dirk_lib'
author       'DirkScripts'
version      '1.3.7'
description  'A library for FiveM developers to use in their projects, accepting of new features and contributions.'

dirk_lib 'scriptConfig'

-- dirk_lib runs its own suite like any other consumer. This flag is what the
-- Studio's test index looks for (GetResourceMetadata(resource, 'dirk_lib') ==
-- 'test'), so without it the Tests tab never appears for dirk_lib itself even
-- though `dirktest dirk_lib` works from the console.
dirk_lib 'test'

dependencies {
  '/server:7290',
  '/onesync',
  'oxmysql',
}

ui_page 'web/build/index.html'
-- ui_page 'http://localhost:3001'

files {
  'locales/**/*',
  'init.lua',
  -- schema.json deliberately NOT listed here — it's loaded server-side via
  -- LoadResourceFile(scriptName, 'schema.json') and must not be NUI-fetchable
  -- (declaring it under files{} would make it accessible at nui://dirk_lib/schema.json
  -- from any iframe). LoadResourceFile bypasses files{} on the server.
  'modules/**/client.lua',
  'modules/**/server.lua',
  'modules/**/shared.lua',
  -- Admin tools subsystem (modules/scriptConfig/admin/) uses free-form file
  -- names (init.lua, tools/<toolname>.lua) rather than the strict
  -- client.lua/server.lua convention, so its files don't match the patterns
  -- above. Wildcard the entire subtree.
  'modules/scriptConfig/admin/**/*.lua',

  -- lib.cinematic splits across take/cues/appearance next to its client.lua,
  -- which the strict patterns above don't match either.
  'modules/cinematic/*.lua',
  'bridge/**/client.lua',
  'bridge/**/server.lua',
  'bridge/**/shared.lua',
  'src/helpers/modelNames.lua',
  'src/settings.lua',
  'src/redmNatives.lua',
  'src/autodetect.lua',
  'src/oxCompat.lua',
  'src/onSettings.lua',
  'src/nuiBridge.lua',
  'src/autoDefaults.lua',
  -- Script Studio's open logic, required by its client half - which can only
  -- load a file listed here.
  'src/scriptConfig/studioPayload.lua',
  --\\ NUI WHEN ADDED \\--
  'web/build/index.html',
  'web/build/**/*',
  -- the world prompt plate (lib.prompt): a DUI page any resource opens at nui://dirk_lib/web/dui/prompt/build/index.html
  'web/dui/prompt/build/index.html',
  'web/dui/prompt/build/**/*',
}

shared_script {
  'src/init.lua',
  'src/**/shared.lua',
}

client_scripts {
  'src/**/client.lua',
  'src/**/client/*.lua',

  -- dirk_lib's own suite. Inert until `dirktest dirk_lib` is run from the
  -- server console. Loaded in BOTH contexts so the `+c` leg has a client half
  -- to talk to - see the lazy-load note in modules/test/shared.lua.
  --
  -- Every consumer had tests; the thing they all depend on had none, and this
  -- week's bugs were all in here.
  'tests/*.lua',
}

server_scripts {
  '@oxmysql/lib/MySQL.lua',
  'modules/callback/server.lua',
  'src/**/server.lua',
  'src/**/server/*.lua',

  'tests/*.lua',
}

