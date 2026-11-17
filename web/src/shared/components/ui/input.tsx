import * as React from "react"
import { Input as InputPrimitive } from "@base-ui/react/input"
import { cn } from "cn"

// DESIGN.md § Input: 36px, radius 6, 1px rule-2 border, cotton fill; the coral focus ring comes from base.css.
function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      className={cn(
        "h-9 w-full min-w-0 rounded-md border border-rule-2 bg-cotton px-3 py-1 text-base text-ink transition-[background-color,border-color] duration-(--dur-micro) placeholder:text-ink-3 hover:border-ink-3 focus-visible:-outline-offset-1 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-error md:text-sm file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-ink",
        className
      )}
      {...props}
    />
  )
}

export { Input }
