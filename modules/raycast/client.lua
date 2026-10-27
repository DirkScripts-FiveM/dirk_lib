-- Adapted from ox_lib (https://github.com/overextended/ox_lib/blob/master/imports/raycast/client.lua)
-- Licensed under LGPL-3.0: https://www.gnu.org/licenses/lgpl-3.0.html
-- and is used under the same license.
lib.raycast = {}

local StartShapeTestLosProbe = StartShapeTestLosProbe
local GetShapeTestResultIncludingMaterial = GetShapeTestResultIncludingMaterial
local glm_sincos = require 'glm'.sincos
local glm_rad = require 'glm'.rad
local math_abs = math.abs
local GetFinalRenderedCamCoord = GetFinalRenderedCamCoord
local GetFinalRenderedCamRot = GetFinalRenderedCamRot

---@alias ShapetestIgnore
---| 1 GLASS
---| 2 SEE_THROUGH
---| 3 GLASS | SEE_THROUGH
---| 4 NO_COLLISION
---| 7 GLASS | SEE_THROUGH | NO_COLLISION

---@alias ShapetestFlags integer
---| 1 INCLUDE_MOVER
---| 2 INCLUDE_VEHICLE
---| 4 INCLUDE_PED
---| 8 INCLUDE_RAGDOLL
---| 16 INCLUDE_OBJECT
---| 32 INCLUDE_PICKUP
---| 64 INCLUDE_GLASS
---| 128 INCLUDE_RIVER
---| 256 INCLUDE_FOLIAGE
---| 511 INCLUDE_ALL

---@param coords vector3
---@param destination vector3
---@param flags ShapetestFlags? Defaults to 511.
---@param ignore ShapetestIgnore? Defaults to 4.
---@return boolean hit
---@return vector3 endCoords
---@return number entityHit
---@return vector3 surfaceNormal
---@return number materialHash
function lib.raycast.fromCoords(coords, destination, flags, ignore)
  local rayHandle = StartShapeTestRay(coords.x, coords.y, coords.z, destination.x, destination.y, destination.z, flags or 511, ignore or 4, 0)
  local _, hit, endCoords, surfaceNormal, materialHash, entityHit = GetShapeTestResultIncludingMaterial(rayHandle)

  -- `hit` is a BOOL, and cfxlua hands a BOOL back as a Lua boolean.
  --
  -- This compared it to the NUMBER 1, and `true == 1` is false in Lua — so the
  -- first return value was false on every call this function has ever made,
  -- hit or miss. ox_lib, which this was adapted from, returns `hit` straight
  -- through; the comparison was added here and broke it.
  --
  -- It hid for a long time because of what the callers do with it. Anything
  -- reading the THIRD return (`entityHit`) was unaffected, so picking an object
  -- under the crosshair kept working. Anything reading the FIRST fell through
  -- to its own fallback — and a prop placer's fallback is "three metres in
  -- front of the camera", which is close enough to where you were pointing
  -- that it reads as working right up until you aim at something near or far.
  --
  -- Both forms accepted, so a build that ever does return a number is fine.
  --
  -- Return results even if nothing was hit (entityHit will be 0)
  return hit == true or hit == 1, endCoords, entityHit or 0, surfaceNormal, materialHash
end

lib.raycast.world3dToScreen2d = function(pos)
  local _, sX, sY = GetScreenCoordFromWorldCoord(pos.x, pos.y, pos.z)
  return vector2(sX, sY)
end

local rotationToDirection = function(rotation)
  local x = rotation.x * math.pi / 180.0
  local z = rotation.z * math.pi / 180.0
  local num = math.abs(math.cos(x))
  return vector3((-math.sin(z) * num), (math.cos(z) * num), math.sin(x))
end

local screenRelToWorld = function(camPos, camRot, cursor)
  local camForward = rotationToDirection(camRot)
  local rotUp = vector3(camRot.x + 1.0, camRot.y, camRot.z)
  local rotDown = vector3(camRot.x - 1.0, camRot.y, camRot.z)
  local rotLeft = vector3(camRot.x, camRot.y, camRot.z - 1.0)
  local rotRight = vector3(camRot.x, camRot.y, camRot.z + 1.0)
  local camRight = rotationToDirection(rotRight) - rotationToDirection(rotLeft)
  local camUp = rotationToDirection(rotUp) - rotationToDirection(rotDown)
  local rollRad = -(camRot.y * math.pi / 180.0)
  local camRightRoll = camRight * math.cos(rollRad) - camUp * math.sin(rollRad)
  local camUpRoll = camRight * math.sin(rollRad) + camUp * math.cos(rollRad)
  local point3DZero = camPos + camForward * 1.0
  local point3D = point3DZero + camRightRoll + camUpRoll
  local point2D = lib.raycast.world3dToScreen2d(point3D)
  local point2DZero = lib.raycast.world3dToScreen2d(point3DZero)
  local scaleX = (cursor.x - point2DZero.x) / (point2D.x - point2DZero.x)
  local scaleY = (cursor.y - point2DZero.y) / (point2D.y - point2DZero.y)
  local point3Dret = point3DZero + camRightRoll * scaleX + camUpRoll * scaleY
  local forwardDir = camForward + camRightRoll * scaleX + camUpRoll * scaleY
  return point3Dret, forwardDir
end




---@param flags ShapetestFlags? Defaults to 511.
---@param ignore ShapetestIgnore? Defaults to 4.
---@param distance number? Defaults to 10.
function lib.raycast.fromCamera(flags, ignore, distance, cam)
  local camRot = not cam and GetGameplayCamRot(0) or GetCamRot(cam, 0)
  local camPos = not cam and GetGameplayCamCoord() or GetCamCoord(cam)
  local posX = 0.5
  local posY = 0.5
  local cam3DPos, forwardDir = screenRelToWorld(camPos, camRot, vector2(posX, posY))
  local destination = camPos + forwardDir * (distance or 1000.0)
  return lib.raycast.fromCoords(cam3DPos, destination, flags, ignore)
end

---@deprecated
lib.raycast.cam = lib.raycast.fromCamera

return lib.raycast