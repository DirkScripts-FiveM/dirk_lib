--- Cues: everything an actor does that ISN'T movement.
---
--- Movement is recorded (see take.lua); anims, props, walk style, speech and
--- vehicle seats are placed on the timeline as cues. That split is deliberate:
--- a recorded anim could only ever be replayed forwards, whereas a cue carries
--- its own dict/clip and duration, so it can be posed at an absolute time with
--- SetEntityAnimCurrentTime — which is what makes an editor able to scrub.
---
--- SCENARIOS ARE CONVERTED, NOT PLAYED. A scenario has no phase: you can start
--- one, but never ask it to be 3.2 seconds in. So a scenario cue is resolved to
--- the anim dict/clip behind it and played as an anim. Anything left as a real
--- scenario would freeze the scrubber.
---
--- Each cue is { at, type, ... } and belongs to a CHANNEL. Posing at time t
--- means, per channel, finding the last cue at or before t and applying it with
--- the right phase — never replaying the ones in between.

local cues = {}

--- Which cues override which. One cue per channel is live at any time.
local CHANNEL = {
  anim      = 'body',
  scenario  = 'body',
  ragdoll   = 'body',
  walkstyle = 'walk',
  prop      = 'prop',
  weapon    = 'weapon',
  speech    = 'oneshot',
  seat      = 'seat',
}

--- Scenarios with a known anim behind them. A scenario cue resolves through
--- here so it can be scrubbed; unknown ones fall back to starting the scenario
--- (and simply won't scrub, which we report rather than hide).
cues.SCENARIO_ANIMS = {
  WORLD_HUMAN_SMOKING        = { dict = 'amb@world_human_smoking@male@male_a@base', clip = 'base' },
  WORLD_HUMAN_DRINKING       = { dict = 'amb@world_human_drinking@beer@male@base', clip = 'base' },
  WORLD_HUMAN_BUM_SLUMPED    = { dict = 'amb@world_human_bum_slumped@male@laying_on_left_side@base', clip = 'base' },
  WORLD_HUMAN_LEANING        = { dict = 'amb@world_human_leaning@male@wall@back@idle_a', clip = 'idle_a' },
  WORLD_HUMAN_STAND_IMPATIENT = { dict = 'amb@world_human_stand_impatient@male@no_props@base', clip = 'base' },
  WORLD_HUMAN_HANG_OUT_STREET = { dict = 'amb@world_human_hang_out_street@male_c@base', clip = 'base' },
  WORLD_HUMAN_SMOKING_POT    = { dict = 'amb@world_human_smoking_pot@male@male_a@base', clip = 'base' },
  WORLD_HUMAN_AA_SMOKE       = { dict = 'amb@world_human_aa_smoke@male@idle_a', clip = 'idle_a' },
  PROP_HUMAN_SEAT_CHAIR      = { dict = 'amb@prop_human_seat_chair@male@generic@base', clip = 'base' },
}

--- Sort once on load; posing assumes ascending `at`.
function cues.prepare(list)
  local out = {}
  for _, cue in ipairs(list or {}) do out[#out + 1] = cue end
  table.sort(out, function(a, b) return (a.at or 0) < (b.at or 0) end)
  return out
end

--- The live cue per channel at time `ms`, plus any one-shots that fall inside
--- the last frame (so speech fires once while playing and never while scrubbing).
function cues.activeAt(list, ms, sinceMs)
  local live, fired = {}, {}

  for _, cue in ipairs(list) do
    local at = cue.at or 0
    if at > ms then break end

    local channel = CHANNEL[cue.type] or cue.type
    if channel == 'oneshot' then
      -- only when the playhead has just crossed it, moving forwards
      if sinceMs and at > sinceMs and at <= ms then fired[#fired + 1] = cue end
    else
      local ends = cue.until_ or (cue.duration and (at + cue.duration))
      if not ends or ms < ends then
        live[channel] = cue
      elseif live[channel] == cue then
        live[channel] = nil
      end
    end
  end

  return live, fired
end

-------------------------------------------------------------------------------
-- applying
-------------------------------------------------------------------------------

local function loadDict(dict)
  if HasAnimDictLoaded(dict) then return true end
  RequestAnimDict(dict)
  local deadline = GetGameTimer() + 5000
  while not HasAnimDictLoaded(dict) do
    if GetGameTimer() > deadline then return false end
    Wait(0)
  end
  return true
end

--- An anim posed at an absolute phase. This is the reason anims are cues.
local function applyAnim(ped, cue, ms)
  local dict, clip = cue.dict, cue.clip

  if cue.type == 'scenario' then
    local mapped = cues.SCENARIO_ANIMS[cue.name]
    if not mapped then
      -- honest degradation: it plays, it just cannot be scrubbed
      ClearPedTasksImmediately(ped)
      TaskStartScenarioInPlace(ped, cue.name, 0, true)
      return false
    end
    dict, clip = mapped.dict, mapped.clip
  end

  if not dict or not clip or not loadDict(dict) then return false end

  local elapsed = ms - (cue.at or 0)
  local length  = GetAnimDuration(dict, clip)
  if not length or length <= 0 then length = 1.0 end

  -- A non-looping clip that has run past its end must NOT be pinned at phase
  -- 1.0 for the rest of its cue: that is what freezes a ped mid-animation and
  -- leaves it standing there. Let it finish naturally instead.
  local past = cue.loop == false and (elapsed / 1000.0) > length
  local phase
  if cue.loop ~= false then
    phase = (elapsed / 1000.0) % length / length
  else
    phase = math.min(elapsed / 1000.0, length) / length
  end

  -- If the clip is ALREADY on the ped, never restart it — just move the
  -- playhead. Restarting on every seek is what makes a drag look like a
  -- stutter: each restart blends from scratch and the phase lands a frame late.
  if IsEntityPlayingAnim(ped, dict, clip, 3) then
    if not past then SetEntityAnimCurrentTime(ped, dict, clip, phase) end
    return true
  end

  local flag = cue.flag or (cue.loop ~= false and 1 or 0)
  TaskPlayAnim(ped, dict, clip, 8.0, -8.0, -1, flag, 0.0, false, false, false)
  -- one frame later, because the task only registers on the next tick and
  -- setting the time in the same frame is a silent no-op
  SetTimeout(0, function()
    if DoesEntityExist(ped) then SetEntityAnimCurrentTime(ped, dict, clip, phase) end
  end)
  return true
end

--- Apply the channel state for time `ms`. `applied` carries what is already on
--- the ped so we don't restart an identical anim every frame.
--- `scrub` = the playhead was moved rather than advanced. Only then is the anim
--- phase forced: pinning it on every frame of normal playback makes the motion
--- look mechanical and fights the game's own blending.
function cues.apply(ped, list, ms, applied, sinceMs, scrub)
  local live, fired = cues.activeAt(list, ms, sinceMs)
  applied = applied or {}

  -- body: anim / scenario / ragdoll
  local body = live.body
  local bodyKey = body and (tostring(body.at) .. (body.dict or body.name or body.type)) or nil
  if bodyKey ~= applied.bodyKey then
    applied.bodyKey = bodyKey
    if body then
      if body.type == 'ragdoll' then
        SetPedCanRagdoll(ped, true)
        SetPedToRagdoll(ped, body.duration or 2000, body.duration or 2000, 0, true, true, false)
      else
        applied.scrubbable = applyAnim(ped, body, ms)
      end
    else
      ClearPedTasks(ped)
    end
  elseif scrub and body and body.type ~= 'ragdoll' and applied.scrubbable then
    -- same cue, but the playhead moved: re-seat the phase. While playing
    -- normally we leave the clip alone and let it run.
    applyAnim(ped, body, ms)
  end
  applied.seekDirty = false

  -- walk style persists until changed
  local walk = live.walk
  local walkKey = walk and walk.style or nil
  if walkKey ~= applied.walkKey then
    applied.walkKey = walkKey
    if walkKey then
      if loadDict(walkKey) then SetPedMovementClipset(ped, walkKey, 1.0) end
    else
      ResetPedMovementClipset(ped, 0.0)
    end
  end

  -- prop in hand
  local prop = live.prop
  local propKey = prop and (tostring(prop.at) .. tostring(prop.model)) or nil
  if propKey ~= applied.propKey then
    if applied.prop and DoesEntityExist(applied.prop) then
      DeleteEntity(applied.prop)
      applied.prop = nil
    end
    applied.propKey = propKey
    if prop and prop.model then
      local model = type(prop.model) == 'string' and joaat(prop.model) or prop.model
      RequestModel(model)
      local deadline = GetGameTimer() + 3000
      while not HasModelLoaded(model) and GetGameTimer() < deadline do Wait(0) end
      if HasModelLoaded(model) then
        local obj = CreateObject(model, GetEntityCoords(ped), false, false, false)
        AttachEntityToEntity(obj, ped, GetPedBoneIndex(ped, prop.bone or 57005),
          prop.x or 0.0, prop.y or 0.0, prop.z or 0.0,
          prop.rx or 0.0, prop.ry or 0.0, prop.rz or 0.0, true, true, false, true, 1, true)
        SetModelAsNoLongerNeeded(model)
        applied.prop = obj
      end
    end
  end

  -- one-shots, forward playback only
  for _, cue in ipairs(fired) do
    if cue.type == 'speech' then
      PlayAmbientSpeech1(ped, cue.name, cue.voice or 'SPEECH_PARAMS_FORCE')
    end
  end

  return applied
end

--- Clean up anything cues attached to a ped.
function cues.clear(applied)
  if applied and applied.prop and DoesEntityExist(applied.prop) then
    DeleteEntity(applied.prop)
  end
end

return cues
