const pool = require('../config/db')

/**
 * 管理员权限中间件
 * 必须先经过 auth 中间件，再经过这个
 */
module.exports = async (req, res, next) => {
  try {
    const [users] = await pool.query('SELECT is_admin FROM `user` WHERE id = ?', [req.userId])
    if (users.length === 0) {
      return res.json({ code: 401, msg: '用户不存在' })
    }
    if (users[0].is_admin !== 1) {
      return res.json({ code: 403, msg: '无权限，仅管理员可操作' })
    }
    next()
  } catch (err) {
    console.error('权限校验失败:', err)
    res.json({ code: -1, msg: '权限校验失败' })
  }
}
