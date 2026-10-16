# 拍摄排单 · 摄影预约与自助排单工具

[简体中文](#简体中文) · [English](#english)

## 简体中文

一个给漫展摄影、Cosplay 约拍使用的**开源自助预约与自动排单工具**。客妹在前端表格里选择日期和空闲时段，填写 CN、手机号、角色和备注，提交后自动登记预约并占用时段、拿到订单号。摄影师打开管理后台，就能按时间查看当天安排、补充备注和登记收款。

适用于摄影预约、漫展排单、约拍排期和多届活动管理。自动排单按客人选择的可用时段登记，不会自动挪动已有预约。

可以部署成网页，客人点开链接就能填写，手机和电脑都能用。

首次部署是空白界面：没有预置漫展、历史存档、订单或收款记录，也没有预填的拍摄日期、单价和联系方式。使用者在后台设置并发布自己的第一届后，前台才开放预约。

## 怎么用

1. 摄影师在后台“新开一届”，设置名称、日期、时段、单价、拍摄须知和联系方式。
2. 先看客人页面预览，确认后发布。预约链接保持不变，内容切换到新一届。
3. 把预约链接发给客妹。提交后自动占用时段，同时预约同一时段时只接受一单；网络重试不会重复生成订单。
4. 在时间表查看拍摄安排，点击卡片编辑信息，或从付款胶囊登记收款。
5. 拍摄结束后可以手动归档。原订单、备注和收款记录继续保留；新开一届也会自动归档上一届。

## 客人页面

- 选择拍摄日期和可用时段，填写 CN、手机号、角色和备注。
- 上传参考图，查看本届拍摄须知。
- 用 CN 注册并登录客人账号；在「我的预约」查看本人历届、已取消及已归档的预约，按场次筛选。
- CN 和电话按账号保存，换设备登录或再填一单可自动预填。
- 预约列表采用紧凑表格，点击整行打开详情；取消和付款通知均需再次确认。
- 提交后可复制订单号、保存预约截图；忘记密码可用注册时自行保存的一次性恢复码重设。
- 关联旧预约默认搜索全部场次，CN 必填，手机号和订单号选填。勾选并二次确认即可关联；已关联结果置灰。仅凭 CN 关联只展示场次、CN、角色；提供匹配的原手机号或订单号可获得正常预约权限。摄影师也可在后台列表批量勾选记录，搜索客人的注册用户名，二次确认后直接指定关联账号；旧表格没有手机号也能处理，不改排期。
- 查看摄影师联系与付款说明，付款后发送通知，等待摄影师核对。

客人端为铺满窗口的布局，电脑侧栏左下显示头像、登录状态和账号名，手机侧栏为抽屉。客人预约表格与摄影师的每日拍摄时间表相互独立。

## 管理后台

- 按“年份 → 届次”整理，显示本浏览器尚未查看的新订单数。
- 按天查看时间表，日期用不同颜色区分；手机侧栏采用汉堡抽屉。
- 统一显示“有效预约 / 已支付 / 未支付”。点击进入对应列表，再按日期、关键词和付款类型筛选，已支付包含免单。
- 正常单价、免单、优惠价三选一；优惠需填写原因，可上传图片凭证。支持已付定金、未付款和已付款标注。
- 单价集中设置；调整单价不会改写已经登记的收款金额。
- 「设置」中可开启消息值守：新预约、取消预约、客人付款通知自动提醒。支持通用 Webhook、企业微信、飞书、Telegram 和邮件（通过 Resend 发信），由使用者配置自己的渠道，关闭网页也能继续运行。默认关闭，详见 [值守设置](./WATCHER.md)。
- 记录编辑、收款、归档、新开一届都在确认后保存。
- 归档停止接收新预约，仍可修改备注、单价和收款。历史表格记录使用相同的统计与列表。

这只是预约和收款**记录**工具，不连接支付渠道、不扣款，也不会根据客人点击“已确认”自动认定到账。

全部订单右上角点击「关联」才进入勾选模式，按钮变为「取消／确认」。已支付、未支付列表的勾选用于批量修改付款状态，支持已付款、未付款、定金和免单；保存前逐单展示金额并二次确认。已有金额、优惠原因与凭证默认保留；缺金额的旧记录需先补充核对，已取消订单不可处理。每批最多50条，有记录冲突时整批不保存，网络重试不会重复登记。

## 后台值守与邮件通知

在「设置 → 脚本值守」中选择通知渠道，填写自己的接收配置并确认保存。新预约、取消预约、客人付款通知会由服务端自动发送，关闭管理网页后仍会继续运行。发送失败会有限重试，也可以通过「测试通知」检查配置。

可选渠道包括 **通用 Webhook、企业微信、飞书、Telegram、邮件**，当前每个实例使用一个渠道。邮件通过 Resend 发信，需要 API Key、已验证域名下的发件地址和收件邮箱；QQ、163、Gmail 等邮箱可作为收件地址，不使用邮箱登录密码或 SMTP 授权码发信。

值守默认关闭，不附带任何人的接收地址或密钥。现有测试覆盖模拟发送、失败重试及电脑/手机操作；实际收信需配置自己的渠道后验证。测试邮件提示“服务已接受”不代表已经送达，请检查收件箱、垃圾邮件或发信服务记录。

字段填写方式和测试步骤见 [值守与邮件设置](./WATCHER.md)。

如果有自己的 Agent，可让它先询问通知目标和提醒范围，再协助配置现成渠道，或自行编写 Webhook 接收服务、定时查询脚本。详见 [给 Agent 的接入说明](./AGENT_SETUP.md)，其中包含接口、持久化去重、测试及避免重复通知的约定。

## 安装说明书

想直接使用而不自行部署，可以 [申请公共服务账号](https://public-paidan.nyachu.site/app)，或 [下载安卓 APK](https://public-paidan.nyachu.site/download/app.apk)。必须等待运营者审核注册并分配额度，之后增加额度也需申请。公共版使用独立后台，详情见 [公共托管说明](../public-service/README.md)；本目录的自部署版仍从空白实例开始，使用自己的资源。

| 使用方式 | 说明 |
| --- | --- |
| [没有 AI Agent：手动安装](./DEPLOYMENT.md) | 从下载代码、安装工具到首次部署、创建第一届和通知测试，逐步操作 |
| [有 AI Agent：协助安装与配置](./AGENT_SETUP.md) | 可复制的任务提示词、使用者准备事项、Agent 执行步骤和验收方式 |

新版同时需要管理员密钥 ADMIN_KEY、客人账号密钥 CUSTOMER_SECRET 和示例配置中的六个限流绑定；升级时保留原存储、迁移声明和已有密钥。详见 [安装与升级](./DEPLOYMENT.md)。

AI Agent 是可选助手。安装完成后，不需要 Agent 持续在线；双击 HTML 或只开启 GitHub Pages 则不能运行完整后端。

## 部署为网页

需要一个能够运行后端接口、保存预约数据的平台，不能只把 HTML 放到静态托管上。前端是普通 HTML、CSS 和 JavaScript，可以按自己的环境调整后端适配。

仓库附带一种部署示例：使用 Cloudflare Workers 提供网页和接口，用持久化对象串行处理预约和修改，KV 作为旧版数据兼容来源。也可以移植到自己的服务器和数据库；无论采用什么平台，都应保留同一时段防重复预约、请求重试去重和管理权限验证。

具体步骤见 [部署示例](./DEPLOYMENT.md)。

## 本地验证

需要 Node.js 20 或更新版本。在 `paidan-booking` 目录运行：

```sh
node tests/fresh-install.test.cjs
node tests/customer.test.cjs
```

测试只使用内存中的虚构记录，不连接已部署服务、不发送通知，也不会把测试数据写入新安装的实例。

## 文件

| 文件 | 内容 |
| --- | --- |
| index.html | 客人预约页面 |
| admin.html | 摄影师管理后台 |
| worker.js | 网页与接口入口 |
| customer-accounts.js | 客人账号、本人预约及账号预填 |
| private-security.js | 管理会话、入口防刷、来源与请求体校验 |
| backend.js | 发布、编辑、收款和并发保存逻辑 |
| watch-runtime.js | 后台通知队列、重试、可选通知渠道及设置接口 |
| wrangler.jsonc | 可选部署示例配置 |

仓库已脱敏，联系方式均为占位内容，不附带真实订单、付款凭证、管理密钥或生产账号配置。使用前请设置自己的管理员密钥和独立的 CUSTOMER_SECRET 账号加密密钥，并在新开一届时确认对外展示的内容。

MIT License

---

旧预约关联仅包含未取消的记录；已取消订单不会出现在待关联搜索，也不能由后台新增关联。本人下单后再取消的历史记录仍保留已取消状态。

登录前只显示居中的共用登录框；客人登录进入自己的预约，摄影师以 `admin` 和自行设置的网页登录密码进入管理后台。网页登录密码可使用独立的 `ADMIN_LOGIN_PASSWORD`，值守脚本继续使用原 `ADMIN_KEY`。项目不提供默认公开密码。

## English

In the full order list, click Link at the top right to reveal selection checkboxes and Cancel/Confirm actions. In paid/unpaid views, selection instead updates payment status in bulk (paid, unpaid, deposit or free). Review each amount before confirming. Existing amounts, discount reasons and evidence are retained by default; missing historical amounts must be supplied. Cancelled rows are excluded. Each batch supports up to 50 rows, saves atomically, and deduplicates retries.


# Photography Booking · Self-Service Appointments & Scheduling

An **open-source, self-hosted booking and scheduling tool for convention photographers and cosplay shoots**. Clients choose a date and an available time slot, enter their cosplay name or nickname (CN), phone number, character, and notes, and receive a booking ID. The backend records the appointment and reserves the slot automatically. Photographers use the admin dashboard to view the schedule, edit notes, and track payments.

Suitable for photography appointments, cosplay session scheduling, and managing multiple events. Automatic scheduling reserves the selected slot; it does not rearrange existing bookings.

Deploy it as a website for desktop and mobile browsers. A fresh instance has no preset events, archives, bookings, payment records, dates, prices, or contact details. Client booking opens only after you configure and publish your first event. The application UI and detailed setup guides are currently in Chinese.

### How it works

1. Create an event in the dashboard with its name, dates, time slots, standard price, shoot instructions, and contact details.
2. Preview the client page and confirm publication. The booking URL stays the same when you switch to a new event.
3. Share the client URL. Submitting a booking reserves the chosen slot; concurrent requests for the same slot accept only one booking, and request retries do not create duplicate bookings.
4. View the schedule, open a booking card to edit details, or use its payment badge to record payment.
5. Archive the event when finished. Existing bookings, notes, and payment records remain available. Publishing a new event also archives the previous one.

### Client page

- Choose a date and an available slot, and enter a nickname, phone number, character, and notes.
- Upload reference images and read the event's instructions.
- Sign up using a CN/nickname, log in, and view only your own bookings across current, archived and cancelled events.
- Reuse saved CN and phone details across devices or subsequent bookings.
- Open details by clicking a table row; cancellation and payment notifications require confirmation.
- Copy the booking ID or save a receipt image. Keep the one-time account recovery code to reset a forgotten password.
- Search older bookings across all events by exact CN; phone and booking ID are optional filters. Select and confirm links, with already-linked rows disabled. CN-only links expose only the event, CN and character. A matching phone or booking ID grants normal access. Photographers can also select records in the admin list and assign them to registered clients after confirmation, including imported rows without phone numbers.
- View contact and payment instructions, then report a payment for the photographer to check.

The client layout fills the window, with an avatar/account area at the bottom of the desktop sidebar and a mobile navigation drawer. The client booking table is separate from the photographer's daily schedule.

### Admin dashboard

- Organize events by year and display the count of new bookings not yet viewed in the current browser.
- View a daily schedule with different colors for each date; use a navigation drawer on mobile.
- Open active, paid, or unpaid booking lists and filter by date, keyword, or payment type. Paid lists include complimentary bookings.
- Choose standard pricing, complimentary service, or a custom discount. Discounts require a reason and may include image evidence. Track deposits, unpaid bookings, and paid bookings.
- Set standard prices centrally without rewriting previously recorded payment amounts.
- Enable optional notifications for new bookings, cancellations, and client-reported payments.
- Confirm changes before saving edits, payment records, archives, or new events.
- Stop new bookings by archiving an event while retaining the ability to update notes, prices, and payment records. Historical imported records use the same statistics and lists.

This is a booking and payment **record-keeping tool**. It does not process payments or charge clients. A client's “Confirmed” action is not automatic proof of payment.

### Background notifications and email

Choose a channel in the admin settings, enter your own configuration, and confirm. The server sends notifications for new bookings, cancellations, and client-reported payments even after you close the dashboard. Failed deliveries have bounded retries, and a test notification helps check the saved configuration.

Available channels are **generic Webhook, WeCom, Feishu, Telegram, and email**. Each instance currently uses one channel. Email uses Resend and requires an API key, a sender address on a verified domain, and a recipient address. QQ Mail, 163, Gmail, and other mailboxes can receive messages; mailbox passwords and SMTP authorization codes are not used to send them.

Notifications are off by default, with no preset destination or credentials. Tests cover simulated delivery, retries, and desktop/mobile interactions; actual receipt must be verified using your own channel. “Accepted by the email service” does not mean delivered to the inbox. Check the inbox, spam folder, or sending service's records.

See [notification and email setup](./WATCHER.md) (Chinese) for fields and testing steps. Your own agent can help configure a built-in channel or write a Webhook receiver or polling script after asking which destination and events you want. The [agent guide](./AGENT_SETUP.md) (Chinese) covers APIs, persistent deduplication, and preventing duplicate alerts.

This edition requires your own ADMIN_KEY, a separate CUSTOMER_SECRET for client password verification, and the six rate-limit bindings in the example configuration. Keep the customer secret and the existing data bindings when upgrading. Browser administration shares the root login form (username `admin`); `/admin` redirects there when logged out. Set your own ADMIN_LOGIN_PASSWORD; never put a secret in the URL.

### Installation guides

To use the hosted service without deploying a backend, [apply for an account](https://public-paidan.nyachu.site/app) or [download the Android APK](https://public-paidan.nyachu.site/download/app.apk). Registration and quota allocation require operator approval, including subsequent increases. The [hosted service](../public-service/README.md#english) uses an independent backend; self-hosting this directory still uses your own empty instance and resources.

| Setup | Guide |
| --- | --- |
| [Install manually, without an AI agent](./DEPLOYMENT.md) (Chinese) | Download, install tools, deploy, create the first event, and test notifications. |
| [Use an AI agent to assist with setup](./AGENT_SETUP.md) (Chinese) | A copyable task prompt, user preparation, agent steps, and verification requirements. |

An AI agent is optional. The deployed application runs without an agent staying online. Opening the HTML files directly or enabling GitHub Pages alone does not run the required backend.

### Web deployment

The application requires a platform that runs backend APIs and persists booking data; static HTML hosting alone is insufficient. The frontend uses plain HTML, CSS, and JavaScript, and the backend can be adapted for another environment.

The included example uses Cloudflare Workers for pages and APIs, a Durable Object to serialize booking changes, and KV for compatibility with legacy data. You can port it to your own server and database, preserving slot conflict prevention, retry deduplication, and admin authentication.

See the [manual deployment guide](./DEPLOYMENT.md) (Chinese).

### Local tests

With Node.js 20 or newer, run `node tests/fresh-install.test.cjs` and `node tests/customer.test.cjs` from this directory. Tests use isolated, synthetic in-memory records; they never contact a deployed instance or send notifications.

### Files

| File | Purpose |
| --- | --- |
| index.html | Client booking page |
| admin.html | Photographer dashboard |
| worker.js | Page and API entry point |
| customer-accounts.js | Client accounts, owned bookings, and profile prefill |
| private-security.js | Admin sessions, rate limits, request-origin and body validation |
| backend.js | Event publication, editing, payment records, and concurrent persistence |
| watch-runtime.js | Notification queue, retries, delivery channels, and settings APIs |
| wrangler.jsonc | Example deployment configuration |

No real bookings, payment evidence, admin secrets, or production account configuration are included. Configure your own admin key and check all public-facing information before publishing your first event.

MIT License

Previous-booking linking excludes cancelled records, including operator assignments. Bookings made by the current account and subsequently cancelled remain in its history with their cancelled status.

Before login, only one centered form is shown. Clients enter their booking workspace; the photographer signs in as `admin` to reach the dashboard. Configure your own `ADMIN_LOGIN_PASSWORD` separately from the existing script `ADMIN_KEY`; if omitted, the latter is used for backward compatibility. No shared default password is shipped. Sessions and permissions remain separate.
