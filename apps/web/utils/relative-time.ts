export function relativeTime(
  input: Date | string | number | null | undefined,
  now: number = Date.now(),
): string {
  if (input == null) return ''
  const date = input instanceof Date ? input : new Date(input)
  const ms = date.getTime()
  if (Number.isNaN(ms)) return ''

  const diffSec = Math.max(0, Math.floor((now - ms) / 1000))
  if (diffSec < 31) return '刚刚'

  const diffMin = Math.floor(diffSec / 60)
  if (diffMin < 60) return `${diffMin} 分钟前`

  const diffHr = Math.floor(diffMin / 60)
  if (diffHr < 24) return `${diffHr} 小时前`

  const diffDay = Math.floor(diffHr / 24)
  if (diffDay <= 7) return `${diffDay} 天前`

  const mm = String(date.getMonth() + 1).padStart(2, '0')
  const dd = String(date.getDate()).padStart(2, '0')
  return `${mm}-${dd}`
}
