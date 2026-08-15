/**
 * 地址标准化 + 模糊匹配工具
 *
 * 匹配策略：
 * 1. 去掉省/市/区/县/镇等行政区划词和特殊符号
 * 2. 重点对比详细地址部分：最长公共子串占较短地址的比例 >= 70% 才算匹配
 * 3. 前面的行政区划相同很常见，不作为主要命中依据
 *
 * 性能优化：
 * - normalize 结果缓存
 * - 批量匹配时先做快速排除，LCS 只对候选执行
 */

// 行政区划词（用于标准化时去掉）
const REGION_WORDS = [
  '壮族自治区', '回族自治区', '维吾尔自治区', '自治区',
  '省', '市', '区', '县', '镇', '乡', '街道', '村', '社区',
  '盟', '州', '旗', '苏木', '嘎查',
  '特别行政区', '自治县', '自治州', '自治旗'
]

// 特殊字符和无关符号（保留数字，门牌号是详细地址的重要部分）
const SPECIAL_CHARS = /[-\s\[\]()（）【】「」『』《》<>、，,。.；;:：!！?？"'`~@#$%^&*_+=|\\/]/g

// 相似度阈值
const SIMILARITY_THRESHOLD = 0.7
// 公共子串最小长度（避免很短的地址误判）
const MIN_COMMON_LEN = 8

// normalize 缓存
const normalizeCache = new Map()
const CACHE_MAX = 50000

/**
 * 标准化地址：去掉特殊符号、数字、行政区划词
 * 注意：数字也去掉（门牌号在不同写法中格式差异大，重点比道路名/小区名等文字部分）
 */
function normalizeAddress(addr) {
  if (!addr) return ''
  if (normalizeCache.has(addr)) return normalizeCache.get(addr)

  let s = String(addr).trim()
  s = s.replace(SPECIAL_CHARS, '')
  const sortedWords = [...REGION_WORDS].sort((a, b) => b.length - a.length)
  for (const w of sortedWords) {
    s = s.split(w).join('')
  }

  if (normalizeCache.size >= CACHE_MAX) normalizeCache.clear()
  normalizeCache.set(addr, s)
  return s
}

/**
 * 计算两个字符串的相似度（0~1）
 * 基于最长公共子串占较短字符串的比例
 */
function calcSimilarity(s1, s2) {
  if (!s1 || !s2) return 0
  if (s1 === s2) return 1

  // 让 s1 是较短的
  if (s1.length > s2.length) {
    const tmp = s1; s1 = s2; s2 = tmp
  }

  const shorter = s1.length
  const longer = s2.length
  if (shorter < MIN_COMMON_LEN) return 0

  // 快速包含判断
  if (s2.includes(s1)) {
    return shorter / longer
  }

  // 最长公共子串
  const lcs = longestCommonSubstring(s1, s2)
  return lcs / shorter
}

/**
 * 判断两个地址是否相似
 */
function isAddressMatch(addr1, addr2) {
  if (!addr1 || !addr2) return false
  if (addr1 === addr2) return true
  if (addr1.length < 6 || addr2.length < 6) return false

  const n1 = normalizeAddress(addr1)
  const n2 = normalizeAddress(addr2)

  if (n1 === n2) return true
  if (n1.length < MIN_COMMON_LEN || n2.length < MIN_COMMON_LEN) return false

  const sim = calcSimilarity(n1, n2)
  return sim >= SIMILARITY_THRESHOLD
}

/**
 * 批量预处理地址列表
 */
function preprocessAddresses(addrs) {
  return addrs.map((addr, index) => ({
    addr,
    norm: normalizeAddress(addr),
    index
  })).filter(x => x.addr && x.addr.length >= 6 && x.norm.length >= MIN_COMMON_LEN)
}

/**
 * 从预处理列表中找出所有匹配目标地址的项
 */
function batchMatchAddress(targetAddr, preprocessed) {
  if (!targetAddr || targetAddr.length < 6) return []
  const target = normalizeAddress(targetAddr)
  if (target.length < MIN_COMMON_LEN) return []

  const matched = []
  for (const item of preprocessed) {
    if (!item.norm || item.norm.length < MIN_COMMON_LEN) continue
    // 快速路径：完全相同或包含
    if (item.norm === target) {
      matched.push(item.index)
      continue
    }
    // 长度差距太大直接跳过（短的/长的 < 70% 不可能命中）
    const minLen = Math.min(item.norm.length, target.length)
    const maxLen = Math.max(item.norm.length, target.length)
    if (minLen / maxLen < SIMILARITY_THRESHOLD) continue

    const sim = calcSimilarity(item.norm, target)
    if (sim >= SIMILARITY_THRESHOLD) {
      matched.push(item.index)
    }
  }
  return matched
}

/**
 * 最长公共子串长度（滚动数组）
 */
function longestCommonSubstring(s1, s2) {
  if (!s1 || !s2) return 0
  if (s1.length > s2.length) {
    const tmp = s1; s1 = s2; s2 = tmp
  }
  const m = s1.length
  const n = s2.length
  let max = 0
  let dp = new Array(n + 1).fill(0)
  for (let i = 1; i <= m; i++) {
    const next = new Array(n + 1).fill(0)
    for (let j = 1; j <= n; j++) {
      if (s1[i - 1] === s2[j - 1]) {
        next[j] = dp[j - 1] + 1
        if (next[j] > max) max = next[j]
      }
    }
    dp = next
  }
  return max
}

module.exports = {
  normalizeAddress,
  isAddressMatch,
  longestCommonSubstring,
  calcSimilarity,
  preprocessAddresses,
  batchMatchAddress
}
