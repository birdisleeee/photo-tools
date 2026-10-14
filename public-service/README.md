# 公共托管版 · 申请注册后使用

[简体中文](#简体中文) · [English](#english)

## 简体中文

公共版提供独立后台：下载安装安卓 APK 或打开网页，申请摄影师账号，运营者审核并分配额度后即可创建拍摄活动和分享预约链接。客人打开对应摄影师的链接填写，系统自动占用时段、同步订单；客人不需要注册摄影师账号或安装 APK。

公共服务入口：<https://photo-booking-public.nyachu-paidan.workers.dev/app>。

[下载安卓 APK](https://photo-booking-public.nyachu-paidan.workers.dev/download/app.apk) · [安卓源码与构建说明](../android-app/README.md)

### 使用流程

1. 在申请页设置账号名、密码，填写审核联系方式和用途。密码至少 12 位。
2. 注册后是“待审核”，所有配额为 0，不能创建场次或开放预约。
3. 运营者审核后明确分配场次、预约记录、存储、通知和每日接口请求额度。批准账号数也受运营者设置的总上限控制。
4. 登录账户页，进入自己的排单后台，创建并发布第一届。
5. 复制或通过 APK 分享自己的预约链接，发给客人填写。其他摄影师的资料和订单不会混入。
6. 增加额度时填写期望的**新总额度**及原因，等待运营者批准；提交申请不代表生效。

目前小规模开放，是否批准和具体额度以运营者审核为准。公共服务需要联网，没有离线提交、自动核款或 Android 系统推送功能；提醒仍使用后台已配置的 Webhook、企业微信、飞书、Telegram 或邮件。公共账号自己的通知配置不使用作者的通知账号。

场次包含归档；预约记录包含取消；通知每次发送尝试都计数，包括测试和失败重试。每日请求在 UTC 午夜重置（北京时间 08:00），这是已批准的每日上限，不会自动增加总额度。后台仅在前台每 2 分钟刷新；提交时始终由服务端检查实际占用。

### 运营者管理

运营入口为同域名 `/owner`。使用与任何私人站点不同的 `OWNER_KEY` 登录，审核账号、设置服务总上限、批准或暂停账号。默认配置下注册关闭且可分配额度为 0；部署者须明确设置后开放。

建议首批范围可以是最多批准 3 个账号，每人 20 届、200 条预约、100 MiB 存储及 600 次通知尝试。界面的“首批建议额度”只是填入表单，仍须运营者二次确认，并受总额度约束；不会根据注册自动赠送。

停用账号会停止访问与后续通知，但保留订单资料；历史已分配容量仍纳入总额度。存储配额包含记录、审计和图片的逻辑负载，以及队列预留量，平台实际物理存储还有索引、页和元数据开销。不能把应用显示的逻辑用量当成精确的 Cloudflare 账单数据。

代码、运营密钥、内部密钥、KV 和两类 DO 都必须与私人排单服务分开。使用同一个平台账号时，**账号级平台额度仍共享**；应用限流不会阻止已被拒绝的请求消耗 Worker 调用，也不保证抗大规模攻击。容量分配不能替代平台实用量监测。

### 自行部署公共服务

本目录是新的多账号入口，原 [`paidan-booking`](../paidan-booking) 仍提供单实例自部署版。不要用本目录的绑定和迁移覆盖原应用。

1. 用自己的 Cloudflare 账号，在本目录执行 `npx wrangler@4 login`。
2. 创建**新的** KV：`npx wrangler@4 kv namespace create PUBLIC_META`，替换 `wrangler.jsonc` 的占位 ID。
3. 检查应用名没有与现有应用冲突，限流 `namespace_id` 没有与其他应用共用。保留 `Registry`、`TenantStore` 的新 SQLite DO 声明。
4. 执行 `npx wrangler@4 deploy`，然后分别执行 `npx wrangler@4 secret put OWNER_KEY` 和 `npx wrangler@4 secret put INTERNAL_KEY`，设置两个不同的随机秘密值。
5. 打开 `/owner`，明确设置是否开放申请、账号上限和所有可分配的总额度，再确认保存。
6. 按自己的网址构建 APK，并将签名安装包写入自己的 `PUBLIC_META` 的 `android:apk` 键。也可只提供网页。

`PUBLIC_META` 只存安装包及版本元信息。账号与限流状态位于 `Registry`，每个摄影师的数据和通知队列位于以账号 ID 命名的 `TenantStore`，不从原站点或旧 KV 迁移数据。

### 免费计划与维护

以 [Workers](https://developers.cloudflare.com/workers/platform/limits/)、[SQLite DO](https://developers.cloudflare.com/durable-objects/platform/pricing/) 和 [KV](https://developers.cloudflare.com/kv/platform/pricing/) 官方额度为准，注意同账号多个应用共用账号级上限。SQLite DO 既计请求/运行时长，也计读取和写入行；KV 方法及 alarm 也会消耗存储操作额度。免费计划超额可能导致请求或写入失败，应用不自动升级付费计划。

检查注册队列、已分配总额度、实际存储、错误和平台调用用量，再决定是否接收更多账号或增加容量。部署升级保留该公共应用的绑定与迁移版本，备份账号及各租户状态。APK 的签名密钥单独保管，后续更新必须使用相同签名；丢失后不能直接覆盖升级已安装的应用。

## English

The hosted service lets photographers install the Android APK or open the website, apply for an account, and use their own booking dashboard **after operator approval and explicit quota allocation**. Clients submit bookings through that photographer's link without installing the app or creating a photographer account.

[Hosted application](https://photo-booking-public.nyachu-paidan.workers.dev/app) · [Android APK](https://photo-booking-public.nyachu-paidan.workers.dev/download/app.apk)

New accounts are pending with zero quotas. Operators manually approve accounts and allocate event, booking-record, storage, notification-attempt, and daily-request limits. Requests for additional capacity never take effect automatically. Each photographer's data is isolated in a separate Durable Object; the public deployment has its own application, KV, DO namespaces, and secrets. Account-level platform allowances are still shared if it uses the same Cloudflare account as another application.

Internet access is required. The APK does not provide offline submission or native push notifications; configured server-side notification channels remain responsible for alerts. The UI and detailed operating guide above are in Chinese. Self-hosters can continue using the independent [`paidan-booking`](../paidan-booking) version with their own resources.

MIT License
