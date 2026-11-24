import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

/**
 * Buttons are pills, in three heights, with no border and no shadow.
 *
 * The old set had six shapes on one screen — two of them identical except that
 * one rounded to 12px and the other to 9px. Separation comes from the fill
 * value, the same rule the cards follow (DESIGN.md).
 */
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:color-mix(in_srgb,var(--pl-orange)_35%,transparent)] disabled:pointer-events-none disabled:opacity-45 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default:
          "bg-[color:var(--pl-orange-fill)] text-white hover:bg-[color:var(--pl-orange-hover)]",
        // -solid would be 3.91 behind white text; the text red clears 5.9.
        destructive:
          "bg-[color:var(--pl-red)] text-white hover:bg-[color:color-mix(in_srgb,#000_12%,var(--pl-red))]",
        // "Outline" no longer outlines: a white pill on the page reads as
        // raised the same way a card does.
        outline:
          "bg-[color:var(--pl-surface)] text-[color:var(--pl-ink)] hover:bg-[color:var(--pl-recessed)]",
        secondary:
          "bg-[color:var(--pl-recessed)] text-[color:var(--pl-ink)] hover:bg-[color:color-mix(in_srgb,var(--pl-ink)_8%,var(--pl-recessed))]",
        ghost:
          "text-[color:var(--pl-ink-2)] hover:bg-[color:var(--pl-recessed)] hover:text-[color:var(--pl-ink)]",
        link: "text-[color:var(--pl-orange-text)] underline-offset-4 hover:underline",
      },
      size: {
        sm: "h-8 px-3 text-xs",
        default: "h-9 px-4 text-[13px]",
        lg: "h-11 px-6 text-sm",
        icon: "h-9 w-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button"
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    )
  }
)
Button.displayName = "Button"

export { Button, buttonVariants }
