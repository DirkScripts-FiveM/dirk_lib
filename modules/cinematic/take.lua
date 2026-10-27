--- Takes: the recorded motion of ONE entity, and the ability to pose that
--- entity at any absolute time.
---
--- Pose-at-T is the whole point. Playing a recording forwards is easy; an
--- editor SCRUBS, which means "put the world exactly as it was at 7.31s" has to
--- be a pure function of the take and t. Everything here is written to that
--- rule: no state that only makes sense if you arrived by playing.
---
--- sample = { t, x, y, z, qx, qy, qz, qw, speed, steer, rpm, wheel, state,
---            weapon, vx, vy, vz, gas, brake, handbrake }
---
--- The tail (vx..handbrake) is what a GTA `.yvr` entry needs, so a vehicle take
--- can be compiled into one and handed to the engine instead of being puppeted.
--- Peds have no such format and are always posed by us.

local take = {}

local T, X, Y, Z, QX, QY, QZ, QW, SPD, STR, RPM, WHL, STA, WPN, VX, VY, VZ, GAS, BRK, HBR =
  1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20

--- What a ped was doing, as one int per sample. Replay forces the matching
--- motion state, which is the difference between a ped that runs and a ped that
--- glides along the path in an idle pose.
take.STATE = {
  IDLE = 0, WALK = 1, RUN = 2, SPRINT = 3,
  AIM = 4, SHOOT = 5, RAGDOLL = 6, JUMP = 7, CROUCH = 8,
}

--- Motion states the engine understands, by our state id.
local MOTION = {
  [0] = `motionstate_idle`,
  [1] = `motionstate_walk`,
  [2] = `motionstate_run`,
  [3] = `motionstate_sprint`,
  [8] = `motionstate_stealth_idle`,
}

local MOVE_RATIO = { [0] = 0.0, [1] = 1.0, [2] = 2.0, [3] = 3.0, [8] = 1.0 }

-------------------------------------------------------------------------------
-- maths
-------------------------------------------------------------------------------

local function lerp(a, b, f) return a + (b - a) * f end

--- Normalised lerp between quaternions. Cheap, and at 30Hz indistinguishable
--- from a true slerp.
local function nlerp(ax, ay, az, aw, bx, by, bz, bw, f)
  if (ax * bx + ay * by + az * bz + aw * bw) < 0.0 then
    bx, by, bz, bw = -bx, -by, -bz, -bw
  end
  local x, y, z, w = ax + (bx - ax) * f, ay + (by - ay) * f, az + (bz - az) * f, aw + (bw - aw) * f
  local len = math.sqrt(x * x + y * y + z * z + w * w)
  if len < 0.0001 then return ax, ay, az, aw end
  return x / len, y / len, z / len, w / len
end

-------------------------------------------------------------------------------
-- recording
-------------------------------------------------------------------------------

--- What a ped is doing right now. `player` is true when this is the local
--- player's own ped, where free-aim is readable.
local function pedState(ped, player)
  if IsPedRagdoll(ped) then return take.STATE.RAGDOLL end
  if IsPedShooting(ped) then return take.STATE.SHOOT end
  if (player and IsPlayerFreeAiming(PlayerId())) or IsPedStrafing(ped) then return take.STATE.AIM end
  if IsPedJumping(ped) then return take.STATE.JUMP end
  if GetPedStealthMovement(ped) then return take.STATE.CROUCH end
  if IsPedSprinting(ped) then return take.STATE.SPRINT end
  if IsPedRunning(ped) then return take.STATE.RUN end
  if IsPedWalking(ped) then return take.STATE.WALK end
  return take.STATE.IDLE
end

--- One sample of `entity` at `t` ms into the take.
function take.sample(entity, t, isPlayer)
  local pos   = GetEntityCoords(entity)
  local vel   = GetEntityVelocity(entity)
  local isVeh = IsEntityAVehicle(entity)
  local qx, qy, qz, qw = GetEntityQuaternion(entity)
  -- there is no brake getter; throttle offset goes negative for brake/reverse
  local throttle = isVeh and (GetVehicleThrottleOffset(entity) or 0.0) or 0.0

  return {
    t,
    pos.x, pos.y, pos.z,
    qx, qy, qz, qw,
    GetEntitySpeedVector(entity, true).y,
    isVeh and GetVehicleSteeringAngle(entity) or 0.0,
    isVeh and GetVehicleCurrentRpm(entity) or 0.0,
    -- what the wheels were doing, so they roll on replay
    isVeh and GetVehicleWheelRotationSpeed(entity, 0) or 0.0,
    isVeh and 0 or pedState(entity, isPlayer),
    isVeh and 0 or GetSelectedPedWeapon(entity),
    vel.x, vel.y, vel.z,
    isVeh and math.max(0.0, throttle) * 100.0 or 0.0,
    isVeh and math.max(0.0, -throttle) * 100.0 or 0.0,
    (isVeh and GetVehicleHandbrake(entity)) and 1 or 0,
  }
end

-------------------------------------------------------------------------------
-- reading a take
-------------------------------------------------------------------------------

function take.duration(t)
  local s = t and t.samples
  return (s and #s > 0) and s[#s][T] or 0
end

--- The two samples bracketing `ms`, and how far between them it falls.
--- Binary search, because a scrub jumps anywhere and a linear scan from the
--- last index is only fast when you arrived by playing.
function take.at(tk, ms)
  local s = tk.samples
  local n = #s
  if n == 0 then return nil end
  if ms <= s[1][T] then return s[1], s[1], 0.0 end
  if ms >= s[n][T] then return s[n], s[n], 0.0 end

  local lo, hi = 1, n
  while hi - lo > 1 do
    local mid = (lo + hi) // 2
    if s[mid][T] <= ms then lo = mid else hi = mid end
  end

  local a, b = s[lo], s[hi]
  local span = b[T] - a[T]
  return a, b, span > 0 and ((ms - a[T]) / span) or 0.0
end

-------------------------------------------------------------------------------
-- posing
-------------------------------------------------------------------------------

local function poseVehicle(ent, a, b, f, scratch)
  SetVehicleForwardSpeed(ent, lerp(a[SPD], b[SPD], f))
  SetVehicleSteeringAngle(ent, lerp(a[STR], b[STR], f))
  SetVehicleCurrentRpm(ent, lerp(a[RPM] or 0.0, b[RPM] or 0.0, f))

  -- A teleported vehicle never gets a rolling contact, so its wheels sit dead
  -- still while the body slides. Push back the rotation speed the game itself
  -- reported while we drove it.
  local w = lerp(a[WHL] or 0.0, b[WHL] or 0.0, f)
  if w == 0.0 and (scratch.radius or 0) > 0 then
    w = lerp(a[SPD], b[SPD], f) / scratch.radius
  end
  for i = 0, (scratch.wheels or 0) - 1 do
    SetVehicleWheelRotationSpeed(ent, i, w)
  end
end

--- Drives a puppeted ped's animation.
---
--- ForcePedMotionState is only applied when the state CHANGES: re-forcing it
--- every frame restarts the clip, and the ped ends up sliding along in a
--- permanent first frame. That is exactly what "floating along the path" looks
--- like, and it cost an afternoon to find.
local function posePed(ent, a, b, f, scratch)
  local state  = a[STA] or 0
  local weapon = a[WPN] or 0

  if weapon ~= scratch.weapon then
    scratch.weapon = weapon
    if weapon ~= 0 and weapon ~= `WEAPON_UNARMED` then
      GiveWeaponToPed(ent, weapon, 250, false, true)
      SetCurrentPedWeapon(ent, weapon, true)
    else
      SetCurrentPedWeapon(ent, `WEAPON_UNARMED`, true)
    end
  end

  if state ~= scratch.state then
    scratch.state = state
    ClearPedTasks(ent)

    if state == take.STATE.AIM or state == take.STATE.SHOOT then
      local fwd = GetEntityForwardVector(ent)
      local pos = GetEntityCoords(ent)
      local tx, ty, tz = pos.x + fwd.x * 12.0, pos.y + fwd.y * 12.0, pos.z + fwd.z * 12.0
      if state == take.STATE.SHOOT then
        TaskShootAtCoord(ent, tx, ty, tz, 60000, `FIRING_PATTERN_FULL_AUTO`)
      else
        TaskAimGunAtCoord(ent, tx, ty, tz, 60000, false, false)
      end
    elseif state == take.STATE.RAGDOLL then
      SetPedCanRagdoll(ent, true)
      SetPedToRagdoll(ent, 60000, 60000, 0, true, true, false)
    else
      SetPedCanRagdoll(ent, false)
      SetPedUsingActionMode(ent, weapon ~= 0 and weapon ~= `WEAPON_UNARMED`, -1, 'DEFAULT_ACTION')
      ForcePedMotionState(ent, MOTION[state] or MOTION[0], false, false, false)
    end
  end

  if MOVE_RATIO[state] then
    SetPedDesiredMoveBlendRatio(ent, MOVE_RATIO[state])
  end
end

--- Put `entity` exactly where the take says it was at `ms`.
---
--- `scratch` is per-playback bookkeeping (wheel geometry, last applied ped
--- state). Pass the same table each call for one entity; pose-at-T stays pure
--- with respect to the WORLD, scratch only stops us re-issuing identical tasks.
function take.pose(entity, tk, ms, scratch)
  local a, b, f = take.at(tk, ms)
  if not a then return end

  scratch = scratch or {}

  SetEntityCoordsNoOffset(entity,
    lerp(a[X], b[X], f), lerp(a[Y], b[Y], f), lerp(a[Z], b[Z], f), false, false, false)
  SetEntityQuaternion(entity, nlerp(a[QX], a[QY], a[QZ], a[QW], b[QX], b[QY], b[QZ], b[QW], f))

  if IsEntityAVehicle(entity) then
    poseVehicle(entity, a, b, f, scratch)
  else
    posePed(entity, a, b, f, scratch)
  end
end

--- Call once before posing a vehicle repeatedly: wheel count and tyre radius
--- don't change, and reading them per frame is waste.
function take.scratchFor(entity)
  local scratch = { state = -1, weapon = -1 }
  if IsEntityAVehicle(entity) then
    scratch.wheels = GetVehicleNumberOfWheels(entity)
    local r = GetVehicleWheelTireColliderSize(entity, 0)
    scratch.radius = (r and r > 0) and r or 0.35
  end
  return scratch
end

--- A scrub backwards has to forget the last applied ped state, or the motion
--- state for the new time is never re-forced.
function take.resetScratch(scratch)
  if not scratch then return end
  scratch.state = -1
  scratch.weapon = -1
end

return take
