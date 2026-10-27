// One notification (lib.notify), in the 19/10 look: a slanted plate with a square icon tile in the type's colour
// (error red, success green, warning amber, inform = the calling script's accent), the title (2 lines at most), the
// description (5 lines, **bold** and *em*), a ×N pill when the same one repeats, and a bar draining along the bottom.
// A script's own icon / iconColor / titleColor still win.
import type { CSSProperties } from "react";
import { useEffect, useMemo } from "react";
import getImageType from "../../utils/getImagePath";
import { accentVars, Ico, KitIcon, md } from "../Kit";

export type NotificationProps = {
  title?: string
  titleColor?: string
  description?: string
  duration?: number
  showDuration?: boolean
  position: string
  type?: string
  icon?: string
  iconColor?: string
  iconBg?: string
  iconAnimation?: string
  /** the calling script's theme (its accent colours an inform) */
  theme?: { primaryColor?: string; customTheme?: string[] } | null

  // FOR UI
  id: string
  hide?: boolean
  count?: number
  onRemove?: () => void
}

const TYPE: Record<string, string> = { error: "var(--red)", success: "var(--ok)", warning: "var(--warn)", inform: "var(--a)", info: "var(--a)" };
const TYPE_ICON: Record<string, string> = { error: "error", success: "success", warning: "warning", inform: "inform", info: "inform" };

export default function Notification(props: NotificationProps & { accent: string }) {
  const duration = props.duration ?? 5000;

  // gone when its time is up (the bar drains over the same time)
  useEffect(() => {
    const t = setTimeout(() => props.onRemove?.(), duration);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [duration]);

  const image = useMemo(() => getImageType(props.icon), [props.icon]);
  const edge = props.iconColor || TYPE[props.type ?? ""] || "var(--a)";

  let icon;
  if (image && image.type === "image") icon = <img src={image.path} alt="" style={{ objectFit: "contain" }} />;
  else if (props.icon) icon = <Ico icon={props.icon} />;
  else icon = <KitIcon name={TYPE_ICON[props.type ?? ""] || "inform"} />;

  return (
    <div className="pl n in" style={{ ...accentVars(props.accent), "--e": edge } as CSSProperties}>
      <div className="ic"><span className="sk">{icon}</span></div>
      <div className="tx sk">
        <div className="T">
          <span style={props.titleColor ? { color: props.titleColor } : undefined}>{props.title}</span>
          {(props.count ?? 0) > 1 && <span className="cnt"><i>×{props.count}</i></span>}
        </div>
        {props.description && <div className="D">{md(props.description)}</div>}
      </div>
      {props.showDuration !== false && <i className="time" style={{ "--d": `${duration / 1000}s` } as CSSProperties} />}
    </div>
  );
}
