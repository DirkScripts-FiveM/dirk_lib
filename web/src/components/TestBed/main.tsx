import { useEffect, useState } from "react";
import { Flex, Stack, Text } from "@mantine/core";
import { TestBed as SharedTestBed, type TestBedItem, useNuiEvent } from "dirk-cfx-react";
import { isEnvBrowser } from "../../utils/misc";
import { internalEvent } from "../../utils/internalEvent";
import { fetchNui } from "../../utils/fetchNui";
import { defaultTestItems } from "./testItems";

export default function TestBed() {
  const [testMode, setTestMode] = useState(isEnvBrowser());
  const [activeKeys, setActiveKeys] = useState<Record<string, boolean>>({});

  useNuiEvent("OPEN_TEST_UI", () => {
    setTestMode((v) => !v);
  });

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && testMode) {
        defaultTestItems.forEach((item) => {
          if (activeKeys[item.index]) {
            internalEvent([{ action: item.onDisable.action, data: item.onDisable.data }]);
          }
        });
        setActiveKeys({});
        setTestMode(false);
        fetchNui("CLOSED_TEST_UI", {});
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [testMode, activeKeys]);

  if (!testMode) return null;

  const items: TestBedItem[] = defaultTestItems.map((item) => ({
    key: item.index,
    label: item.label,
    active: !!activeKeys[item.index],
    onToggle: (next) => {
      const event = next ? item.onEnable : item.onDisable;
      internalEvent([{ action: event.action, data: event.data }]);
      setActiveKeys((prev) => ({ ...prev, [item.index]: next }));
    },
  }));

  // cfx-react's TestBed returns null outside the browser, so in game /testUI
  // took NUI focus and showed nothing. In game we draw the same list here.
  if (isEnvBrowser()) return <SharedTestBed items={items} disablePersistence />;
  return <GameTestBed items={items} />;
}

const glass = {
  background: "rgba(0,0,0,0.55)",
  backdropFilter: "blur(0.6vh)",
  border: "0.1vh solid rgba(255,255,255,0.1)",
  borderRadius: "var(--mantine-radius-sm)",
  minWidth: "22vh",
};

function GameTestBed({ items }: { items: TestBedItem[] }) {
  return (
    <div style={{ position: "fixed", top: "1vh", left: "1vh", zIndex: 2147483647, pointerEvents: "auto", fontSize: "1.4vh" }}>
      <Flex align="center" gap="xs" px="sm" py="xs" style={{ ...glass, userSelect: "none" }}>
        <Text size="xs" ff="Akrobat Bold" tt="uppercase" lts="0.08em" c="rgba(255,255,255,0.85)" style={{ flex: 1 }}>
          UI Test Bed
        </Text>
        <Text size="xxs" ff="Akrobat Bold" tt="uppercase" lts="0.06em" c="rgba(255,255,255,0.45)">
          Esc to close
        </Text>
      </Flex>
      <Stack gap={4} mt="xxs" p="xs" style={{ ...glass, maxHeight: "80vh", overflowY: "auto" }}>
        {items.map((item) => (
          <Flex
            key={item.key}
            align="center"
            justify="space-between"
            gap="xs"
            px="xs"
            py="xxs"
            onClick={() => item.onToggle(!item.active)}
            style={{
              cursor: "pointer",
              borderRadius: "var(--mantine-radius-xs)",
              background: item.active ? "rgba(245,158,11,0.15)" : "rgba(255,255,255,0.03)",
              border: `0.1vh solid ${item.active ? "rgba(245,158,11,0.35)" : "rgba(255,255,255,0.05)"}`,
              userSelect: "none",
            }}
          >
            <Text size="xs" ff="Akrobat Bold" c={item.active ? "#f59e0b" : "rgba(255,255,255,0.75)"}>
              {item.label}
            </Text>
            <Text size="xxs" ff="Akrobat Bold" tt="uppercase" lts="0.06em" c={item.active ? "#f59e0b" : "rgba(255,255,255,0.35)"}>
              {item.active ? "On" : "Off"}
            </Text>
          </Flex>
        ))}
      </Stack>
    </div>
  );
}
