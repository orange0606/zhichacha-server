/**
 * 地址标准化 + 模糊匹配工具
 * 用于解决地址写法不一致（省市区县镇前缀、特殊符号、详略不同）导致的匹配失败
 */

// 行政区划词（用于标准化时去掉）
const REGION_WORDS = [
  '壮族自治区', '回族自治区', '维吾尔自治区', '自治区',
  '省', '市', '区', '县', '镇', '乡', '街道', '村', '社区',
  '盟', '州', '旗', '苏木', '嘎查',
  '特别行政区', '自治县', '自治州', '自治旗'
]

// 特殊字符和无关符号
const SPECIAL_CHARS = /[-\s\[\]()（）【】「」『』《》<>、，,。.；;:：!！?？"'`~@#$%^&*_+=|\\/]/g

/**
 * 标准化地址：去掉特殊符号、行政区划词
 */
function normalizeAddress(addr) {
  if (!addr) return ''
  let s = String(addr).trim()
  // 去掉特殊字符
  s = s.replace(SPECIAL_CHARS, '')
  // 去掉行政区划词（按长度从长到短替换）
  const sortedWords = [...REGION_WORDS].sort((a, b) => b.length - a.length)
  for (const w of sortedWords) {
    s = s.split(w).join('')
  }
  return s
}

/**
 * 判断两个地址是否相似
 * 规则：完全相同 / 标准化后互相包含 / 有>=10字公共子串
 */
function isAddressMatch(addr1, addr2) {
  if (!addr1 || !addr2) return false
  if (addr1 === addr2) return true
  if (addr1.length < 6 || addr2.length < 6) return false

  const n1 = normalizeAddress(addr1)
  const n2 = normalizeAddress(addr2)

  if (n1 === n2) return true
  if (n1.includes(n2) || n2.includes(n1)) return true

  // 最长公共子串 >= 10 字
  const lcs = longestCommonSubstring(n1, n2)
  if (lcs >= 10) return true

  return false
}

/**
 * 最长公共子串长度
 */
function longestCommonSubstring(s1, s2) {
  if (!s1 || !s2) return 0
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
  longestCommonSubstring
}
