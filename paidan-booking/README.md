# paidan-booking · 漫展/约拍排单预约系统

一个部署在 Cloudflare Workers 上的轻量排单系统：**客妹在前端表单填写预约信息，后端自动排单**——按日期和时段自动占用、锁定冲突时段，摄影师在管理后台查看、登记收款、切换场次。无服务器、无数据库，一个 Worker + 一个 KV 搞定，**免费套餐即可跑**。

## 功能

**前台（客人）**
- 按日期 + 30 分钟时段预约，已被约的时段自动锁定（并发冲突返回 409）
- 提交手机号/角色/备注，支持上传参考图
- 「查看我的预约」：手机号或订单号查询、取消（取消后时段释放）
- 日期/时段/标题从服务端「当前届」动态拉取——换届时客人链接不用变

**后台（摄影师）** `/admin?key=你的key`
- 多届（场次）管理：新开一届自动归档旧届，历史届只读回看
- 届切换侧边栏（桌面）/胶囊（移动端），过期届自动标记归档
- 统计卡：总单数、已支付/未支付金额
- 点时段直接登记预约或释放；支付状态与金额手动登记
- 全部订单表：来源（线上/手动）、支付标记、筛选

## 部署

1. 建 KV namespace（如 `paidan-orders`）
2. 把 `worker.js` 中 `REPLACE_ADMIN_KEY` 换成你自己的管理密钥
3. 部署 Worker（绑定 KV），三个文件的关系：
   - `worker.js` — Worker 源码（路由 + API + KV 读写），`index.html`/`admin.html` 以 import 形式引入
   - `index.html` — 前台页面
   - `admin.html` — 管理后台页面
4. 绑定自定义域或用 workers.dev 访问

> 也可以把两个 HTML 内嵌进 Worker 脚本字符串单文件部署（本项目生产即此方式），见 wrangler 或 API 文档。

## 数据结构（KV）

- `events` — 届索引 `[{id,name,dates,slots,status,price}]`
- `e:<eventId>/orders|booked|config|o:<orderId>` — 各届数据
- v1 全局键首次访问自动迁移为多届结构

## License

MIT
