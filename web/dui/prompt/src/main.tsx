// dirk_lib's world prompt page (lib.prompt, modules/prompt/client.lua): the house plate from dirk-cfx-react (WorldPromptPage),
// drawn into a DUI that the module lays flat in the world beside the thing it is for. Any resource's prompt opens THIS page
// (nui://dirk_lib/web/dui/prompt/build/index.html), so the plate looks the same everywhere and changes in one place.
// The game pushes the theme (UPDATE_DIRK_LIB_SETTINGS - DirkProvider listens) and the plate's words. Its own resource name: a
// DUI never reaches NUI callbacks, and its startup calls (NUI_READY...) must never be taken for dirk_lib's real panel.
import React from 'react';
import ReactDOM from 'react-dom/client';
import '@mantine/core/styles.css';
import './prompt.css';
import { DirkProvider, WorldPromptPage } from 'dirk-cfx-react';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <DirkProvider overideResourceName="dirk_lib_prompt_dui">
      <WorldPromptPage />
    </DirkProvider>
  </React.StrictMode>,
);
