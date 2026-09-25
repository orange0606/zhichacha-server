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

    // ========== 1. 账号维度：全库订单统计（含跨店铺金额） ==========
    const accountOrderMap = {}
    if (allAccounts.length > 0) {
      const ph = allAccounts.map(() => '?').join(',')
      const [rows] = await pool.query(
        `SELECT o.order_no, o.buyer_account, o.shop_id, o.shop_name, o.pay_amount, o.order_time, u.username AS owner_account
         FROM \`order\` o
         LEFT JOIN \`shop\` s ON o.shop_id = s.shop_id
         LEFT JOIN \`user\` u ON s.user_id = u.id
         WHERE o.buyer_account IN (${ph}) ORDER BY o.order_time DESC`,
        allAccounts
      )
      rows.forEach(r => {
        if (!accountOrderMap[r.buyer_account]) {
          accountOrderMap[r.buyer_account] = { shopIds: new Set(), shopOrderMap: {} }
        }
        const sid = String(r.shop_id)
        accountOrderMap[r.buyer_account].shopIds.add(sid)
        // 按店铺分组记录订单金额和时间（已按时间倒序）
        if (r.pay_amount != null) {
          if (!accountOrderMap[r.buyer_account].shopOrderMap[sid]) {
            accountOrderMap[r.buyer_account].shopOrderMap[sid] = []
          }
          accountOrderMap[r.buyer_account].shopOrderMap[sid].push({
            orderNo: r.order_no,
            ownerAccount: r.owner_account || '',
            amount: Number(r.pay_amount),
            time: r.order_time ? new Date(r.order_time).toLocaleString('zh-CN', { hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }) : ''
          })
        }
      })
    }

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
          const matchedAddrs = matchedIndexes.map(i => allOrderAddrRows[i].buyer_address)
          addressOrderMap[addr] = { shopIds, matchedAddrs }
        }
      }
    }

    // ========== 3. 账号被举报次数（排除已撤销的） ==========
    const accountReportMap = {}
    if (allAccounts.length > 0) {
      const ph = allAccounts.map(() => '?').join(',')
      const [rows] = await pool.query(
        `SELECT buyer_account, COUNT(*) as cnt FROM report WHERE buyer_account IN (${ph}) AND status = 1 GROUP BY buyer_account`,
        allAccounts
      )
      rows.forEach(r => { accountReportMap[r.buyer_account] = r.cnt })
    }

    // ========== 4. 地址被举报次数（智能模糊匹配，排除已撤销的） ==========
    const addressReportMap = {}
    const similarReportMap = {}
    if (allAddresses.length > 0) {
      const [allReportRows] = await pool.query(
        `SELECT DISTINCT receiver_address FROM report
         WHERE receiver_address IS NOT NULL AND CHAR_LENGTH(receiver_address) >= 6
           AND receiver_address NOT LIKE '%*%' AND status = 1 LIMIT 5000`
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
      const addrStat = addressOrderMap[buyerAddress]
      // 提取跨店铺（非当前店铺）的订单，最多前5个
      // 提取跨店铺（非当前店铺）订单：账号维度 + 地址维度都要，合并去重最多5条
      const crossOrderSet = new Set();
      const crossOrderList = [];
      const pushCrossOrders = (stat) => {
        if (!stat || !stat.shopOrderMap) return;
        for (const [sid, orderList] of Object.entries(stat.shopOrderMap)) {
          if (sid !== myShopId) {
            orderList.forEach(o => {
              if (!crossOrderSet.has(o.orderNo)) { crossOrderSet.add(o.orderNo); crossOrderList.push(o); }
            });
          }
        }
      };
      pushCrossOrders(accStat);
      pushCrossOrders(addrStat);
      const crossShopOrders = crossOrderList.slice(0, 5);

      if (crossShopCount >= 2) {
        tags.push(`全库跨${crossShopCount}家店铺(账号)`)
        if (riskLevel === 'none') riskLevel = 'medium'
      }

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
        crossShopOrders,
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


    // ========== 7. 地址跨店：按需查询跨店订单详情（仅命中地址，最近90天） ==========
    const addrCrossResults = results.filter(r => r.addressCrossShopCount >= 2)
    if (addrCrossResults.length > 0) {
      const addrMap = {}
      for (const r of addrCrossResults) {
        const stat = addressOrderMap[r.buyerAddress]
        if (stat && stat.matchedAddrs) {
          stat.matchedAddrs.forEach(a => { addrMap[a] = true })
        }
      }
      const addrList = Object.keys(addrMap)
      if (addrList.length > 0) {
        const ph = addrList.map(() => '?').join(',')
        const [addrOrderRows] = await pool.query(
          `SELECT o.order_no, o.buyer_address, o.shop_id, o.pay_amount, o.order_time, u.username AS owner_account
           FROM \`order\` o
           LEFT JOIN \`shop\` s ON o.shop_id = s.shop_id
           LEFT JOIN \`user\` u ON s.user_id = u.id
           WHERE o.buyer_address IN (${ph})
             AND o.order_time >= DATE_SUB(NOW(), INTERVAL 90 DAY)
           ORDER BY o.order_time DESC`,
          addrList
        )
        const addrOrderGroup = {}
        addrOrderRows.forEach(r => {
          if (!addrOrderGroup[r.buyer_address]) addrOrderGroup[r.buyer_address] = []
          addrOrderGroup[r.buyer_address].push({
            orderNo: r.order_no,
            ownerAccount: r.owner_account || '',
            amount: Number(r.pay_amount),
            time: r.order_time ? new Date(r.order_time).toLocaleString('zh-CN', { hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }) : ''
          })
        })
        for (const r of addrCrossResults) {
          const stat = addressOrderMap[r.buyerAddress]
          if (!stat || !stat.matchedAddrs) continue
          const existSet = new Set(r.crossShopOrders.map(o => o.orderNo))
          const merged = [...r.crossShopOrders]
          for (const ma of stat.matchedAddrs) {
            (addrOrderGroup[ma] || []).forEach(o => {
              if (String(o.orderNo) !== String(r.orderNo) && !existSet.has(o.orderNo) && merged.length < 5) {
                existSet.add(o.orderNo)
                merged.push(o)
              }
            })
          }
          r.crossShopOrders = merged.slice(0, 5)
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
