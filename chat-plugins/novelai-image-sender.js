// Float 聊天插件 · NovelAI 生图发送器 v1.0.0
//
// 用途：在聊天「+」面板增加“AI 生图”。输入画面描述，生成、预览后，
//       作为“我”发送的真实图片写入当前会话，并可立即触发角色回复。
// 安装：聊天设置 → 扩展插件 → 导入插件 → 选择本文件。
// 网络：浏览器直接请求 NovelAI。国内网络通常需要手机开启代理。
// 隐私：NovelAI Token 只保存在本插件的本地私有存储中；卸载插件会清除。

export default {
  manifest: {
    id: "novelai-image-sender",
    name: "NovelAI 生图发送器",
    apiVersion: 1,
    version: "1.0.0",
    author: "Float personal",
    description: "在聊天中用 NovelAI 生图，预览后作为自己的图片发给角色。支持 V4、V4.5、V5。",
    permissions: ["chat.write", "network", "ui", "storage"],
    settings: [
      { key: "model", label: "模型", type: "select", default: "nai-diffusion-5-full", options: [
        { value: "nai-diffusion-5-full", label: "NovelAI Diffusion V5 Full" },
        { value: "nai-diffusion-5-curated", label: "NovelAI Diffusion V5 Curated" },
        { value: "nai-diffusion-4-5-full", label: "NovelAI Diffusion V4.5 Full" },
        { value: "nai-diffusion-4-5-curated", label: "NovelAI Diffusion V4.5 Curated" },
        { value: "nai-diffusion-4-full", label: "NovelAI Diffusion V4 Full" },
        { value: "nai-diffusion-4-curated-preview", label: "NovelAI Diffusion V4 Curated" },
        { value: "nai-diffusion-3", label: "NovelAI Diffusion V3" },
        { value: "nai-diffusion-furry-3", label: "NovelAI Diffusion Furry V3" }
      ] },
      { key: "resolution", label: "分辨率", type: "select", default: "832x1216", options: [
        { value: "832x1216", label: "832×1216（标准竖向）" },
        { value: "1216x832", label: "1216×832（标准横向）" },
        { value: "1024x1024", label: "1024×1024（正方形）" },
        { value: "1024x1536", label: "1024×1536（大图竖向）" },
        { value: "1536x1024", label: "1536×1024（大图横向）" },
        { value: "512x768", label: "512×768（小图竖向）" },
        { value: "768x512", label: "768×512（小图横向）" }
      ] },
      { key: "sampler", label: "采样器", type: "select", default: "k_euler", options: [
        { value: "k_euler", label: "Euler" },
        { value: "k_euler_ancestral", label: "Euler Ancestral" },
        { value: "k_dpmpp_2m", label: "DPM++ 2M" },
        { value: "k_dpmpp_2s_ancestral", label: "DPM++ 2S Ancestral" },
        { value: "k_dpmpp_sde", label: "DPM++ SDE" },
        { value: "ddim", label: "DDIM" }
      ] },
      { key: "noiseSchedule", label: "调度器", type: "select", default: "karras", options: [
        { value: "karras", label: "Karras" },
        { value: "native", label: "Native" },
        { value: "exponential", label: "Exponential" },
        { value: "polyexponential", label: "Polyexponential" }
      ] },
      { key: "steps", label: "步数（1–50）", type: "number", default: 28 },
      { key: "scale", label: "提示词相关度 CFG（1–30）", type: "number", default: 6 },
      { key: "positivePrompt", label: "固定正面提示词", type: "text", default: "masterpiece, best quality, amazing quality, very aesthetic, absurdres" },
      { key: "negativePrompt", label: "固定负面提示词", type: "text", default: "lowres, bad anatomy, bad hands, text, error, missing fingers, extra digit, fewer digits, cropped, worst quality, low quality, jpeg artifacts, signature, watermark, username, blurry, artist name" },
      { key: "qualityToggle", label: "启用质量词 Quality+", type: "boolean", default: true },
      { key: "smea", label: "启用 SMEA（V5 会自动忽略）", type: "boolean", default: false },
      { key: "autoReply", label: "发送图片后让角色立即回复", type: "boolean", default: true },
      { key: "webpQuality", label: "聊天图片压缩质量（0.5–1）", type: "number", default: 0.9 }
    ]
  },

  setup(ctx) {
    var activeSessionId = "";
    var TOKEN_KEY = "novelai-token";
    var REQUEST_REPLY_EVENT = "chat-request-reply";

    function S(key, fallback) {
      try {
        var value = ctx.system.settings.get(key);
        return value === undefined || value === null || value === "" ? fallback : value;
      } catch (_) {
        return fallback;
      }
    }

    function token() {
      try { return String(ctx.system.storage.get(TOKEN_KEY) || "").trim(); }
      catch (_) { return ""; }
    }

    function clamp(value, min, max, fallback) {
      var number = Number(value);
      if (!isFinite(number)) return fallback;
      return Math.max(min, Math.min(max, number));
    }

    function log() {
      try { ctx.system.log.apply(null, ["[NovelAI 生图发送器]"].concat([].slice.call(arguments))); }
      catch (_) {}
    }

    function escapeHtml(value) {
      return String(value == null ? "" : value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/\"/g, "&quot;")
        .replace(/'/g, "&#39;");
    }

    function currentSessionId() {
      if (activeSessionId && ctx.data.sessions.get(activeSessionId)) return activeSessionId;
      var sessions = ctx.data.sessions.list() || [];
      if (!sessions.length) return "";
      sessions = sessions.slice().sort(function (a, b) {
        return String(b.updatedAt || "").localeCompare(String(a.updatedAt || ""));
      });
      return sessions[0] && sessions[0].id ? String(sessions[0].id) : "";
    }

    ctx.hooks.on("session.opened", function (payload) {
      activeSessionId = payload && payload.sessionId ? String(payload.sessionId) : "";
    });

    ctx.ui.injectCSS([
      ".fais-toolbar{padding:2px 4px 8px;display:flex;justify-content:flex-start}",
      ".fais-open{appearance:none;border:0;background:transparent;color:var(--c-text,#222);display:flex;flex-direction:column;align-items:center;gap:5px;padding:6px 9px;min-width:64px;font:inherit}",
      ".fais-open-icon{width:48px;height:48px;border-radius:14px;display:grid;place-items:center;background:var(--c-input,#f2f3f5);font-size:23px}",
      ".fais-open-label{font-size:11px;line-height:1.2}",
      ".fais-modal{width:min(92vw,430px);max-height:min(82vh,720px);overflow:auto;padding:18px;color:var(--c-text,#1d2433);box-sizing:border-box}",
      ".fais-title{font-size:19px;font-weight:750;margin:0 0 4px}",
      ".fais-sub{font-size:12px;opacity:.62;line-height:1.55;margin-bottom:14px}",
      ".fais-label{font-size:12px;font-weight:650;margin:12px 0 6px;display:block}",
      ".fais-textarea{width:100%;min-height:112px;resize:vertical;border:1px solid color-mix(in srgb,currentColor 14%,transparent);border-radius:14px;padding:11px 12px;background:var(--c-input,#f6f7f9);color:inherit;font:inherit;line-height:1.55;box-sizing:border-box;outline:none}",
      ".fais-textarea:focus{border-color:#775cff;box-shadow:0 0 0 3px rgba(119,92,255,.12)}",
      ".fais-meta{font-size:11px;opacity:.58;margin-top:7px;line-height:1.45}",
      ".fais-status{font-size:12px;line-height:1.5;min-height:18px;margin:10px 0;color:#7259d9;white-space:pre-wrap;word-break:break-word}",
      ".fais-status.error{color:#d64b4b}",
      ".fais-preview{display:none;width:100%;max-height:48vh;object-fit:contain;background:#111;border-radius:14px;margin-top:10px}",
      ".fais-actions{display:flex;gap:9px;margin-top:13px;position:sticky;bottom:-18px;padding:10px 0 2px;background:color-mix(in srgb,var(--c-bg,#fff) 94%,transparent)}",
      ".fais-btn{appearance:none;border:0;border-radius:13px;padding:11px 14px;font:inherit;font-size:14px;font-weight:650;flex:1;background:var(--c-input,#edf0f4);color:inherit}",
      ".fais-btn.primary{background:#171d2c;color:#fff}",
      ".fais-btn.send{background:#32c75c;color:#fff;display:none}",
      ".fais-btn:disabled{opacity:.45}",
      ".fais-token-box{padding:12px 16px 15px;border-top:1px solid color-mix(in srgb,currentColor 9%,transparent)}",
      ".fais-token-title{font-size:13px;font-weight:700;margin-bottom:5px}",
      ".fais-token-note{font-size:11px;opacity:.6;line-height:1.5;margin-bottom:8px}",
      ".fais-token-row{display:flex;gap:7px}",
      ".fais-token-input{min-width:0;flex:1;border:1px solid color-mix(in srgb,currentColor 15%,transparent);border-radius:10px;padding:9px 10px;background:var(--c-input,#f5f6f8);color:inherit;font:inherit}",
      ".fais-token-toggle{border:0;border-radius:10px;padding:0 11px;background:var(--c-input,#eef0f4);color:inherit}"
    ].join("\n"));

    // Token 用自绘 password 输入保存，避免插件管理页把它以明文文本框显示。
    ctx.ui.slot("settings.section", function (el) {
      el.innerHTML = '<div class="fais-token-box">'
        + '<div class="fais-token-title">NovelAI API Token</div>'
        + '<div class="fais-token-note">仅保存在这个浏览器的插件私有存储中。卸载插件会清除；更新同一插件会保留。</div>'
        + '<div class="fais-token-row">'
        + '<input class="fais-token-input" type="password" autocomplete="off" placeholder="粘贴 Persistent API Token">'
        + '<button class="fais-token-toggle" type="button">显示</button>'
        + '</div></div>';
      var input = el.querySelector(".fais-token-input");
      var toggle = el.querySelector(".fais-token-toggle");
      input.value = token();
      var save = function () {
        try { ctx.system.storage.set(TOKEN_KEY, String(input.value || "").trim()); }
        catch (error) { log("保存 Token 失败", error && error.message || error); }
      };
      input.addEventListener("change", save);
      input.addEventListener("blur", save);
      toggle.addEventListener("click", function () {
        var show = input.type === "password";
        input.type = show ? "text" : "password";
        toggle.textContent = show ? "隐藏" : "显示";
      });
      return function () { save(); el.replaceChildren(); };
    });

    function resolution() {
      var raw = String(S("resolution", "832x1216"));
      var match = /^(\d+)x(\d+)$/.exec(raw);
      return match ? { value: raw, width: Number(match[1]), height: Number(match[2]) }
        : { value: "832x1216", width: 832, height: 1216 };
    }

    function isV5(model) { return /diffusion-5(?:-|$)/i.test(model); }
    function usesStructuredPrompt(model) { return /diffusion-(?:4|5)(?:-|$)/i.test(model); }

    function buildParameters(model, prompt) {
      var negativePrompt = String(S("negativePrompt", ""));
      var v5 = isV5(model);
      var common = {
        width: resolution().width,
        height: resolution().height,
        scale: clamp(S("scale", 6), 1, 30, 6),
        sampler: String(S("sampler", "k_euler")),
        steps: Math.round(clamp(S("steps", 28), 1, 50, 28)),
        n_samples: 1,
        ucPreset: 0,
        qualityToggle: S("qualityToggle", true) !== false,
        dynamic_thresholding: false,
        controlnet_strength: 1,
        legacy: false,
        add_original_image: false,
        cfg_rescale: 0,
        noise_schedule: v5 ? "karras" : String(S("noiseSchedule", "karras")),
        negative_prompt: negativePrompt
      };
      if (!usesStructuredPrompt(model)) {
        common.sm = S("smea", false) === true;
        common.sm_dyn = false;
        common.uncond_scale = 1;
        return common;
      }
      common.params_version = v5 ? 4 : 3;
      if (!v5) common.autoSmea = false;
      if (v5 && common.qualityToggle) common.tag_hint_qt = 1;
      common.legacy_v3_extend = false;
      common.use_coords = false;
      common.image_format = "png";
      common.v4_prompt = {
        caption: { base_caption: prompt, char_captions: [] },
        use_coords: false,
        use_order: true
      };
      common.v4_negative_prompt = {
        caption: { base_caption: negativePrompt, char_captions: [] }
      };
      return common;
    }

    function decodeName(bytes) {
      try { return new TextDecoder("utf-8").decode(bytes); }
      catch (_) {
        var result = "";
        for (var i = 0; i < bytes.length; i++) result += String.fromCharCode(bytes[i]);
        return result;
      }
    }

    function u16(view, offset) { return view.getUint16(offset, true); }
    function u32(view, offset) { return view.getUint32(offset, true); }

    async function inflateRaw(bytes) {
      if (typeof DecompressionStream === "undefined") {
        throw new Error("当前浏览器不能解压 NovelAI 返回的图片，请升级 Safari/iOS 后重试。");
      }
      var stream;
      try { stream = new DecompressionStream("deflate-raw"); }
      catch (_) { throw new Error("当前浏览器不支持 ZIP 解压，请升级 Safari/iOS 后重试。"); }
      return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer());
    }

    async function extractImageFromZip(arrayBuffer) {
      var bytes = new Uint8Array(arrayBuffer);
      var view = new DataView(arrayBuffer);
      var entries = [];
      // 从 ZIP 末尾的 EOCD 读取中央目录，避免在 PNG 压缩数据里误撞签名。
      var eocd = -1;
      for (var tail = Math.max(0, bytes.length - 65557); tail + 22 <= bytes.length; tail++) {
        if (u32(view, tail) === 0x06054b50) eocd = tail;
      }
      if (eocd < 0) throw new Error("NovelAI 返回的图片压缩包不完整。");
      var entryCount = u16(view, eocd + 10);
      var offset = u32(view, eocd + 16);
      for (var entryIndex = 0; entryIndex < entryCount && offset + 46 <= bytes.length; entryIndex++) {
        if (u32(view, offset) !== 0x02014b50) break;
        var method = u16(view, offset + 10);
        var compressedSize = u32(view, offset + 20);
        var nameLength = u16(view, offset + 28);
        var extraLength = u16(view, offset + 30);
        var commentLength = u16(view, offset + 32);
        var localOffset = u32(view, offset + 42);
        var name = decodeName(bytes.slice(offset + 46, offset + 46 + nameLength));
        if (name && !/\/$/.test(name)) entries.push({ name: name, method: method, compressedSize: compressedSize, localOffset: localOffset });
        offset += 46 + nameLength + extraLength + commentLength;
      }
      if (!entries.length) throw new Error("NovelAI 返回的压缩包里没有找到图片。");
      var entry = entries.find(function (item) { return /\.(?:png|webp|jpe?g)$/i.test(item.name); }) || entries[0];
      if (u32(view, entry.localOffset) !== 0x04034b50) throw new Error("NovelAI 图片压缩包结构异常。");
      var localNameLength = u16(view, entry.localOffset + 26);
      var localExtraLength = u16(view, entry.localOffset + 28);
      var dataOffset = entry.localOffset + 30 + localNameLength + localExtraLength;
      var compressed = bytes.slice(dataOffset, dataOffset + entry.compressedSize);
      var output;
      if (entry.method === 0) output = compressed;
      else if (entry.method === 8) output = await inflateRaw(compressed);
      else throw new Error("NovelAI 返回了暂不支持的 ZIP 压缩格式（" + entry.method + "）。");
      var mime = /\.webp$/i.test(entry.name) ? "image/webp" : /\.jpe?g$/i.test(entry.name) ? "image/jpeg" : "image/png";
      return new Blob([output], { type: mime });
    }

    async function parseNovelAiResponse(response) {
      if (!response.ok) {
        var detail = await response.text().catch(function () { return ""; });
        if (response.status === 401 || response.status === 403) throw new Error("NovelAI Token 无效或已失效。");
        throw new Error("NovelAI 接口报错 " + response.status + (detail ? "：" + detail.slice(0, 260) : ""));
      }
      var buffer = await response.arrayBuffer();
      var bytes = new Uint8Array(buffer);
      var type = String(response.headers.get("content-type") || "").toLowerCase();
      var isZip = (bytes[0] === 0x50 && bytes[1] === 0x4b) || type.indexOf("zip") >= 0;
      if (isZip) return extractImageFromZip(buffer);
      var isPng = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
      return new Blob([buffer], { type: type.indexOf("image/") === 0 ? type.split(";")[0] : isPng ? "image/png" : "application/octet-stream" });
    }

    async function generateImage(description, signal) {
      var apiKey = token();
      if (!apiKey) throw new Error("请先到插件设置中填写 NovelAI API Token。");
      var model = String(S("model", "nai-diffusion-5-full"));
      var positive = String(S("positivePrompt", "")).trim();
      var prompt = [positive, String(description || "").trim()].filter(Boolean).join(", ");
      var response;
      var requestController = new AbortController();
      var timedOut = false;
      var onAbort = function () { requestController.abort(); };
      if (signal) signal.addEventListener("abort", onAbort, { once: true });
      var timeout = setTimeout(function () { timedOut = true; requestController.abort(); }, 180000);
      try {
        response = await ctx.system.fetch("https://image.novelai.net/ai/generate-image", {
          method: "POST",
          headers: { Authorization: "Bearer " + apiKey, "Content-Type": "application/json" },
          signal: requestController.signal,
          body: JSON.stringify({
            input: prompt,
            model: model,
            action: "generate",
            parameters: buildParameters(model, prompt)
          })
        });
      } catch (error) {
        if (signal && signal.aborted) throw new Error("已取消生成。");
        if (timedOut) throw new Error("NovelAI 请求超时（180 秒未返回），请稍后重试。");
        if (error instanceof TypeError) throw new Error("连接 NovelAI 失败。请确认手机代理已开启，然后重试。");
        throw error;
      } finally {
        clearTimeout(timeout);
        if (signal) signal.removeEventListener("abort", onAbort);
      }
      return { blob: await parseNovelAiResponse(response), model: model, prompt: prompt };
    }

    function blobToDataUrl(blob) {
      return new Promise(function (resolve, reject) {
        var reader = new FileReader();
        reader.onload = function () { resolve(String(reader.result || "")); };
        reader.onerror = function () { reject(reader.error || new Error("图片读取失败")); };
        reader.readAsDataURL(blob);
      });
    }

    async function compressForChat(blob) {
      var objectUrl = URL.createObjectURL(blob);
      try {
        var image = await new Promise(function (resolve, reject) {
          var img = new Image();
          img.onload = function () { resolve(img); };
          img.onerror = function () { reject(new Error("生成图片解码失败")); };
          img.src = objectUrl;
        });
        var canvas = document.createElement("canvas");
        canvas.width = image.naturalWidth || image.width;
        canvas.height = image.naturalHeight || image.height;
        var context = canvas.getContext("2d");
        if (!context) return blobToDataUrl(blob);
        context.drawImage(image, 0, 0);
        var quality = clamp(S("webpQuality", 0.9), 0.5, 1, 0.9);
        var compressed = await new Promise(function (resolve) {
          canvas.toBlob(function (value) { resolve(value); }, "image/webp", quality);
        });
        return blobToDataUrl(compressed || blob);
      } catch (_) {
        return blobToDataUrl(blob);
      } finally {
        URL.revokeObjectURL(objectUrl);
      }
    }

    function sendImage(sessionId, description, result, dataUrl) {
      var session = ctx.data.sessions.get(sessionId);
      if (!session) throw new Error("当前会话已经不存在，请重新进入聊天。");
      var message = ctx.data.messages.push({
        sessionId: sessionId,
        role: "user",
        content: "",
        mediaType: "image",
        mediaUrl: dataUrl,
        mediaData: {
          label: description,
          generatedBy: "novelai-image-sender",
          generatedModel: result.model,
          generatedPrompt: result.prompt
        }
      });
      if (!message || !message.id) throw new Error("图片消息写入失败。");
      if (S("autoReply", true) !== false && typeof window !== "undefined") {
        var detail = { sessionId: sessionId, handled: false, busy: false };
        window.dispatchEvent(new CustomEvent(REQUEST_REPLY_EVENT, { detail: detail }));
        if (!detail.handled) {
          ctx.ui.toast("图片已发送；点聊天框右侧星星可让角色回复");
        }
      }
      return message;
    }

    function openGenerator(sessionId) {
      if (!sessionId || !ctx.data.sessions.get(sessionId)) {
        ctx.ui.toast("没有识别到当前聊天，请退出后重新进入一次会话");
        return;
      }
      if (!token()) {
        ctx.ui.toast("请先到聊天设置 → 扩展插件中填写 NovelAI Token");
        return;
      }
      var controller = null;
      var previewUrl = "";
      var generated = null;
      var sendDataUrl = "";
      var modal = ctx.ui.openModal(function (el, api) {
        var model = String(S("model", "nai-diffusion-5-full"));
        var size = resolution().value;
        el.classList.add("fais-modal");
        el.innerHTML = '<h2 class="fais-title">AI 生图</h2>'
          + '<div class="fais-sub">生成完成后先预览，确认后才会发给当前角色。</div>'
          + '<label class="fais-label">画面描述</label>'
          + '<textarea class="fais-textarea" placeholder="例如：雨夜的便利店门口，女孩撑着透明伞回头微笑，霓虹灯倒映在积水里"></textarea>'
          + '<div class="fais-meta">' + escapeHtml(model) + ' · ' + escapeHtml(size) + ' · 浏览器直连</div>'
          + '<div class="fais-status" aria-live="polite"></div>'
          + '<img class="fais-preview" alt="NovelAI 生成预览">'
          + '<div class="fais-actions">'
          + '<button class="fais-btn cancel" type="button">关闭</button>'
          + '<button class="fais-btn primary generate" type="button">生成预览</button>'
          + '<button class="fais-btn send" type="button">发送给角色</button>'
          + '</div>';
        var textarea = el.querySelector(".fais-textarea");
        var status = el.querySelector(".fais-status");
        var preview = el.querySelector(".fais-preview");
        var cancel = el.querySelector(".fais-btn.cancel");
        var generate = el.querySelector(".fais-btn.generate");
        var send = el.querySelector(".fais-btn.send");

        function setBusy(busy) {
          textarea.disabled = busy;
          generate.disabled = busy;
          send.disabled = busy;
          generate.textContent = busy ? "生成中…" : (generated ? "重新生成" : "生成预览");
        }
        function setStatus(text, error) {
          status.textContent = text || "";
          status.classList.toggle("error", !!error);
        }

        cancel.onclick = function () {
          if (controller) controller.abort();
          api.close();
        };
        generate.onclick = async function () {
          var description = String(textarea.value || "").trim();
          if (!description) { setStatus("请先写画面描述。", true); textarea.focus(); return; }
          if (controller) controller.abort();
          controller = new AbortController();
          generated = null;
          sendDataUrl = "";
          send.style.display = "none";
          preview.style.display = "none";
          if (previewUrl) { URL.revokeObjectURL(previewUrl); previewUrl = ""; }
          setBusy(true);
          setStatus("正在连接 NovelAI 生成图片，请保持页面开启…", false);
          try {
            var result = await generateImage(description, controller.signal);
            if (controller.signal.aborted) return;
            setStatus("图片已生成，正在整理成聊天图片…", false);
            var dataUrl = await compressForChat(result.blob);
            if (controller.signal.aborted) return;
            generated = result;
            sendDataUrl = dataUrl;
            previewUrl = URL.createObjectURL(result.blob);
            preview.src = previewUrl;
            preview.style.display = "block";
            send.style.display = "block";
            setStatus("生成完成。确认画面满意后再发送。", false);
          } catch (error) {
            var message = error && error.message ? error.message : String(error);
            if (message !== "已取消生成。") setStatus(message, true);
            log("生成失败", message);
          } finally {
            controller = null;
            setBusy(false);
          }
        };
        send.onclick = function () {
          var description = String(textarea.value || "").trim();
          if (!generated || !sendDataUrl) { setStatus("请先生成预览。", true); return; }
          try {
            sendImage(sessionId, description, generated, sendDataUrl);
            ctx.ui.toast("AI 图片已发送给角色");
            api.close();
          } catch (error) {
            setStatus(error && error.message ? error.message : String(error), true);
          }
        };
        setTimeout(function () { textarea.focus(); }, 50);
        return function () {
          if (controller) controller.abort();
          if (previewUrl) URL.revokeObjectURL(previewUrl);
          el.replaceChildren();
        };
      });
      return modal;
    }

    ctx.ui.slot("chat.inputToolbar", function (el) {
      el.classList.add("fais-toolbar");
      var button = document.createElement("button");
      button.type = "button";
      button.className = "fais-open";
      button.innerHTML = '<span class="fais-open-icon">✦</span><span class="fais-open-label">AI 生图</span>';
      button.onclick = function () { openGenerator(currentSessionId()); };
      el.appendChild(button);
      return function () { el.replaceChildren(); };
    });
  }
};
