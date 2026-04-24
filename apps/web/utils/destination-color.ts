interface DestinationBand {
  match: RegExp
  gradient: string
}

const BANDS: DestinationBand[] = [
  { match: /京都|奈良|东京|大阪|冲绳|横滨/, gradient: 'linear-gradient(135deg, #F9A8D4 0%, #EC4899 60%, #BE185D 100%)' },
  { match: /北海道|札幌|函馆|小樽/, gradient: 'linear-gradient(135deg, #86EFAC 0%, #10B981 60%, #047857 100%)' },
  { match: /北京|西安|敦煌|大同|太原/, gradient: 'linear-gradient(135deg, #FCD34D 0%, #F59E0B 60%, #B45309 100%)' },
  { match: /杭州|苏州|上海|南京|乌镇/, gradient: 'linear-gradient(135deg, #C7D2FE 0%, #818CF8 60%, #6366F1 100%)' },
  { match: /巴黎|伦敦|阿姆斯特丹|罗马|巴塞罗那|马德里|柏林|维也纳|布拉格|冰岛/, gradient: 'linear-gradient(135deg, #DDD6FE 0%, #A78BFA 60%, #7C3AED 100%)' },
  { match: /清迈|曼谷|巴厘岛|胡志明|河内|吉隆坡|新加坡|普吉|芽庄/, gradient: 'linear-gradient(135deg, #FDBA74 0%, #F97316 60%, #C2410C 100%)' },
]

const FALLBACK = 'linear-gradient(135deg, #7B5BFF 0%, #4F7CFF 100%)'

export function destinationColor(destination: string | undefined | null): string {
  if (!destination) return FALLBACK
  for (const band of BANDS) {
    if (band.match.test(destination)) return band.gradient
  }
  return FALLBACK
}
