import { Marker } from '@adamscybot/react-leaflet-component-marker';
import { alpha, Flex, Text, useMantineTheme } from '@mantine/core';
import { ConfirmModal, Map as DirkMap, Modal, ZoomControls, gameToMap, mapToGame } from 'dirk-cfx-react';
import { AnimatePresence, motion } from 'framer-motion';
import L from 'leaflet';
import 'leaflet-draw';
import 'leaflet-draw/dist/leaflet.draw.css';
import { Eye, EyeOff, Lock, LockOpen, MapPin, Pencil, PenTool, Trash2, X } from 'lucide-react';
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { Polygon, useMap } from 'react-leaflet';
import { PANE_HEIGHT, PANE_MIN_HEIGHT } from './Controls';
import { RowFields } from './RowFields';
import { useStudio } from './store';
import { validateRow } from './rowValidation';
import { Icon } from './Icon';
import { PickerDrawer } from './PickerDrawer';
import { singular, StudioButton } from './ui';
import type { SettingColumn, SettingEntry } from './types';
import { useChrome } from './studioLocale';
import { newRow } from './newRow';

type Row = Record<string, unknown>;
type Point = { x: number; y: number };

export type MapLayerInput = {
  entry: SettingEntry;
  value: unknown;
  onChange: (next: unknown) => void;
};

// Fallback colours for a layer whose schema does not name one. A script that
// cares declares it in `x-mapPaths` - dirk_lib naming fishing's layers was the
// per-script knowledge this design keeps out.
const ZONE_PALETTE = ['#5FD08A', '#4CC3DE', '#E0B15F', '#E0776B', '#B98FE0', '#8FE05F'];

/**
 * One map, every polygon layer on it.
 *
 * Fishing keeps three kinds of area and they all belong on the same canvas:
 *   zones          - a list of fishing areas, each with a `zone` boundary
 *   depthOverride  - a list of areas that force a water depth
 *   seaBoundary    - a single polygon splitting salt from fresh water
 *
 * Nothing here asks anyone to type a coordinate: boundaries are drawn with
 * leaflet-draw, the same interaction fishing's ZonesSection uses.
 */
/**
 * Zoom at which a place's points stop being one marker and become several.
 *
 * Chosen so a barn find's car and its owner — a few metres apart — are one pin
 * at map scale and two once you are looking at the yard itself.
 */
const SPLIT_ZOOM = 6;

export function ZoneMap({
  layers, resource, disabled,
}: { layers: MapLayerInput[]; resource?: string; disabled?: boolean }) {
  const t = useChrome();
  const theme = useMantineTheme();
  const accent = theme.colors[theme.primaryColor][5];

  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<{ path: string; index: number } | null>(null);
  const [editing, setEditing] = useState<{ path: string; index: number } | null>(null);


  const [confirmDelete, setConfirmDelete] = useState<{ path: string; index: number } | null>(null);
  const [drawInto, setDrawInto] = useState<string | null>(null);

  /**
   * Pins are LOCKED until you say otherwise — and for most places, always.
   *
   * Dragging was how you moved a place, and also how you moved one by accident:
   * every pin was live the whole time the map was open, so a missed click on a
   * barn find nudged its owner into the next field with nothing to say it had
   * happened.
   *
   * More than that, most of these positions are not map data at all. A barn
   * find's owner is somewhere you STOOD — a spot with a height and a heading,
   * set by walking there and pressing E. A map can express neither, so dragging
   * one can only ever make it worse. Those layers opt out entirely with
   * `movable: false` on their `x-mapPaths` entry and this toggle does not reach
   * them; it exists for the ones a map really can place.
   */
  const [movable, setMovable] = useState(false);

  /**
   * How far in we are, for deciding whether a place's pins are one thing or
   * several.
   */
  const [zoom, setZoom] = useState(4);
  /**
   * A row being made, held OUT of the list until it is saved.
   *
   * Appending first and opening the editor over it leaves a blank row behind
   * when you cancel — the ghost the blueprint chooser had. Nothing is written
   * until there is something worth writing.
   */
  const [adding, setAdding] = useState<{ path: string; row: Row } | null>(null);
  const [replaceSingle, setReplaceSingle] = useState<{ path: string; points: Point[] } | null>(null);

  // Normalise every mapped shape into one thing the map can draw.
  const model = useMemo(() => layers.map((layer, layerIndex) => {
    const raw = Array.isArray(layer.value) ? layer.value : [];
    // A list of points at the TOP level is one outline (fishing's seaBoundary).
    // A list of rows each holding a point is a set of markers - told apart by
    // the entry's declared shape, because both are arrays of objects with x.
    const isMarker = layer.entry.mapShape === 'marker';
    const isSingle = !isMarker && raw.length > 0 && typeof (raw[0] as Point)?.x === 'number';

    const polyKey = (() => {
      const sample = raw.find((r) => r && typeof r === 'object' && !Array.isArray(r)) as Row | undefined;
      if (!sample) return 'zone';
      const hit = Object.entries(sample).find(([, v]) =>
        Array.isArray(v) && v.length > 2 && typeof (v[0] as Point)?.x === 'number');
      return hit?.[0] ?? 'zone';
    })();

    const labelKey = layer.entry.rowLabelKey ?? 'label';

    /**
     * Every position a marker row holds.
     *
     * One place per row is the common case and puts `x`/`y` on the row itself.
     * A row that is genuinely two places — a barn find's owner standing apart
     * from the car he is selling — declares `points` in `x-mapPaths` and keeps
     * a `{x,y,z,w}` under each named key. Both draw, and each drags on its own.
     */
    const declared = layer.entry.mapPoints;
    const pinsOf = (row: Row) => {
      if (!declared?.length) {
        return typeof row.x === 'number' && typeof row.y === 'number'
          ? [{ key: null as string | null, label: undefined as string | undefined,
            color: undefined as string | undefined, point: { x: row.x, y: row.y } as Point }]
          : [];
      }
      return declared.flatMap((spot) => {
        const at = row[spot.key] as { x?: unknown; y?: unknown } | undefined;
        if (!at || typeof at.x !== 'number' || typeof at.y !== 'number') return [];
        return [{
          key: spot.key as string | null,
          label: spot.label,
          color: spot.color,
          point: { x: at.x, y: at.y } as Point,
        }];
      });
    };

    const shapes = isSingle
      ? [{
        index: 0,
        title: layer.entry.label,
        // A top-level outline has no pins, but the shape of the two branches
        // has to match or nothing can read `pins` without narrowing first.
        pins: [] as ReturnType<typeof pinsOf>,
        points: raw as Point[],
        row: undefined as Row | undefined,
      }]
      : (raw as Row[]).map((row, index) => ({
        index,
        title: String(row[labelKey] ?? row.id ?? row.name ?? `${layer.entry.label} ${index + 1}`),
        pins: isMarker ? pinsOf(row) : [],
        points: isMarker
          ? pinsOf(row).map((pin) => pin.point)
          : (Array.isArray(row[polyKey]) ? (row[polyKey] as Point[]) : []),
        row,
      }));

    // The layer colour comes from the SCHEMA. This used to match the path
    // against 'seaBoundary' and 'depthOverride' by name - two of fishing's
    // field names, hardcoded inside dirk_lib, which is the per-script knowledge
    // this design exists to keep out. Declare it in `x-mapPaths` instead:
    // `{ "path": "seaBoundary", "color": "#3b82f6" }`.
    const color = layer.entry.mapColor ?? ZONE_PALETTE[layerIndex % ZONE_PALETTE.length];

    // Which column carries the value that styles each pin - the first enum
    // column whose options declare icons or colours.
    const styleKey = isMarker
      ? layer.entry.columns?.find((column) =>
        column.options?.some((option) => option.icon || option.color))?.key
      : undefined;
    const styleFor = (row: Row | undefined) => {
      if (!styleKey || !row) return undefined;
      const column = layer.entry.columns?.find((c) => c.key === styleKey);
      return column?.options?.find((option) => option.value === String(row[styleKey]));
    };

    return { ...layer, isMarker, isSingle, polyKey, labelKey, shapes, color, styleFor };
  }), [layers]);

  /**
   * Somewhere else asked for one of these rows.
   *
   * The same request `ListRows` already answers - a validation problem naming
   * `fish[27]`, a search result naming a yard by its own name. This editor
   * never listened, so anything pointing at a row that happens to live on a MAP
   * arrived at the section and stopped, and you finished the job by hand.
   *
   * One request, both editors, so it does not matter which kind of list the
   * thing being pointed at turned out to be in.
   */
  const rowRequest = useStudio((state) => state.openRowRequest);
  useEffect(() => {
    if (!rowRequest) return;
    const layer = model.find((l) => l.entry.path === rowRequest.path);
    if (!layer || !layer.shapes.some((shape) => shape.index === rowRequest.index)) return;
    setSelected({ path: rowRequest.path, index: rowRequest.index });
    setEditing({ path: rowRequest.path, index: rowRequest.index });
    useStudio.setState({ openRowRequest: null });
  }, [rowRequest, model]);

  const layerFor = (path: string) => model.find((l) => l.entry.path === path);

  const commitDrawing = (points: Point[]) => {
    const layer = layerFor(drawInto ?? '');
    setDrawInto(null);
    if (!layer) return;

    if (layer.isSingle) {
      // only one of these exists, so drawing replaces it - confirm first
      setReplaceSingle({ path: layer.entry.path, points });
      return;
    }

    const rows = Array.isArray(layer.value) ? [...(layer.value as Row[])] : [];
    const template = newRow(layer.entry.rowTemplate, layer.entry.columns);
    template[layer.labelKey] = `${layer.entry.label} ${rows.length + 1}`;
    template[layer.polyKey] = points;
    layer.onChange([...rows, template]);
    setSelected({ path: layer.entry.path, index: rows.length });
    setEditing({ path: layer.entry.path, index: rows.length });
  };

  /**
   * Pins are placed, not drawn.
   *
   * Dragging an outline round a place that IS one point makes no sense, and a
   * row can hold several positions anyway — which one would the outline be?
   * So a marker layer adds through its own editor, and the map stays the thing
   * that shows you where everything ended up.
   */
  const startAdd = (path: string) => {
    const layer = layerFor(path);
    if (!layer) return;
    const rows = Array.isArray(layer.value) ? (layer.value as Row[]) : [];
    const template = newRow(layer.entry.rowTemplate, layer.entry.columns);
    // Singular: the layer is called Locations, but the thing being made is one
    // location. "Locations 3" reads like a group of them.
    template[layer.labelKey] = `${singular(layer.entry.label)} ${rows.length + 1}`;
    setAdding({ path, row: template });
  };

  const deleteShape = (path: string, index: number) => {
    const layer = layerFor(path);
    setConfirmDelete(null);
    if (!layer) return;
    if (layer.isSingle) { layer.onChange([]); return; }
    layer.onChange((layer.value as Row[]).filter((_, i) => i !== index));
    setSelected(null);
  };

  const frameRef = useRef<HTMLDivElement | null>(null);
  const [mapReady, setMapReady] = useState(false);
  useEffect(() => {
    if (mapReady) return;
    const node = frameRef.current;
    if (!node) return;
    const observer = new IntersectionObserver((records) => {
      if (records.some((r) => r.isIntersecting)) { setMapReady(true); observer.disconnect(); }
    }, { rootMargin: '400px' });
    observer.observe(node);
    return () => observer.disconnect();
  }, [mapReady]);

  const visibleShapes = model.filter((l) => !hidden.has(l.entry.path));
  const editingLayer = editing ? layerFor(editing.path) : null;
  const editingRow = editingLayer && !editingLayer.isSingle
    ? (editingLayer.value as Row[])[editing!.index]
    : undefined;

  return (
    <Flex direction="column" gap="xs" flex={1} style={{ width: '100%', minHeight: 0 }}>
      {/* Fills the workspace pane rather than picking a height. The section
          that holds it is a definite-height column, so there is no sum here. */}
      <Flex gap="xs" flex={1} style={{ minHeight: PANE_MIN_HEIGHT, height: PANE_HEIGHT }}>
        <Flex
          ref={frameRef as never}
          style={{
            flex: 1, position: 'relative',
            borderRadius: theme.radius.xs, overflow: 'hidden',
            border: `0.1vh solid ${alpha(drawInto ? accent : theme.colors.dark[5], drawInto ? 0.6 : 0.4)}`,
            // Leaflet's panes sit at z-index 400+. Without a stacking context of
            // its own the map paints straight over the panel's pinned header.
            isolation: 'isolate',
            zIndex: 0,
          }}
        >
          {!mapReady && (
            <Flex align="center" justify="center" style={{ flex: 1, background: alpha(theme.colors.dark[9], 0.5) }}>
              <Text ff="Akrobat SemiBold" size="xs" c="rgba(255,255,255,0.3)">{t('zoneMap.loading_map', 'Loading map...')}</Text>
            </Flex>
          )}

          {mapReady && (
            <DirkMap initialZoom={4}>
              <ExtendZoomRange minZoom={2} />
              <ZoomWatch onZoom={setZoom} />
              <ZoomControls />
              <FrameAll model={visibleShapes} selected={selected} />
              {drawInto && <DrawPolygon color={layerFor(drawInto)?.color ?? accent} onDone={commitDrawing} />}

              {/* Pins first, so an outline never paints over one. */}
              {visibleShapes.filter((layer) => layer.isMarker).map((layer) => layer.shapes.flatMap((shape) => {
                const active = selected?.path === layer.entry.path && selected.index === shape.index;
                const style = layer.styleFor(shape.row);
                /*
                  ONE place, one pin — until you are close enough for the
                  difference to mean anything.

                  A barn find is a car and the man selling it, a few metres
                  apart. Zoomed out, those two pins sit on top of each other and
                  read as two separate finds; the map looked like it had twice
                  as much on it as it did. Past the threshold they separate and
                  label themselves, which is the point at which "the owner
                  stands over there" is a thing you can act on.
                */
                const pins = zoom >= SPLIT_ZOOM || shape.pins.length < 2
                  ? shape.pins
                  : [shape.pins[0]];
                const collapsed = pins.length < shape.pins.length;

                return pins.map((pin) => (
                  <Marker
                    key={`${layer.entry.path}:${shape.index}:${pin.key ?? ''}`}
                    position={gameToMap(pin.point.x, pin.point.y)}
                    draggable={!disabled && movable && layer.entry.mapMovable !== false}
                    eventHandlers={{
                      click: () => setSelected({ path: layer.entry.path, index: shape.index }),
                      // Dragging a pin IS how you move a place. Typing two
                      // numbers to reposition a shop is the interaction this
                      // panel exists to replace.
                      dragend: (event: L.LeafletEvent) => {
                        const { lat, lng } = (event.target as L.Marker).getLatLng();
                        const game = mapToGame(lat, lng);
                        const rows = [...(layer.value as Row[])];
                        const row = rows[shape.index];
                        // Only x and y move. A height and a heading were set
                        // standing in the place and the map knows neither.
                        rows[shape.index] = pin.key
                          ? { ...row, [pin.key]: { ...(row[pin.key] as object), x: game[0], y: game[1] } }
                          : { ...row, x: game[0], y: game[1] };
                        layer.onChange(rows);
                      },
                    }}
                    icon={(
                      <PlacePin
                        label={collapsed || !pin.label ? shape.title : `${shape.title} · ${pin.label}`}
                        hex={pin.color ?? style?.color ?? layer.color}
                        icon={style?.icon}
                        active={active}
                      />
                    )}
                  />
                ));
              }))}

              {visibleShapes.filter((layer) => !layer.isMarker).map((layer) => layer.shapes.map((shape) => {
                if (shape.points.length < 3) return null;
                const active = selected?.path === layer.entry.path && selected.index === shape.index;
                const positions = shape.points.map((p) => gameToMap(p.x, p.y));
                return (
                  <Fragment key={`${layer.entry.path}:${shape.index}`}>
                    <Polygon
                      positions={positions}
                      pathOptions={{
                        color: layer.color,
                        weight: active ? 2.5 : 1.5,
                        opacity: active ? 1 : 0.7,
                        fillColor: layer.color,
                        fillOpacity: active ? 0.3 : 0.1,
                        dashArray: layer.isSingle ? '6 4' : undefined,
                      }}
                      eventHandlers={{ click: () => setSelected({ path: layer.entry.path, index: shape.index }) }}
                    />
                    <Marker
                      position={centroid(positions)}
                      eventHandlers={{ click: () => setSelected({ path: layer.entry.path, index: shape.index }) }}
                      icon={<ShapeLabel label={shape.title} hex={layer.color} active={active} points={shape.points.length} />}
                    />
                  </Fragment>
                );
              }))}
            </DirkMap>
          )}

          {/* key */}
          <Flex
            direction="column" gap="0.3vh" p="xs"
            style={{
              position: 'absolute', bottom: '2vh', left: '2vh', zIndex: 999998,
              background: alpha(theme.colors.dark[9], 0.9),
              border: `0.1vh solid ${alpha(theme.colors.dark[5], 0.6)}`,
              borderRadius: theme.radius.xs,
            }}
          >
            {model.map((layer) => {
              const off = hidden.has(layer.entry.path);
              return (
                <Flex
                  key={layer.entry.path}
                  align="center" gap="xs"
                  onClick={() => setHidden((prev) => {
                    const next = new Set(prev);
                    if (next.has(layer.entry.path)) next.delete(layer.entry.path);
                    else next.add(layer.entry.path);
                    return next;
                  })}
                  style={{ cursor: 'pointer', opacity: off ? 0.4 : 1 }}
                >
                  <Flex
                    w="1.4vh" h={layer.isMarker ? '1.4vh' : '0.6vh'}
                    style={{
                      background: layer.color,
                      borderRadius: layer.isMarker ? '50%' : '0.15vh',
                      flexShrink: 0,
                    }}
                  />
                  <Text ff="Akrobat Bold" size="xxs" c="rgba(255,255,255,0.75)" style={{ flex: 1 }}>
                    {layer.entry.label}
                  </Text>
                  <Text ff="monospace" size="xxs" c="rgba(255,255,255,0.35)">
                    {layer.isSingle ? `${layer.shapes[0]?.points.length ?? 0} pts` : layer.shapes.length}
                  </Text>
                  {off ? <EyeOff size="1.2vh" color="rgba(255,255,255,0.4)" /> : <Eye size="1.2vh" color="rgba(255,255,255,0.4)" />}
                </Flex>
              );
            })}
          </Flex>

          {drawInto && (
            <Flex
              align="center" gap="xs" px="sm" py="xs"
              style={{
                position: 'absolute', top: '2vh', left: '2vh', zIndex: 999999,
                background: alpha(theme.colors.dark[9], 0.92),
                border: `0.1vh solid ${alpha(layerFor(drawInto)?.color ?? accent, 0.6)}`,
                borderRadius: theme.radius.xs,
              }}
            >
              <PenTool size="1.5vh" color={layerFor(drawInto)?.color ?? accent} />
              <Text ff="Akrobat Bold" size="xs" c={layerFor(drawInto)?.color ?? accent}>
                Drawing {layerFor(drawInto)?.entry.label} · click points, click the first to close
              </Text>
              <motion.button
                type="button" onClick={() => setDrawInto(null)} whileTap={{ scale: 0.94 }}
                style={{ display: 'flex', background: 'transparent', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,0.5)', padding: 0 }}
                aria-label={t('zoneMap.cancel_drawing', 'Cancel drawing')}
              >
                <X size="1.4vh" />
              </motion.button>
            </Flex>
          )}
        </Flex>

        {/* list, grouped by layer */}
        <Flex
          direction="column" w="38vh"
          style={{
            flexShrink: 0,
            background: alpha(theme.colors.dark[9], 0.4),
            border: `0.1vh solid ${alpha(theme.colors.dark[5], 0.4)}`,
            borderRadius: theme.radius.xs,
            minHeight: 0,
          }}
        >
          <Flex direction="column" gap="xs" p="xs" style={{ overflowY: 'auto', flex: 1, minHeight: 0 }}>
            {model.map((layer) => (
              <Flex key={layer.entry.path} direction="column" gap="xxs">
                <Flex align="center" gap="xs">
                  <Flex w="1.2vh" h="0.5vh" style={{ background: layer.color, borderRadius: '0.15vh' }} />
                  <Text ff="Akrobat Bold" size="xxs" tt="uppercase" lts="0.08em" c="rgba(255,255,255,0.45)">
                    {layer.entry.label}
                  </Text>
                  <Flex h="0.1vh" style={{ flex: 1, background: alpha(theme.colors.dark[5], 0.5) }} />
                </Flex>

                {layer.shapes.map((shape) => {
                  const active = selected?.path === layer.entry.path && selected.index === shape.index;
                  return (
                    <Flex
                      key={shape.index}
                      align="center" gap="xs" px="xs" py="0.5vh"
                      onClick={() => setSelected({ path: layer.entry.path, index: shape.index })}
                      style={{
                        background: active ? alpha(layer.color, 0.14) : alpha(theme.colors.dark[8], 0.4),
                        border: `0.1vh solid ${active ? alpha(layer.color, 0.5) : 'transparent'}`,
                        borderRadius: theme.radius.xs,
                        cursor: 'pointer',
                      }}
                    >
                      <Flex direction="column" style={{ flex: 1, minWidth: 0, lineHeight: 1.15 }}>
                        <Text ff="Akrobat Bold" size="xs" c={active ? layer.color : 'rgba(255,255,255,0.85)'} truncate>
                          {shape.title}
                        </Text>
                        <Text ff="monospace" size="xxs" c="rgba(255,255,255,0.3)">
                          {shape.points.length} points
                          {shape.row?.depth !== undefined ? ` · ${shape.row.depth}m` : ''}
                          {shape.row?.lvlRequired ? ` · lvl ${shape.row.lvlRequired}` : ''}
                        </Text>
                      </Flex>
                      <Flex align="center" gap="xxs" style={{ flexShrink: 0 }}>
                        {!layer.isSingle && (
                          <MiniButton icon={Pencil} label={t('zoneMap.edit', 'Edit')}
                            onClick={() => setEditing({ path: layer.entry.path, index: shape.index })} disabled={disabled} />
                        )}
                        <MiniButton icon={Trash2} label={t('zoneMap.delete', 'Delete')} danger
                          onClick={() => setConfirmDelete({ path: layer.entry.path, index: shape.index })} disabled={disabled} />
                      </Flex>
                    </Flex>
                  );
                })}

                {layer.shapes.length === 0 && (
                  <Text ff="Akrobat SemiBold" size="xxs" c="rgba(255,255,255,0.25)" pl="xs">{t('zoneMap.none_drawn', 'None drawn')}</Text>
                )}
              </Flex>
            ))}
          </Flex>

          {/* The lock. Off by default, loud while on, and absent entirely when
              no layer on this map can be dragged anyway. */}
          {model.some((layer) => layer.isMarker && layer.entry.mapMovable !== false) && (
          <Flex px="xs" pb="xxs" style={{ flexShrink: 0 }}>
            <motion.button
              type="button"
              onClick={() => setMovable((on) => !on)}
              disabled={disabled}
              whileTap={{ scale: 0.97 }}
              style={{
                display: 'flex', alignItems: 'center', gap: '0.6vh',
                width: '100%', padding: '0.5vh 0.8vh',
                background: movable ? alpha('#f59e0b', 0.16) : 'transparent',
                border: `0.1vh solid ${movable ? alpha('#f59e0b', 0.55) : alpha(theme.colors.dark[5], 0.5)}`,
                borderRadius: theme.radius.xs,
                cursor: disabled ? 'not-allowed' : 'pointer',
              }}
            >
              {movable
                ? <LockOpen size="1.4vh" color="#f59e0b" />
                : <Lock size="1.4vh" color="rgba(255,255,255,0.4)" />}
              <Text
                ff="Akrobat Bold" size="xxs" tt="uppercase" lts="0.06em"
                c={movable ? '#f59e0b' : 'rgba(255,255,255,0.45)'}
              >
                {movable
                  ? t('zoneMap.pins_unlocked', 'Pins can be dragged')
                  : t('zoneMap.pins_locked', 'Pins locked')}
              </Text>
            </motion.button>
          </Flex>
          )}

          <Flex direction="column" gap="xxs" p="xs" style={{ flexShrink: 0 }}>
            <Text ff="Akrobat Bold" size="xxs" tt="uppercase" lts="0.08em" c="rgba(255,255,255,0.3)">
              {model.every((layer) => layer.isMarker)
                ? t('zoneMap.add_new', 'Add new')
                : t('zoneMap.draw_new', 'Draw new')}
            </Text>
            <Flex gap="xxs" wrap="wrap">
              {model.map((layer) => (
                <motion.button
                  key={layer.entry.path}
                  type="button"
                  onClick={() => (layer.isMarker
                    ? startAdd(layer.entry.path)
                    : setDrawInto(drawInto === layer.entry.path ? null : layer.entry.path))}
                  disabled={disabled}
                  whileTap={{ scale: 0.97 }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '0.5vh',
                    padding: '0.5vh 0.8vh',
                    background: drawInto === layer.entry.path ? alpha(layer.color, 0.2) : 'transparent',
                    border: `0.1vh solid ${alpha(layer.color, drawInto === layer.entry.path ? 0.6 : 0.3)}`,
                    borderRadius: theme.radius.xs,
                    cursor: disabled ? 'not-allowed' : 'pointer',
                    opacity: disabled ? 0.5 : 1,
                  }}
                >
                  <PenTool size="1.2vh" color={layer.color} />
                  <Text ff="Akrobat Bold" size="xxs" tt="uppercase" lts="0.05em" c={layer.color}>
                    {layer.entry.label}
                  </Text>
                </motion.button>
              ))}
            </Flex>
          </Flex>
        </Flex>
      </Flex>

      <Text ff="Akrobat SemiBold" size="xxs" c="rgba(255,255,255,0.28)">
        {t('zoneMap.every_area_is_drawn_never_typed_toggle_a', 'Every area is drawn, never typed. Toggle a layer in the key to get it out of the way while you work.')}
      </Text>

      <AnimatePresence>
        {editing && editingLayer && editingRow && (
          <ShapeModal
            entry={editingLayer.entry}
            resource={resource}
            row={editingRow}
            polyKey={editingLayer.polyKey}
            title={editingLayer.shapes[editing.index]?.title ?? editingLayer.entry.label}
            disabled={disabled}
            onSave={(next) => {
              editingLayer.onChange((editingLayer.value as Row[]).map((r, i) => (i === editing.index ? next : r)));
              setEditing(null);
            }}
            onDelete={() => { setConfirmDelete(editing); setEditing(null); }}
            onClose={() => setEditing(null)}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {adding && layerFor(adding.path) && (
          <ShapeModal
            entry={layerFor(adding.path)!.entry}
            resource={resource}
            row={adding.row}
            polyKey={layerFor(adding.path)!.polyKey}
            title={t('zoneMap.add_title', 'New')}
            disabled={disabled}
            onSave={(next) => {
              const layer = layerFor(adding.path)!;
              const rows = Array.isArray(layer.value) ? [...(layer.value as Row[])] : [];
              layer.onChange([...rows, next]);
              setSelected({ path: adding.path, index: rows.length });
              setAdding(null);
            }}
            onClose={() => setAdding(null)}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {confirmDelete && (
          <ConfirmModal
            title={t('zoneMap.delete_area', 'Delete area')}
            description={`"${layerFor(confirmDelete.path)?.shapes[confirmDelete.index]?.title ?? 'This area'}" and its boundary are removed when you save.`}
            confirmLabel="Delete"
            onConfirm={() => deleteShape(confirmDelete.path, confirmDelete.index)}
            onClose={() => setConfirmDelete(null)}
            zIndex={10200}
          />
        )}
        {replaceSingle && (
          <ConfirmModal
            title={`Replace ${layerFor(replaceSingle.path)?.entry.label}`}
            description={`There is only one ${layerFor(replaceSingle.path)?.entry.label.toLowerCase()}. The shape you just drew replaces the existing ${layerFor(replaceSingle.path)?.shapes[0]?.points.length ?? 0}-point boundary.`}
            confirmLabel="Replace"
            onConfirm={() => {
              layerFor(replaceSingle.path)?.onChange(replaceSingle.points);
              setReplaceSingle(null);
            }}
            onClose={() => setReplaceSingle(null)}
            zIndex={10200}
          />
        )}
      </AnimatePresence>
    </Flex>
  );
}

/**
 * dirk-cfx-react's tile layer is capped at `minZoom: 4`, and at zoom 4 the GTA
 * map is several times taller than this pane - so an admin can never see the
 * whole coastline at once. Widen the range on the live instance and let leaflet
 * downscale the zoom-4 tiles (`minNativeZoom`) rather than blanking them.
 *
 * Worth folding into the Map component itself later so every consumer gets it.
 */
/**
 * Reports the current zoom outward.
 *
 * Lives inside the map because `useMap` only works under the container, and
 * the pin rendering above needs to know how far in we are to decide whether a
 * place's several points are worth separating.
 */
function ZoomWatch({ onZoom }: { onZoom: (z: number) => void }) {
  const map = useMap();
  useEffect(() => {
    const report = () => onZoom(map.getZoom());
    report();
    map.on('zoomend', report);
    return () => { map.off('zoomend', report); };
  }, [map, onZoom]);
  return null;
}

function ExtendZoomRange({ minZoom = 2 }: { minZoom?: number }) {
  const map = useMap();

  useEffect(() => {
    map.eachLayer((layer) => {
      if (!(layer instanceof L.TileLayer)) return;
      const options = layer.options as L.TileLayerOptions & { minNativeZoom?: number; maxNativeZoom?: number };
      options.minNativeZoom = 4;
      options.maxNativeZoom = 6;
      options.minZoom = minZoom;
      layer.redraw();
    });

    map.setMinZoom(minZoom);
    // fractional steps so the fit is not forced to a whole zoom level
    map.options.zoomSnap = 0.25;
    map.options.zoomDelta = 0.5;
  }, [map, minZoom]);

  return null;
}

function DrawPolygon({ color, onDone }: { color: string; onDone: (points: Point[]) => void }) {
  const map = useMap();

  useEffect(() => {
    const Handler = (L as unknown as { Draw: { Polygon: new (map: L.Map, opts: unknown) => { enable: () => void; disable: () => void } } }).Draw.Polygon;
    const handler = new Handler(map, {
      allowIntersection: false,
      showArea: false,
      shapeOptions: { color, weight: 2, fillOpacity: 0.2 },
    });

    const onCreated = (e: { layer: L.Polygon }) => {
      const latlngs = e.layer.getLatLngs()[0] as L.LatLng[];
      const points = latlngs.map((ll) => {
        const [x, y] = mapToGame(ll.lat, ll.lng);
        return { x: Number(x.toFixed(2)), y: Number(y.toFixed(2)) };
      });
      if (points.length >= 3) onDone(points);
    };

    map.on('draw:created', onCreated as never);
    handler.enable();

    return () => {
      map.off('draw:created', onCreated as never);
      try { handler.disable(); } catch { /* already gone */ }
    };
  }, [map, color, onDone]);

  return null;
}

function FrameAll({
  model, selected,
}: {
  model: { entry: SettingEntry; shapes: { index: number; points: Point[] }[] }[];
  selected: { path: string; index: number } | null;
}) {
  const map = useMap();
  const count = model.reduce((sum, l) => sum + l.shapes.length, 0);

  useEffect(() => {
    const all = model.flatMap((l) => l.shapes.flatMap((s) => s.points)).map((p) => gameToMap(p.x, p.y));
    if (all.length < 2) return;
    map.fitBounds(all as [number, number][], { padding: [30, 30], animate: false, maxZoom: 6 });
  }, [count]);

  useEffect(() => {
    if (!selected) return;
    const layer = model.find((l) => l.entry.path === selected.path);
    const shape = layer?.shapes.find((s) => s.index === selected.index);
    if (!shape || shape.points.length < 2) return;
    map.fitBounds(shape.points.map((p) => gameToMap(p.x, p.y)) as [number, number][], { padding: [60, 60], animate: true });
  }, [selected]);

  return null;
}

/**
 * One place on the map.
 *
 * A coloured disc with a lucide glyph inside, matching what the old hand-built
 * dirk_phone panel drew - and, more to the point, matching the pins players see
 * in the phone's own Maps app. The colour and icon are the SETTING, so the
 * admin map should look like the player map rather than approximate it.
 *
 * Colour and glyph come from the schema (`x-enumColors` / `x-enumIcons` on the
 * row's category field); the layer colour is the fallback for a row with no
 * category or a value the schema does not style.
 */
function PlacePin({
  label, hex, icon, active,
}: { label: string; hex: string; icon?: string; active: boolean }) {
  const size = active ? '3.4vh' : '2.6vh';

  return (
    <Flex
      direction="column" align="center" gap="0.2vh"
      style={{ pointerEvents: 'auto', cursor: 'pointer' }}
    >
      <Flex
        align="center" justify="center"
        w={size} h={size}
        style={{
          background: hex,
          border: `0.2vh solid ${active ? '#ffffff' : alpha('#000000', 0.35)}`,
          borderRadius: '50%',
          boxShadow: active ? `0 0 0.8vh ${hex}` : `0 0.1vh 0.3vh ${alpha('#000000', 0.5)}`,
          transition: 'width 0.12s, height 0.12s',
        }}
      >
        {/* 55% of the disc, as the old pin had it - big enough to read at a
            glance, small enough to keep the colour ring reading as the colour */}
        <Icon name={icon ?? 'map-pin'} size={active ? '1.9vh' : '1.45vh'} color="#ffffff" />
      </Flex>
      {active && (
        <Flex
          px="0.7vh" py="0.15vh"
          style={{
            background: 'rgba(8,12,11,0.85)',
            border: `0.1vh solid ${alpha(hex, 0.9)}`,
            borderRadius: '0.3vh',
            whiteSpace: 'nowrap',
          }}
        >
          <Text ff="Akrobat Bold" size="xxs" c={hex}>{label}</Text>
        </Flex>
      )}
    </Flex>
  );
}

function ShapeLabel({
  label, hex, active, points,
}: { label: string; hex: string; active: boolean; points: number }) {
  return (
    <Flex
      direction="column" align="center" gap="0.2vh"
      style={{ pointerEvents: 'auto', cursor: 'pointer', filter: active ? `drop-shadow(0 0 0.6vh ${hex})` : 'none' }}
    >
      <Flex
        px="0.7vh" py="0.15vh"
        style={{
          background: 'rgba(8,12,11,0.85)',
          border: `0.1vh solid ${alpha(hex, active ? 0.9 : 0.5)}`,
          borderRadius: '0.3vh',
          whiteSpace: 'nowrap',
        }}
      >
        <Text ff="Akrobat Bold" size="xxs" c={hex}>{label}</Text>
      </Flex>
      {active && (
        <Text ff="monospace" size="xxs" c="rgba(255,255,255,0.5)" style={{ whiteSpace: 'nowrap' }}>{points} pts</Text>
      )}
    </Flex>
  );
}

function ShapeModal({
  entry, resource, row, polyKey, title, onSave, onDelete, onClose, disabled,
}: {
  entry: SettingEntry;
  /** the script this zone belongs to, for options resolved from its config */
  resource?: string;
  row: Row;
  polyKey: string;
  title: string;
  onSave: (next: Row) => void;
  /** Absent while ADDING — there is nothing yet to delete. */
  onDelete?: () => void;
  onClose: () => void;
  disabled?: boolean;
}) {
  const t = useChrome();
  const theme = useMantineTheme();
  const color = theme.colors[theme.primaryColor][5];
  const [draft, setDraft] = useState<Row>(() => JSON.parse(JSON.stringify(row)));
  /**
   * What the picker is editing, and where its answer goes.
   *
   * This held the COLUMN alone and `onPick` ignored the child it was handed,
   * so clicking a blip's sprite inside the `blip` object opened the drawer on
   * the object itself - a type the drawer has no picker for, hence an empty
   * modal. The row editor has always carried the child and its accessors;
   * this is the same shape, so nested fields behave the same in both.
   */
  const [picker, setPicker] = useState<
    { column: SettingColumn; value: unknown; apply: (next: unknown) => void } | null
  >(null);

  const allColumns = (entry.columns ?? []).filter((c) => c.key !== polyKey);
  const points = Array.isArray(draft[polyKey]) ? (draft[polyKey] as Point[]).length : 0;

  /**
   * The same `x-rowTabs` the list row editor honours.
   *
   * A zone is edited HERE rather than in RowModal - it belongs to the map -
   * so a schema declaring tabs had them silently ignored and every field came
   * out in one long scroll. The boundary column is excluded because the map
   * behind this modal IS that field.
   */
  const tabs = useMemo(() => {
    const declared = entry.rowTabs ?? [];
    const built = declared
      .map((tab) => ({
        ...tab,
        columns: tab.keys
          .map((key) => allColumns.find((c) => c.key === key))
          .filter(Boolean) as SettingColumn[],
      }))
      .filter((tab) => tab.columns.length > 0);
    if (!built.length) return [];

    // Anything the schema forgot to list still has to be reachable, so it
    // joins the first tab rather than vanishing.
    const claimed = new Set(built.flatMap((tab) => tab.columns.map((c) => c.key)));
    const orphans = allColumns.filter((c) => !claimed.has(c.key));
    if (orphans.length) built[0].columns = [...built[0].columns, ...orphans];
    return built;
  }, [entry.rowTabs, allColumns]);

  const [activeTab, setActiveTab] = useState(() => tabs[0]?.id ?? '');

  // Same rules the list row editor enforces - a zone is a row like any other,
  // it just happens to be edited on a map.
  const problems = useMemo(() => validateRow(allColumns, draft, t), [allColumns, draft]);
  const problemFor = (key: string) => problems.find((p) => p.key === key)?.message;
  const tabOf = (key: string) => tabs.find((tab) => tab.columns.some((c) => c.key === key));

  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(row), [draft, row]);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const askClose = () => {
    if (dirty) { setConfirmDiscard(true); return; }
    onClose();
  };
  const columns = tabs.length
    ? (tabs.find((tab) => tab.id === activeTab) ?? tabs[0]).columns
    : allColumns;

  return (
    <>
      <Modal
        title={title}
        icon={MapPin}
        iconColor={color}
        description={entry.label}
        badge={{ label: `${points} BOUNDARY POINTS`, color }}
        onClose={askClose}
        width="70vh"
        height="66vh"
        zIndex={10100}
      >
        <Flex direction="column" flex={1} style={{ minHeight: 0 }}>
          {tabs.length > 1 && (
            <Flex gap="xs" px="sm" pt="xs" style={{ flexShrink: 0 }}>
              {tabs.map((tab) => (
                <motion.button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  whileTap={{ scale: 0.99 }}
                  style={{
                    padding: '0.5vh 1vh',
                    background: tab.id === activeTab ? alpha(color, 0.12) : 'transparent',
                    border: `0.1vh solid ${tab.id === activeTab ? alpha(color, 0.4) : 'transparent'}`,
                    borderRadius: theme.radius.xs,
                    cursor: 'pointer',
                  }}
                >
                  <Text
                    ff="Akrobat Bold" size="xxs" tt="uppercase" lts="0.05em"
                    c={tab.id === activeTab ? color : 'rgba(255,255,255,0.5)'}
                  >
                    {tab.label}
                  </Text>
                </motion.button>
              ))}
            </Flex>
          )}

          <RowFields
            columns={columns}
            draft={draft}
            resource={resource}
            path={entry.path}
            disabled={disabled}
            problemFor={problemFor}
            setField={(key, value) => setDraft((prev) => ({ ...prev, [key]: value }))}
            onPick={setPicker}
          />

          <Flex
            align="center" justify="space-between" px="sm" py="xs"
            style={{ borderTop: `0.1vh solid ${alpha(theme.colors.dark[4], 0.4)}`, flexShrink: 0 }}
          >
            {onDelete && (
              <StudioButton label={t('zoneMap.delete', 'Delete')} danger icon={Trash2} onClick={onDelete} disabled={disabled} />
            )}
            <Flex gap="xs">
              {problems.length > 0 && (
                <motion.button
                  type="button"
                  onClick={() => {
                    const tab = tabOf(problems[0].key);
                    if (tab) setActiveTab(tab.id);
                  }}
                  whileTap={{ scale: 0.99 }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '0.5vh',
                    background: 'transparent', border: 'none',
                    cursor: 'pointer', padding: 0, maxWidth: '30vh',
                  }}
                >
                  <Text ff="Akrobat SemiBold" size="xxs" c="#E0B15F" truncate>
                    {problems.length === 1
                      ? problems[0].message
                      : t('zoneMap.n_problems', '{} things need fixing').replace('{}', String(problems.length))}
                  </Text>
                </motion.button>
              )}
              <StudioButton label={t('zoneMap.cancel', 'Cancel')} onClick={askClose} />
              <StudioButton
                label={t('zoneMap.save_area', 'Save area')}
                primary
                onClick={() => onSave(draft)}
                disabled={disabled || problems.length > 0}
              />
            </Flex>
          </Flex>
        </Flex>
      </Modal>

      <AnimatePresence>
        {picker && (
          <PickerDrawer
            type={picker.column.type}
            label={picker.column.label}
            iconSet={picker.column.iconSet}
            value={picker.value}
            disabled={disabled}
            onApply={picker.apply}
            onClose={() => setPicker(null)}
          />
        )}

        {confirmDiscard && (
          <ConfirmModal
            title={t('zoneMap.discard_changes', 'Discard changes?')}
            description={t('zoneMap.discard_body', 'You have unsaved changes to this area. Closing now throws them away.')}
            confirmLabel={t('zoneMap.discard', 'Discard')}
            onConfirm={() => { setConfirmDiscard(false); onClose(); }}
            onClose={() => setConfirmDiscard(false)}
            zIndex={10300}
          />
        )}
      </AnimatePresence>
    </>
  );
}

function MiniButton({
  icon: Icon, label, onClick, disabled, danger,
}: { icon: React.ElementType; label: string; onClick: () => void; disabled?: boolean; danger?: boolean }) {
  const theme = useMantineTheme();
  const accent = danger ? '#ef4444' : theme.colors[theme.primaryColor][5];

  return (
    <motion.div
      role="button"
      onClick={(e: React.MouseEvent) => { e.stopPropagation(); if (!disabled) onClick(); }}
      whileHover={disabled ? undefined : { background: alpha(accent, 0.16), borderColor: alpha(accent, 0.5) }}
      whileTap={disabled ? undefined : { scale: 0.94 }}
      style={{
        aspectRatio: '1 / 1', height: '2.4vh',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'transparent',
        border: `0.1vh solid ${alpha(theme.colors.dark[4], 0.55)}`,
        borderRadius: theme.radius.xs,
        cursor: disabled ? 'not-allowed' : 'pointer',
        color: 'rgba(255,255,255,0.55)',
        opacity: disabled ? 0.5 : 1,
      }}
      aria-label={label}
    >
      <Icon size="1.2vh" />
    </motion.div>
  );
}

function centroid(positions: [number, number][]): [number, number] {
  const lat = positions.reduce((sum, p) => sum + p[0], 0) / positions.length;
  const lng = positions.reduce((sum, p) => sum + p[1], 0) / positions.length;
  return [lat, lng];
}
