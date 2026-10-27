--- The camera channel.
---
--- A camera is not "presentation you can bolt on later": an intro read without
--- its shots looks like nothing at all, and an editor has to be able to scrub
--- the camera as well as the actors. So it poses at an absolute time like
--- everything else — including mid-move, which is just a lerp between the
--- previous shot and this one.
---
--- cue = {
---   at, pos = {x,y,z}, rot = {x,y,z}, fov,
---   to = { pos, rot, fov }, moveMs,      -- move to `to` over moveMs
---   target = '<actorId>', aim = 'head' | 'body',   -- look at an actor instead
--- }

local camera = {}

local function lerp(a, b, f) return a + (b - a) * f end

local function xyz(v, d)
  if type(v) ~= 'table' then return d, d, d end
  return v.x or d, v.y or d, v.z or d
end

--- Where the shot is at `ms`: start values, or partway through a move.
local function shotAt(cue, ms)
  local px, py, pz = xyz(cue.pos, 0.0)
  local rx, ry, rz = xyz(cue.rot, 0.0)
  local fov = cue.fov or 50.0

  local move = cue.moveMs or 0
  if cue.to and move > 0 then
    local f = math.max(0.0, math.min(1.0, (ms - (cue.at or 0)) / move))
    local tx, ty, tz = xyz(cue.to.pos or cue.pos, 0.0)
    local qx, qy, qz = xyz(cue.to.rot or cue.rot, 0.0)
    px, py, pz = lerp(px, tx, f), lerp(py, ty, f), lerp(pz, tz, f)
    rx, ry, rz = lerp(rx, qx, f), lerp(ry, qy, f), lerp(rz, qz, f)
    fov = lerp(fov, cue.to.fov or fov, f)
  elseif cue.to then
    -- no duration: the `to` IS the shot
    px, py, pz = xyz(cue.to.pos or cue.pos, 0.0)
    rx, ry, rz = xyz(cue.to.rot or cue.rot, 0.0)
    fov = cue.to.fov or fov
  end

  return px, py, pz, rx, ry, rz, fov
end

--- The live shot at `ms` — the last cue at or before it.
function camera.cueAt(list, ms)
  local live
  for _, cue in ipairs(list or {}) do
    if (cue.at or 0) > ms then break end
    live = cue
  end
  return live
end

--- Put the camera where the timeline says it should be. `resolve(id)` hands
--- back an actor's entity so a shot can follow somebody.
function camera.pose(cam, list, ms, resolve)
  if not cam or not DoesCamExist(cam) then return end

  local cue = camera.cueAt(list, ms)
  if not cue then return end

  local px, py, pz, rx, ry, rz, fov = shotAt(cue, ms)
  SetCamCoord(cam, px + 0.0, py + 0.0, pz + 0.0)
  SetCamFov(cam, fov + 0.0)

  local aimAt = (cue.to and cue.to.aim) or cue.aim
  local target = (cue.to and cue.to.target) or cue.target
  local entity = target and resolve and resolve(target)

  if aimAt and entity and DoesEntityExist(entity) then
    -- a bone, so the shot holds on the face rather than the feet
    local bone = aimAt == 'head' and 31086 or 0
    local at = bone ~= 0 and GetPedBoneCoords(entity, bone, 0.0, 0.0, 0.0) or GetEntityCoords(entity)
    PointCamAtCoord(cam, at.x, at.y, at.z)
  else
    StopCamPointing(cam)
    SetCamRot(cam, rx + 0.0, ry + 0.0, rz + 0.0, 2)
  end
end

function camera.create()
  local cam = CreateCamWithParams('DEFAULT_SCRIPTED_CAMERA', 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 50.0, true, 2)
  SetCamActive(cam, true)
  RenderScriptCams(true, false, 0, true, true)
  return cam
end

function camera.destroy(cam)
  if not cam then return end
  RenderScriptCams(false, false, 0, true, true)
  if DoesCamExist(cam) then DestroyCam(cam, false) end
end

return camera
