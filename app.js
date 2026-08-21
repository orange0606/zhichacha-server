const express = require('express')
const cors = require('cors')
const path = require('path')
const app = express()

// 中间件
app.use(cors())
// app.use(express.json())
// app.use(express.urlencoded({ extended: true }))
// 把 JSON 请求体上限放宽到 10MB，批量导入订单完全够用
app.use(express.json({ limit: '10mb' }))
// 如果有表单提交，urlencoded 也可以同步加大
app.use(express.urlencoded({ extended: true, limit: '10mb' }))

// 静态文件服务 - 插件下载文件
app.use('/uploads', express.static(path.join(__dirname, 'uploads')))

// 健康检查接口
app.get('/api/health', (req, res) => {
  res.status(200).json({ code: 0, msg: 'ok', time: Date.now() })
})

// 路由注册
app.use('/api/auth', require('./routes/auth'))
app.use('/api/shop', require('./routes/shop'))
app.use('/api/order', require('./routes/order'))
app.use('/api/search', require('./routes/search'))
app.use('/api/report', require('./routes/report'))
app.use('/api/dashboard', require('./routes/dashboard'))
app.use('/api/risk', require('./routes/risk'))
app.use('/api/extension', require('./routes/extension'))

// 错误处理中间件
app.use((err, req, res, next) => {
  console.error('服务器错误:', err)
  res.status(500).json({ code: -1, msg: '服务器内部错误' })
})

const PORT = process.env.PORT || 3001
app.listen(PORT, () => {
  console.log(`智查查后端服务已启动: http://localhost:${PORT}`)
})
