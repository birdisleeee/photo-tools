# 拍摄排单 · Android APK

[简体中文](#简体中文) · [English](#english)

## 简体中文

[下载公共版 APK](https://photo-booking-public.nyachu-paidan.workers.dev/download/app.apk)

Android 8.0 及以上。安装后连接公共服务，申请账号；等待运营者审核并分配额度后使用。账号申请和额度规则见 [公共服务说明](../public-service/README.md)。APK 不含运营密钥、私人站点密钥、订单或作者存档。

这是当前手机界面的 Android 客户端，提供账户入口、系统分享、刷新和系统图片选择器。预约数据位于公共后端，手机关闭不影响服务器的已配置通知。客人只需打开摄影师分享的链接。应用需要联网；尚未提供离线订单缓存或系统推送。

首次安装系统可能要求允许当前下载来源安装应用。仅安装你信任来源的包；本 APK 为直接分发版本，没有宣称已在应用商店上架。服务端保持独立，安装 APK 本身不会自动获得额度。

### 自行构建

源码不依赖 Gradle 或外部 Java 库，使用 Android 官方 SDK Build Tools 和 JDK 17 构建。准备 API 35 的 `android.jar` 和 Build Tools 35.0.0，修改 `MainActivity.java` 中的 `BASE_URL` 为自己的公共服务网址。自部署时也可自行调整包名；不要直接指向需要共享私人管理员密钥的站点。

设置以下环境变量后，在本目录执行 `python build.py`：

| 环境变量 | 内容 |
| --- | --- |
| `ANDROID_SDK_ROOT` | 自己的 SDK 根目录 |
| `ANDROID_PLATFORM_JAR`（可选） | `android.jar` 的路径 |
| `ANDROID_BUILD_TOOLS`（可选） | Build Tools 目录 |
| `APK_KEYSTORE` | 自己的签名密钥文件路径 |
| `APK_KEY_ALIAS`（可选） | 签名别名，默认 `photo-booking` |
| `APK_STORE_PASSWORD`、`APK_KEY_PASSWORD` | 从秘密配置读取的签名密码 |

输出为 `build/photo-booking-public.apk`。构建脚本执行签名校验；运行界面、上传和系统分享还应在目标手机验证。签名密钥和密码不入 Git，保留同一签名以支持后续升级。

没有 JavaScript 原生桥接；仅在配置的 HTTPS 服务域内导航，其他 HTTPS、电话和邮件链接交给系统处理。关闭文件访问、明文 HTTP、混合内容、调试及 Android 应用备份；图片仅由使用者通过系统选择器选取。

构建与签名方式参考 [Android 命令行构建](https://developer.android.com/build/building-cmdline) 和 [应用签名](https://developer.android.com/studio/publish/app-signing)。

## English

[Download the hosted Android APK](https://photo-booking-public.nyachu-paidan.workers.dev/download/app.apk). Requires Android 8.0 or later and internet access. Apply for an account, then wait for operator approval and quota allocation. No private bookings or admin secrets are bundled.

The app wraps the mobile interface with account navigation, system sharing, refresh, and image selection. Booking data and configured notification delivery remain on the independent public backend. There is no offline booking cache or native push notification feature in this release.

To build your own variant, install JDK 17 and Android API 35 / Build Tools 35.0.0, set your service URL, provide your own signing secrets through environment variables, and run `python build.py`. Keep signing keys out of Git and use the same key for subsequent updates. Test device-specific interactions on your target phone.

MIT License
