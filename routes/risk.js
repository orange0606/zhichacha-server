const express = require('express')
const router = express.Router()
const pool = require('../config/db')
const auth = require('../middleware/auth')
const { preprocessAddresses, batchMatchAddress } = require('../utils/addressMatcher')

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
        `SELECT DISTINCT buyer_address, shop_id FROM \`order\`
         WHERE buyer_address IS NOT NULL AND CHAR_LENGTH(buyer_address) >= 6
           AND buyer_address NOT LIKE '%*%'`
      )
      const preprocessed = preprocessAddresses(allOrderAddrRows.map(r => r.buyer_address))
      for (const addr of allAddresses) {
        if (!addr || addr.length < 6) continue
        const matchedIndexes = batchMatchAddress(addr, preprocessed)
        if (matchedIndexes.length > 0) {
          const shopIds = new Set()
          matchedIndexes.forEach(i => shopIds.add(String(allOrderAddrRows[i].shop_id)))
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
      const [allReportRows] = await pool.query(
        `SELECT DISTINCT receiver_address FROM report
         WHERE receiver_address IS NOT NULL AND CHAR_LENGTH(receiver_address) >= 6
           AND receiver_address NOT LIKE '%*%' LIMIT 5000`
      )
      const allReportAddrs = allReportRows.map(r => r.receiver_address)
      const preprocessed = preprocessAddresses(allReportAddrs)

      for (const addr of allAddresses) {
        if (!addr || addr.length < 6) continue
        const matchedIndexes = batchMatchAddress(addr, preprocessed)
        if (matchedIndexes.length > 0) {
          const matchedAddrs = matchedIndexes.map(i => allReportAddrs[i])
          const exactCnt = matchedAddrs.filter(a => a === addr).length
          const similar = [...new Set(matchedAddrs.filter(a => a !== addr))].slice(0, 5)
          if (exactCnt > 0) addressReportMap[addr] = exactCnt
          if (similar.length > 0) similarReportMap[addr] = similar
        }
      }
    }

    // ========== 5. 逐个计算风险 ==========
    const results = list.map(item => {
      const { shopId, buyerAccount, buyerAddress, orderNo } = item
      const myShopId = String(shopId || '')

      const tags = []
      let riskLevel = 'none'

      const accReportCount = accountReportMap[buyerAccount] || 0
      if (accReportCount > 0) {
        tags.push(`账号被举报${accReportCount}次`)
        riskLevel = 'high'
      }

      const addrReportCount = addressReportMap[buyerAddress] || 0
      if (addrReportCount > 0) {
        tags.push(`地址被举报${addrReportCount}次`)
        riskLevel = 'high'
      }

      const similarAddrs = similarReportMap[buyerAddress] || []
      const similarity = similarAddrs.length > 0
        ? Math.min(95, 70 + similarAddrs.length * 10)
        : (addrReportCount > 0 ? 100 : 0)
      if (similarAddrs.length > 0) {
        tags.push(`发现${similarAddrs.length}个相似地址被举报`)
        if (riskLevel === 'none') riskLevel = 'high'
      }

      const accStat = accountOrderMap[buyerAccount]
      const crossShopCount = accStat ? accStat.shopIds.size : 1
      if (crossShopCount >= 2) {
        tags.push(`全库跨${crossShopCount}家店铺(账号)`)
        if (riskLevel === 'none') riskLevel = 'medium'
      }

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

    // ========== 6. 同店铺多单（低风险，批量查询避免N+1） ==========
    const needCheck = results.filter(r => r.riskLevel === 'none' && r.shopId && r.buyerAccount)
    if (needCheck.length > 0) {
      // 按 shopId + buyerAccount 分组批量查
      const conditions = []
      const params = []
      for (const r of needCheck) {
        conditions.push('(shop_id = ? AND buyer_account = ?)')
        params.push(r.shopId, r.buyerAccount)
      }
      const [cntRows] = await pool.query(
        `SELECT shop_id, buyer_account, COUNT(*) as cnt FROM \`order\`
         WHERE ${conditions.join(' OR ')}
         GROUP BY shop_id, buyer_account`,
        params
      )
      const cntMap = {}
      cntRows.forEach(r => { cntMap[`${r.shop_id}_${r.buyer_account}`] = r.cnt })
      for (const r of needCheck) {
        const sameCnt = cntMap[`${r.shopId}_${r.buyerAccount}`] || 0
        if (sameCnt >= 2) {
          r.tags.push(`同店铺下单${sameCnt}次`)
          r.riskLevel = 'low'
          r.riskLevelText = '低风险'
        }
      }
    }

    res.json({ code: 0, data: results })
  } catch (err) {
    console.error('批量风险匹配错误：', err)
    res.json({ code: -1, msg: '检测失败：' + err.message })
  }
})

module.exports = router
