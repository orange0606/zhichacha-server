const mysql = require('mysql2/promise')

// 数据库连接池配置
// 请根据你的MySQL环境修改以下配置
const pool = mysql.createPool({
  host: '127.0.0.1',
  port: 3306,
  user: 'root',           // 修改为你的MySQL用户名
  password: '015118208876',     // 修改为你的MySQL密码
  database: 'zhichacha',  // 数据库名
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  charset: 'utf8mb4'
})

module.exports = pool
