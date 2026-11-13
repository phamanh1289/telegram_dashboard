import * as React from "react"
import { cn } from "cn"

// Same field recipe as Input; reading/writing text sits at 15px.
function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "flex field-sizing-content min-h-16 w-full rounded-md border border-rule-2 bg-cotton px-3 py-2 text-md leading-relaxed text-ink transition-[background-color,border-color] duration-(--dur-micro) placeholder:text-ink-3 hover:border-ink-3 focus-visible:-outline-offset-1 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-error md:text-md",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
