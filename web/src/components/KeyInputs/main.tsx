/**
 * lib.showKeys: a strip of keys while a script waits for one.
 *
 * SET_KEY_INPUTS shows it (and slides it in), UPDATE_KEY_INPUTS changes the
 * keys in place (lib.updateKeys: no re-show, no re-animation), HIDE_KEY_INPUTS
 * takes it away. Per key a script can dim it, highlight it red, pulse it, show
 * it pressed, hang a small note over it, or fill it as a hold.
 */
import { CSSProperties, useEffect, useRef, useState } from "react";
import { useNuiEvent } from "../../hooks/useNuiEvent";
import { setUiTheme } from '../../stores/uiTheme';
import { Key, Layer } from "../Kit";
import "./keyInputs.css";

export type KeyInputProps = {
  /** the key as shown (lib.showKeys sends the game's name for it) */
  qwerty?: string
  key?: string
  /** the controller button (lib.getKey's xbox, or the script's own) */
  pad?: string
  label: string
  icon?: string
  /** hold-to-use time in ms */
  delay?: number
  hidden?: boolean
  pressed?: boolean
  dim?: boolean
  hl?: boolean
  pulse?: boolean
  down?: boolean
  note?: string
  /** 0..1, drawn as the cap filling up */
  hold?: number
  /** a hold just started: fill over `delay` ms */
  holding?: boolean
  /** words only, no key (what's missing) */
  miss?: boolean
}

type Direction = 'row' | 'column' | 'row-reverse' | 'column-reverse'
type Pos = string | { top?: string | number, right?: string | number, bottom?: string | number, left?: string | number, transform?: string, x?: number, y?: number }

const css = (v: string | number | undefined) =>
  v == null ? undefined : typeof v === 'number' ? (v >= 0 && v <= 1 ? `${v * 100}%` : `${v}px`) : v

/** Where the strip sits. Strings are the usual sides; { x, y } centres it on a screen point (0..1). */
function place(position: Pos | undefined, column: boolean): { style: CSSProperties, align: string } {
  if (position && typeof position === 'object') {
    if (typeof position.x === 'number' && typeof position.y === 'number') {
      return { style: { left: `${position.x * 100}%`, top: `${position.y * 100}%`, transform: 'translate(-50%, -50%)' }, align: 'center' }
    }
    return {
      style: { top: css(position.top), right: css(position.right), bottom: css(position.bottom), left: css(position.left), transform: position.transform || 'none' },
      align: position.right != null && position.left == null ? 'flex-end' : position.left != null && position.right == null ? 'flex-start' : 'center',
    }
  }
  const p = String(position || (column ? 'right-center' : 'bottom-center'))
  const o = '3vh'
  switch (p) {
    case 'top-left': return { style: { left: o, top: o }, align: 'flex-start' }
    case 'top-right': return { style: { right: o, top: o }, align: 'flex-end' }
    case 'bottom-left': return { style: { left: o, bottom: o }, align: 'flex-start' }
    case 'bottom-right': return { style: { right: o, bottom: o }, align: 'flex-end' }
    case 'left-center': return { style: { left: o, top: '50%', transform: 'translateY(-50%)' }, align: 'flex-start' }
    case 'right-center': return { style: { right: o, top: '50%', transform: 'translateY(-50%)' }, align: 'flex-end' }
    case 'top-center': return { style: { left: '50%', top: '4vh', transform: 'translateX(-50%)' }, align: 'center' }
    default: return { style: { left: '50%', bottom: '4vh', transform: 'translateX(-50%)' }, align: 'center' }
  }
}

/** A hold: the cap fills over `ms`, from the moment it mounts with holding set. */
function useHoldFill(k: KeyInputProps) {
  const [run, setRun] = useState(false)
  useEffect(() => {
    if (!k.holding) { setRun(false); return }
    setRun(false)
    const id = requestAnimationFrame(() => requestAnimationFrame(() => setRun(true)))
    return () => cancelAnimationFrame(id)
  }, [k.holding])
  if (k.holding && k.delay) return { hold: run ? 1 : 0, style: { '--hd': run ? `${k.delay}ms` : '0ms' } as CSSProperties }
  if (typeof k.hold === 'number') return { hold: k.hold, style: undefined }
  return { hold: null, style: undefined }
}

function KeyPlate({ k, i }: { k: KeyInputProps, i: number }) {
  const fill = useHoldFill(k)
  const cls = 'pl kp in'
    + (k.hl ? ' hl' : '') + (k.pulse ? ' kpulse' : '') + (k.down || k.pressed ? ' down' : '')
    + (k.dim ? ' dim' : '') + (k.miss ? ' miss' : '')
  const kb = String(k.key ?? k.qwerty ?? '')
  return (
    <span className={cls} style={{ '--i': i } as CSSProperties}>
      <span className="sk">
        {!k.miss && kb !== '' && <Key kb={kb} pad={k.pad} hold={fill.hold} style={fill.style} />}
        <span className="act">{k.label}</span>
      </span>
      {k.note && <span className="tag"><b>{k.note}</b></span>}
    </span>
  )
}

export default function KeyInputs() {
  const [display, setDisplay] = useState(false)
  const [position, setPosition] = useState<Pos>('bottom-center')
  const [direction, setDirection] = useState<Direction>('row')
  const [inputs, setInputs] = useState<KeyInputProps[]>([])
  // a new show re-mounts the plates so they slide in again; an update doesn't
  const [showId, setShowId] = useState(0)
  const shown = useRef(false)

  useNuiEvent('SET_KEY_INPUTS', (data: { position?: Pos, inputs: KeyInputProps[], direction?: Direction, theme?: never }) => {
    // Whose colours this belongs to. `App` wraps this component in <Themed>,
    // so the whole thing — body and hooks included — renders in the calling
    // resource's palette.
    setUiTheme('keyinputs', data?.theme)
    setPosition(data.position ?? 'bottom-center')
    setDirection(data.direction ?? 'row')
    setInputs(Array.isArray(data.inputs) ? data.inputs : [])
    if (!shown.current) setShowId((n) => n + 1)
    shown.current = true
    setDisplay(true)
  })

  useNuiEvent('UPDATE_KEY_INPUTS', (data: { inputs?: KeyInputProps[] }) => {
    if (Array.isArray(data?.inputs)) setInputs(data.inputs)
  })

  useNuiEvent('HIDE_KEY_INPUTS', () => {
    shown.current = false
    setDisplay(false)
  })

  if (!display) return null
  const column = direction.startsWith('column')
  const at = place(position, column)
  return (
    <Layer>
      <div
        key={showId}
        className={'kstrip ki' + (column ? ' col' : '')}
        style={{ ...at.style, flexDirection: direction, alignItems: column ? at.align : 'center' }}
      >
        {inputs.map((k, i) => !k.hidden && <KeyPlate key={i} k={k} i={i} />)}
      </div>
    </Layer>
  )
}
