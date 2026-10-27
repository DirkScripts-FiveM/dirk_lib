import { Layer } from "../Kit";
import "./notify.css";
import NotificationContainer from "./NotificationContainer";

// Every stack in one layer. Each notification wears the accent of the script that raised it (its `theme`).
export default function Notifications(){
  return (
    <Layer className="dk-notify">
      <NotificationContainer position="top-left" />
      <NotificationContainer position="top-center" />
      <NotificationContainer position="top-right" />
      <NotificationContainer position="bottom-left" />
      <NotificationContainer position="bottom-center" />
      <NotificationContainer position="bottom-right" />
    </Layer>
  )
}
