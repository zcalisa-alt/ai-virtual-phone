// Float 聊天插件 · AI 生图发送器 v1.1.0
//
// 用途：在聊天「+」面板增加“AI 生图”。输入画面描述，生成、预览后，
//       作为“我”发送的真实图片写入当前会话，并可立即触发角色回复。
// 配置：直接跟随 Float「设置 → 图像生成」中当前选择的提供方、Base URL、
//       API Key、模型、预设与请求方式，插件不重复保存任何生图密钥。
// 安装：聊天设置 → 扩展插件 → 导入插件 → 选择本文件。

export default {
  manifest: {
    id: "novelai-image-sender",
    name: "AI 生图发送器",
    apiVersion: 1,
    version: "1.1.0",
    author: "Float personal",
    description: "使用 Float 当前的图像生成配置生图，预览后作为自己的图片发给角色。兼容 OpenAI、GPT Image、NovelAI、Flux、SD 等。",
    permissions: ["chat.write", "ai", "ui"],
    settings: [
      { key: "autoReply", label: "发送图片后让角色立即回复", type: "boolean", default: true }
    ]
  },

  setup(ctx) {
    var activeSessionId = "";
    var REQUEST_REPLY_EVENT = "chat-request-reply";

    // 1.0.x 曾在插件私有存储里保存 NovelAI Token；1.1 起统一使用系统生图配置，
    // 升级时主动清理这份不再使用的旧密钥。
    try { ctx.system.storage.remove("novelai-token"); }
    catch (_) {}

    function S(key, fallback) {
      try {
        var value = ctx.system.settings.get(key);
        return value === undefined || value === null || value === "" ? fallback : value;
      } catch (_) {
        return fallback;
      }
    }

    function log() {
      try { ctx.system.log.apply(null, ["[AI 生图发送器]"].concat([].slice.call(arguments))); }
      catch (_) {}
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
      ".fais-toolbar{display:flex;justify-content:center;min-width:0}",
      ".fais-open{appearance:none;border:0;background:transparent;color:var(--c-text,#222);display:flex;flex-direction:column;align-items:center;gap:6px;padding:0;width:100%;min-width:0;font:inherit;cursor:pointer}",
      ".fais-open-icon{width:44px;height:44px;border-radius:12px;border:1px solid transparent;display:grid;place-items:center;background:var(--c-panel,#f2f3f5);box-shadow:0 1px 3px rgba(0,0,0,.05);font-size:20px;box-sizing:border-box}",
      ".fais-open-label{font-size:11px;line-height:1.2;color:var(--c-text,#222)}",
      ".fais-modal{width:min(92vw,430px);max-height:min(82vh,720px);overflow:auto;padding:18px;color:var(--c-text,#1d2433);box-sizing:border-box}",
      ".fais-title{font-size:19px;font-weight:750;margin:0 0 4px}",
      ".fais-sub{font-size:12px;opacity:.68;line-height:1.55;margin-bottom:14px}",
      ".fais-config{font-size:12px;line-height:1.5;padding:10px 12px;border-radius:12px;background:color-mix(in srgb,#6e59d9 9%,transparent);color:#6753c9;margin-bottom:12px}",
      ".fais-label{font-size:12px;font-weight:650;margin:12px 0 6px;display:block}",
      ".fais-textarea{width:100%;min-height:112px;resize:vertical;border:1px solid color-mix(in srgb,currentColor 14%,transparent);border-radius:14px;padding:11px 12px;background:var(--c-input,#f6f7f9);color:inherit;font:inherit;line-height:1.55;box-sizing:border-box;outline:none}",
      ".fais-textarea:focus{border-color:#775cff;box-shadow:0 0 0 3px rgba(119,92,255,.12)}",
      ".fais-status{font-size:12px;line-height:1.5;min-height:18px;margin:10px 0;color:#7259d9;white-space:pre-wrap;word-break:break-word}",
      ".fais-status.error{color:#d64b4b}",
      ".fais-preview{display:none;width:100%;max-height:48vh;object-fit:contain;background:#111;border-radius:14px;margin-top:10px}",
      ".fais-actions{display:flex;gap:9px;margin-top:13px;position:sticky;bottom:-18px;padding:10px 0 2px;background:color-mix(in srgb,var(--c-bg,#fff) 94%,transparent)}",
      ".fais-btn{appearance:none;border:0;border-radius:13px;padding:11px 14px;font:inherit;font-size:14px;font-weight:650;flex:1;background:var(--c-input,#edf0f4);color:inherit}",
      ".fais-btn.primary{background:#171d2c;color:#fff}",
      ".fais-btn.send{background:#32c75c;color:#fff;display:none}",
      ".fais-btn:disabled{opacity:.45}"
    ].join("\n"));

    function sendImage(sessionId, description, result) {
      var session = ctx.data.sessions.get(sessionId);
      if (!session) throw new Error("当前会话已经不存在，请重新进入聊天。");
      var message = ctx.data.messages.push({
        sessionId: sessionId,
        role: "user",
        content: "",
        mediaType: "image",
        mediaUrl: result.mediaRef,
        mediaData: {
          label: description,
          generatedBy: "ai-image-sender",
          generatedPrompt: result.prompt,
          revisedPrompt: result.revisedPrompt || ""
        }
      });
      if (!message || !message.id) throw new Error("图片消息写入失败。");
      if (S("autoReply", true) !== false && typeof window !== "undefined") {
        var detail = { sessionId: sessionId, handled: false, busy: false };
        window.dispatchEvent(new CustomEvent(REQUEST_REPLY_EVENT, { detail: detail }));
        if (!detail.handled) ctx.ui.toast("图片已发送；点聊天框右侧星星可让角色回复");
      }
      return message;
    }

    function openGenerator(sessionId) {
      if (!sessionId || !ctx.data.sessions.get(sessionId)) {
        ctx.ui.toast("没有识别到当前聊天，请退出后重新进入一次会话");
        return;
      }
      if (!ctx.ai || typeof ctx.ai.generateImage !== "function") {
        ctx.ui.toast("当前 Float 版本还不支持系统生图插件，请先更新网页版本");
        return;
      }

      var controller = null;
      var generated = null;
      var modal = ctx.ui.openModal(function (el, api) {
        el.classList.add("fais-modal");
        el.innerHTML = '<h2 class="fais-title">AI 生图</h2>'
          + '<div class="fais-sub">生成完成后先预览，确认后才会发给当前角色。</div>'
          + '<div class="fais-config">跟随「设置 → 图像生成」中当前选中的提供方、Base URL、API Key、模型、预设和请求方式。</div>'
          + '<label class="fais-label">画面描述</label>'
          + '<textarea class="fais-textarea" placeholder="例如：一只黑白相间的阿拉斯加雪橇犬坐在雪地里，真实摄影，毛发清晰，正面全身照"></textarea>'
          + '<div class="fais-status" aria-live="polite"></div>'
          + '<img class="fais-preview" alt="AI 生成预览">'
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
          if (!description) {
            setStatus("请先写画面描述。", true);
            textarea.focus();
            return;
          }
          if (controller) controller.abort();
          controller = new AbortController();
          generated = null;
          send.style.display = "none";
          preview.style.display = "none";
          preview.removeAttribute("src");
          setBusy(true);
          setStatus("正在使用当前图像生成配置生成图片，请保持页面开启…", false);
          try {
            var result = await ctx.ai.generateImage({
              description: description,
              signal: controller.signal
            });
            if (controller.signal.aborted) return;
            if (!result) {
              throw new Error("图像生成尚未启用或配置不完整。请先到 设置 → 图像生成，选择提供方并填写 Base URL、API Key 和模型。");
            }
            generated = result;
            preview.src = result.dataUrl;
            preview.style.display = "block";
            send.style.display = "block";
            setStatus("生成完成。确认画面满意后再发送。", false);
          } catch (error) {
            var message = error && error.message ? error.message : String(error);
            if (!(controller && controller.signal.aborted)) setStatus(message, true);
            log("生成失败", message);
          } finally {
            controller = null;
            setBusy(false);
          }
        };

        send.onclick = function () {
          var description = String(textarea.value || "").trim();
          if (!generated || !generated.mediaRef) {
            setStatus("请先生成预览。", true);
            return;
          }
          try {
            sendImage(sessionId, description, generated);
            ctx.ui.toast("AI 图片已发送给角色");
            api.close();
          } catch (error) {
            setStatus(error && error.message ? error.message : String(error), true);
          }
        };

        setTimeout(function () { textarea.focus(); }, 50);
        return function () {
          if (controller) controller.abort();
          el.replaceChildren();
        };
      });
      return modal;
    }

    ctx.ui.slot("chat.inputToolbar", function (el, props) {
      el.classList.add("fais-toolbar");
      var button = document.createElement("button");
      button.type = "button";
      button.className = "fais-open";
      button.innerHTML = '<span class="fais-open-icon">✦</span><span class="fais-open-label">AI 生图</span>';
      button.onclick = function () {
        openGenerator(props && props.sessionId ? String(props.sessionId) : currentSessionId());
      };
      el.appendChild(button);
      return function () { el.replaceChildren(); };
    });
  }
};
