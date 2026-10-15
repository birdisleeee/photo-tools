# 公共版安全边界 / Hosted service security

## 简体中文

这是小规模公共预约服务，入口防刷是纵深防护，**不是零风险或抗大规模攻击的保证**。同一平台账号的总额度仍由其应用共享。

### 入口防护

请求先经过总入口限流，然后检查已知路径、HTTP 方法、请求格式与大小。未带有效格式会话的管理请求提前拒绝；有会话格式也必须继续通过服务端身份和租户权限校验。

| 入口 | 每个来源 IP、每个边缘位置的分钟上限 |
| --- | --- |
| 总入口 | 120 |
| 注册与登录入口合计 | 10 |
| 客人查单 | 30 |
| 提交预约、取消、付款声明、参考图上传合计 | 20 |
| APK 下载 | 6 |

这些边缘计数是平台的近似限流，不是精确计费或全网共享计数。同一 Wi-Fi / 移动运营商出口的用户可能共用 IP；过于频繁时返回 429 和 `Retry-After: 60`，一分钟后可重试。不因切换租户路径获得新的同类入口额度。

注册 / 登录另有中心化总尝试上限（合计每分钟 60 次），同一账号名跨 IP 每分钟最多 10 次登录尝试；运营登录另设每分钟 30 次总尝试上限。原有单 IP 登录每分钟 5 次、注册每小时 3 次继续生效。已建立的运营会话不受普通注册 / 登录尝试总上限影响，但仍受总入口限流；不永久锁定账号。

登录和查单等普通请求体上限为 12 KB；管理表单一般为 64 KB；图片相关入口最多接收 8 MiB 请求体，并继续检查图片自身的 5 MiB 限制、MIME 和文件签名。查一个订单号只读取该订单，不遍历全部订单。

### 隔离和限制

- 注册不自动获得额度；批准、停用、修改额度均须运营者授权。
- 租户由路径及会话共同确定，不信任客户端传入的租户 ID 或管理员密钥。
- 公共版只允许订单号回查，返回值不含手机号和付款凭证。取消、上传及付款声明另需验证原预约手机号。
- 客人的“已支付”提交只产生待核对声明，不会直接变成已收款。
- 图片限制和权限检查不能代替完整文件安全扫描；本项目不接受 SVG / HTML 附件。
- 通知渠道保持可配置。通用 Webhook 仍能向符合格式的任意 HTTPS 域名发送请求；当前检查不是 DNS 地址级白名单，也没有验证接收域名所有权。此风险不因入口限流消失。
- 运营和租户页面同源，CSP 仍兼容内联脚本；若未来引入脚本注入漏洞，影响可能扩大。新增渲染内容必须安全转义，不可把用户内容当 HTML。
- 不提供“无论攻击规模多大都不影响同账号其他站点”的承诺。被拒绝的请求仍可能消耗平台调用，账号级额度隔离需独立平台账号。

### 自行验证

Node.js 22 或以上，在仓库根目录执行：

```sh
node --test public-service/tests/security.test.cjs
```

测试用虚构数据和内存存储，不连接生产站点、不发送外部通知。边缘限流用模拟器验证应用的拦截逻辑，不模拟平台全球分布和计费。

部署时保留 `wrangler.jsonc` 的全部五个限流绑定。现有总入口绑定存在而专用绑定缺失时，相应入口返回 503，避免防护静默失效。不要使用旧的手工上传脚本覆盖掉这些绑定。

## English

This is a small hosted booking service. Abuse controls reduce risk; they do not guarantee DDoS resistance or protect shared account quotas from every attack.

Requests pass the general edge limiter (120/minute), route/method checks, and body constraints before business processing. Additional per-IP, per-location limits are 10/minute for authentication, 30 for order lookup, 20 for customer writes, and 6 for APK downloads. Cloudflare edge counters are approximate and location-local. Shared network users may share a limit. Rejections return HTTP 429 with `Retry-After: 60`.

Central authentication limits also apply: registration/login combined 60 attempts/minute, each username 10 login attempts/minute across IPs, and owner login 30 attempts/minute in total. Existing per-IP login (5/minute) and registration (3/hour) limits remain. Existing owner sessions remain usable when the ordinary authentication ceiling is reached, subject to the general edge limit. There is no permanent account lockout.

Ordinary guest/auth payloads are limited to 12 KB; most admin forms to 64 KB; image request bodies to 8 MiB with separate 5 MiB image size/type/signature checks. Order lookup reads a single order instead of scanning the entire event.

Tenant authorization, manual approval and quotas remain mandatory. Order-number lookup omits phone and payment evidence; cancellation, uploads and payment declarations verify the original phone. A guest payment declaration never confirms receipt of money.

Generic HTTPS webhooks remain supported, without DNS-level destination allowlisting or domain-ownership verification. Admin and tenant pages share an origin and retain inline-script-compatible CSP. Those residual risks, shared platform quotas, and the absence of full malware scanning remain relevant. No external destination or customer data is bundled.

Run `node --test public-service/tests/security.test.cjs` with Node.js 22+ from the repository root. Tests use synthetic in-memory fixtures and simulated edge counters, never production traffic or external notifications. Keep all five rate-limit bindings from `wrangler.jsonc` when upgrading; do not deploy with an older script that drops the new bindings.

References: [Cloudflare rate limiting](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/), [OWASP authentication guidance](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html).
