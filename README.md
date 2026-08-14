# 智查查 - 电商订单风险检测平台（后端）

## 技术栈
- Node.js
- Express
- MySQL 5.7+ / 8.0
- JWT 鉴权
- bcryptjs 密码加密

## 项目结构
```
zhichacha-server/
├── config/
│   └── db.js           # 数据库连接配置
├── middleware/
│   └── auth.js         # JWT 鉴权中间件
├── routes/
│   ├── auth.js         # 登录注册接口
│   ├── shop.js         # 店铺管理接口
│   ├── order.js        # 订单管理接口
│   └── search.js       # 风险检测接口
├── sql/
│   └── init.sql        # 数据库初始化脚本
├── app.js              # 应用入口
├── package.json
└── README.md
```

## 启动步骤

### 1. 安装 MySQL
确保本地已安装 MySQL 5.7 或 8.0，并启动服务。

### 2. 初始化数据库
使用 Navicat、MySQL Workbench 或命令行执行 `sql/init.sql`：
```bash
mysql -u root -p < sql/init.sql
```

### 3. 修改数据库配置
编辑 `config/db.js`，修改为你的 MySQL 账号密码：
```javascript
const pool = mysql.createPool({
  host: '127.0.0.1',
  port: 3306,
  user: 'root',           // 你的MySQL用户名
  password: '123456',     // 你的MySQL密码
  database: 'zhichacha',
  // ...
})
```

### 4. 安装依赖
```bash
cd zhichacha-server
npm install
```

### 5. 启动服务
```bash
# 开发模式（需要 nodemon）
npm run dev

# 生产模式
npm start
```

服务启动后监听端口：**3001**

## API 接口列表

| 方法 | 路径 | 说明 | 鉴权 |
|------|------|------|------|
| POST | /api/auth/register | 用户注册 | 否 |
| POST | /api/auth/login | 用户登录 | 否 |
| GET | /api/shop/list | 获取店铺列表 | 是 |
| POST | /api/shop/add | 新增店铺 | 是 |
| GET | /api/order/list | 获取订单列表 | 是 |
| POST | /api/order/add | 新增订单 | 是 |
| GET | /api/search/riskQuery | 风险检测查询 | 是 |
| GET | /api/health | 健康检查 | 否 |

## 风险检测规则
- **正常**：无匹配订单或订单数较少
- **⚠️ 风险**：同一店铺近14天内下单3次及以上
- **🔴 高危**：同一买家在2个及以上不同店铺下单

## 注意事项
- 确保 MySQL 服务已启动
- 确保端口 3001 未被占用
- 前端项目默认请求地址为 `http://localhost:3001/api`
