export interface PoiVisual {
  gradient: string
  icon: string
}

const CANONICAL: Record<string, PoiVisual> = {
  lodging:    { gradient: 'var(--gradient-poi-hotel)',   icon: 'bed' },
  meal:       { gradient: 'var(--gradient-poi-food)',    icon: 'utensils-crossed' },
  attraction: { gradient: 'var(--gradient-poi-poi)',     icon: 'mountain' },
  transport:  { gradient: 'var(--gradient-poi-transit)', icon: 'tram-front' },
  activity:   { gradient: 'var(--gradient-poi-poi)',     icon: 'compass' },
  note:       { gradient: 'linear-gradient(135deg, #D1D5DB, #6B7280)', icon: 'sticky-note' },
}

const FALLBACK: PoiVisual = CANONICAL.attraction

export function poiVisualForType(type: string | undefined | null): PoiVisual {
  if (!type) return FALLBACK
  return CANONICAL[type] ?? FALLBACK
}
