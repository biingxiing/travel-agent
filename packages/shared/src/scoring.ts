import type { Plan, PlanItem } from './plan.js'

export type Grade = 'excellent' | 'good' | 'fair' | 'poor' | 'none'

export interface ScoreCheck {
  label: string
  points: number
  maxPoints: number
  found: boolean
}

export interface ItemScore {
  title: string
  type: string
  score: number
  checks: ScoreCheck[]
  grade: Grade
}

export interface CategoryScore {
  score: number | null
  count: number
  items: ItemScore[]
  grade: Grade
}

export interface CoverageScore {
  score: number
  daysWithTransport: number
  daysWithLodging: number
  daysWithAttractions: number
  totalDays: number
}

export interface ItineraryScore {
  overall: number
  grade: Grade
  transport: CategoryScore
  lodging: CategoryScore
  attraction: CategoryScore
  meal: CategoryScore
  coverage: CoverageScore
  suggestions: string[]
}

export const REQUIRED_CATEGORIES = ['transport', 'lodging', 'attraction'] as const
export const DEFAULT_THRESHOLD = 90

export function gradeFromScore(score: number | null): Grade {
  if (score === null) return 'none'
  if (score >= 85) return 'excellent'
  if (score >= 70) return 'good'
  if (score >= 50) return 'fair'
  return 'poor'
}

function anyMatch(text: string, patterns: RegExp[]): boolean {
  return patterns.some((p) => p.test(text))
}

function itemText(item: PlanItem): string {
  const parts: string[] = [item.title]
  if (item.description) parts.push(item.description)
  if (Array.isArray(item.tips)) parts.push(...item.tips)
  return parts.join(' ')
}

function chk(label: string, found: boolean, maxPoints: number): ScoreCheck {
  return { label, found, points: found ? maxPoints : 0, maxPoints }
}

function avgScore(items: ItemScore[]): number | null {
  if (items.length === 0) return null
  return Math.round(items.reduce((s, i) => s + i.score, 0) / items.length)
}

function buildCategory(items: ItemScore[]): CategoryScore {
  const score = avgScore(items)
  return { score, count: items.length, items, grade: gradeFromScore(score) }
}

function scoreTransportItem(item: PlanItem): ItemScore {
  const t = itemText(item)
  const checks: ScoreCheck[] = [
    chk('航班 / 车次号', anyMatch(t, [
      /\b[A-Z]{2}\d{3,4}\b/,
      /\b[GDZKTYJ]\d{2,4}次?\b/i,
      /航班号|车次|班次/,
    ]), 35),
    chk('出发 / 到达站点', anyMatch(t, [
      /机场|Airport|航站楼|T[123]/,
      /高铁站|火车站|动车站/,
      /\S+站[，。\s]/,
      /\S+机场/,
    ]), 20),
    chk('出发 / 到达时间',
      (!!item.time && item.time !== '') || anyMatch(t, [/\d{1,2}:\d{2}/]),
      20),
    chk('舱位 / 座位类型', anyMatch(t, [
      /经济舱|商务舱|头等舱|公务舱/,
      /二等座|一等座|商务座/,
      /软卧|硬卧|硬座|软座/,
    ]), 15),
    chk('预订 / 出行提示',
      (Array.isArray(item.tips) && item.tips.length > 0) ||
        anyMatch(t, [/提前|预订|购票|值机|托运|行李额/]),
      10),
  ]
  const score = checks.reduce((s, c) => s + c.points, 0)
  return { title: item.title, type: item.type, score, checks, grade: gradeFromScore(score) }
}

function scoreLodgingItem(item: PlanItem): ItemScore {
  const t = itemText(item)
  const checks: ScoreCheck[] = [
    chk('具体房型', anyMatch(t, [
      /大床房|双床房|标准间|单人间|三人间|家庭房/,
      /豪华|行政|套房|海景|山景|城景|花园|湖景|阁楼/,
      /King|Queen|Twin|Suite|Deluxe|Superior|Standard/i,
    ]), 30),
    chk('入住 / 退房时间', anyMatch(t, [
      /入住.{0,8}\d{1,2}:\d{2}/,
      /退房.{0,8}\d{1,2}:\d{2}/,
      /\d{1,2}:\d{2}.{0,8}(入住|退房)/,
      /check.?in|check.?out/i,
    ]), 20),
    chk('每晚价格',
      !!item.estimatedCost ||
        anyMatch(t, [/\d+\s*元?\/晚|每晚\s*\d+|¥\s*\d+|\$\d+/, /房费|住宿费/]),
      20),
    chk('地址 / 位置',
      !!item.location ||
        anyMatch(t, [/路|街道|区.{0,2}号|步行\d+分钟/, /地址|位于|靠近|附近/]),
      20),
    chk('设施 / 须知', anyMatch(t, [
      /含早餐|免费早餐|早餐/,
      /停车|WiFi|泳池|健身|SPA/i,
      /预订|取消政策|订房须知/,
    ]), 10),
  ]
  const score = checks.reduce((s, c) => s + c.points, 0)
  return { title: item.title, type: item.type, score, checks, grade: gradeFromScore(score) }
}

function scoreAttractionItem(item: PlanItem): ItemScore {
  const t = itemText(item)
  const descLen = (item.description ?? '').length
  const checks: ScoreCheck[] = [
    chk('开放时间', anyMatch(t, [
      /开放时间|营业时间|开门时间/,
      /全天开放|24小时开放/,
      /\d{1,2}:\d{2}\s*[-~至到]\s*\d{1,2}:\d{2}/,
      /每(天|日)\s*\d{1,2}:\d{2}/,
    ]), 25),
    chk('门票信息', anyMatch(t, [
      /门票|票价|入场费|景区票/,
      /免费(入场|参观|开放)|无需(门票|购票)/,
      /\d+\s*元.{0,4}(票|门票)/,
      /凭票入场|凭证入场/,
    ]), 25),
    chk('建议游览时长',
      !!item.durationMinutes ||
        anyMatch(t, [/\d+\s*小时/, /半天|全天/, /建议(游览|参观|停留)/, /参观时间|游览时间/]),
      20),
    chk('景点具体内容',
      descLen >= 40 ||
        anyMatch(t, [/推荐|必看|必去|特色|亮点|重点景点/, /代表性|知名|著名|标志性/]),
      20),
    chk('游玩贴士',
      (Array.isArray(item.tips) && item.tips.length > 0) ||
        anyMatch(t, [/建议|注意|避免|旺季|淡季|人多|拥挤|提前|预约|拍照/]),
      10),
  ]
  const score = checks.reduce((s, c) => s + c.points, 0)
  return { title: item.title, type: item.type, score, checks, grade: gradeFromScore(score) }
}

function scoreMealItem(item: PlanItem): ItemScore {
  const t = itemText(item)
  const checks: ScoreCheck[] = [
    chk('特色菜品', anyMatch(t, [
      /推荐|必点|招牌|特色菜|代表菜/,
      /[^\s，。]{2,6}(饭|面|汤|锅|串|饺|粥|饼|糕|虾|蟹|鱼)/,
    ]), 30),
    chk('人均价格',
      !!item.estimatedCost ||
        anyMatch(t, [/人均|消费|价格|费用/, /\d+\s*元\s*(\/人|左右|起)/]),
      25),
    chk('餐厅位置',
      !!item.location || anyMatch(t, [/路|街|区.{0,2}号/, /位于|地址|靠近/]),
      20),
    chk('预订建议', anyMatch(t, [/预订|预约|排队|需要提前|建议预约/]), 15),
    chk('用餐贴士',
      (Array.isArray(item.tips) && item.tips.length > 0) ||
        anyMatch(t, [/营业时间|开门|打烊|高峰|等位|人气/]),
      10),
  ]
  const score = checks.reduce((s, c) => s + c.points, 0)
  return { title: item.title, type: item.type, score, checks, grade: gradeFromScore(score) }
}

export function scorePlan(plan: Plan): ItineraryScore {
  const allItems = plan.dailyPlans.flatMap((d) => d.items)
  const transportScores = allItems.filter((i) => i.type === 'transport').map(scoreTransportItem)
  const lodgingScores = allItems.filter((i) => i.type === 'lodging').map(scoreLodgingItem)
  const attractionScores = allItems
    .filter((i) => i.type === 'attraction' || i.type === 'activity')
    .map(scoreAttractionItem)
  const mealScores = allItems.filter((i) => i.type === 'meal').map(scoreMealItem)

  const transport = buildCategory(transportScores)
  const lodging = buildCategory(lodgingScores)
  const attraction = buildCategory(attractionScores)
  const meal = buildCategory(mealScores)

  const totalDays = plan.days
  const daysWithTransport = plan.dailyPlans.filter((d) =>
    d.items.some((i) => i.type === 'transport')).length
  const daysWithLodging = plan.dailyPlans.filter((d) =>
    d.items.some((i) => i.type === 'lodging')).length
  const daysWithAttractions = plan.dailyPlans.filter((d) =>
    d.items.filter((i) => i.type === 'attraction' || i.type === 'activity').length >= 2).length
  const coverageScore = totalDays === 0 ? 0 : Math.round(
    (daysWithTransport / totalDays) * 33 +
    (daysWithLodging / totalDays) * 33 +
    (daysWithAttractions / totalDays) * 34,
  )
  const coverage: CoverageScore = {
    score: coverageScore, daysWithTransport, daysWithLodging, daysWithAttractions, totalDays,
  }

  let coverageWeight = 0.15
  let weightedSum = 0
  const catWeights = [
    { score: transport.score, weight: 0.30 },
    { score: lodging.score, weight: 0.30 },
    { score: attraction.score, weight: 0.25 },
  ]
  for (const { score, weight } of catWeights) {
    if (score !== null) weightedSum += score * weight
    else coverageWeight += weight
  }
  weightedSum += coverageScore * coverageWeight
  const overall = Math.round(weightedSum)

  const suggestions: string[] = []
  if (transport.score === null) suggestions.push('行程中未包含交通安排，建议添加航班或火车具体信息')
  else if (transport.score < 60) suggestions.push('交通信息较简略，建议补充具体航班 / 车次号、舱位类型和乘车站点')
  if (lodging.score === null) suggestions.push('行程中未包含住宿安排，建议添加酒店名称和具体房型')
  else if (lodging.score < 60) suggestions.push('住宿信息较简略，建议补充具体房型、入住退房时间及每晚价格')
  if (attraction.score === null) suggestions.push('行程中未检测到景点活动，建议添加具体游览项目')
  else if (attraction.score < 60) suggestions.push('景点信息较简略，建议补充开放时间、门票价格和建议游览时长')
  if (coverageScore < 60 && suggestions.length < 3)
    suggestions.push('部分天数缺少交通或住宿安排，建议检查每日行程完整性')

  return { overall, grade: gradeFromScore(overall), transport, lodging, attraction, meal, coverage, suggestions }
}

export function isConverged(score: ItineraryScore, threshold = DEFAULT_THRESHOLD): boolean {
  return REQUIRED_CATEGORIES.every((cat) => {
    const s = score[cat].score
    return s !== null && s >= threshold
  })
}
