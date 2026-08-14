const jwt = require('jsonwebtoken')

// JWT密钥，生产环境请使用环境变量
const SECRET_KEY = 'zhichacha2026secretkey'

module.exports = (req, res, next) => {
  const authHeader = req.headers.authorization
  if (!authHeader) {
    return res.json({ code: 401, msg: '未登录，请先登录' })
  }

  const token = authHeader.split(' ')[1]
  if (!token) {
    return res.json({ code: 401, msg: 'token无效' })
  }

  try {
    const decoded = jwt.verify(token, SECRET_KEY)
    req.userId = decoded.userId
    next()
  } catch (err) {
    return res.json({ code: 401, msg: '登录已过期，请重新登录' })
  }
}

module.exports.SECRET_KEY = SECRET_KEY
