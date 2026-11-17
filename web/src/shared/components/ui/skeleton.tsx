import { cn } from "cn"

// A quiet block in the shape of what is coming; the pulse stops under reduced motion (base.css).
function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      aria-hidden
      className={cn("animate-pulse rounded-sm bg-paper-3", className)}
      {...props}
    />
  )
}

export { Skeleton }
