--- lib.cinematic — record what you perform, then play it back, scrub it, and
--- build scenes out of it.
---
--- Two backends, chosen per actor, never per scene:
---
---   * **vehicles with a `.yvr`** are handed to the engine
---     (StartPlaybackRecordedVehicle). The car is genuinely DRIVEN, so wheels,
---     suspension, body roll, tyre smoke and engine note are all correct for
---     free. Scrubbing is limited: the engine's skip is forward-only.
---   * **everything else** is posed by us from the recorded samples. Slightly
---     less physical, but it can be put at any absolute time instantly, which
---     is what an editor needs.
---
--- So: scrub on the posed backend, play the finished thing on the engine one.
--- Peds have no engine format at all and are always posed.
---
--- MULTIPLE PEDS come from LAYERED takes. You can only act one ped at a time,
--- so record the second while the first plays back in sync — overdubbing. That
--- is why `record` accepts a scene to run underneath it.

local take = require '@dirk_lib.modules.cinematic.take'
local cues = require '@dirk_lib.modules.cinematic.cues'
local appearance = require '@dirk_lib.modules.cinematic.appearance'
local camera = require '@dirk_lib.modules.cinematic.camera'

local cinematic = {}
cinematic.take = take
cinematic.cues = cues
cinematic.appearance = appearance
cinematic.camera = camera

--- Recordings the engine can drive, by take name. A consumer registers one
--- after streaming a `.yvr` for it; without one, a vehicle is posed like
--- everything else, which needs no files and works on any server.
---
---   lib.cinematic.engineTakes['gang_rollin'] = 1   -- the recording id
cinematic.engineTakes = {}

--- Is this take available to the engine right now? Asks the streamer, because
--- "it loaded at startup" is not the same as "it is loaded now" — restarting a
--- resource that streams .yvr files evicts them.
function cinematic.engineReady(name)
  local id = cinematic.engineTakes[name]
  if not id then return false end
  if HasVehicleRecordingBeenLoaded(id, name) then return true end
  RequestVehicleRecording(id, name)
  local deadline = GetGameTimer() + 2000
  while not HasVehicleRecordingBeenLoaded(id, name) do
    if GetGameTimer() > deadline then return false end
    Wait(50)
  end
  return true
end

local RECORD_HZ = 30

-------------------------------------------------------------------------------
-- recording
-------------------------------------------------------------------------------

--- Record the motion of an entity.
---
--- opts = {
---   entity  = entity to follow (default: the player's vehicle, else their ped)
---   hz      = samples per second (default 30)
---   scene   = a scene to play underneath, so you can act against earlier
---             layers — this is how a second ped gets timed to the first
---   countdown = seconds before capture starts
---   onTick  = function(state) called each sample for a HUD
--- }
---
--- Returns a handle: { stop() -> recorded take, cancel(), state() }
function cinematic.record(opts)
  opts = opts or {}

  local ped    = PlayerPedId()
  local entity = opts.entity
  if not entity then
    local veh = GetVehiclePedIsIn(ped, false)
    entity = veh ~= 0 and veh or ped
  end

  local isPlayer = entity == ped
  local recording = {
    entity    = entity,
    isVehicle = IsEntityAVehicle(entity),
    samples   = {},
    dist      = 0.0,
    countdown = opts.countdown,
  }

  local stopped, cancelled = false, false
  local handle = {}

  function handle.state()
    if cancelled or stopped then return nil end
    return {
      countdown = recording.countdown,
      samples   = #recording.samples,
      elapsed   = recording.startedAt and (GetGameTimer() - recording.startedAt) or 0,
      dist      = recording.dist,
      entity    = entity,
    }
  end

  function handle.cancel()
    cancelled, stopped = true, true
    if opts.scene then opts.scene:stop() end
  end

  --- Returns the finished take, or nil if it was too short to be one.
  function handle.stop()
    if cancelled then return nil end
    stopped = true
    if opts.scene then opts.scene:stop() end

    if #recording.samples < 2 then return nil end

    return {
      kind       = recording.isVehicle and 'vehicle' or 'ped',
      model      = GetEntityModel(entity),
      hz         = opts.hz or RECORD_HZ,
      duration   = recording.samples[#recording.samples][1],
      dist       = recording.dist,
      samples    = recording.samples,
      -- who was aboard / what the ped looked like, so replay rebuilds them
      occupants  = recording.isVehicle and appearance.captureOccupants(entity) or nil,
      appearance = (not recording.isVehicle) and appearance.capture(entity) or nil,
    }
  end

  CreateThread(function()
    for i = (opts.countdown or 0), 1, -1 do
      recording.countdown = i
      if opts.onTick then opts.onTick(handle.state()) end
      Wait(1000)
      if cancelled then return end
    end
    recording.countdown = nil
    if cancelled then return end

    -- the layers you are acting against start with the take, not before it
    if opts.scene then opts.scene:play() end

    recording.startedAt = GetGameTimer()
    recording.lastPos   = GetEntityCoords(entity)

    local interval = math.floor(1000 / (opts.hz or RECORD_HZ))
    local nextAt   = 0

    while not stopped do
      local now = GetGameTimer()
      if not DoesEntityExist(entity) then break end

      if now >= nextAt then
        nextAt = now + interval
        local pos = GetEntityCoords(entity)
        recording.dist = recording.dist + #(pos - recording.lastPos)
        recording.lastPos = pos
        recording.samples[#recording.samples + 1] =
          take.sample(entity, now - recording.startedAt, isPlayer)
        if opts.onTick then opts.onTick(handle.state()) end
      end

      Wait(0)
    end
  end)

  return handle
end

-------------------------------------------------------------------------------
-- scenes
-------------------------------------------------------------------------------

local Scene = {}
Scene.__index = Scene

--- def = {
---   actors = {
---     [id] = {
---       kind = 'ped' | 'vehicle' | 'object',
---       model, appearance, take, cues = {...},
---       seat = { vehicle = '<actorId>', index = -1 },  -- ride instead of move
---       spawn = vec4(...),                             -- for cue-only actors
---     }
---   },
---   camera = { <camera cues> },   -- see camera.lua; scene-level, not an actor
--- }
function cinematic.create(def)
  local self = setmetatable({
    def      = def or {},
    actors   = {},
    t        = 0,
    speed    = 1.0,
    playing  = false,
    duration = 0,
  }, Scene)

  self.cameraCues = {}
  for _, cue in ipairs(self.def.camera or {}) do self.cameraCues[#self.cameraCues + 1] = cue end
  table.sort(self.cameraCues, function(a, b) return (a.at or 0) < (b.at or 0) end)
  for _, cue in ipairs(self.cameraCues) do
    local ends = (cue.at or 0) + (cue.moveMs or 0)
    if ends > self.duration then self.duration = ends end
  end

  for id, actor in pairs(self.def.actors or {}) do
    local list = cues.prepare(actor.cues)
    local dur  = actor.take and take.duration(actor.take) or 0
    for _, cue in ipairs(list) do
      local ends = (cue.at or 0) + (cue.duration or 0)
      if ends > dur then dur = ends end
    end
    if dur > self.duration then self.duration = dur end

    self.actors[id] = { id = id, def = actor, cues = list, applied = {}, scratch = {} }
  end

  return self
end

--- Point the streamer at the scene.
---
--- A scene rarely happens where the player is standing, and the world only
--- streams around the player — so without this you get a grey void with the
--- actors floating in it. Must be released again (ClearFocus in :stop), or
--- everything stays loaded around a place nobody is.
function Scene:setFocus(x, y, z)
  self.focus = { x = x, y = y, z = z }
  RequestCollisionAtCoord(x, y, z)
  SetFocusPosAndVel(x, y, z, 0.0, 0.0, 0.0)
  return self
end

--- Where the scene happens: the first thing with a position wins.
local function sceneOrigin(self)
  for _, a in pairs(self.actors) do
    local d = a.def
    if d.take and d.take.samples and d.take.samples[1] then
      local s = d.take.samples[1]
      return s[2], s[3], s[4]
    end
  end
  for _, a in pairs(self.actors) do
    if a.def.spawn then return a.def.spawn.x, a.def.spawn.y, a.def.spawn.z end
  end
end

--- Block until the world around the focus exists, so actors aren't posed into
--- thin air on the first frame.
function Scene:stream(ms)
  local f = self.focus
  if not f then return self end
  NewLoadSceneStartSphere(f.x, f.y, f.z, 80.0, 0)
  local deadline = GetGameTimer() + (ms or 5000)
  while not IsNewLoadSceneLoaded() and GetGameTimer() < deadline do Wait(0) end
  NewLoadSceneStop()
  return self
end

--- Spawn everything. Safe to call twice; it only builds what's missing.
function Scene:build()
  if not self.focus then
    local x, y, z = sceneOrigin(self)
    if x then
      self:setFocus(x, y, z)
      self:stream()
    end
  end

  for _, a in pairs(self.actors) do
    if not a.entity or not DoesEntityExist(a.entity) then
      local d = a.def
      local model = d.model or (d.appearance and d.appearance.model) or (d.take and d.take.model)
      if model then
        local hash = type(model) == 'string' and joaat(model) or model
        RequestModel(hash)
        local deadline = GetGameTimer() + 8000
        while not HasModelLoaded(hash) and GetGameTimer() < deadline do Wait(0) end

        local x, y, z = 0.0, 0.0, 0.0
        if d.take and d.take.samples[1] then
          local s = d.take.samples[1]
          x, y, z = s[2], s[3], s[4]
        elseif d.spawn then
          x, y, z = d.spawn.x, d.spawn.y, d.spawn.z
        end

        if d.kind == 'vehicle' then
          a.entity = CreateVehicle(hash, x, y, z, 0.0, false, false)
          SetVehicleEngineOn(a.entity, true, true, false)
        elseif d.kind == 'object' then
          a.entity = CreateObject(hash, x, y, z, false, false, false)
          FreezeEntityPosition(a.entity, true)
        else
          a.entity = CreatePed(4, hash, x, y, z, 0.0, false, false)
          SetBlockingOfNonTemporaryEvents(a.entity, true)
          SetPedCanRagdoll(a.entity, false)
          if d.appearance then appearance.apply(a.entity, d.appearance) end
        end

        SetModelAsNoLongerNeeded(hash)
        SetEntityInvincible(a.entity, true)
        a.scratch = take.scratchFor(a.entity)
      end
    end
  end

  if #self.cameraCues > 0 and not self.cam then
    self.cam = camera.create()
  end

  -- occupants of a recorded vehicle, and actors that ride rather than move
  for _, a in pairs(self.actors) do
    if a.entity and a.def.take and a.def.take.occupants and not a.occupants then
      a.occupants = appearance.spawnOccupants(a.entity, a.def.take.occupants)
    end
    if a.entity and a.def.seat then
      local host = self.actors[a.def.seat.vehicle]
      if host and host.entity then SetPedIntoVehicle(a.entity, host.entity, a.def.seat.index or 0) end
    end
  end

  return self
end

--- Hand an eligible vehicle to the engine. Returns true if it took.
local function engineStart(self, a)
  local name = a.def.engineTake
  if not name or a.def.kind ~= 'vehicle' or not a.entity then return false end
  local id = cinematic.engineTakes[name]
  if not id or not cinematic.engineReady(name) then return false end

  StartPlaybackRecordedVehicle(a.entity, id, name, 0)
  if self.speed ~= 1.0 then SetPlaybackSpeed(a.entity, self.speed + 0.0) end
  if self.t > 0 then SkipTimeInPlaybackRecordedVehicle(a.entity, self.t + 0.0) end
  a.engineDriven = true
  return true
end

local function engineStop(a)
  if not a.engineDriven then return end
  a.engineDriven = false
  if a.entity and DoesEntityExist(a.entity) then StopPlaybackRecordedVehicle(a.entity) end
end

--- Put the whole scene at an absolute time. This is the editor's entry point:
--- one call, every actor, no memory of how you got here.
function Scene:seek(ms, opts)
  local from = self.t

  -- Scrubbing and engine playback are incompatible: the engine can only skip
  -- forwards. Any real jump drops those actors back to being posed.
  if math.abs(ms - from) > 120 then
    for _, a in pairs(self.actors) do engineStop(a) end
  end
  self.t = math.max(0, math.min(ms, self.duration))
  self:build()

  local jumped = math.abs(self.t - from) > 120

  for _, a in pairs(self.actors) do
    if a.entity and DoesEntityExist(a.entity) then
      if jumped then
        -- a scrub must forget the last applied state or nothing is re-forced
        take.resetScratch(a.scratch)
        a.applied.seekDirty = true
      end

      -- an engine-driven car moves itself; posing it would fight the playback
      if a.def.take and not a.def.seat and not a.engineDriven then
        take.pose(a.entity, a.def.take, self.t, a.scratch)
      end

      if a.def.kind ~= 'vehicle' and a.def.kind ~= 'object' then
        -- scrubbing = the playhead moved, or we're parked (paused/editing)
        a.applied = cues.apply(a.entity, a.cues, self.t, a.applied,
          (not jumped) and from or nil, jumped or not self.playing)
      end
    end
  end

  -- after the actors: a shot that aims at somebody needs them already posed
  if self.cam then
    camera.pose(self.cam, self.cameraCues, self.t, function(id)
      local a = self.actors[id]
      return a and a.entity
    end)
  end

  if opts and opts.pause then self.playing = false end
  return self
end

--- opts.engine = true hands eligible vehicles to the game instead of posing
--- them. Use it for the finished thing; leave it off in an editor, because a
--- scrub has to land on an absolute time and the engine's skip is forward-only.
function Scene:play(opts)
  if self.playing then return self end
  self:build()
  self.playing = true

  if opts and opts.engine then
    for _, a in pairs(self.actors) do engineStart(self, a) end
  end

  local origin = GetGameTimer() - self.t / self.speed
  self.origin = origin

  CreateThread(function()
    while self.playing do
      local t = (GetGameTimer() - self.origin) * self.speed
      if t >= self.duration then
        self:seek(self.duration)
        self.playing = false
        if self.onFinish then self.onFinish() end
        break
      end
      self:seek(t)
      Wait(0)
    end
  end)

  return self
end

function Scene:pause()
  self.playing = false
  for _, a in pairs(self.actors) do
    if a.engineDriven and a.entity and DoesEntityExist(a.entity) then
      PausePlaybackRecordedVehicle(a.entity)
    end
  end
  return self
end

function Scene:setSpeed(x)
  self.speed = x
  self.origin = GetGameTimer() - self.t / self.speed
  for _, a in pairs(self.actors) do
    if a.engineDriven and a.entity and DoesEntityExist(a.entity) then
      SetPlaybackSpeed(a.entity, x + 0.0)
    end
  end
  return self
end

function Scene:time() return self.t end
function Scene:isPlaying() return self.playing end

--- Tear the scene down: every entity it spawned, anything cues attached, and
--- the streaming focus — leaving that set keeps the world loaded around a place
--- nobody is standing.
function Scene:stop()
  self.playing = false
  if self.focus then
    ClearFocus()
    self.focus = nil
  end
  if self.cam then
    camera.destroy(self.cam)
    self.cam = nil
  end
  for _, a in pairs(self.actors) do
    engineStop(a)
    cues.clear(a.applied)
    for _, p in ipairs(a.occupants or {}) do
      if DoesEntityExist(p) then
        SetEntityAsMissionEntity(p, true, true)
        DeleteEntity(p)
      end
    end
    if a.entity and DoesEntityExist(a.entity) then
      SetEntityAsMissionEntity(a.entity, true, true)
      DeleteEntity(a.entity)
    end
    a.entity, a.occupants, a.applied = nil, nil, {}
  end
  return self
end

lib.cinematic = cinematic

return lib.cinematic
