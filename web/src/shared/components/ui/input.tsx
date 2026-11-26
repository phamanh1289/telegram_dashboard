import * as React from "react"
import { Input as InputPrimitive } from "@base-ui/react/input"
import { Eye, EyeOff } from "lucide-react"
import { cn } from "cn"
import { Hint } from "@/shared/components/ui/hint"
import { useT } from "@/shared/lib/i18n"

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

/** A password-like field with an eye button that shows / hides what was typed; `onReveal` tells the caller (the login
 *  mascot peeks while it is shown). */
function SecretInput({ className, onReveal, ...props }: React.ComponentProps<"input"> & { onReveal?: (shown: boolean) => void }) {
  const t = useT()
  const [shown, setShown] = React.useState(false)
  const Icon = shown ? EyeOff : Eye
  return (
    <span className="relative flex w-full min-w-0">
      <Input {...props} type={shown ? "text" : "password"} className={cn("pr-9", className)} />
      <Hint side="bottom" text={t("Hiện / ẩn nội dung")}>
        <button type="button" aria-label={t("Hiện / ẩn nội dung")} aria-pressed={shown}
          onClick={() => { setShown(!shown); onReveal?.(!shown) }}
          className="absolute inset-y-0 right-0 grid w-9 place-items-center rounded-r-md text-ink-3 transition-colors duration-(--dur-micro) hover:text-ink focus-visible:outline-2 focus-visible:outline-(--color-focus)">
          <Icon className="size-4" aria-hidden />
        </button>
      </Hint>
    </span>
  )
}

export { Input, SecretInput }
