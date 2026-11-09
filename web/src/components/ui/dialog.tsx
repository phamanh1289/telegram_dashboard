"use client"

import * as React from "react"
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog"
import { cn } from "cn"

import { Button } from "@/components/ui/button"
import { CircleHelp, Loader2, Trash2, XIcon, type LucideIcon } from "lucide-react"

function Dialog({ ...props }: DialogPrimitive.Root.Props) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />
}

function DialogTrigger({ ...props }: DialogPrimitive.Trigger.Props) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />
}

function DialogPortal({ ...props }: DialogPrimitive.Portal.Props) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />
}

function DialogClose({ ...props }: DialogPrimitive.Close.Props) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />
}

function DialogOverlay({
  className,
  ...props
}: DialogPrimitive.Backdrop.Props) {
  return (
    <DialogPrimitive.Backdrop
      data-slot="dialog-overlay"
      className={cn(
        "scrim fixed inset-0 isolate z-50 bg-(--scrim) backdrop-blur-[2px]",
        className
      )}
      {...props}
    />
  )
}

function DialogContent({
  className,
  children,
  showCloseButton = true,
  ...props
}: DialogPrimitive.Popup.Props & {
  showCloseButton?: boolean
}) {
  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Popup
        data-slot="dialog-content"
        // Centred by inset-0 + m-auto + h-fit, not translate(-50%): no fight with .pop's translate, no half-pixel blur.
        // --dlg-p is the padding DialogFooter bleeds back over, so the two never drift apart.
        // grid-cols-1 (minmax(0,1fr)): an implicit auto column grows to the width of any nowrap/truncate line inside.
        className={cn(
          "fixed inset-0 z-50 m-auto grid h-fit grid-cols-1 max-h-[min(88dvh,48rem)] w-full max-w-[calc(100%-2rem)] gap-4 overflow-x-hidden overflow-y-auto overscroll-contain rounded-lg bg-cotton p-(--dlg-p) text-sm text-ink shadow-pop outline-none [--dlg-p:1.25rem] sm:max-w-md pop [&>:first-child]:[grid-area:1/1]",
          className
        )}
        {...props}
      >
        {children}
        {showCloseButton && (
          <DialogPrimitive.Close
            data-slot="dialog-close"
            render={
              <Button
                variant="ghost"
                // grid popup (default): sticky in the first row's top-right, so it stays put while the popup scrolls
                // (it shares cell 1/1 with the first child; sticky offsets count from inside the popup's padding)
                className="absolute top-3 right-3 text-ink-3 hover:text-ink [.grid>&]:sticky [.grid>&]:top-[calc(0.75rem-var(--dlg-p))] [.grid>&]:right-auto [.grid>&]:z-10 [.grid>&]:-mt-2 [.grid>&]:-mr-2 [.grid>&]:justify-self-end [.grid>&]:bg-cotton [.grid>&]:[grid-area:1/1]"
                size="icon-sm"
              />
            }
          >
            <XIcon aria-hidden />
            <span className="sr-only">Đóng</span>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Popup>
    </DialogPortal>
  )
}

/** `DialogContent` className for a detail page sliding in from the right (full height, no padding: the page lays out its own head / body / foot). */
const DIALOG_SHEET =
  "inset-y-0 right-0 left-auto m-0 flex h-dvh max-h-none max-w-full flex-col gap-0 overflow-hidden rounded-none bg-paper p-0 [--dlg-p:0px] sm:max-w-2xl pop-sheet"

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-header"
      className={cn("grid gap-1.5", className)}
      {...props}
    />
  )
}

function DialogFooter({
  className,
  showCloseButton = false,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  showCloseButton?: boolean
}) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        // sticky: stays in view when the popup itself has to scroll (short window, long text)
        "sticky bottom-[calc(-1*var(--dlg-p))] z-10 -mx-(--dlg-p) -mb-(--dlg-p) flex flex-col-reverse gap-2 border-t border-rule bg-paper-2 px-(--dlg-p) py-3 sm:flex-row sm:items-center sm:justify-end",
        className
      )}
      {...props}
    >
      {children}
      {showCloseButton && (
        <DialogPrimitive.Close render={<Button variant="outline" />}>
          Đóng
        </DialogPrimitive.Close>
      )}
    </div>
  )
}

function DialogTitle({ className, ...props }: DialogPrimitive.Title.Props) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn(
        "pr-9 text-base leading-snug font-semibold tracking-tight text-pretty text-ink",
        className
      )}
      {...props}
    />
  )
}

function DialogDescription({
  className,
  ...props
}: DialogPrimitive.Description.Props) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn(
        "max-w-[65ch] text-sm leading-relaxed text-pretty text-ink-2 *:[a]:underline *:[a]:underline-offset-3 *:[a]:hover:text-ink",
        className
      )}
      {...props}
    />
  )
}

const SHOWN = 5

/** Per tone: the icon by default, its badge, the confirm button. A new kind of confirm = one more row here. */
const TONES = {
  danger: { icon: Trash2, badge: "confirm-shake bg-error-wash text-error", button: "bg-error text-paper hover:bg-error/90" },
  default: { icon: CircleHelp, badge: "bg-hl-wash text-hl-2", button: "" },
} satisfies Record<string, { icon: LucideIcon; badge: string; button: string }>

/** "Xóa …?" / "Xong tất cả?" asked in the app's own look (never `window.confirm`): what happens, what it touches, Hủy first.
 *  Stays open while `busy` (Esc / Hủy blocked); the caller closes it on success and passes `error` on failure.
 *  `children` goes under the list for anything else the question needs (a checkbox, a note). */
function ConfirmDialog({ open, onOpenChange, title, description, items, unit = "mục", confirmLabel, tone = "danger", icon,
  busy, error, onConfirm, children }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: React.ReactNode
  description?: React.ReactNode
  items?: { id: string; label: React.ReactNode; tag?: string }[] // what it touches, first SHOWN of them
  unit?: string // "+3 phiên khác"
  confirmLabel: React.ReactNode
  tone?: keyof typeof TONES
  icon?: LucideIcon // overrides the tone's icon, in the badge and on the button
  busy?: boolean
  error?: React.ReactNode
  onConfirm: () => void
  children?: React.ReactNode
}) {
  const t = TONES[tone], Icon = icon ?? t.icon
  const more = (items?.length ?? 0) - SHOWN
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!busy) onOpenChange(o) }}>
      <DialogContent showCloseButton={false} role="alertdialog" className="sm:max-w-md">
        <div className="flex gap-3.5">
          <span aria-hidden className={cn("grid size-10 shrink-0 place-items-center rounded-lg [&_svg]:size-5", t.badge)}><Icon /></span>
          <DialogHeader className="min-w-0 flex-1 pt-0.5">
            <DialogTitle className="pr-0">{title}</DialogTitle>
            {description && <DialogDescription>{description}</DialogDescription>}
          </DialogHeader>
        </div>
        {/* grid-cols-1: without it the truncated rows widen the column past the dialog's edge */}
        {!!items?.length && (
          <ul className="grid grid-cols-1 divide-y divide-rule overflow-hidden rounded-lg border border-rule bg-paper-2 text-xs">
            {items.slice(0, SHOWN).map((it) => (
              <li key={it.id} className="flex min-h-9 items-center gap-2.5 px-3 py-1.5">
                {it.tag && <span className="shrink-0 font-mono text-ink-3 tabular-nums">{it.tag}</span>}
                <span className="min-w-0 flex-1 truncate text-ink-2">{it.label}</span>
              </li>
            ))}
            {more > 0 && <li className="px-3 py-1.5 text-ink-3">+<span className="font-mono tabular-nums">{more}</span> {unit} khác</li>}
          </ul>
        )}
        {children}
        {error && <p role="alert" className="text-sm text-error">{error}</p>}
        <DialogFooter>
          <DialogPrimitive.Close disabled={busy} render={<Button variant="outline" />}>Hủy</DialogPrimitive.Close>
          <Button className={t.button} aria-busy={busy} disabled={busy} onClick={onConfirm}>
            {busy ? <Loader2 className="animate-spin" aria-hidden /> : <Icon aria-hidden />}{confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export {
  ConfirmDialog,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
  DIALOG_SHEET,
}
