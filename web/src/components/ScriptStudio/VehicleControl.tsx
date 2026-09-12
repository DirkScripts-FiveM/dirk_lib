import { alpha, Autocomplete, Flex, Text, useMantineTheme } from '@mantine/core';
import { X } from 'lucide-react';
import { fetchNui, type Vehicle } from 'dirk-cfx-react';
import { useEffect, useMemo, useState } from 'react';
import { useInputStyles } from './Controls';

/**
 * The server's vehicle list.
 *
 * Fetched directly rather than through cfx-react's `ensureVehicles`, which
 * guards itself with a module-level "already requested" flag — one early call
 * that came back empty is cached for the life of the page and nothing retries.
 * The catalogue page hit this and does the same.
 */
function useVehicleList() {
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  useEffect(() => {
    let live = true;
    fetchNui<Vehicle[]>('GET_VEHICLES', undefined, [])
      .then((data) => { if (live) setVehicles(Array.isArray(data) ? data : []); })
      .catch(() => { if (live) setVehicles([]); });
    return () => { live = false; };
  }, []);
  return vehicles;
}

/** "Sultan RS — sultanrs", or just the model when the name adds nothing. */
function optionLabel(v: Vehicle) {
  return v.name && v.name !== v.model ? `${v.name} — ${v.model}` : v.model;
}

/**
 * A vehicle, searched by display name or spawn name.
 *
 * `x-control: "vehicle"` used to be a bare text box — you had to know the spawn
 * name and type it exactly, and a typo produced a setting that silently matched
 * nothing. `model` next to it IS searchable, but it lists every model in the
 * game, so picking a car meant scrolling past props and peds.
 *
 * Searching on the NAME as well as the model matters: nobody knows `sultanrs`
 * from `casco` by heart, and the framework already tells us both.
 */
export function VehicleControl({
  value, onChange, disabled, compact,
}: {
  value: unknown;
  onChange: (next: string) => void;
  disabled?: boolean;
  compact?: boolean;
}) {
  const styles = useInputStyles(compact);
  const vehicles = useVehicleList();

  const current = typeof value === 'string' ? value : '';

  /**
   * Options are "Sultan RS — sultanrs", so the list is readable and the search
   * hits either half. The STORED value is always the spawn name, which is
   * pulled back out on pick.
   */
  const options = useMemo(() => {
    const needle = current.trim().toLowerCase();
    const labelled = vehicles.map((v) => ({ label: optionLabel(v), model: v.model }));
    const hits = needle
      ? labelled.filter((o) => o.label.toLowerCase().includes(needle))
      : labelled;
    // Whatever is typed stays selectable even when it is not a known vehicle —
    // an addon car the framework has not been told about is still valid.
    const list = hits.slice(0, 100).map((o) => o.label);
    if (current && !list.includes(current)) list.unshift(current);
    return list;
  }, [vehicles, current]);

  return (
    <Autocomplete
      value={current}
      onChange={(next) => {
        // "Sultan RS — sultanrs" back to "sultanrs". A typed value with no
        // dash is taken as the spawn name it looks like.
        const dash = next.lastIndexOf(' — ');
        onChange(dash === -1 ? next : next.slice(dash + 3));
      }}
      data={options}
      disabled={disabled}
      placeholder="Search vehicles"
      limit={100}
      styles={{ ...styles, input: { ...styles.input, fontFamily: 'monospace' } }}
      style={{ flex: 1 }}
    />
  );
}

/**
 * SEVERAL vehicles, the way `peds` is several peds.
 *
 * Written because a part can fit more than one car and the single picker could
 * only ever say one — a field that means "these three and nothing else" had no
 * control to be edited with, so the annotation would have been dropped on the
 * floor by the allowlist and nobody told.
 *
 * Chips rather than a multi-select dropdown: the list is short by nature (a
 * long one is what `perModel` exists to avoid) and a chip you can see and
 * remove reads better than a closed combobox holding six names.
 */
export function VehiclesControl({
  value, onChange, disabled, compact,
}: {
  value: unknown;
  onChange: (next: string[]) => void;
  disabled?: boolean;
  compact?: boolean;
}) {
  const theme = useMantineTheme();
  const color = theme.colors[theme.primaryColor][5];
  const styles = useInputStyles(compact ?? true);
  const vehicles = useVehicleList();
  const [draft, setDraft] = useState('');

  const chosen = Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];

  /** Spawn name to something a person recognises, when we know it. */
  const nameOf = useMemo(() => {
    const map = new Map(vehicles.map((v) => [v.model, v.name]));
    return (model: string) => {
      const name = map.get(model);
      return name && name !== model ? name : model;
    };
  }, [vehicles]);

  const options = useMemo(() => {
    const needle = draft.trim().toLowerCase();
    // Already picked ones come out of the list — offering to add a second
    // Sultan is offering something that does nothing.
    const free = vehicles.filter((v) => !chosen.includes(v.model));
    const labelled = free.map(optionLabel);
    const hits = needle ? labelled.filter((l) => l.toLowerCase().includes(needle)) : labelled;
    return hits.slice(0, 100);
  }, [vehicles, chosen, draft]);

  const add = (picked: string) => {
    const dash = picked.lastIndexOf(' — ');
    const model = (dash === -1 ? picked : picked.slice(dash + 3)).trim();
    if (!model || chosen.includes(model)) return;
    onChange([...chosen, model]);
    setDraft('');
  };

  return (
    <Flex direction="column" gap="0.6vh" style={{ width: '100%' }}>
      {chosen.length > 0 && (
        <Flex gap="0.4vh" wrap="wrap">
          {chosen.map((model) => (
            <Flex
              key={model}
              align="center" gap="0.5vh"
              px="0.7vh" py="0.3vh"
              style={{
                background: alpha(color, 0.12),
                border: `0.1vh solid ${alpha(color, 0.35)}`,
                borderRadius: theme.radius.xs,
              }}
            >
              <Text ff="Akrobat SemiBold" size="xxs" c="rgba(255,255,255,0.85)">
                {nameOf(model)}
              </Text>
              <Text ff="monospace" size="xxs" c="rgba(255,255,255,0.35)">{model}</Text>
              {!disabled && (
                <X
                  size="1.2vh"
                  style={{ cursor: 'pointer', color: 'rgba(255,255,255,0.5)' }}
                  onClick={() => onChange(chosen.filter((m) => m !== model))}
                />
              )}
            </Flex>
          ))}
        </Flex>
      )}

      <Autocomplete
        value={draft}
        onChange={setDraft}
        onOptionSubmit={add}
        data={options}
        disabled={disabled}
        placeholder="Add a vehicle"
        limit={100}
        styles={{ ...styles, input: { ...styles.input, fontFamily: 'monospace' } }}
      />
    </Flex>
  );
}
