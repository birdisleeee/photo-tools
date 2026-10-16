# 图片存储 / Image storage

## 中文

订单、客人账号、排期锁和图片索引保存在 DO。参考图、优惠凭证可选择保存到 **R2 Standard 私有桶**；不开启 R2 时，示例配置仍可使用原来的 DO 存储。下载代码不会获得作者的任何图片、账号、活动或存档。

### 第一次安装并启用 R2

1. 在自己的平台账号中开通 R2。开通涉及账单资料，请自行阅读平台费用；本项目不会代你开通、升级套餐或自动分配更多容量。
2. 选择自部署单人版或公共托管版。分别使用目录内的 `wrangler.r2.example.jsonc`，填写自己创建的 KV ID，保留对应 DO 声明、限流和已有密钥。已有实例须从现有配置增加 R2 绑定，不能把示例配置直接覆盖上去。
3. 在选定目录创建自己的桶，例如单人版：

   ```sh
   npx wrangler@4 r2 bucket create my-photo-booking-images
   ```

   公共托管版使用另一个桶，例如 `my-photo-booking-public-images`。自己的私人版和公共版不要共用桶。桶不开放 `r2.dev`，不绑定公开域名，不配置匿名读取。
4. 在配置中确认 `IMAGE_BUCKET` 指向自己的桶，并设置 `IMAGE_STORE_REQUIRED="1"`。从选定配置部署：

   ```sh
   npx wrangler@4 deploy --config wrangler.r2.example.jsonc
   ```

   这是常规安装说明的补充，管理员、客人账号或公共运营密钥仍需按各模式安装文档设置。新实例依然是空界面。
5. 用自己的测试活动上传 PNG/JPEG/WebP，检查管理员查看、匿名访问拒绝与正常预约。每张图片仍限制 5 MiB；图片不会因换存储而自动变公开。

### 配额与一致性

- 公共版仍使用运营者审核的存储额度，包括图片、订单、审计等逻辑负载；上传前检查额度，成功后才提交指针和业务记录。不自动批准账号或增加额度。
- 图片对象按 DO 身份和内容摘要命名；客户不能指定其他租户的存储路径。替换图片后，订单与审计仍在使用的文件会保留。
- 写入失败时不提交业务记录；未提交对象有持久化清理标记，在后续写入或维护时重试清理。没有后续活动时，待清理对象可能暂时保留。
- DO 的 `physicalBytes` 不含 R2；逻辑配额也不等于平台账单。R2 免费用量不是硬性消费上限，超额可能计费，应查看自己的用量。以 [R2 官方定价](https://developers.cloudflare.com/r2/pricing/) 为准。

### 已有实例：先备份，再逐条迁移

先备份原代码、完整存储状态、密钥和图片原文件；在独立环境演练。绑定 R2 后，新上传的图使用 R2，旧 DO/KV 数据仍兼容读取，**不会在部署时批量改写历史数据**。

维护接口只用于实例拥有者/运维脚本，不在普通用户页面提供：

- 单人版：`POST /admin/api/image-storage`，同时携带管理员 `X-Admin-Key` 与同值的 `X-Image-Maintenance-Key`；不要把密钥写进网址、网页或公开脚本。
- 公共版：运营者登录后调用 `POST /service/api/owner/image-storage`，用 `id` 指定已存在的摄影师账号。普通摄影师和客人无权调用。
- `action: inventory` 按 `cursor` 分页列出 DO 逻辑键；旧 KV 的键需额外通过自己的平台后台导出，不能把 DO 清单当成完整 KV 备份。
- `action: export` 加 `key` 导出一条图片相关逻辑值与摘要。保存备份后，`action: migrate` 携带 `key`、`confirm: true`、`backupDigest`，校验一致才迁移；单次处理一条。
- 对早期单人版全局 `a:<订单号>` / `ab:<订单号>` 附件，可用 `action: recover-legacy` 恢复到已有订单。需核对所属活动与订单，备份二进制和元信息，分别提供 `backupDigest` 与 `metadataDigest`；目标已有附件时拒绝覆盖。公共版没有旧私人 KV 来源。
- `action: selftest` 测试真实桶写入、读取与删除，仅创建临时测试对象，不创建订单。公共版可省略 `id` 做桶连通测试。

迁移后核对每张图的摘要，并确认订单、收款、活动和通知设置未变。不要直接部署不认识 R2 指针的旧代码。需要退回旧存储格式时，先用 `action: restore`、相同备份校验参数逐条把图片恢复到 DO，导出并验证后才回退代码；保留恢复原文件的备份。该接口不恢复账号、订单或其他业务状态。

## English

Orders, customer accounts, slot locks, and image references stay in Durable Objects. Reference images and discount evidence can optionally use a **private R2 Standard bucket**. The default configuration still supports DO-only storage. Fresh installations contain no author data, accounts, events, or images.

Enable R2 in your own account after reviewing billing. Use the appropriate directory's `wrangler.r2.example.jsonc`, supply your own KV ID, create the named private bucket, and follow that mode's setup instructions for secrets and rate limits. Keep separate buckets for private and public deployments. Leave `r2.dev` and public custom domains disabled. For existing installations, add bindings to your current configuration rather than replacing it with the example.

Public-service image bytes remain part of the operator-approved logical storage quota. Quotas are checked before upload; no capacity is granted automatically. The authenticated application serves images, and server-derived DO identities separate tenants. Uploads are checked before a transactional reference switch; shared audit references retain their objects. Failed/uncommitted objects are cleaned on later writes or maintenance; idle installations can retain pending cleanup objects temporarily. DO physical-size metrics exclude R2. Free allowances are not spending caps; review [R2 pricing](https://developers.cloudflare.com/r2/pricing/).

Existing DO/KV images remain readable. Deployment does not automatically migrate historical data. Back up code, credentials, all storage, and original files first. The private maintenance endpoint requires both administrator headers; public maintenance requires an operator session. Inventory is paginated and covers DO keys only; export legacy KV separately. Export and back up each image-related logical key, then migrate with its exact backup digest and explicit confirmation. Verify image hashes and unchanged business data. Before rolling back to code that cannot read R2 references, restore each migrated value into DO using the authenticated maintenance endpoint, verify it, and retain original-file backups.
