const express = require('express')
const router = express.Router()
const pool = require('../config/db')
const auth = require('../middleware/auth')
const { isAddressMatch } = require('../utils/addressMatcher')

/**
 * 批量风险匹配接口
 * POST /api/risk/batchMatch
 * 入参：{ list: [{ orderNo, shopId, buyerAccount, buyerAddress }] }
 */
router.post('/batchMatch', auth, async (req, res) => {
  try {
    const { list } = req.body
    if (!Array.isArray(list) || list.length === 0) {
      return res.json({ code: -1, msg: '请传入要检测的列表' })
    }

    // 收集所有账号和地址（去重）
    const allAccounts = [...new Set(list.map(i => i.buyerAccount).filter(Boolean))]
    const allAddresses = [...new Set(list.map(i => i.buyerAddress).filter(Boolean))]

    // ========== 1. 账号维度：全库订单统计 ==========
    const accountOrderMap = {}
    if (allAccounts.length > 0) {
      const ph = allAccounts.map(() => '?').join(',')
      const [rows] = await pool.query(
        `SELECT buyer_account, shop_id FROM \`order\` WHERE buyer_account IN (${ph})`,
        allAccounts
      )
      rows.forEach(r => {
        if (!accountOrderMap[r.buyer_account]) {
          accountOrderMap[r.buyer_account] = { shopIds: new Set() }
        }
        accountOrderMap[r.buyer_account].shopIds.add(String(r.shop_id))
      })
    }

    // ========== 2. 地址维度：全库订单统计（智能模糊匹配） ==========
    const addressOrderMap = {}
    if (allAddresses.length > 0) {
      const [allOrderAddrRows] = await pool.query(
        `SELECT DISTINCT buyer_address, shop_id FROM \`order\` WHERE buyer_address IS NOT NULL AND CHAR_LENGTH(buyer_address) >= 6 AND buyer_address NOT LIKE '%*%'`
      )
      for (const addr of allAddresses) {
        if (!addr || addr.length < 6) continue
        const shopIds = new Set()
        allOrderAddrRows.forEach(r => {
          if (!r.buyer_address) return
          if (isAddressMatch(addr, r.buyer_address)) {
            shopIds.add(String(r.shop_id))
          }
        })
        if (shopIds.size > 0) {
          addressOrderMap[addr] = { shopIds }
        }
      }
    }

    // ========== 3. 账号被举报次数 ==========
    const accountReportMap = {}
    if (allAccounts.length > 0) {
      const ph = allAccounts.map(() => '?').join(',')
      const [rows] = await pool.query(
        `SELECT buyer_account, COUNT(*) as cnt FROM report WHERE buyer_account IN (${ph}) GROUP BY buyer_account`,
        allAccounts
      )
      rows.forEach(r => { accountReportMap[r.buyer_account] = r.cnt })
    }

    // ========== 4. 地址被举报次数（智能模糊匹配） ==========
    const addressReportMap = {}
    const similarReportMap = {}
    if (allAddresses.length > 0) {
      // 取出所有举报地址
      const [allReportRows] = await pool.query(
        `SELECT DISTINCT receiver_address FROM report WHERE receiver_address IS NOT NULL AND CHAR_LENGTH(receiver_address) >= 6 AND receiver_address NOT LIKE '%*%' LIMIT 2000`
      )
      const allReportAddrs = allReportRows.map(r => r.receiver_address)

      for (const addr of allAddresses) {
        if (!addr || addr.length < 6) continue
        // 精确匹配
        let exactCnt = 0
        const similar = []
        allReportAddrs.forEach(rAddr => {
          if (!rAddr || rAddr.length < 6) return
          if (rAddr === addr) {
            exactCnt++
          } else if (isAddressMatch(addr, rAddr)) {
            similar.push(rAddr)
          }
        })
        if (exactCnt > 0) {
          addressReportMap[addr] = exactCnt
        }
        if (similar.length > 0) {
          similarReportMap[addr] = [...new Set(similar)].slice(0, 5)
        }
      }
    }

    // ========== 5. 逐个计算风险 ==========
    const results = list.map(item => {
      const { shopId, buyerAccount, buyerAddress, orderNo } = item
      const myShopId = String(shopId || '')

      const tags = []
      let riskLevel = 'none'

      // 账号举报
      const accReportCount = accountReportMap[buyerAccount] || 0
      if (accReportCount > 0) {
        tags.push(`账号被举报${accReportCount}次`)
        riskLevel = 'high'
      }

      // 地址精确举报
      const addrReportCount = addressReportMap[buyerAddress] || 0
      if (addrReportCount > 0) {
        tags.push(`地址被举报${addrReportCount}次`)
        riskLevel = 'high'
      }

      // 地址相似举报
      const similarAddrs = similarReportMap[buyerAddress] || []
      const similarity = similarAddrs.length > 0
        ? Math.min(95, 70 + similarAddrs.length * 10)
        : (addrReportCount > 0 ? 100 : 0)
      if (similarAddrs.length > 0) {
        tags.push(`发现${similarAddrs.length}个相似地址被举报`)
        if (riskLevel === 'none') riskLevel = 'high'
      }

      // 账号跨店
      const accStat = accountOrderMap[buyerAccount]
      const crossShopCount = accStat ? accStat.shopIds.size : 1
      if (crossShopCount >= 2) {
        tags.push(`全库跨${crossShopCount}家店铺(账号)`)
        if (riskLevel === 'none') riskLevel = 'medium'
      }

      // 地址跨店
      const addrStat = addressOrderMap[buyerAddress]
      const addrCrossShopCount = addrStat ? addrStat.shopIds.size : 1
      if (addrCrossShopCount >= 2) {
        tags.push(`全库跨${addrCrossShopCount}家店铺(地址)`)
        if (riskLevel === 'none') riskLevel = 'medium'
      }

      const levelTextMap = { high: '高风险', medium: '中风险', low: '低风险', none: '安全' }

      return {
        orderNo,
        shopId,
        buyerAccount,
        buyerAddress,
        riskLevel,
        riskLevelText: levelTextMap[riskLevel],
        accountReportCount: accReportCount,
        addressReportCount: addrReportCount,
        crossShopCount,
        addressCrossShopCount: addrCrossShopCount,
        addressSimilarity: similarity,
        similarAddresses: similarAddrs,
        tags
      }
    })

    // ========== 6. 同店铺多单（低风险） ==========
    for (const r of results) {
      if (r.riskLevel !== 'none') continue
      if (!r.shopId || !r.buyerAccount) continue
      const [cntRows] = await pool.query(
        `SELECT COUNT(*) as cnt FROM \`order\` WHERE shop_id = ? AND buyer_account = ?`,
        [r.shopId, r.buyerAccount]
      )
      const sameCnt = cntRows[0].cnt || 0
      if (sameCnt >= 2) {
        r.tags.push(`同店铺下单${sameCnt}次`)
        r.riskLevel = 'low'
        r.riskLevelText = '低风险'
      }
    }

    res.json({ code: 0, data: results })
  } catch (err) {
    console.error('批量风险匹配错误：', err)
    res.json({ code: -1, msg: '检测失败：' + err.message })
  }
})

module.exports = router
