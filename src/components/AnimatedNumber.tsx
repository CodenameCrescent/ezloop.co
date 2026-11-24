import * as React from "react";
import { animate } from "framer-motion";
import { DUR, EASE_OUT, useMotionPrefs } from "@/lib/motion";

/**
 * A figure that counts to itself.
 *
 * Only the hero number on a screen should use this. A count-up says "this
 * changed, watch it land"; a page where six numbers all do it says nothing at
 * all, and takes a second to become readable.
 *
 * It writes straight into the DOM node rather than through React state, so a
 * nine-hundred-millisecond count does not cause sixty re-renders of whatever
 * card it happens to sit in. `format` is your money formatter, so the animated
 * figure and the final figure are produced by the same function and cannot
 * disagree about currency, separators or rounding.
 *
 * Under prefers-reduced-motion it renders the value and stops.
 */
export function AnimatedNumber({
  value,
  format,
  className,
  style,
  duration = DUR.count,
}: {
  value: number;
  /** Almost always `useFormatters().money`. */
  format: (value: number) => string;
  className?: string;
  style?: React.CSSProperties;
  duration?: number;
}) {
  const ref = React.useRef<HTMLSpanElement>(null);
  const { reduced } = useMotionPrefs();
  const from = React.useRef(0);

  // Held in a ref so a re-render with a new formatter (currency changed in
  // Settings, say) does not restart the count.
  const formatRef = React.useRef(format);
  formatRef.current = format;

  React.useEffect(() => {
    const node = ref.current;
    if (!node) return;

    // Landing the figure is not optional. Every exit from this effect goes
    // through here, because a half-counted number IS A WRONG NUMBER, and this
    // app's entire promise is that its numbers are right.
    const land = () => {
      node.textContent = formatRef.current(value);
      from.current = value;
    };

    // A hidden tab gets no animation frames at all, so a count started here
    // would freeze partway and still be frozen — showing a wrong figure —
    // when the owner switches back. Skip straight to the answer.
    if (reduced || document.visibilityState === "hidden") {
      land();
      return;
    }

    const controls = animate(from.current, value, {
      duration,
      ease: EASE_OUT,
      onUpdate: (v) => {
        node.textContent = formatRef.current(v);
      },
      onComplete: land,
    });

    // Same hazard, arriving mid-count: switching away pauses the frames, so
    // give up on the animation and show the real number instead.
    const onHide = () => {
      if (document.visibilityState === "hidden") {
        controls.stop();
        land();
      }
    };
    document.addEventListener("visibilitychange", onHide);

    return () => {
      document.removeEventListener("visibilitychange", onHide);
      controls.stop();
      land();
    };
  }, [value, duration, reduced]);

  return (
    /* The server-rendered / first-paint text is the real value, so the number
       is correct even in the frame before the effect runs. */
    <span ref={ref} className={className} style={style}>
      {format(value)}
    </span>
  );
}
