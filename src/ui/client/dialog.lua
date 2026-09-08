local settings = lib.settings
local dialogs = {}
local dialog = {}
dialog.__index = dialog

dialog.register = function(id,data)
  assert(id, 'Dialog ID is required')
  assert(data and type(data) == 'table', 'Dialog data is required')
  assert(data.dialog, 'Dialog text is required')
  assert(data.title, 'Dialog title is required')
  local self = setmetatable(data, dialog)
  self.id = id  
  self.resource = GetInvokingResource() or GetCurrentResourceName() or 'unknown'
  dialogs[id] = self
  self:__init()
  return self
end

AddEventHandler('onResourceStop', function(resource)
  for k,v in pairs(dialogs) do 
    if v.resource == resource then
      v:close()
    end 
  end
end)

dialog.get = function(id)
  return dialogs[id]
end
  
function dialog:__init()
  self.responses = self.responses or {}

  local is_func = type(self.responses) == 'function' or rawget(self.responses, '__cfx_functionReference')
  if not is_func then
    for k, v in ipairs(self.responses) do
      -- Index carried on the row itself, so the panel can page and pin without
      -- its position in the array meaning anything.
      v.index  = v.index or k
      if v.action then
        v.action = msgpack.unpack(msgpack.pack(v.action))
      end
    end
  end

  return true
end

--- The shot: just off their nose, level with their eyes, pointed at their head.
---
--- Aimed at the HEAD BONE rather than by a fixed rotation and a guessed height.
--- A ped's origin is at its FEET, so the obvious version — sit a metre and a
--- half in front, raise it a bit, face their heading — puts the lens at knee
--- height staring past them at whatever is behind. Asking the skeleton where
--- the head actually is works on every ped, tall or short, and cannot drift
--- when somebody changes the model.
function dialog:viewCamera()
  if not self.entity or not DoesEntityExist(self.entity) then return; end

  local head = GetPedBoneCoords(self.entity, 31086, 0.0, 0.0, 0.0)  -- SKEL_Head
  -- Slightly off their centre line, so it reads as a shot of a person rather
  -- than a passport photo.
  local at = GetOffsetFromEntityInWorldCoords(self.entity, 0.28, 1.25, 0.0)

  local cam = CreateCam('DEFAULT_SCRIPTED_CAMERA', true)
  SetEntityLocallyInvisible(cache.ped)
  SetCamActive(cam, true)
  RenderScriptCams(true, true, 500, true, true)
  SetCamCoord(cam, at.x, at.y, head.z + 0.04)
  PointCamAtCoord(cam, head.x, head.y, head.z)
  SetCamFov(cam, self.fov or 36.0)
  self.cam = cam
end

--- How they hold themselves while they talk.
---
--- Every value comes from the CALLER. Mapping a mood onto a face is per-script
--- knowledge and does not belong here — a barn find owner losing patience and a
--- scrapyard man deciding he does not like you are the same three fields with
--- different words in them.
---
--- `expression` is a facial IDLE override, so it is how they look between lines
--- rather than a one-off that plays and stops. `gesture` is upper body only
--- (flag 48) so a full-body task cannot walk them out of their own barn.
function dialog:perform()
  local ped = self.entity
  if not ped or not DoesEntityExist(ped) then return end

  if self.expression then
    SetFacialIdleAnimOverride(ped, self.expression, nil)
  end

  -- The mouth. Without it they deliver every line stone-faced, and the whole
  -- point of being this close to them is lost.
  if self.talking then
    PlayFacialAnim(ped, 'mic_chatter', 'mp_facial')
  end

  if not self.gesture then return end
  local dict = self.gestureDict
    or (IsPedMale(ped) and 'gestures@m@standing@casual' or 'gestures@f@standing@casual')
  local anim = self.gesture
  CreateThread(function()
    if not lib.request.animDict(dict, 2000) then return end
    if not ped or not DoesEntityExist(ped) then return end
    TaskPlayAnim(ped, dict, anim, 4.0, -4.0, -1, 48, 0.0, false, false, false)
  end)
end
 
function dialog:closeCamera()
  if not self.cam then return; end 
  RenderScriptCams(false, true, 500, true, true)
  DestroyCam(self.cam)
end 

function dialog:open(another_menu, entity)
  self.isOpen = true 

  if not another_menu then 
    self.entity = entity
  end 

  if self.entity and not another_menu then 
    self:viewCamera()
  end

  CreateThread(function()
    while self.isOpen and self.entity ~= cache.ped do
      Wait(0)
      SetEntityLocallyInvisible(cache.ped)
    end
  end)

  local is_func = type(self.responses) == 'function' or rawget(self.responses, '__cfx_functionReference')
  if is_func then 
    self.responses = self.responses()
    for k,v in ipairs(self.responses) do 
      v.action      = msgpack.unpack(msgpack.pack(v.action))  
    end 
  end 

  if self.metadata then 
    local metaFunc = type(self.metadata) == 'function' or rawget(self.metadata, '__cfx_functionReference')
      if metaFunc then 
        self.metadata = self.metadata()
      end
  end 

    
  SetNuiFocus(true, true)

  -- And again next frame.
  --
  -- ox_target and lib.interact release focus AFTER the option's action returns,
  -- so a dialogue opened from one has it taken straight back off. It has to be
  -- re-taken HERE rather than by the caller: focus is granted per RESOURCE, so
  -- a consumer re-asserting it points the mouse at its own empty page and the
  -- dialogue becomes a picture you cannot click.
  CreateThread(function()
    Wait(0)
    if self.isOpen then SetNuiFocus(true, true) end
  end)

  self:perform()
  self:send()
end

--- Push the current state at the panel.
---
--- Split out of `open` because a server-driven dialogue replaces its whole
--- state on every pick and must NOT re-run the opening — the camera is already
--- where it belongs and re-taking focus mid-conversation loses the click.
function dialog:send()
  SendNuiMessage(json.encode({
    action = 'DIALOG_STATE',
    data = {
      -- The colours of whoever opened this, resolved at send time so an admin
      -- changing a theme mid-conversation is reflected on the next state.
      theme       = lib.themeFor(self.resource),
      id          = self.id,
      title       = self.title,
      subtitle    = self.subtitle,
      dialog      = self.dialog,
      dialogTone  = self.dialogTone,
      icon        = self.icon,
      prevDialog  = self.prevDialog,
      audioFile   = self.audioFile,
      metadata    = self.metadata,
      -- Standing with whoever is talking. The shape `lib.skill.progress`
      -- returns, passed straight through — no conversion here, because a
      -- translation layer between the two is where they drift apart.
      skill       = self.skill,
      note        = self.note,
      noteTone    = self.noteTone,
      locked      = self.locked,
      cantClose   = self.cantClose,
      closeLabel  = self.closeLabel,
      clickSounds = self.clickSounds or settings.dialogClickSounds or false,
      hoverSounds = self.hoverSounds or settings.dialogHoverSounds or false,
      responses   = self.responses
    }
  }, {sort_keys = true}))
end

--- Replace what is on screen without reopening it.
---
--- Everything the caller hands over wins; anything it leaves out keeps its
--- current value, so a state that only changes the line does not have to
--- restate the metadata to avoid wiping it.
--- Keys that describe THIS state rather than this conversation.
---
--- Cleared before the new state is copied on, because a Lua table cannot carry
--- a nil: leaving `note` out of the next state would keep the old one, so a
--- dialogue that said "refused" once would say it forever. The handlers and the
--- camera are not in this list and survive.
local PER_STATE = {
  'subtitle', 'dialogTone', 'metadata', 'skill', 'note', 'noteTone',
  'locked', 'closeLabel', 'expression', 'gesture', 'talking',
}

function dialog:update(data)
  if type(data) ~= 'table' then return end
  for _, k in ipairs(PER_STATE) do self[k] = nil end
  for k, v in pairs(data) do self[k] = v end
  self:__init()
  self:perform()
  self:send()
end

function dialog:close(keep_cam)
  self.isOpen = false
  SetNuiFocus(false, false)

  SendNuiMessage(json.encode({
    action = 'DIALOG_STATE'
  }))
  if not keep_cam and not self.disableFocus then 
    self:closeCamera()
  end

  if self.onClose then 
    self.onClose()
  end
end


function dialog:triggerAction(_index)
  if _index == 'close' then
    self:close()
    return
  end

  -- SERVER-DRIVEN. One function, given the pick, answers with the whole next
  -- state — or with false to end the conversation. Nothing on this side decides
  -- anything, which is what makes it safe to put money in one.
  if self.onSelect then
    local next_ = self.onSelect(_index, self.responses[_index])
    if next_ == false or next_ == nil then
      self:close()
    elseif type(next_) == 'table' then
      self:update(next_)
    end
    return
  end

  local response = self.responses[_index]
  if response then  
    if not response.dontClose and not response.dialog and not self.prevDialog then
      self:close()
    end

    if response.action then
      response.action()
    end

    if response.dialog then
      local dialog = dialog.get(response.dialog)
      if dialog then
        self.isOpen = false
        dialog.cam = self.cam
        dialog:open(true)
      end
    end

    if response.context then 
      lib.openContext(response.context)
    end 

    -- One rule, both modes: a pick always ends in a close or a fresh state.
    -- A `dontClose` response that sent nothing back used to leave the panel
    -- waiting, with every button disabled and no way to find out why.
    if self.isOpen and not response.dialog and not response.context then
      self:send()
    end
  end
end

local getOpenDialog = function()
  for k,v in pairs(dialogs) do 
    if type(v) == 'table' and v.isOpen then
      return v
    end
  end
  return nil
end

RegisterNUICallback('DIALOG_SELECTED', function(data, cb)
  -- Answered FIRST, and always. A server-driven pick yields for a round trip
  -- inside triggerAction, and a NUI callback that has not answered yet leaves
  -- the panel sat waiting on it with its buttons locked.
  cb(1)

  local current_dialog = getOpenDialog()
  if not current_dialog then
    return
  end
  local id = current_dialog.id
  local index = data.index
  if dialogs[id] then
    dialogs[id]:triggerAction(index)
  end
end)  

RegisterNuiCallback('DIALOG_GO_BACK', function(data,cb)
  local current_dialog = getOpenDialog()  

  --\\ Close last one 
  if not current_dialog then
    return
  end

  local prevDialog, prevContext = current_dialog.prevDialog, current_dialog.prevContext

  if prevDialog and dialogs[prevDialog] then
    dialogs[current_dialog.id].isOpen = false
    dialogs[prevDialog]:open(true)
  end

  if prevContext then
    dialogs[current_dialog.id]:close()
    lib.openContext(prevContext)
  end
end)



--- Replace a live dialogue's state. For a caller that pushes rather than
--- answers a pick — a price that moves while you stand there, say.
lib.updateDialog = function(id, data)
  local d = dialog.get(id)
  if d and d.isOpen then d:update(data) end
end

lib.registerDialog = dialog.register
lib.openDialog     = function(entity, id)
  local dialog = dialog.get(id)
  if dialog then
    dialog:open(false, entity)
  end 
end

lib.closeDialog    = function(id, keep_cam)
  for k,v in pairs(dialogs) do 
    if not id or v.id == id then
      v:close(keep_cam)
    end
  end
end


