package app.floatphone.shell

import android.Manifest
import android.annotation.SuppressLint
import android.app.DownloadManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Rect
import android.media.AudioManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.provider.OpenableColumns
import android.provider.Settings
import android.view.WindowManager
import android.webkit.CookieManager
import android.webkit.DownloadListener
import android.webkit.JavascriptInterface
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Toast
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import java.io.File
import java.util.concurrent.Executors

/**
 * Float 小手机安卓壳：全屏 WebView 直接加载线上站点。
 * 网页每次部署即时生效，本壳只负责原生能力（推送长连接、文件上下行、外链）。
 */
class MainActivity : AppCompatActivity() {

    companion object {
        val SITE_URL: String = BuildConfig.SITE_URL
        const val VERSION = "1.0.13"
        /** 来电接听等场景的站内深链（必须以 SITE_URL 开头，否则忽略） */
        const val EXTRA_OPEN_URL = "open_url"
        /** 选中文件复制到私有缓存用的子目录（需与 res/xml/file_paths.xml 里的 cache-path 一致） */
        private const val UPLOAD_CACHE_DIR = "uploads"
        /** 临时上传文件的保留时长，过期的在下次选择时顺手清掉 */
        private const val UPLOAD_CACHE_TTL_MS = 24L * 60 * 60 * 1000
        /** 交给 WebView 的 content:// URI 的 authority 后缀，需与 AndroidManifest 里的 FileProvider 一致 */
        private const val FILE_PROVIDER_SUFFIX = ".fileprovider"
        /** 壳自己的 SharedPreferences（与网页的 localStorage/IndexedDB 互不相干） */
        private const val PREFS_NAME = "shell_prefs"
        private const val KEY_LAST_VERSION_CODE = "last_version_code"
        private const val KEY_LAST_CACHE_CLEAR_AT = "last_cache_clear_at"
        /** 即使壳自身没升级，也至少每隔这么久清一次资源缓存，保证线上部署能在壳里生效 */
        private const val CACHE_MAX_AGE_MS = 72L * 60 * 60 * 1000
        /**
         * 壳内视口兜底样式：**始终铺满**。
         *
         * 网页那套"手机"是固定 390×844 的竖屏设计稿，只有一条媒体查询会把外层手机壳去掉、
         * 改成铺满：
         *   @media (max-width: 500px) and (hover: none) and (pointer: coarse)
         * 于是这些情况它都接不住：
         *   1) 折叠机外屏常上报 hover（例如支持手写笔 hover），条件凑不齐 → 继续用 390px
         *      固定宽度（加外壳约 419px），比视口宽，左侧留空、右侧被裁；
         *   2) 横屏（含翻开盖横屏、普通手机横屏）"又宽又矮"，844 的高度塞不下 → 底部超出；
         *   3) 翻开盖后的内屏（宽 > 500 且竖屏）→ 中间一条窄手机，两侧大片留白。
         *
         * 壳本身就是"手机 App 容器"，用户要的是铺满，所以这里不再设生效条件：注入后一律
         * 全屏铺满（手机框隐藏）。高度一律用 dvh（键盘弹出时会跟着缩）；键盘本身由壳原生监听
         * IME inset 把 WebView 内容区缩短来处理（见 onCreate 里的 OnApplyWindowInsetsListener），
         * 所以这里刻意不再用网页那套 --mobile-keyboard-lift 位移，避免两边各顶一次。
         * 顶部仍保留 --status-bar-drop 补偿，防止被系统栏切掉。
         *
         * 将来若想恢复"大屏显示手机框"，把下面 css 外层包回
         *   @media (max-width:500px), (orientation:landscape) { ... }
         * 即可；线上正道仍是给 styles/phone-shell.css 补横屏/宽屏规则后再删掉这段。
         */
        private const val VIEWPORT_FIX_JS = """
(function () {
  try {
    function apply() {
      if (document.getElementById('float-viewport-fix')) return;
      var css = ':root{--phone-screen-width:100vw;--phone-screen-height:100dvh}'
        + 'html,body{overflow:hidden;width:100%;height:100%;height:100dvh}'
        + '.app-root{width:100vw;height:100%;height:100dvh;padding:0;overflow:hidden}'
        + '.phone-shell-wrap{--phone-case-padding:0px;--phone-case-border-size:0px;--phone-frame-size:0px;'
        + '--phone-screen-radius:0px;--phone-frame-radius:0px;--phone-case-radius:0px;'
        + 'width:100vw;margin-inline:0;gap:0;transform-origin:top left;'
        + 'margin-top:calc(-1 * var(--status-bar-drop, 0px));'
        + 'transform:translate3d(0, calc(-1 * var(--float-keyboard-lift, 0px)), 0);'
        + 'transition:transform .18s cubic-bezier(.22,1,.36,1);will-change:transform}'
        + '.phone-shell-wrap .phone-case{padding:0;border:0;background:transparent;box-shadow:none}'
        + '.phone-shell-wrap .phone-frame{padding:0;background:transparent;box-shadow:none}'
        + '.phone-shell-wrap .phone-case::before,.phone-shell-wrap .phone-case::after,'
        + '.phone-shell-wrap .phone-frame::before,.phone-shell-wrap .phone-frame::after{display:none}';
      var style = document.createElement('style');
      style.id = 'float-viewport-fix';
      style.textContent = css;
      (document.head || document.documentElement).appendChild(style);
    }
    apply();
    window.addEventListener('resize', apply);
    window.addEventListener('orientationchange', apply);

    // ── 键盘 ──────────────────────────────────────────────────────────────
    // vivo 这类机器上系统不把键盘高度告诉应用（IME inset 与可见区域都拿不到 0，实测读数就是
    // nat=0 / vp=0），所以从网页侧量，按可信度依次退：
    //   native = 基准高度 - 当前 innerHeight      → 系统把内容区缩小了（最理想，无需再顶）
    //   vp     = innerHeight - 视觉视口高 - 偏移  → 视觉视口被键盘占了（网页自己的做法）
    //   fb     = 输入框聚焦后按屏高 38% 估算的兜底（前两条都没信号时才用。实测键盘约占屏高 34%，
    //            38% 留一点余量，又不会在键盘上方空出一大截）
    // 结果写进 --float-keyboard-lift，由上面那条 transform 把整块顶上去；键盘收起自动归零。
    var baseHeight = window.innerHeight;
    var manualLift = 0;
    function refreshKeyboard() {
      try {
        var vv = window.visualViewport;
        var ih = window.innerHeight;
        var vh = vv ? Math.round(vv.height) : ih;
        var top = vv ? Math.round(vv.offsetTop) : 0;
        var native = baseHeight - ih; if (native < 40) native = 0;
        var vp = ih - vh - top; if (vp < 40) vp = 0;
        var lift = native > 0 ? 0 : (vp > 0 ? vp : manualLift);
        document.documentElement.style.setProperty('--float-keyboard-lift', lift + 'px');
      } catch (e) {}
    }
    document.addEventListener('focusin', function (e) {
      var t = e.target;
      var tag = t && t.tagName ? String(t.tagName).toLowerCase() : '';
      if (tag !== 'input' && tag !== 'textarea' && !(t && t.isContentEditable)) return;
      manualLift = Math.round(window.innerHeight * 0.38);
      window.setTimeout(refreshKeyboard, 350);
    }, true);
    document.addEventListener('focusout', function () {
      window.setTimeout(function () { manualLift = 0; baseHeight = window.innerHeight; refreshKeyboard(); }, 250);
    }, true);
    refreshKeyboard();
    window.addEventListener('resize', refreshKeyboard);
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', refreshKeyboard);
      window.visualViewport.addEventListener('scroll', refreshKeyboard);
    }
  } catch (e) {}
})();
"""
    }

    private lateinit var webView: WebView
    private var filePathCallback: ValueCallback<Array<Uri>>? = null

    /** 选中文件的本地化拷贝放到后台线程做，避免大图在 UI 线程上读盘/拷贝卡住界面。 */
    private val fileCopyExecutor = Executors.newSingleThreadExecutor()

    private val fileChooserLauncher = registerForActivityResult(
        ActivityResultContracts.StartActivityForResult()
    ) { result ->
        val callback = filePathCallback ?: return@registerForActivityResult
        filePathCallback = null
        val picked = collectPickedUris(result.data)
        if (picked.isEmpty()) {
            callback.onReceiveValue(emptyArray())
            return@registerForActivityResult
        }
        // 相册/媒体库（Android 13+ 的系统照片选择器）回传的 content:// URI，读授权只到"拿到
        // 选择结果的进程"，WebView 渲染进程直接读会失败：网页的 <input type=file> 拿不到文件
        // 内容、FileReader 不触发 onload，表现为选完图没有预览、"发送"按钮一直是灰的。
        // 所以先把选中内容复制到本应用私有缓存，再换成本应用 FileProvider 的 content:// URI。
        fileCopyExecutor.execute {
            val localized = picked.map { uri -> localizePickedUri(uri) }.toTypedArray()
            runOnUiThread {
                if (!isDestroyed) callback.onReceiveValue(localized)
            }
        }
    }

    private val notifPermissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { granted ->
        if (granted) PushService.start(this)
    }

    // 网页侧 getUserMedia（通话按住说话、语音条录音、视频通话摄像头）触发的
    // WebView 权限请求：先要系统运行时权限，拿到后再转授给页面。
    // 不实现 onPermissionRequest 时 WebView 会静默拒绝，页面永远拿不到麦克风。
    private var pendingWebPermissionRequest: android.webkit.PermissionRequest? = null

    private val webPermissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { _ ->
        val request = pendingWebPermissionRequest ?: return@registerForActivityResult
        pendingWebPermissionRequest = null
        val granted = request.resources.filter { resource ->
            webResourcePermissions(resource).all {
                ContextCompat.checkSelfPermission(this, it) == PackageManager.PERMISSION_GRANTED
            }
        }
        if (granted.isEmpty()) request.deny() else request.grant(granted.toTypedArray())
    }

    private fun webResourcePermissions(resource: String): List<String> = when (resource) {
        android.webkit.PermissionRequest.RESOURCE_AUDIO_CAPTURE -> listOf(Manifest.permission.RECORD_AUDIO)
        android.webkit.PermissionRequest.RESOURCE_VIDEO_CAPTURE -> listOf(Manifest.permission.CAMERA)
        else -> emptyList()
    }

    // ── 文件选择结果处理 ─────────────────────────────────────────

    /** 兼容单选（intent.data）和多选（clipData）两种回传方式，按出现顺序去重。 */
    private fun collectPickedUris(data: Intent?): List<Uri> {
        if (data == null) return emptyList()
        val uris = LinkedHashSet<Uri>()
        data.clipData?.let { clip ->
            for (i in 0 until clip.itemCount) {
                clip.getItemAt(i).uri?.let { uris.add(it) }
            }
        }
        data.data?.let { uris.add(it) }
        return uris.toList()
    }

    /**
     * 把选中的内容复制到应用私有缓存，返回本应用 FileProvider 的 content:// URI。
     * 复制或转换失败时回退到原始 URI，保持与改动前一致的行为。
     */
    private fun localizePickedUri(uri: Uri): Uri {
        val copied = runCatching { copyToUploadCache(uri) }.getOrNull() ?: return uri
        return runCatching {
            FileProvider.getUriForFile(this, packageName + FILE_PROVIDER_SUFFIX, copied)
        }.getOrDefault(uri)
    }

    /** 把选中内容的字节落到 cacheDir/uploads/，返回落地后的文件。 */
    private fun copyToUploadCache(uri: Uri): File {
        val dir = File(cacheDir, UPLOAD_CACHE_DIR)
        if (!dir.exists() && !dir.mkdirs()) throw IllegalStateException("cannot create ${dir.path}")
        pruneUploadCache(dir)
        val displayName = queryDisplayName(uri)
        val extension = displayName
            ?.substringAfterLast('.', "")
            ?.takeIf { it.isNotBlank() && it.length <= 8 }
            ?: "bin"
        val baseName = displayName
            ?.substringBeforeLast('.', displayName)
            ?.replace(Regex("[^A-Za-z0-9_\\-]"), "_")
            ?.take(48)
            ?.takeIf { it.isNotBlank() }
            ?: "picked"
        val dest = File(dir, "${System.currentTimeMillis()}_$baseName.$extension")
        contentResolver.openInputStream(uri)?.use { input ->
            dest.outputStream().use { output -> input.copyTo(output) }
        } ?: throw IllegalStateException("openInputStream returned null: $uri")
        return dest
    }

    private fun queryDisplayName(uri: Uri): String? = runCatching {
        contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { cursor ->
            if (cursor.moveToFirst()) cursor.getString(0) else null
        }
    }.getOrNull()

    /** 清掉缓存目录里过期的临时上传文件，避免长期占空间。 */
    private fun pruneUploadCache(dir: File) {
        val cutoff = System.currentTimeMillis() - UPLOAD_CACHE_TTL_MS
        runCatching {
            dir.listFiles()?.forEach { file ->
                if (file.isFile && file.lastModified() < cutoff) file.delete()
            }
        }
    }

    /** 从后台切回、或用户从边缘滑出系统栏后，重新收起，保持沉浸。 */
    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) {
            WindowInsetsControllerCompat(window, window.decorView)
                .hide(WindowInsetsCompat.Type.systemBars())
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // 沉浸全屏：允许内容画到系统栏下面，并隐藏系统栏，让小手机自己的虚拟状态栏
        // 成为唯一的一条（等价于浏览器 requestFullscreen 的效果）。themes.xml 已把两条栏
        // 设为透明，正好配合。若改回 true，顶部会重新多出一条空带。
        WindowCompat.setDecorFitsSystemWindows(window, false)
        WindowInsetsControllerCompat(window, window.decorView).apply {
            hide(WindowInsetsCompat.Type.systemBars())
            systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        }
        // 允许内容画进挖孔/刘海区域。不设的话系统会为摄像头挖孔在顶部保留一条黑边，
        // 即使系统栏已隐藏，那条黑带也依然在（表现为"字没了但黑块还在"）。
        if (Build.VERSION.SDK_INT >= 28) {
            window.attributes = window.attributes.apply {
                layoutInDisplayCutoutMode =
                    WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES
            }
        }
        // 音量键默认调媒体流：WebView 里的语音条/TTS 都走媒体流播放，
        // 不设的话短音频没在播时按键调的是铃声，用户感觉"音量键无效、声音巨大"
        volumeControlStream = AudioManager.STREAM_MUSIC

        webView = WebView(this)
        setContentView(webView)

        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            mediaPlaybackRequiresUserGesture = false
            allowFileAccess = false
            userAgentString = "$userAgentString FloatShell/$VERSION"
        }

        // 键盘（IME）：壳是 edge-to-edge（decorFitsSystemWindows=false），系统既不会为键盘缩小窗口，
        // 实测也不会把 IME inset 派发给 WebView（拿到的是 0），于是网页里贴底的输入栏停在整屏底部、
        // 被键盘盖住。这里两路探测取较大值，哪路灵都能兜住：
        //   ① DecorView 上的 IME inset（Android 11+ 正常走这条路）；
        //   ② 全局布局监听：根视图高度 − 可见区域底部 = 键盘高度（老办法，所有版本都灵）。
        // 探到的高度作为 WebView 底部 padding 扣掉：内容区变矮 → 网页视口变矮（配合 dvh）→
        // 输入栏浮到键盘上方；键盘收起置 0，恢复整屏。
        var imeFromInsets = 0
        var imeFromLayout = 0
        fun applyImePadding() {
            val target = maxOf(imeFromInsets, imeFromLayout)
            if (webView.paddingBottom != target) {
                webView.setPadding(0, 0, 0, target)
            }
        }
        ViewCompat.setOnApplyWindowInsetsListener(window.decorView) { _, insets ->
            imeFromInsets = insets.getInsets(WindowInsetsCompat.Type.ime()).bottom
            applyImePadding()
            insets
        }
        window.decorView.viewTreeObserver.addOnGlobalLayoutListener {
            val visible = Rect()
            window.decorView.getWindowVisibleDisplayFrame(visible)
            val rootHeight = window.decorView.height
            val hidden = rootHeight - visible.bottom
            imeFromLayout = if (rootHeight > 0 && hidden * 100 > rootHeight * 15) hidden else 0
            applyImePadding()
        }
        ViewCompat.requestApplyInsets(window.decorView)

        CookieManager.getInstance().setAcceptCookie(true)
        CookieManager.getInstance().setAcceptThirdPartyCookies(webView, false)

        webView.addJavascriptInterface(ShellBridge(), "AndroidShell")

        webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                val url = request.url
                val scheme = url.scheme ?: return false
                // 站内导航留在壳里；http(s) 外链和自定义协议（shortcuts:// 等）交给系统
                if (scheme == "http" || scheme == "https") {
                    if (url.host == Uri.parse(SITE_URL).host) return false
                    return runCatching {
                        startActivity(Intent(Intent.ACTION_VIEW, url)); true
                    }.getOrDefault(true)
                }
                return runCatching {
                    startActivity(Intent(Intent.ACTION_VIEW, url)); true
                }.getOrDefault(true)
            }

            override fun onPageFinished(view: WebView, url: String) {
                super.onPageFinished(view, url)
                // 窄视口 / 横屏兜底：官方媒体查询没命中时，补一份等价的铺满样式
                view.evaluateJavascript(VIEWPORT_FIX_JS, null)
            }
        }

        webView.webChromeClient = object : WebChromeClient() {
            override fun onPermissionRequest(request: android.webkit.PermissionRequest) {
                val supported = request.resources.filter { webResourcePermissions(it).isNotEmpty() }
                if (supported.isEmpty()) { request.deny(); return }
                val missing = supported.flatMap { webResourcePermissions(it) }
                    .distinct()
                    .filter { ContextCompat.checkSelfPermission(this@MainActivity, it) != PackageManager.PERMISSION_GRANTED }
                if (missing.isEmpty()) { request.grant(supported.toTypedArray()); return }
                if (pendingWebPermissionRequest != null) { request.deny(); return }
                pendingWebPermissionRequest = request
                webPermissionLauncher.launch(missing.toTypedArray())
            }

            override fun onShowFileChooser(
                view: WebView,
                callback: ValueCallback<Array<Uri>>,
                params: FileChooserParams,
            ): Boolean {
                filePathCallback?.onReceiveValue(emptyArray())
                filePathCallback = callback
                return runCatching {
                    fileChooserLauncher.launch(params.createIntent()); true
                }.getOrElse {
                    filePathCallback = null; false
                }
            }
        }

        // 备份导出等下载：交给系统下载管理器，落到公共下载目录
        webView.setDownloadListener(DownloadListener { url, userAgent, contentDisposition, mimeType, _ ->
            runCatching {
                if (url.startsWith("blob:") || url.startsWith("data:")) {
                    // blob/data 由页面内 JS 触发的 a[download] 处理；提示用户等待
                    Toast.makeText(this, "正在导出…", Toast.LENGTH_SHORT).show()
                    return@DownloadListener
                }
                val request = DownloadManager.Request(Uri.parse(url)).apply {
                    addRequestHeader("User-Agent", userAgent)
                    addRequestHeader("Cookie", CookieManager.getInstance().getCookie(url) ?: "")
                    setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
                    setDestinationInExternalPublicDir(
                        Environment.DIRECTORY_DOWNLOADS,
                        android.webkit.URLUtil.guessFileName(url, contentDisposition, mimeType),
                    )
                }
                (getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager).enqueue(request)
                Toast.makeText(this, "已开始下载到「下载」目录", Toast.LENGTH_SHORT).show()
            }
        })

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (webView.canGoBack()) webView.goBack() else moveTaskToBack(true)
            }
        })

        // 站点是"部署即生效"的，但壳若一直吃旧缓存，线上修好的东西在壳里就永远看不到
        // （照片选择器、生图模型这类问题都踩过）。所以加载前按策略清一次资源缓存。
        applyWebCachePolicy()

        // 冷启动带深链（如来电接听）直接加载目标；否则加载首页
        webView.loadUrl(consumeOpenUrl(intent) ?: SITE_URL)
        ensurePushService()
    }

    /** singleTask：App 已在运行时（如全屏来电页接听）通过 onNewIntent 送达深链 */
    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        val target = consumeOpenUrl(intent) ?: return
        // SPA 已加载：loadUrl 到同页 hash 只触发 hashchange，不会整页重载
        webView.loadUrl(target)
    }

    private fun consumeOpenUrl(intent: Intent?): String? {
        val target = intent?.getStringExtra(EXTRA_OPEN_URL) ?: return null
        intent.removeExtra(EXTRA_OPEN_URL)
        return target.takeIf { it.startsWith(SITE_URL) }
    }

    /**
     * 该清就清一次 WebView 的资源缓存：
     *   1. 壳自己升级过（versionCode 变了）→ 清一次；
     *   2. 距上次清理超过 CACHE_MAX_AGE_MS → 再清一次。
     * 只清 HTTP/资源缓存（clearCache），cookie、localStorage、IndexedDB 全部保留，
     * 所以登录状态和本地数据不受影响。
     */
    private fun applyWebCachePolicy() {
        val prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val lastVersion = prefs.getInt(KEY_LAST_VERSION_CODE, 0)
        val lastClearAt = prefs.getLong(KEY_LAST_CACHE_CLEAR_AT, 0L)
        val now = System.currentTimeMillis()
        val versionChanged = lastVersion != BuildConfig.VERSION_CODE
        val expired = now - lastClearAt > CACHE_MAX_AGE_MS
        if (!versionChanged && !expired) return
        webView.clearCache(true)
        prefs.edit()
            .putInt(KEY_LAST_VERSION_CODE, BuildConfig.VERSION_CODE)
            .putLong(KEY_LAST_CACHE_CLEAR_AT, now)
            .apply()
    }

    private fun ensurePushService() {
        if (Build.VERSION.SDK_INT >= 33 &&
            ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS)
            != PackageManager.PERMISSION_GRANTED
        ) {
            notifPermissionLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
        } else {
            PushService.start(this)
        }
    }

    override fun onDestroy() {
        CookieManager.getInstance().flush()
        fileCopyExecutor.shutdown()
        webView.destroy()
        super.onDestroy()
    }

    /** 暴露给网页的原生桥（网页侧可用 window.AndroidShell 特性检测壳环境）。 */
    inner class ShellBridge {
        @JavascriptInterface
        fun getVersion(): String = VERSION

        @JavascriptInterface
        fun configureLocalPush(token: String, enabled: Boolean) {
            LocalPushConfig.configure(this@MainActivity, token, enabled)
            runOnUiThread {
                stopService(Intent(this@MainActivity, PushService::class.java))
                ensurePushService()
            }
        }

        @JavascriptInterface
        fun localPushStatus(): String = org.json.JSONObject()
            .put("enabled", LocalPushConfig.enabled(this@MainActivity))
            .put("deviceId", LocalPushConfig.deviceId(this@MainActivity))
            .put("connectedAt", LocalPushConfig.connectedAt(this@MainActivity))
            .put("notificationsAllowed", getSystemService(android.app.NotificationManager::class.java).areNotificationsEnabled())
            .toString()



        /**
         * 供网页调用：清掉资源缓存并重新加载站点。
         * 网页侧将来想做一个"强制更新/刷新"按钮时，直接调
         * window.AndroidShell.clearCacheAndReload() 即可，不用再发一次 APK。
         * 同样只清资源缓存，不动登录和本地数据。
         */
        @JavascriptInterface
        fun clearCacheAndReload() {
            runOnUiThread {
                webView.clearCache(true)
                webView.loadUrl(SITE_URL)
            }
        }

        /** 打开本应用的系统设置页（引导用户关电池限制、开自启动）。 */
        @JavascriptInterface
        fun openAppSettings() {
            runCatching {
                startActivity(
                    Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:$packageName"))
                        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
                )
            }
        }

        /** 请求忽略电池优化（保活关键一步）。 */
        @SuppressLint("BatteryLife")
        @JavascriptInterface
        fun requestIgnoreBatteryOptimization() {
            runCatching {
                startActivity(
                    Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:$packageName"))
                        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
                )
            }
        }
    }
}
