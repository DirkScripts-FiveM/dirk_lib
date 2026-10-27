// lib.registerStatusInfo, in the 19/10 look: a stack of slanted plates down the left. Each has its icon and title,
// the time left as mm:ss (red "Time's up" when it runs out), the description, a 10-segment bar for its progress
// (0 included) and the progress text. A status may carry its own `color` for the edge and the bar.
import type { CSSProperties } from "react";
import { useEffect, useState } from "react";
import { useNuiEvent } from "../../hooks/useNuiEvent";
import { setUiTheme } from "../../stores/uiTheme";
import { fetchNui } from "../../utils/fetchNui";
import { Ico, Layer, md, mmss, Segs, tr } from "../Kit";

type Status = {
  id: string
  title: string
  icon?: string
  description?: string
  time?: number
  progress?: number
  progText?: string
  /** the edge + bar colour for this one (default: the script's accent) */
  color?: string
}

export default function StatusInfo() {
  const [shown, setShown] = useState(true);
  const [statuses, setStatuses] = useState<Status[]>([]);

  useNuiEvent("ADD_STATUS", (status: Status) => {
    // Whose colours this belongs to: App wraps this component in <Themed>, so the whole of it renders in the
    // calling resource's palette.
    setUiTheme("status", (status as unknown as { theme?: never })?.theme);
    setStatuses((prev) => [...prev.filter((s) => s.id !== status.id), status]);
  });

  useNuiEvent("REMOVE_STATUS", (id: string) => {
    setStatuses((prev) => prev.filter((s) => s.id !== id));
  });

  useNuiEvent("UPDATE_STATUS", (status: Status) => {
    setStatuses((prev) => prev.map((s) => (s.id === status.id ? status : s)));
  });

  useNuiEvent("HIDE_ALL_STATUS", (hidden: boolean) => setShown(!hidden));

  if (!statuses.length) return null;
  return (
    <Layer>
      <div className="si" style={{ transition: "transform .5s ease, opacity .5s ease", ...(shown ? null : { transform: "translate(-50vh, -50%)", opacity: 0 }) }}>
        {statuses.map((s, i) => <Card key={s.id} {...s} i={i} />)}
      </div>
    </Layer>
  );
}

function Card(props: Status & { i: number }) {
  const hasTime = typeof props.time === "number";
  const [left, setLeft] = useState(hasTime ? Math.max(0, Math.floor(props.time as number)) : 0);

  // counts down once a second; at 0 Lua hears STATUS_TIMER_OVER (onTimeUp, then it goes 2.5s later)
  useEffect(() => {
    if (!hasTime) return;
    let t = Math.max(0, Math.floor(props.time as number));
    setLeft(t);
    if (t <= 0) {
      fetchNui("STATUS_TIMER_OVER", { id: props.id });
      return;
    }
    const iv = window.setInterval(() => {
      t -= 1;
      setLeft(Math.max(0, t));
      if (t <= 0) {
        window.clearInterval(iv);
        fetchNui("STATUS_TIMER_OVER", { id: props.id });
      }
    }, 1000);
    return () => window.clearInterval(iv);
  }, [props.time, props.id, hasTime]);

  const up = hasTime && left <= 0;
  const st: Record<string, string | number> = { "--i": props.i };
  if (props.color) { st["--e"] = props.color; st["--lit"] = props.color; }
  const prog = typeof props.progress === "number" && Number.isFinite(props.progress) ? props.progress : null;

  return (
    <div className={"pl edge pp in" + (up ? " up" : "")} style={st as CSSProperties}>
      <div className="sk">
        <div className="hd">
          <span className="T">{props.icon && <Ico icon={props.icon} />}<span>{props.title}</span></span>
          {hasTime && <span className="V">{up ? tr("status_time_over", "Time's up") : mmss(left)}</span>}
        </div>
        {props.description && <div className="D">{md(props.description)}</div>}
        {prog !== null && <Segs n={10} frac={prog / 100} />}
        {props.progText && <div className="L pt">{props.progText}</div>}
      </div>
    </div>
  );
}
