/** The Biết tuốt bot's open / close, shared by every panel that grows out of its button: spring in from half size, a quick ease out. */
export const POP_SPRING = { type: "spring" as const, stiffness: 420, damping: 34 };
export const POP_EXIT = 0.2; // seconds the close takes
export const POP_OUT = { duration: POP_EXIT, ease: [0.4, 0, 1, 1] as const };
export const POP = {
  open: { opacity: 1, scale: 1, transition: { scale: POP_SPRING, opacity: { duration: 0.16 } } },
  shut: { opacity: 0, scale: 0.5, transition: POP_OUT },
};
/** POP under prefers-reduced-motion: a fade only. */
export const POP_FADE = { open: { opacity: 1 }, shut: { opacity: 0 } };
