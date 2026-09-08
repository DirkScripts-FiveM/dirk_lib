local settings      = lib.settings
local bridge        = lib.loadBridge('framework', settings.framework, 'server')
local prison        = lib.loadBridge('prison', settings.prison, 'server')
local clothingBridge = lib.loadBridge('clothing', settings.clothing, 'server')

return  {
  ---@function lib.player.get
  ---@description # Get the player object
  ---@param src number | string 
  ---@return table
  get = bridge.get,

  ---@function lib.player.identifier
  ---@description # Get the identifier of a player
  ---@param src number
  ---@return string
  identifier      = bridge.identifier,

  ---@function lib.player.name
  ---@description # Get the name of a player
  ---@param src number
  ---@return string, string
  name            = bridge.name,
  
  ---@function lib.player.phoneNumber
  ---@description # Get the phone number of a player.
  ---@param src number
  ---@return string
  phoneNumber    = bridge.phoneNumber,

  ---@function lib.player.gender 
  ---@description # Gets the gender of a player
  ---@param src number
  ---@return string
  gender          = bridge.gender,

  ---@function lib.player.deleteCharacter
  ---@description # Deletes a character
  ---@param src number
  ---@param citizenId string
  ---@return boolean
  deleteCharacter = bridge.deleteCharacter,

  ---@function lib.player.loginCharacter
  ---@description # Logs in a character
  ---@param src number
  ---@param citizenId string
  ---@param newData table
  ---@return boolean
  loginCharacter  = bridge.loginCharacter,

  ---@function lib.player.logoutCharacter
  ---@description # Logs out a character
  ---@param src number
  ---@param citizenId string
  ---@return boolean
  logoutCharacter = bridge.logoutCharacter,


  ---@function lib.player.createCharacter
  ---@description # Creates a character
  ---@param src number
  ---@param data table
  ---@return boolean
  createCharacter = bridge.createCharacter,

  ---@function lib.player.getCharacters
  ---@description # Gets the characters of a player
  ---@param src number
  ---@return table[]
  getCharacters   = bridge.getCharacters,

  ---@function lib.player.getSkin
  ---@function # Gets the skin of the playersId passed
  ---@return table
  getSkin = clothingBridge.getSkin,

  ---@function lib.player.jail
  ---@description # Jails a player
  ---@param src number
  ---@param time number
  ---@param reason string
  ---@return boolean
  jail = prison.jail or bridge.jail,  

  ---@function lib.player.setJob
  ---@description # Sets the job of a player
  ---@param src number
  ---@param job string
  ---@param rank string | number
  setJob   = bridge.setJob,

  ---@function lib.player.getJob 
  ---@description # Gets the job of a player
  ---@param src number
  ---@return {name: string, type: string, label: string, grade: number, isBoss: boolean, bankAuth: boolean, gradeLabel: string, duty: boolean}
  getJob   = bridge.getJob,

  ---@function lib.player.getGang
  ---@description # Gets the gang of a player
  ---@param src number
  ---@return {name: string, grade: number}
  getGang = bridge.getGang,

  ---@function lib.player.setDuty 
  ---@description # Sets the duty of a player
  ---@param src number
  ---@param duty boolean
  setDuty  = bridge.setDuty,

  ---@function lib.player.addMoney
  ---@description # Adds money to a player
  ---@param src number
  ---@param acc string
  ---@param count number
  ---@param reason string
  ---@return boolean
  addMoney = bridge.addMoney,

  ---@function lib.player.removeMoney
  ---@description # Removes money from a player
  ---@param src number
  ---@param acc string
  ---@param count number
  ---@param reason string
  ---@return boolean
  removeMoney = bridge.removeMoney,

  ---@function lib.player.setMoney 
  ---@description # Sets the money of a player
  ---@param src number
  ---@param acc string
  ---@param count number
  ---@return boolean
  setMoney = bridge.setMoney,

  ---@function lib.player.getMoney
  ---@description # Gets the money of a player
  ---@param src number
  ---@param acc string
  ---@return number
  getMoney = bridge.getMoney,

  ---@function lib.player.getAccounts
  ---@description # Every money account a player has, and its balance
  ---@description Saves looping getMoney over names you had to know in advance.
  ---@description ESX reads xPlayer.getAccounts(); QB/QBX read PlayerData.money.
  ---@param src number
  ---@return table<string, number> e.g. { cash = 1200, bank = 54000 }
  getAccounts = bridge.getAccounts,

  ---@function lib.player.getSourceFromIdentifier
  ---@description # Server id for an identifier, or nil if they're offline
  ---@description The frameworks all have this natively. lib.player.checkOnline
  ---@description is the only other route and it loops every player and hands
  ---@description back a string index.
  ---@param identifier string
  ---@return number|nil
  getSourceFromIdentifier = bridge.getSourceFromIdentifier,
  
  ---@function lib.player.setPlayerData
  ---@description # Sets the data of a player
  ---@param src number
  ---@param _key string
  ---@param data table
  setPlayerData = bridge.setPlayerData,

  ---@function lib.player.getPlayerData
  ---@description # Gets the data of a player
  ---@param src number
  ---@param _key string
  ---@return table
  getPlayerData = bridge.getPlayerData,

  ---@function lib.player.setMetadata
  ---@description # Sets the metadata of a player
  ---@param src number
  ---@param _key string
  ---@param data table
  setMetadata = bridge.setMetadata,

  ---@function lib.player.getMetadata
  ---@description # Gets the metadata of a player
  ---@param src number
  ---@param _key string
  ---@return table
  getMetadata = bridge.getMetadata,

  ---@function lib.player.hasLicense
  ---@description # Checks if a player has a specific license
  ---@param src number
  ---@param license string | table
  ---@return boolean
  hasLicense = bridge.hasLicense,

  ---@function lib.player.getLicenses
  ---@description # Gets the licenses of a player
  ---@param src number
  ---@return table
  getLicenses = bridge.getLicenses,

  ---@function lib.player.hasGroup
  ---@description # Check if a player has a specific group
  ---@param src number
  ---@param group string | Record<string, number> | Array<string>
  ---@return boolean
  hasGroup = bridge.hasGroup,


  ---@function lib.player.checkOnline 
  ---@description # Checks if a player is online either by their character ID or server ID
  ---@param identifier string|number
  ---@return boolean
  checkOnline = function(identifier)
    assert(type(identifier) == 'string' or type(identifier) == 'number', 'Identifier must be a string or number')
    if type(identifier) == 'number' then 
      return GetPlayerByServerId(identifier) ~= 0
    end
    local plys = GetPlayers()
    for _, ply in ipairs(plys) do 
      local other_ply = lib.player.get(tonumber(ply))
      if other_ply then 
        if identifier == lib.player.identifier(tonumber(ply)) then
          return ply
        end
      end
    end
    return false
  end,

  ---@function lib.player.roster
  ---@description
  --- Every character the server has ever had, a page at a time.
  ---
  --- ── why this is in dirk_lib ────────────────────────────────────────────
  ---
  --- Any script with an admin Players page needs the same thing: search the
  --- roster, page it, put whoever is online at the top, and hand back each
  --- character's metadata so the script can read its own key out of it.
  --- dirk_fishing wrote it, and dirk_projectCars was about to write it again —
  --- the same framework-branching SQL, the same column-fallback ladder, the
  --- same online-first ordering, in two places that would drift.
  ---
  --- The table differs by framework and so do the columns: QB keeps characters
  --- in `players` keyed by `citizenid`, ESX in `users` keyed by `identifier`,
  --- and neither is consistent about which name columns exist across versions.
  --- So each shape is tried in turn and the first that runs wins, rather than
  --- guessing from a version number.
  ---
  --- Returns rows only. It does NOT check permission — the CALLER must, because
  --- only the caller knows which resource's admins are allowed to look.
  ---
  ---@param opts table? { query: string?, offset: number?, limit: number? }
  ---@return table { items = { { id, name, online, metadata } }, total = number }
  roster = function(opts)
    opts = type(opts) == 'table' and opts or {}
    local offset = math.max(0, math.floor(tonumber(opts.offset) or 0))
    local limit = math.floor(math.max(1, math.min(100, tonumber(opts.limit) or 40)))
    local search = tostring(opts.query or ''):gsub('^%s+', ''):gsub('%s+$', '')
    local like = ('%%%s%%'):format(search)

    local isEsx = (settings and settings.framework) == 'es_extended'
    local table_ = isEsx and 'users' or 'players'
    local idCol = isEsx and 'identifier' or 'citizenid'

    -- Online first, so the person an admin is most likely looking for is on
    -- page one. The identifiers come from the server's own roster, never from
    -- input, and still go through `?` substitution.
    local online, onlineBy = {}, {}
    for _, ply in ipairs(GetPlayers()) do
      local src = tonumber(ply)
      local id = src and lib.player.get(src) and lib.player.identifier(src)
      if id then
        online[#online + 1] = tostring(id)
        onlineBy[tostring(id)] = src
      end
    end
    local onlineCsv = table.concat(online, ',')

    --- Run the first query that this database actually accepts.
    ---
    --- A missing column is a hard SQL error, and which name columns exist
    --- varies by framework version. Trying in order of richest-first means a
    --- server keeps the best result its schema can give.
    local function firstThatRuns(queries, args)
      for _, sql in ipairs(queries) do
        local ok, result = pcall(MySQL.query.await, sql, args)
        if ok and result then return result end
      end
      return {}
    end

    local order = ('ORDER BY (CASE WHEN FIND_IN_SET(%s, ?) > 0 THEN 0 ELSE 1 END), %s ASC LIMIT ? OFFSET ?')
      :format(idCol, idCol)

    local nameCols = isEsx
      and { 'name', 'firstname', 'lastname' }
      or { 'name', 'charinfo' }

    local rows, total = {}, 0

    -- Richest first: every name column, then fewer, then the id alone.
    for take = #nameCols, 0, -1 do
      local cols = { idCol, 'metadata' }
      local where = { ('%s LIKE ?'):format(idCol) }
      local args = { search, like }
      for i = 1, take do
        cols[#cols + 1] = nameCols[i]
        where[#where + 1] = ('%s LIKE ?'):format(nameCols[i])
        args[#args + 1] = like
      end
      args[#args + 1] = onlineCsv
      args[#args + 1] = limit
      args[#args + 1] = offset

      local sql = ('SELECT %s FROM %s WHERE (? = "" OR %s) %s')
        :format(table.concat(cols, ', '), table_, table.concat(where, ' OR '), order)

      local ok, result = pcall(MySQL.query.await, sql, args)
      if ok and result then
        rows = result
        -- The same WHERE, counted. Built from the shape that just worked, so
        -- the total can never describe a different query from the page.
        local countArgs = { search, like }
        for _ = 1, take do countArgs[#countArgs + 1] = like end
        local counted = firstThatRuns({
          ('SELECT COUNT(*) as n FROM %s WHERE (? = "" OR %s)')
            :format(table_, table.concat(where, ' OR ')),
        }, countArgs)
        total = tonumber(counted[1] and counted[1].n) or #rows
        break
      end
    end

    local items = {}
    for _, row in ipairs(rows) do
      local id = tostring(row[idCol] or '')
      -- The CHARACTER's name, from whichever column this framework turned out
      -- to have. QB packs it into `charinfo` JSON; ESX has columns for it.
      --
      -- Character columns are read FIRST, and `name` is only the fallback.
      -- On QB `players.name` is the ACCOUNT - the person's own handle - so
      -- reading it first meant every row showed the same handle twice and the
      -- character's actual name never appeared anywhere. Which one goes where
      -- is the whole point of returning both.
      local name
      if row.firstname or row.lastname then
        name = ('%s %s'):format(row.firstname or '', row.lastname or ''):gsub('^%s+', ''):gsub('%s+$', '')
      elseif type(row.charinfo) == 'string' then
        local ok, info = pcall(json.decode, row.charinfo)
        if ok and type(info) == 'table' then
          name = ('%s %s'):format(info.firstname or '', info.lastname or ''):gsub('^%s+', ''):gsub('%s+$', '')
        end
      elseif type(row.charinfo) == 'table' then
        name = ('%s %s'):format(row.charinfo.firstname or '', row.charinfo.lastname or ''):gsub('^%s+', ''):gsub('%s+$', '')
      end
      if not name or name == '' then name = row.name end

      local metadata = row.metadata
      if type(metadata) == 'string' then
        local ok, decoded = pcall(json.decode, metadata)
        metadata = ok and decoded or {}
      end

      items[#items + 1] = {
        id = id,
        name = (name and name ~= '') and name or id,
        -- The ACCOUNT name, separately. A character is "Marcus Webb" and the
        -- person behind them is whatever they called themselves — an admin
        -- looking for a player often knows only the second, and collapsing the
        -- two loses the one they typed.
        account = (type(row.name) == 'string' and row.name ~= '') and row.name or nil,
        -- The SOURCE, not a boolean. `false` when offline, so it reads as one
        -- either way, but a caller that wants to message them has it.
        online = onlineBy[id] or false,
        metadata = type(metadata) == 'table' and metadata or {},
      }
    end

    return { items = items, total = total, nextOffset = (offset + #items < total) and (offset + #items) or nil }
  end,

  getIdentifierType = function(src, _type)
    local identifiers = GetPlayerIdentifiers(src)
    for k,v in pairs(identifiers) do 
      if string.find(v, _type..":") then 
        return v
      end
    end
    return false
  end,



}
