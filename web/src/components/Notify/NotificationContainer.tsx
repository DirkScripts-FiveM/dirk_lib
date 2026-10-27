import { AnimatePresence, motion } from "framer-motion";
import { useState } from "react";
import { useNuiEvent } from "../../hooks/useNuiEvent";
import { useAccentOf } from "../Kit";
import Notification, { NotificationProps } from "./Notification";

// where each stack sits (notify.css): bottom-left sits above the minimap
const CLASS: Record<string, string> = {
  "top-left": "tl", "top-center": "tc", "top-right": "tr", "bottom-left": "bl", "bottom-center": "bc", "bottom-right": "br",
};

export type NotificationContainerProps = {
  position: string;
};

function NotificationContainer(props: NotificationContainerProps) {
  const [notifications, setNotifications] = useState<NotificationProps[]>([]);
  const accentOf = useAccentOf();

  useNuiEvent('ADD_NOTIFICATION', (data: NotificationProps) => {
    if (data.position !== props.position) return;
    setNotifications((list) => {
      // the same one again: count it instead of stacking it
      const same = list.find((n) => n.title === data.title && n.description === data.description && n.icon === data.icon);
      if (same) return list.map((n) => (n === same ? { ...n, count: (n.count || 1) + 1 } : n));
      return [...list, { ...data, id: `${data.title}-${data.description}-${Date.now()}` }];
    });
  });

  useNuiEvent('CLEAR_NOTIFICATIONS', () => {
    setNotifications([]);
  });

  return (
    <div className={"nst " + CLASS[props.position]}>
      <AnimatePresence initial={false}>
        {notifications.map((notification) => (
          <motion.div
            key={notification.id}
            style={{ marginBottom: "0.9vh" }}
            exit={{ opacity: 0, height: 0, marginBottom: 0 }}
            transition={{ opacity: { duration: 0.15 }, default: { delay: 0.12, duration: 0.18, ease: "easeIn" } }}
          >
            <Notification
              {...notification}
              accent={accentOf(notification.theme)}
              onRemove={() => {
                setNotifications((prev) => prev.filter((n) => n.id !== notification.id));
              }}
            />
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

export default NotificationContainer;
