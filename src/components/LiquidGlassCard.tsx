/**
 * Liquid Glass is retired — the blur, the sheen and the double border were the
 * opposite of the flat, borderless direction the app now follows (DESIGN.md).
 *
 * This file stays as a shim so the pages that still import `LiquidGlassCard`
 * or `liquidGlassCardClass` keep working while they are rebuilt one at a time.
 * New code imports `Surface` directly. Delete this file when the last import
 * of it goes.
 */
import * as React from "react";
import { Surface, surfaceClass, type SurfaceProps, type SurfacePadding } from "./Surface";

export const liquidGlassCardClass = surfaceClass;

/** The old variants collapse: there is one card now, plus a recessed well. */
export type LiquidGlassCardVariant =
  | "default"
  | "interactive"
  | "flat"
  | "danger"
  | "success"
  | "accent"
  | "bordered";
export type LiquidGlassCardPadding = SurfacePadding;

export type LiquidGlassCardProps = Omit<SurfaceProps, "variant"> & {
  variant?: LiquidGlassCardVariant;
};

export const LiquidGlassCard = React.forwardRef<HTMLDivElement, LiquidGlassCardProps>(
  ({ variant = "default", interactive, ...props }, ref) => (
    <Surface
      ref={ref}
      variant={variant === "bordered" ? "bordered" : undefined}
      interactive={interactive || variant === "interactive"}
      {...props}
    />
  ),
);

LiquidGlassCard.displayName = "LiquidGlassCard";

export { Surface };
