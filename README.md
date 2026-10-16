# photo-tools · 摄影预约与自助排单工具

[简体中文](#简体中文) · [English](#english)

## 简体中文

**面向漫展摄影、Cosplay 约拍的开源自助预约与自动排单工具。** 客人自己填表、选择空闲时段，系统自动生成预约记录并占用时段；摄影师在后台管理拍摄排期、收款记录和通知。可以部署成网页，手机和电脑都能用。

适用于漫展排单、摄影预约、约拍时间管理和多届活动记录。自动排单指按客人选择的可用时段登记预约并防止重复占用，不会擅自替客人调整拍摄时间。

| 小工具 | 用来做什么 |
| --- | --- |
| [拍摄排单](./paidan-booking) | 客妹填表预约，后端自动登记排单；摄影师管理拍摄安排和收款，还可开启后台值守通知。 |

**也可以申请使用我们提供的公共后台。** [打开注册申请页](https://public-paidan.nyachu.site/app) 或 [下载安卓 APK](https://public-paidan.nyachu.site/download/app.apk)，提交申请后等待运营者审核并分配额度。账号和任何新增额度都不会自动批准；首发最多批准 3 个账号。详细规则见 [公共托管版说明](./public-service/README.md)。自行部署原版则使用自己的账号和资源，不受公共服务的分发额度约束。

## 拍摄排单：填表预约，自动排期

摄影师先设置本届的拍摄日期、时段、单价、须知和联系方式，预览并确认后发布。客妹打开链接，选择空闲时段、填写 CN 和角色等信息，提交后自动生成订单并占用时段，不必再手动把每份预约抄进表格。

- **客人注册后自助预约（自部署版）**：用 CN 注册登录，查看本人历届预约；CN 和电话按账号预填，订单列表点击整行查看详情，支持保存预约截图、复制订单号和二次确认取消。
- **摄影师集中管理**：按年份、届次整理记录，按天查看时间表；有效预约、已支付和未支付都能点开查看与筛选。
- **登记收款**：支持正常单价、免单、优惠价和定金记录，优惠可填写原因并上传凭证。
- **图片独立存储（可选）**：参考图和优惠凭证可保存到私有图片桶，通过原有权限校验查看；订单与排单锁继续保存到数据库。见 [配置说明](./IMAGE_STORAGE.md)。
- **多届归档**：结束后停止新预约，保留记录，仍可补充备注和调整收款。
- **手机也能操作**：手机端使用汉堡菜单抽屉，电脑端显示侧栏和多日时间表。

自部署版的客人页面采用全屏布局、左下角账号资料区和手机抽屉导航；「我的预约」用紧凑表格展示记录。摄影师后台仍保留按日期排列的拍摄时间表。公共托管版与 APK 是独立发行，功能以 [公共版说明](./public-service/README.md) 为准。

旧预约默认搜索全部场次：CN 必填，手机号和订单号选填；勾选并二次确认后即可关联，已关联结果会置灰。仅凭 CN 关联时只展示场次、CN 和角色；核对原手机号或订单号后可获取正常预约权限。摄影师也可在后台列表批量勾选旧记录，搜索已注册的客人账号并二次确认关联，无需补录手机号或重建订单。

## 可选的后台值守通知

不必一直开着管理页面等订单。在后台「设置 → 脚本值守」开启并配置渠道后，**新预约、取消预约、客人付款通知**会自动发送到你选择的接收端。值守在服务端运行，关闭网页后仍会继续处理通知；发送失败会有限重试。

| 通知渠道 | 需要自己配置什么 |
| --- | --- |
| 通用 Webhook | 接收通知的 HTTPS 地址，可选鉴权 Token |
| 企业微信 | 群机器人 Webhook 地址 |
| 飞书 | 群机器人 Webhook 地址 |
| Telegram | Bot Token 和 Chat ID |
| **邮件** | Resend API Key、已验证域名下的发件地址、收件邮箱 |

渠道由使用者自行选择，当前每个实例配置一个渠道，不绑定 QQ 或其他个人账号。邮件可以发到 QQ、163、Gmail 等收件邮箱；发信通过 Resend，不能直接填写邮箱登录密码或 SMTP 授权码。

值守默认关闭，通知凭据默认空白。保存设置和发送测试通知都需要二次确认。现有自动化测试覆盖模拟发送、失败重试和页面操作；**真实渠道是否收到消息，需要配置自己的接收端后实测**。邮件服务接受请求也不等于邮件已送达，请检查收件箱、垃圾邮件或发信服务记录。

详细步骤见 [值守与邮件设置](./paidan-booking/WATCHER.md)。客人点击「已确认」只会发送付款通知，不会自动确认到账；本工具不代收款、不扣款。

**有自己的 Agent 也可以接入。** 让 Agent 先询问你希望通知发到哪里、提醒哪些事件，再配置内置渠道，或编写自己的 Webhook 接收服务、定时查询脚本。具体流程、接口和防重复通知约定见 [给 Agent 的接入说明](./paidan-booking/AGENT_SETUP.md)。拥有 GitHub 账号或下载代码本身不会自动启动值守任务。

## 安装与上手：选择适合你的方式

**没有 AI Agent 也能完整使用。** 部署完成后，预约、查询、自动排单和内置通知都由项目后端运行，不依赖 AI，也不需要一直开着电脑。

| 你的情况 | 从哪里开始 | 需要做什么 |
| --- | --- | --- |
| **直接使用公共服务** | [公共版与 APK 使用说明](./public-service/README.md) | 下载 APK 或打开网页 → 申请注册 → 等待运营者批准并分配额度 → 创建场次与分享自己的预约链接 |
| **没有 AI Agent，自己安装** | [手动安装说明书](./paidan-booking/DEPLOYMENT.md) | 下载代码 → 安装工具 → 创建自己的存储 → 部署网页 → 设置管理员密钥 → 创建第一届 → 按需配置通知 |
| **有 AI Agent，让它协助** | [AI Agent 操作说明书](./paidan-booking/AGENT_SETUP.md) | 给 Agent 仓库和任务说明 → 确认部署账号及通知去向 → 自己完成登录与凭据填写 → 让 Agent 部署并验证 |

手动安装不要求 GitHub 账号，可下载 ZIP；有 GitHub 账号也不会自动启动 Agent 或值守。当前附带可直接照做的 Cloudflare 部署示例，其他平台需要适配后端。两条路线使用同一套代码，新实例都是空白界面。

## 从空白界面开始

下载并部署后，没有预置漫展、历史存档、客户订单或收款记录，也没有我们的联系方式和通知凭据。使用者设置自己的管理员密钥，在后台创建并发布第一届后，客人页面才开放预约。

可以部署在能运行后端接口、保存数据的平台上。仓库提供 Cloudflare 部署示例，也可以适配自己的服务器和数据库；不能只上传 HTML 到静态托管后就完成预约和通知功能。

- [完整功能与使用流程](./paidan-booking/README.md)
- [部署说明](./paidan-booking/DEPLOYMENT.md)
- [后台值守与邮件配置](./paidan-booking/WATCHER.md)

每个小工具都可以独立使用。仓库不包含实际客人的订单、付款凭证、联系方式或管理密钥。

MIT License

---

旧预约关联仅包含未取消的记录；已取消订单不会出现在待关联搜索，也不能由后台新增关联。本人下单后再取消的历史记录仍保留已取消状态。

登录前只显示居中的共用登录框；客人登录进入自己的预约，摄影师以 `admin` 和自行设置的网页登录密码进入管理后台。网页登录密码可使用独立的 `ADMIN_LOGIN_PASSWORD`，值守脚本继续使用原 `ADMIN_KEY`。项目不提供默认公开密码。

## English

# photo-tools · Photography Booking & Self-Service Scheduling

**An open-source, self-hosted appointment booking and scheduling tool for photographers, cosplay shoots, and conventions.** Clients fill out a booking form and choose an available time slot. The backend creates the booking and reserves that slot, while the photographer manages the schedule, payment records, and notifications in an admin dashboard.

Works in desktop and mobile browsers. Automatic scheduling means reserving the client's chosen available slot and preventing double booking; it does not move appointments or choose a different time for the client.

| Tool | What it does |
| --- | --- |
| [Photography Booking](./paidan-booking) | Client booking forms, automatic slot reservation, a photographer dashboard, and optional background notifications. |

**You can also apply for our hosted service.** [Open the application page](https://public-paidan.nyachu.site/app) or [download the Android APK](https://public-paidan.nyachu.site/download/app.apk). Accounts and quotas require explicit operator approval; nothing is allocated automatically. The initial service admits at most three approved accounts. See [hosted service rules](./public-service/README.md#english). Self-hosting the original version uses your own resources and does not require an allocation from our hosted service.

### Self-service booking and schedule management

The photographer configures an event's dates, time slots, pricing, instructions, and contact details, previews the client page, and publishes it. Clients open the link, select a slot, and enter their cosplay name or nickname (CN), character, and other booking details. The backend records the appointment and reserves the slot.

- **Client self-service:** booking forms, reference image uploads, booking lookup, and cancellation.
- **Photographer dashboard:** events organized by year, daily schedules, and filterable lists of active, paid, and unpaid bookings.
- **Payment records:** standard pricing, complimentary bookings, discounts with reasons and optional evidence, and deposit records.
- **Optional private image storage:** keep reference images and payment evidence in a separate private bucket, with the existing access controls; orders and slot locks remain in the database. See [image storage setup](./IMAGE_STORAGE.md).
- **Event archives:** stop new bookings while keeping existing records available for notes and payment updates.
- **Mobile and desktop layouts:** a mobile navigation drawer and a desktop sidebar with a multi-day schedule.

#
The self-hosted edition now includes client signup/login (use the client CN as the username), account-scoped booking history, saved CN/phone prefill, copyable booking IDs and downloadable booking receipts. The client page uses a full-window layout, an account profile in the sidebar, and a compact clickable My Bookings table with a mobile drawer. The photographer schedule remains a daily calendar. Hosted service/APK releases are maintained separately.

Clients search all events by exact CN, with optional phone and booking-ID filters, then select and confirm links. Linked rows are disabled. CN-only links show only the event, CN and character; a matching original phone or booking ID grants normal booking access. Photographers can also select older records in the admin list and assign them to a registered client account after confirmation, without filling in missing phone numbers or recreating bookings.

## Optional background notifications

Enable background notifications in the admin settings to receive alerts for **new bookings, cancellations, and client-reported payments**. Notifications run on the server, continue after the page is closed, and use bounded retries on delivery failures.

| Channel | Your configuration |
| --- | --- |
| Generic Webhook | An HTTPS receiver URL and an optional authentication token. |
| WeCom | A group bot Webhook URL. |
| Feishu | A group bot Webhook URL. |
| Telegram | A bot token and chat ID. |
| **Email** | A Resend API key, a sender address on a verified domain, and a recipient address. |

Each instance currently uses one channel, chosen and configured by its owner. No author's QQ account or other personal account is required. Email can be delivered to mailboxes such as QQ Mail, 163, or Gmail, but sending uses Resend rather than a mailbox password or SMTP authorization code.

Notifications are off by default, and credentials start blank. Saving settings and sending a test message require confirmation. Automated tests cover simulated delivery, retries, and UI interactions. **You must test actual receipt with your own configured destination.** A successful email API response does not prove delivery to an inbox; check the inbox, spam folder, or sending service's records.

See [notification and email setup](./paidan-booking/WATCHER.md) (Chinese). A client's “Confirmed” action sends a notification for the photographer to check; it does not confirm payment. This is a record-keeping tool, not a payment processor, and it does not charge clients.

**Have your own agent?** It can ask where notifications should go and which events matter, then configure a built-in channel or implement your own Webhook receiver or scheduled polling script. The [agent integration guide](./paidan-booking/AGENT_SETUP.md) (Chinese) covers the APIs, persistent deduplication, and avoiding duplicate alerts from multiple tasks.

### Installation: with or without an AI agent

**No AI agent is required.** Once deployed, the backend handles booking, lookup, scheduling, and built-in notifications. You do not need to keep your computer or an AI assistant running.

| Your setup | Guide | Steps |
| --- | --- | --- |
| Apply for the hosted service | [Hosted service and APK guide](./public-service/README.md#english) | Install or open the website → apply → wait for approval and quota allocation → create an event and share your own booking link. |
| Install it yourself, without an AI agent | [Manual installation guide](./paidan-booking/DEPLOYMENT.md) (Chinese) | Download → install tools → create your own storage → deploy → set an admin key → publish your first event → optionally configure notifications. |
| Ask your AI agent to help | [AI agent setup guide](./paidan-booking/AGENT_SETUP.md) (Chinese) | Share the repository and task → choose your account and notification destination → complete login and secret entry yourself → have the agent deploy and verify. |

You can download the ZIP without a GitHub account. A GitHub account alone does not start an agent or a monitoring task. The repository includes a Cloudflare deployment example; other platforms require backend adaptation. Both installation routes use the same code and start with an empty instance. The application interface and detailed setup guides are currently in Chinese.

### Start with your own data

A fresh deployment contains no preset events, archives, client bookings, payment records, author contact details, or notification credentials. Set your own admin key and publish your first event before client booking opens.

Deployment needs a backend and persistent storage. The included example uses Cloudflare; you can adapt the code for your own server and database. Uploading only the HTML files to static hosting will not provide working bookings or notifications.

- [Full features and workflow](./paidan-booking/README.md#english)
- [Manual installation](./paidan-booking/DEPLOYMENT.md) (Chinese)
- [AI agent installation and integration](./paidan-booking/AGENT_SETUP.md) (Chinese)
- [Notifications and email configuration](./paidan-booking/WATCHER.md) (Chinese)

Tools can be used independently. The repository does not include real client records, payment evidence, contact details, or admin secrets.

MIT License

Previous-booking linking excludes cancelled records, including operator assignments. Bookings made by the current account and subsequently cancelled remain in its history with their cancelled status.

Before login, only one centered form is shown. Clients enter their booking workspace; the photographer signs in as `admin` to reach the dashboard. Configure your own `ADMIN_LOGIN_PASSWORD` separately from the existing script `ADMIN_KEY`; if omitted, the latter is used for backward compatibility. No shared default password is shipped. Sessions and permissions remain separate.
