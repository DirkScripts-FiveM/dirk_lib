import { Flex } from '@mantine/core';
import '@mantine/dates/styles.css';
import { DirkProvider, copyToClipboard } from 'dirk-cfx-react';
import { motion } from 'framer-motion';
import React from "react";
import { useNuiEvent } from '../hooks/useNuiEvent';
import { fetchNui } from '../utils/fetchNui';
import { imageUrlToBase64 } from '../utils/misc';
import { useScriptConfigHooks } from '../stores/useScriptConfig';
import AdminSection from './Admin/main';
import AlertDialog from './AlertDialog/main';
import Menu from './Context/main';
import Dialog from './Dialog/main';
import Input from './Input/main';
import Instructions from './Instructions/main';
import Keycode from './Keycode/main';
import KeyInputs from './KeyInputs/main';
import Notifications from './Notify/main';
import ProgressBar from './Progress/main';
import Quiz from './Quiz/main';
import ScriptConfigChooser from './ScriptConfigChooser/main';
import ScriptStudio from './ScriptStudio/main';
import StatusInfo from './StatusInfo/main';
import TestBed from './TestBed/main';
import TextUI from './TextUI/main';
import Themed from './Themed';
import { useUiTheme } from '../stores/uiTheme';


// @ts-expect-error - This is a web component, it doesn't exist in the types
export const MotionFlex = motion.create(Flex);

const App: React.FC = () => {
  useScriptConfigHooks();

  // Delegated rather than reimplemented: this was a second copy of
  // cfx-react's copyToClipboard, character for character, and two copies of
  // one behaviour are two things to fix when the browser moves on.
  useNuiEvent('COPY_TO_CLIPBOARD', (data: string) => copyToClipboard(data));


  useNuiEvent('OPEN_LINK', (data: string) => {
    // @ts-expect-error There is no such thing as invokeNative outside FiveM
    window.invokeNative("openUrl", data);
  });

  useNuiEvent<string>('IMAGE_TO_BASE64', (url) => {
    const img = new Image();
    img.crossOrigin = 'Anonymous';
    img.src = url;
    img.onload = async () => {
      const base64 = await imageUrlToBase64(img.src);
      fetchNui('IMAGE_TO_BASE64_RESULT', { url, base64 });
    };
  });

  return (
    <DirkProvider>
      <TestBed />

      {/*
        Each shared element wears the colours of the resource that opened it.

        Wrapped HERE rather than inside each component, because a component
        resolves its hooks in its own body — above the JSX it returns — so a
        wrapper on the return leaves every colour computed up there as
        dirk_lib's. From out here the whole component is inside the scope and
        nothing had to be restructured.

        Notifications are deliberately NOT wrapped: they are server furniture
        and should look the same whichever script raised them.
      */}
      <Themed theme={useUiTheme('progress')}><ProgressBar /></Themed>
      <Themed theme={useUiTheme('textui')}><TextUI /></Themed>
      <Notifications />
      <Themed theme={useUiTheme('context')}><Menu /></Themed>
      <Themed theme={useUiTheme('quiz')}><Quiz /></Themed>
      <Themed theme={useUiTheme('dialog')}><Dialog /></Themed>
      <Themed theme={useUiTheme('input')}><Input /></Themed>
      <Themed theme={useUiTheme('keyinputs')}><KeyInputs /></Themed>
      <Themed theme={useUiTheme('keycode')}><Keycode /></Themed>
      <Themed theme={useUiTheme('status')}><StatusInfo /></Themed>
      <Themed theme={useUiTheme('alert')}><AlertDialog /></Themed>
      <Themed theme={useUiTheme('instructions')}><Instructions /></Themed>
      <ScriptConfigChooser />
      <ScriptStudio />
      <AdminSection />
    </DirkProvider>
  );
};

export default App;
