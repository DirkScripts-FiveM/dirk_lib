# UPDATE 1.3.0 | 02/09/2026

## New — Script Studio

- **Every dirk script is configured in one panel.** /dirk_config opens it; /<resource_name> opens it with that script already selected. The separate config menu each script used to carry is gone — one search across the lot, one save bar, one change history.
- **Logs.** Every dirk script's log lines are kept on your own server in a dirk_logs table and read back in the panel — filter by script, event, player, level or time, and open a line for the full payload including every identifier that player had, not just the server ID they happened to hold.
- **Redirects.** Send matching log lines on to Discord as well as keeping them — to a webhook, or to a channel your bot posts in — filtered by script, event or level. Scripts no longer carry their own webhook settings; an existing one is carried over the first time the script loads.
- **Any change can now be reverted.** The audit of saved edits — who changed what, and the value before and after — is now readable in the panel alongside everything else, and any line can be put back, which stages it for you to review like any other edit.
- **Admins.** One place for who can open the panel, replacing the Access tab scripts used to carry. Grants can be a person (picked from who is online, or by identifier for someone offline) or an ACE group. A new **view** level below edit reads settings and logs but can never save and is never sent server-only values such as webhook URLs. Existing per-script grants fold in automatically on first load.
- **Bridges page.** The overrides you already had, now next to what dirk_lib actually detected on your server, so auto has a face.
- **Changelogs and announcements in the panel**, fetched from our repo, so you see what changed without leaving the game.
- **Better controls throughout** — durations, hour-of-day pickers, two-point range sliders, either/or switches that name both sides, and open maps of values. Areas are drawn on a real map, and a coordinate is set by walking to the spot and pressing a key rather than typed.
- **The panel opens fast.** Opening used to re-download every script's schema and config; now your game keeps the schemas cached and already holds the values, so only a small amount of admin-only data travels - and everything loads at once instead of one script at a time.
- **A Players page, the same in every script that has one.** Searching your character list, putting whoever is online at the top, and paging through the rest is now dirk_lib's job rather than each script writing its own — so it behaves identically wherever it appears, and a character's own name and the account behind it are told apart properly instead of showing the same handle twice.
- **A self-check command.** Type dirktest in your server console and the script tests itself against your own inventory and framework — so a bad combination shows up before your players find it, not after. Name a script to run just that one — `dirktest dirk_fishing` — and any script shipping tests gets a **Tests** tab in the panel automatically. Console only, because a suite is allowed real side effects.

## New — levels and XP

- **One levelling system, shared by every dirk script.** Fishing's XP curve is now part of dirk_lib, which means any script can have levels without inventing its own — and every one of them is calculated the same way. Same maths in the game and in the panel, so a gate and the bar a player is looking at can never disagree.
- **Choose the shape of the climb.** Long haul (what fishing has always used), Steady, Classic RPG, or Reachable. **Switching never takes anyone's XP.** A level is worked out from XP each time it is asked for and never written down, so a new shape simply re-reads everyone.
- **Levels can be held per-something.** A fishing level is one number per player; a reputation is one per place — you are somebody to one man and nobody to the next. Both are the same setting with the same curve.
- **The panel draws the curve.** Any levelling block shows the climb as you drag it, what real levels cost, the total to max, and how that compares with the default pace.

## Fixes

- **Players could be left running on the wrong settings for a whole session.** A client that asked for its config while the server was still building it was marked as loaded anyway, so it never asked again — it served defaults, or, because that cache is shared by every server running a resource of the same name, another server's settings. Shop hours, drawn zones and the language all come from config, so players saw stale or foreign values while an admin (whose panel forces a fresh fetch) saw the right ones. The client now retries until the server answers, and only ever applies a cached config the server has confirmed is its own.
- **Change history listed edits nobody made.** Fields inside a list row take their default from the shipped row rather than the field, which the diff did not know, so saving any row logged a pile of "default → …" lines for values that never changed.
- Settings the schema does not declare are no longer deleted from your stored config.
- An empty server-only payload is sent as nothing rather than an empty object.

## Fixes — the settings map

- **Pins could be dragged by accident, and now cannot be dragged at all unless you say so.** Every pin on every settings map was live the whole time it was open, so a missed click nudged a place into the next field with nothing to say it had happened. Dragging is now off by default and turned on with one clearly-marked button — and positions that were set by WALKING to them are never draggable, because a map has no height or heading to give back. Those are shown on the map and edited in the row.
- **One place stopped looking like several.** A barn find is a car and the man selling it a few metres apart; zoomed out those two pins sat on top of each other and read as two separate finds. They are one pin until you are close enough for the difference to matter, then they separate and label themselves.
- **"Is this point inside this area?" answered no almost everywhere.** The check was three-dimensional with a five-metre allowance, but an area drawn on a map is flat — so anything at real world height fell outside a boundary drawn at ground level. Every drop rule, area check and "am I at this place" question built on it silently refused. Areas are now flat unless a height is asked for.
- **Editing a place on the map lost things the list editor had.** The two editors were separate copies that had drifted: the map's could not translate its own field labels, showed a blank where a setting has a default, and opened the wrong picker for a setting nested inside another (a blip's sprite, for instance, opened an empty window). Both now use the same editor, so all three are fixed and cannot drift again.

## Fixes — map blips

- **Changing a blip errored and left the old one stuck on the map.** The update ran against the wrong thing entirely, so the blip it was meant to replace was never removed and the new one was never drawn. Scripts that rename or recolour a blip while the server is running — a property changing hands, a shop opening — piled up duplicates.
- **Blips that should only show sometimes were on the map permanently.** The visibility check always answered yes, so a blip meant to appear only for its owner, or only while you are on the job, was visible to everyone all the time.
- **Blips that hide and come back no longer leak.** Each redraw was leaving a shutdown handler behind that was never cleared.
- **Long-range blips work.** Asking for a blip to show across the whole map was ignored and it was always drawn short-range.

## Fixes — settings panel

- **Sliders name their own steps.** Every slider borrowed fishing's difficulty words whatever it measured, so a blip's SIZE read "Weak" at its smallest. A setting now says what its steps are called — Tiny to Huge, Rarely to Often — and those words translate like everything else. So do dropdown options, which were English-only with no way to change them.
- **A row editor no longer shows a heading with nothing to say.** Opening one showed the name of the list it came from underneath the title, where a description belongs.
- **The last sections of a script can be reached.** A rail click or a search result aimed at one of a script's final sections scrolled as far as the page would go, stopped short, and highlighted whichever section happened to be nearest the top — so the link looked broken when it was the page that had run out of room. There is now room past the end, and a jump holds its landing while the rest of the list is still being measured underneath it.

---

# UPDATE 1.2.78 | 17/07/2026

## Fixes — devix-inventory bridge
- **Usable items now register through devix-core's `UsableItem`**, so the handler receives the exact **slot + metadata** of the item being used. Fixes fishing rods (and other usable items) erroring with "cannot find slot on use" on devix — the framework-sync path wasn't reliably carrying the slot. (Reported by _i23.)
- **Item metadata now writes by slot** via devix's `UpdateSlotMetadata`, replacing the old serial-based write that only worked for weapons. Fixes item metadata/attachments (e.g. the fishing rod loadout) not persisting on devix.

---

# UPDATE 1.2.77 | 17/07/2026

## Fixes
- **Callback timers no longer linger.** Every `lib.callback` request scheduled a 5-minute timeout that was never cancelled once the callback answered (normally within milliseconds), leaving a growing backlog of dead timers on a busy server — and a request that never got a reply also leaked its tracking entry. Both are now cleaned up the instant a callback resolves.
- **SQL diagnostics fully stop when debug is turned off.** The debug hitch-monitor previously kept running until a full resource restart, even after `basic.debug` was switched back off. Its thread now exits completely the moment debug is disabled (and respawns if you turn it back on), so a server that isn't actively debugging has zero diagnostic threads. Only ever affected servers that had debug enabled.

---

# UPDATE 1.2.76 | 15/07/2026

## Fixes
- **Big join-time hitch removed.** The groups module ran a player lookup on every character load — profiled at up to **700ms per join** on a busy (350-slot) server, stacking into visible server hitches. It now exits instantly when no groups are active (the overwhelmingly common case). (Profiled + reported by reyesmtv.)

## Improvements
- **Lithuanian translation polished by a native speaker** — 106 strings improved. Ačiū, snaiperiukas!
- **Italiano (it) added to the language picker** — the `it` locale already shipped; now it's selectable from `/dirk_lib` → Basic → Language.

---

# UPDATE 1.2.75 | 10/07/2026

## New
- **Lithuanian (`lt`) added.** `/dirk_lib` → Basic → Language now lists **Lietuvių (lt)**, and a Lithuanian `locales/lt.json` ships with the library. It's a solid first pass rather than a native polish — corrections are very welcome.

---

# UPDATE 1.2.74 | 09/07/2026

## Fixes
- **A fresh install could leave every dirk script's config permanently dead.** On a brand-new database all your dirk resources boot at once, and each one tries to create the shared `dirk_scriptConfig` table. That `CREATE TABLE` was neither `IF NOT EXISTS` nor error-guarded, so whichever resources lost the race threw *"table already exists"*, silently killed their own scriptConfig init, and every client callback then failed with a cryptic `Callback <resource>:getScriptConfig timed out` — no peds, shops or zones, and an admin panel that loads forever and never saves. Table creation and the column migrations are now idempotent and error-guarded, so any number of resources can boot together safely.
- **If the table genuinely can't be created** (database user missing `CREATE` permission, unsupported DDL) **you now get a clear error saying exactly that**, naming the SQL problem and how to fix it — instead of silent death followed by timeout spam from every dirk script.

---

# UPDATE 1.2.73 | 09/07/2026

## New
- **Norwegian added to the language picker.** `/dirk_lib` → Basic → Language now lists **Norsk (no)** alongside the other languages, so you can select it from the panel instead of setting the convar by hand. Scripts that ship a `no` locale (e.g. dirk_fishing) then render in Norwegian.

---

# UPDATE 1.2.72 | 09/07/2026

## Fixes
- **Custom item images (ox `client.image`) now display instead of breaking.** When an item's `client.image` was a fully-qualified reference — a URL, an `nui://` path, a data URI or an absolute path — `lib.formatImagePath` still prefixed the CDN base and appended `.png`, producing a mangled URL and a broken image. Those are now used as-is, so custom item art shows everywhere dirk UIs render inventory images (stores, markets, guidebook, loadout, admin item pickers). Bare item names still resolve against your configured image path as before.

---

# UPDATE 1.2.71 | 09/07/2026

## Fixes
- **devix-inventory: client-side inventory reads now use the correct export.** The bridge was calling a guessed `GetInventory()` to read the local player's items (rod loadout, bait counts, `hasItem` checks) — an export devix doesn't provide, so on devix installs those reads came back empty. It now uses devix's actual **`GetPlayerItems()`** (confirmed with the devix developer), so client-side inventory checks work on devix.

---

# UPDATE 1.2.70 | 08/07/2026

## Fixes
- **`lib.inventory.canCarryItem` now works on ox_inventory and qs-inventory.** These two bridges were missing the capacity check, so any script that pre-flights "can the player carry this?" before taking payment (e.g. store purchases) silently skipped it — a player with a full inventory could be **charged without receiving the item**. Both now implement it (ox `CanCarryItem`, qs `CanCarryItem`), so purchase flows across every dirk script correctly block when there's no room.

---

# UPDATE 1.2.69 | 06/07/2026

A garage bridge, so scripts can store vehicles into any garage system with one call.

## New
- **`lib.garage.addVehicle(src, opts)`** — store a completed / purchased vehicle in a player's garage with a single call, on any framework + garage system. dirk_lib routes it to the detected garage system's bridge (for systems with their own storage) or the framework's vehicle store, using a **schema-aware insert** that only writes columns your `owned_vehicles` / `player_vehicles` table actually has. This kills the class of `Unknown column 'garage'` errors on setups whose vehicle table doesn't match a hard-coded insert — e.g. **ESX + jg-advancedgarages**, whose `owned_vehicles` has no `garage` column.
- **Garage auto-detection** now recognises `jg-advancedgarages`, `cd_garage`, `okokGarage`, `esx_garage` and `loaf_garage` alongside qb-garages / wasabi / renewed.

---

# UPDATE 1.2.68 | 05/07/2026

Item icons now resolve on a cold boot without a restart, and devix / older tgiann installs get the right image path automatically.

## Fixes
- **Item icons no longer need a resource restart to appear.** On a cold server start, if your inventory resource finished starting *after* dirk_lib (common — libraries are ensured early), the item image path was left on a fallback and stayed wrong until you manually restarted dirk_lib and the script using it — reported on core_inventory (fish-store icons blank until a restart). dirk_lib now re-checks once the inventory is actually up and pushes the corrected path to every script live, so icons resolve on first boot. An image path you've set yourself in `/dirk_config` is never overwritten by this.
- **devix_inventory icons.** The devix image path now points at `devix-inventory/html/img` (where devix keeps its icons) instead of the previous `html/images` guess, so devix item images load.

## Improvements
- **Older tgiann-inventory icons work out of the box.** Some tgiann builds keep their icons in a separate `inventory_images` resource rather than inside tgiann-inventory itself. dirk_lib now detects that resource and points item images at it automatically — no manual image-path override needed. (Newer tgiann is unaffected.)

---

# UPDATE 1.2.67 | 05/07/2026

## Improvements
- **Item descriptions are now surfaced to script NUIs.** The shared item list (used by config panels + item pickers) now includes each item's inventory `description` alongside its label, weight and image — so scripts can source item descriptions from your inventory instead of re-storing them in their own config. (ox_inventory.)

---

# UPDATE 1.2.66 | 03/07/2026

Localisation hardening.

## Fixes
- **Missing translations are no longer written back into locale files at runtime.** A dev-only "collect missing translations" mode could echo any untranslated key back to disk — churning locale files on boot and leaving `"Key": "Key"` placeholders baked into shipped translations, which then showed as raw-looking labels or blocked the English fallback. It's been removed entirely: a missing key now simply falls back to English, and locale files are only ever edited by hand.

---

# UPDATE 1.2.65 | 03/07/2026

Inventory-bridge fixes for tgiann, a new devix_inventory bridge, and a Traditional Chinese locale.

## Fixes
- **tgiann-inventory: usable items (e.g. fishing rods) now fire.** On inventories layered over ESX that don't hand ESX an item record, a used item arrived without its data and the use was silently skipped — so the item appeared to "do nothing". The ESX bridge now resolves the missing record through the active inventory bridge instead of bailing, so the use goes through. Kept generic — no hardcoded inventory in the framework layer.

## New
- **devix_inventory bridge.** Initial compatibility layer for devix_inventory (grid-based). Handles add/remove/read, resolves grid slots, and writes item metadata through devix's serial-keyed update path. devix is closed-source, so a couple of record-shape details still need confirming on a live install — treat this first pass accordingly.
- **Traditional Chinese (zh-TW) locale.**

---

# UPDATE 1.2.63 | 26/06/2026

Logging backends beyond Discord, per-resource access control, and a lighter config panel.

### New features
- **Send logs to Grafana, Datadog or Fivemanage.** A new Logger tab in `/dirk_config` lets you pick a logging service (Loki / Grafana, Datadog or Fivemanage); any dirk script that logs — fishing included — then routes through it. Discord webhooks still work exactly as before, this sits alongside them. Service credentials are server-only and never sent to clients.
- **Per-resource access control.** Each script — and dirk_lib itself — now has its own Access tab controlling who, beyond server admins, can open and edit its live config, granted by job / gang / ACE group or by individual player. The old central override list has been removed in favour of this. Master admins (the `dirk_lib_master_group` convar, default `group.admin`) always have access and can't be locked out.

### Improvements
- **The Appearance tab is now "Theme"** — same settings, clearer name (matches the per-script theme tabs).
- **Lighter config-panel load.** The panel now hydrates from a single cached fetch handed to the interface, and admins pull only the server-only fields when they actually open it — less network traffic, and secrets never leave the server.
- **English fallback for untranslated strings.** A config label with no translation in the active language now falls back to English instead of showing the raw key.

---

# UPDATE 1.2.62 | 25/06/2026

### Fixes
- **Destroyed ped handles are never served from cache.** A cached ped handle is now validated before reuse, preventing a class of nil-ped errors after respawns or model swaps.

---

# UPDATE 1.2.61 | 24/06/2026

### Fixes
- **core_inventory: item images + fitted rod parts fixed.** The image path for core_inventory is now detected correctly (shop and loadout icons were blank) and item metadata is read from the right place client-side, so fitted rod parts (reel / line / hook) save properly. Any dirk script running on core_inventory benefits.

---

# UPDATE 1.2.60 | 23/06/2026

### Fixes
- **Framework bridge player accessors now fail safe.** `lib.player.identifier` / `.name` / `.gender` / `.phoneNumber` (and the other player getters) used to `assert` "Player does not exist" the moment they were called for a connecting / not-yet-loaded source. If that landed in a server callback during early join, the throw left the client's `lib.callback.await` hanging — which on some setups blocked op-multicharacter (new players couldn't create a character) and could crash an admin panel mid-join. They now return `nil` and let the caller degrade gracefully. Applied across the **qb-core, qbx_core and es_extended** bridges. **Any dirk script benefits — updating is recommended.**

- **ESX + tgiann-inventory: using a fishing rod (or any usable item) no longer throws a server error.** When tgiann fires a use event without an ESX-shaped item record, the bridge now bails gracefully (with a warning) instead of handing `nil` to the consumer.
- **qb-inventory: item metadata now persists per slot.** The bridge had no per-slot `setMetadata` (writes fell through to *player* metadata) and read item metadata from the wrong field — so fitted rod parts (reel/line/hook) silently failed to save. Both fixed; any dirk script storing item metadata on qb-inventory benefits.
- **`formatImagePath` no longer errors on a nameless item.** A nil/empty item name (e.g. surfacing in a FETCH_ALL_ITEMS lookup) now returns safely instead of crashing the item-list load.

---

# UPDATE 1.2.59 | 21/06/2026

### New inventory support — one_inventory
- **one_inventory (OneStudios) is now a supported inventory.** It's autodetected like every other system — no config needed — or you can pick it explicitly under Bridging in `/dirk_lib`. Item give/remove, stacking with metadata, slot lookups, item images, and per-slot metadata writes all work through it, so any dirk script that uses the inventory bridge (fishing included) runs on one_inventory out of the box.
- Usable items keep working via your framework's normal registration, and the item image path is detected automatically (override it under Bridging if you serve images from a CDN).

---

# UPDATE 1.2.58 | 19/06/2026

Config menu cleanup, a complete Spanish translation, and the diagnostics layer is now opt-in.

### Config menu — new "Basic" tab
- **Server name, language, currency, and a debug toggle now live in one "Basic" tab** at the top of `/dirk_lib`, replacing the separate Branding and Localization tabs. Existing values carry over automatically on first boot — nothing to re-enter.
- **Advanced** now holds just the primary-identifier setting.
- The inventory image path stays under Bridging (next to the inventory picker), and a custom URL there now properly overrides the auto-detected one.

### Diagnostics are now opt-in
- **The SQL/hitch diagnostics layer only runs when you enable Basic → Debug** (off by default). It was previously always-on; now it's zero-overhead unless you flip the toggle to capture a report.

### Discord settings page
- Bigger, easier show/hide toggle on the bot-token field, with proper spacing from the edge.
- The "how to create a bot" guide is shown inline instead of behind a dropdown, and the developer-portal link is more readable.

### Localization
- **Spanish (es) is now fully translated** — a large batch of strings that previously fell back to English have been completed.
- The config menu's left-hand tab labels now update instantly when you switch language (no restart needed).

### Under the hood (recent)
- Lighter startup: the script-config system skips its boot-time database write on a clean restart, and the shared config table is schema-checked once per boot instead of by every dirk resource.

---

# UPDATE 1.2.47 | 12/05/2026

### Hotfix — ox_inventory bridge `getItems` cleanup
- 1.2.46 swapped to `GetInventory(invId, true)`, but ox_inventory's second arg is `owner` (string|number), not a `full` flag — passing `true` is undefined on modern ox. Dropped the second arg. Items still come back the same way via `.items` on the returned OxInventory object. Strictly broader compatibility.

---

# UPDATE 1.2.46 | 12/05/2026

### Hotfix — ox_inventory bridge: wrong export name
- `lib.inventory.getItems(invId)` was calling `exports.ox_inventory:GetInventoryItems(invId)`. The export exists on modern ox_inventory, but ox-compatible inventories that re-declare `provides 'ox_inventory'` (e.g. ak47_inventory) emulate an older snapshot of the API and don't ship it — calling it there crashes with `No such export GetInventoryItems in resource ox_inventory`. Switched to `GetInventory(invId)` which has been in ox's API since day one and works on every version + emulation. Affects everywhere `lib.inventory.getItems` is used (fish markets, equipment stores, loadout, bait market, reward backfill).

---

# UPDATE 1.2.45 | 12/05/2026

### Hotfix — configurator crash on malformed inventory items
- `lib.formatImagePath` now safely returns `""` when called with `nil`/empty/non-string input, instead of crashing with `attempt to index a nil value (local 'name')`. The configurator could fail to open on servers whose inventory had at least one item registered without a `name` field — a custom or malformed entry was enough to break the whole items lookup.
- ox_inventory bridge: `items()` and `item()` now fall back to the item's table key when both `client.image` and `name` are missing, matching the defensive `or k`/`or name` pattern the other bridges already had.

---

# UPDATE 1.2.43 | 11/05/2026

Lib-side fixes from the dirk_fishing customer-ticket batch (jamazzz, jahm94, battlex2307), plus a new schema-driven install + missing-items pipeline. Pairs with dirk_fishing 2.0.26.

### Schema-driven install generation
- New `x-installItem` / `x-installItemList` schema annotations describe items the consumer needs registered. dirk_lib walks them after every scriptConfig load + change and writes `INSTALLATION/itemsToAdd/{ox.lua, qb.lua, esx.sql}` straight to the consumer's resource folder. Replaces hand-rolled per-resource install.lua files.
- ESX SQL output now matches the actual ESX legacy `items` table (`name, label, weight`) — the previous hand-rolled SQL declared a non-existent `description` column and would fail to import on some servers.

### Missing-items audit + banner
- New per-resource callback returns a list of items that are configured but not registered in the player's inventory, with ready-to-paste snippets for ox / qb / esx.
- Server console warning fires once on resource start (deferred 5s for inventory-bridge readiness): "N items missing from your inventory: …". Caps at 5 names + "and N more". Silent when nothing's missing.
- A missing-items banner auto-appears in the configurator above the tab list whenever items are missing — no consumer code required, just annotate the schema. Includes a refresh button; re-audits on save-success.

### Inventory lookups
- New `lib.inventory.item(name)` accessor — works on every inventory bridge.
- Audited every underlying inventory's actual exports. Native single-item fast-paths now wired for `ox_inventory`, `tgiann-inventory`, `ak47_inventory` and `dirk_inventory`. `qs-inventory` and `codem-inventory` have no native definition lookup, so they fall back to a cached-bulk read.
- Framework-level fast-paths added too: `qb-core`, `qbx_core` and `es_extended` now do direct shared-table indexing, skipping the bulk-fetch cache build entirely.
- Fixed an edge case where an inventory's own items table (e.g. qs-inventory's `shared/items.lua`) was being shadowed by the framework's. Resolution chain now uses the inventory's own table when it has one, before falling back to the framework's. No more "item exists in the inventory but the lookup says it doesn't".

### ESX bridge
- `getMoney` now nil-checks the account — returns 0 instead of crashing on `.money`-of-nil when an account is missing. (This was the source of battlex2307's permit-purchase crash on first install.)
- New `cash` ↔ `money` alias resolver shared across `getMoney` / `addMoney` / `removeMoney` / `setMoney`. If you ask for `cash` and the player only has `money` (or vice versa), the bridge resolves to whichever the player actually has — cross-framework consumers don't need to special-case ESX legacy's account naming.

### Security
- `schema.json` removed from `dirk_lib/fxmanifest.lua`'s `files{}` block. It was reachable via `nui://dirk_lib/schema.json` from any iframe. Server-side `LoadResourceFile` reads don't need that exposure — only NUI / asset manifests do.

### scriptConfig
- `<scriptName>:giveScriptConfigItem` callback now accepts an optional `metadata` payload that's passed through to `addItem`. Lets consumers include real catch metadata on items the admin spawns from the configurator, so the spawned item behaves identically to one earned naturally. Optional — no breaking change.

### Release pipeline
- Released zip now includes `schema.json`. The release workflow's bundled-files copy was missing it, so FiveM warned `could not find file 'schema.json'` on first boot for installs from the GitHub release (self-built copies were always fine).

---

# UPDATE 1.2.42 | 08/05/2026

### scriptConfig — permissions
- **Master-group convar takes a comma-separated list now.** Default `group.admin,admin,command` — whichever ACE your server.cfg actually grants, you'll match. Override `dirk_lib_master_group` with your own list (or single value) to lock it down. Avoids the long-running "I'm clearly admin but the editor says no permission" issue caused by every cfg granting different ACE values.
- **Save permission now matches the chooser-open permission.** Both go through the same authoritative `canEditScriptConfig` check (master ACE list + per-resource overrides). Before this, opens worked but saves silently failed with `NoPermission` for masters because the callback ran in the consumer's Lua VM and couldn't see the dirk_lib-internal access function.
- New export: **`exports.dirk_lib:canEditScriptConfig(src, resourceName)`** — bridges the cross-VM gap above. Any script consuming `lib.scriptConfig(...)` can also call this directly to check permission server-side.
- The `/dirk_config` chooser now logs (server-side) when a player is denied, including the master-group value it checked and the player's identifiers, so cfg mismatches are diagnosable instead of silent.

### scriptConfig — smartMerge
- **Fixed nested-array deletes silently coming back from defaults.** Inside an `x-arrayKey` array (e.g. `stores`), the matching of a default item with its DB version used `lib.table.merge`, whose third argument is `addDuplicateNumbers` — not the `overwrite` flag the calling code seemed to assume. The recursion into nested arrays merged by numeric index, so any indexes that existed in defaults but had been deleted in the DB came back on every load. Replaced with recursive `smartMerge`, which respects "DB is source of truth" for arrays.
- New helper `isArrayLike(t)` so smartMerge can correctly identify nested arrays even when no JSON-Schema item info is provided.

### Notes for consumers
- No API changes. Existing `lib.scriptConfig(schema, canEditFn, rules)` calls keep working — `canEditFn` becomes a fallback that runs only when the master/override check denies. Custom rules can grant additional access but cannot lock out the master.
