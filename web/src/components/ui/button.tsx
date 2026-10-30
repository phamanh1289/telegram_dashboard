import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"

// DESIGN.md § Button: 36px default, 30px small; ink primary lifts 1px on hover and presses 1px on active.
// Focus is the shared coral ring from base.css (instant, never animated). Disabled: opacity .5, no pointer.
// On coarse pointers an invisible ::after grows every button to a 44px hit area.
const buttonVariants = cva(
  "group/button relative inline-flex shrink-0 items-center justify-center rounded-md border border-transparent bg-clip-padding text-sm font-medium whitespace-nowrap select-none transition-[background-color,border-color,color,opacity,transform] duration-(--dur-micro) ease-out active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none disabled:opacity-50 aria-busy:cursor-progress aria-invalid:border-error pointer-coarse:after:absolute pointer-coarse:after:-inset-1.5 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-board text-board-type hover:-translate-y-px hover:bg-ink-2",
        outline:
          "bg-cotton text-ink shadow-edge hover:bg-paper-2 aria-expanded:bg-paper-2 aria-pressed:bg-paper-3",
        secondary:
          "bg-cotton text-ink shadow-edge hover:bg-paper-2 aria-expanded:bg-paper-2 aria-pressed:bg-paper-3",
        ghost:
          "text-ink-2 hover:bg-paper-3 hover:text-ink aria-expanded:bg-paper-3 aria-expanded:text-ink aria-pressed:bg-paper-3 aria-pressed:text-ink",
        destructive:
          "text-error hover:bg-error-wash",
        link: "h-auto px-0 text-ink underline decoration-rule-2 underline-offset-4 hover:decoration-signal-2",
      },
      size: {
        default:
          "h-9 gap-1.5 px-3 has-data-[icon=inline-end]:pr-2.5 has-data-[icon=inline-start]:pl-2.5",
        xs: "h-[30px] gap-1 px-2 text-xs [&_svg:not([class*='size-'])]:size-3.5",
        sm: "h-[30px] gap-1 px-2.5 text-[0.8125rem] [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-9 gap-1.5 px-4",
        icon: "size-9",
        "icon-xs": "size-[30px] [&_svg:not([class*='size-'])]:size-3.5",
        "icon-sm": "size-[30px]",
        "icon-lg": "size-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
