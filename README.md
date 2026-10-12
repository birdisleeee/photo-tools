# photo-tools · 摄影相关小工具合集

个人摄影师工作流里的小软件集合，每个子目录一个独立小项目，可单独使用。

## 项目列表

| 目录 | 说明 | 技术 |
|---|---|---|
| [paidan-booking](./paidan-booking) | 漫展/约拍排单预约系统：前台预约 + 管理后台，多场次（届）管理、时段预约、支付登记、手机/订单号查询与取消 | Cloudflare Workers + KV，纯前端无框架 |

## 使用方式

每个子项目看各自目录下的 README。通用约定：免费部署在 Cloudflare Workers 免费套餐上，只需要一个 Worker + 一个 KV namespace。

## License

MIT
