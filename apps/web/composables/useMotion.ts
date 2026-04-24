// Named motion presets used across the app. Values are expressed in the
// format expected by motion-v (`initial` / `animate` / `transition`).

const easeOut = [0.2, 0.7, 0.25, 1] as const

export const motionPresets = {
  fadeIn: {
    initial: { opacity: 0 },
    animate: { opacity: 1 },
    transition: { duration: 0.24, ease: 'easeOut' as const },
  },
  slideUp: {
    initial: { y: 8, opacity: 0 },
    animate: { y: 0, opacity: 1 },
    transition: { duration: 0.32, ease: easeOut },
  },
  pop: {
    initial: { scale: 0.96, opacity: 0 },
    animate: { scale: 1, opacity: 1 },
    transition: { duration: 0.2, ease: easeOut },
  },
  listStagger: {
    staggerChildren: 0.04,
  },
  ghostPulse: {
    animate: { opacity: [0.6, 1, 0.6] },
    transition: { duration: 1.6, repeat: Infinity, ease: 'easeInOut' as const },
  },
} as const

export type MotionPresetName = keyof typeof motionPresets
