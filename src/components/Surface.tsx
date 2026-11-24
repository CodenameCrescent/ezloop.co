import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * THE card.
 *
 * In LIGHT it reads as raised purely because it is lighter than the page — no
 * border, no shadow. In DARK that alone is not enough, so it also carries a
 * hairline and a whisper of shadow. Neither is decided here: both come from
 * `--pl-surface-line` / `--pl-surface-shadow`, which resolve to nothing in
 * light. The visual recipe lives in index.css (`.pl-surface`) so the legacy
 * `.pl-glass` / `.app-panel` / `.app-table-shell` aliases stay identical.
 */
export const surfaceClass = "pl-surface";

export type SurfaceVariant = "default" | "recessed" | "hero" | "brand" | "bordered" | "interactive";
export type SurfacePadding = "none" | "sm" | "md" | "lg";

const variantClass: Record<SurfaceVariant, string> = {
  default: "",
  recessed: "bg-[color:var(--pl-recessed)]",
  /**
   * The brand wash. ONE surface per screen may wear it — the block the page
   * exists for. On a second card it stops meaning "this is the important one"
   * and becomes wallpaper, which is the thing the palette is built to avoid.
   */
  hero: "pl-hero overflow-hidden",
  /**
   * The strong form of the wash: the card IS the brand colour.
   *
   * Same budget as `hero` — ONE per screen — and the two are alternatives, not
   * a pair. A page with a washed card and a brand card has two things claiming
   * to be the thing the page is for.
   *
   * Text inside it must not name its own colour: the class sets `color` to
   * `--pl-on-hero`, which is white in light and near-black in dark (the brand
   * fill flips, DESIGN.md §5). A child hardcoding "text-white" is correct in
   * one theme and invisible in the other.
   */
  brand: "pl-hero-solid overflow-hidden",
  // Hover shifts the surface value rather than lifting it. Nothing on the page
  // plane is allowed to grow a shadow.
  interactive:
    "cursor-pointer transition-colors duration-150 hover:bg-[color:color-mix(in_srgb,var(--pl-orange)_5%,var(--pl-surface))]",
  // The one place a border is allowed on the page plane: a dense grid panel,
  // where the hairline divides cells instead of gapping cards (DESIGN.md).
  // The recipe lives in index.css because it also has to cancel the inset line
  // dark mode puts on every card — two edges a pixel apart is a defect.
  bordered: "pl-bordered",
};

const paddingClass: Record<SurfacePadding, string> = {
  none: "",
  sm: "p-4",
  md: "p-5 sm:p-6",
  lg: "p-6 sm:p-8",
};

export type SurfaceProps = React.HTMLAttributes<HTMLDivElement> & {
  variant?: SurfaceVariant;
  /** Additive, so a hero or recessed panel can also be clickable. */
  interactive?: boolean;
  /**
   * Additive, so the hero can wear the brand wash AND the dense hairline.
   * `variant="bordered"` remains for a plain bordered grid panel.
   */
  bordered?: boolean;
  padding?: SurfacePadding;
  as?: "div" | "section" | "article" | "aside";
};

export const Surface = React.forwardRef<HTMLDivElement, SurfaceProps>(
  (
    { className, variant = "default", interactive, bordered, padding = "none", as: Tag = "div", children, ...props },
    ref,
  ) => (
    <Tag
      ref={ref as React.Ref<HTMLDivElement>}
      className={cn(
        surfaceClass,
        variantClass[variant],
        // Both modifiers are additive, so the combinations the dense pass needs
        // (a washed hero that is also bordered) do not each need a new variant.
        interactive && variant !== "interactive" && variantClass.interactive,
        bordered && variant !== "bordered" && variantClass.bordered,
        paddingClass[padding],
        className,
      )}
      {...props}
    >
      {children}
    </Tag>
  ),
);

Surface.displayName = "Surface";
