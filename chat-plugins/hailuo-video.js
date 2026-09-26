// 小手机聊天插件 · 海螺视频 v1.0.3
// 用途：让角色在聊天里发一段真实生成的短视频（MiniMax 海螺视频 API）。
// 安装：聊天设置 → 扩展插件 → 导入插件 → 选择本文件。
// 注意：本插件与小手机宿主同环境执行（无沙箱），请只安装信任来源的插件。
//
// 配置项说明（插件卡片齿轮里设置，文本框为失焦保存，填完请点空白处）：
//   apiKey        必填，MiniMax API Key
//   baseUrl       默认 https://api.minimax.cn；如报鉴权失败可试 https://api.minimaxi.com
//   model         默认 MiniMax-Hailuo-2.3
//   resolution    720P / 768P / 1080P（1080P 仅支持 6 秒）
//   duration      6 / 10 秒（10 秒仅 Hailuo 系列，且不支持 1080P）
//   refSource     人物参考图：none / avatar / custom
//   refUrl        自定义参考图（公网直链或 data URL）
//   allowProactive 允许角色主动发（靠提示词，不保证每次命中）
//   allowGroup    群聊里也允许主动发
//   dailyLimit    每天最多主动发几条（0 = 关闭主动发）
//   minInterval   两条之间最少间隔分钟
//   allowManual   长按消息可手动生成
//   rewriteManual 手动触发时先用 AI 把消息转写成画面描述（治"画面莫名其妙"）
//   styleSuffix   固定拼在提示词末尾的风格词

export default {
  manifest: {
    id: "hailuo-video",
    name: "海螺视频",
    apiVersion: 1,
    version: "1.0.3",
    author: "小坊",
    description: "让角色在聊天里发一段真实生成的短视频（MiniMax 海螺）。可限制发送频率、时长与清晰度。",
    permissions: ["chat.read", "chat.write", "ai", "network", "ui", "storage"],
    settings: [
      { key: "apiKey", label: "MiniMax API Key（填完请点空白处保存）", type: "text", default: "" },
      { key: "baseUrl", label: "接口地址", type: "text", default: "https://api.minimax.cn" },
      { key: "model", label: "模型", type: "select", default: "MiniMax-Hailuo-2.3", options: [
        { value: "MiniMax-Hailuo-2.3", label: "Hailuo 2.3（画质最好）" },
        { value: "MiniMax-Hailuo-02", label: "Hailuo 02" },
        { value: "T2V-01-Director", label: "T2V-01-Director" },
        { value: "T2V-01", label: "T2V-01（最快最省）" }
      ] },
      { key: "resolution", label: "清晰度", type: "select", default: "768P", options: [
        { value: "720P", label: "720P" },
        { value: "768P", label: "768P" },
        { value: "1080P", label: "1080P（仅 6 秒）" }
      ] },
      { key: "duration", label: "时长", type: "select", default: "6", options: [
        { value: "6", label: "6 秒" },
        { value: "10", label: "10 秒（Hailuo 系列）" }
      ] },
      { key: "refSource", label: "人物参考图", type: "select", default: "none", options: [
        { value: "none", label: "不用（纯文字生成）" },
        { value: "avatar", label: "用当前角色头像（本地头像即可，无需图床）" },
        { value: "custom", label: "自定义链接 / data URL" }
      ] },
      { key: "refUrl", label: "自定义参考图链接（填完请点空白处保存）", type: "text", default: "" },
      { key: "allowProactive", label: "允许角色主动发视频", type: "boolean", default: true },
      { key: "allowGroup", label: "群聊里也允许主动发", type: "boolean", default: false },
      { key: "dailyLimit", label: "每天最多主动发（条，0 = 关闭主动发）", type: "number", default: 3 },
      { key: "minInterval", label: "两条之间最少间隔（分钟）", type: "number", default: 30 },
      { key: "allowManual", label: "长按消息可手动生成", type: "boolean", default: true },
      { key: "rewriteManual", label: "手动触发时先用 AI 转写画面描述（推荐开）", type: "boolean", default: true },
      { key: "styleSuffix", label: "风格后缀（拼在提示词末尾，可留空）", type: "text", default: "电影感画质，柔和体积光，自然光，细节清晰" }
    ]
  },

  setup(ctx) {
    var KIND = "hailuo_video";
    var MARK = /\[视频[:：]([^\]\n]{1,300})\]/;
    var inflight = {};
    var recs = {};
    var sids = {};

    function S(k) { try { return ctx.system.settings.get(k); } catch (e) { return null; } }
    function log() { try { ctx.system.log.apply(null, ["[海螺视频]"].concat([].slice.call(arguments))); } catch (e) {} }
    function rec(id) { return recs[id] || {}; }

    var ERR = {
      1002: "触发限流，稍后再试", 1039: "触发限流，稍后再试",
      1004: "API Key 鉴权失败", 2049: "API Key 无效",
      1008: "MiniMax 余额不足", 1026: "输入内容敏感",
      1027: "生成内容敏感", 2013: "参数异常",
      1013: "服务内部错误", 1001: "请求超时", 1000: "未知错误"
    };
    var STATUS = { Preparing: "准备中", Queueing: "排队中", Processing: "生成中" };

    function api(path, opt) {
      var key = String(S("apiKey") || "").trim();
      if (!key) return Promise.reject(new Error("尚未填写 MiniMax API Key（插件设置里填，注意点空白处保存）"));
      var base = String(S("baseUrl") || "https://api.minimax.cn").trim().replace(/\/+$/, "");
      var url = base + path;
      if (opt && opt.query) {
        var q = [];
        var ks = Object.keys(opt.query);
        for (var i = 0; i < ks.length; i++) {
          q.push(encodeURIComponent(ks[i]) + "=" + encodeURIComponent(String(opt.query[ks[i]])));
        }
        if (q.length) url += "?" + q.join("&");
      }
      var init = {
        method: (opt && opt.method) || "GET",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + key }
      };
      if (opt && opt.body) init.body = JSON.stringify(opt.body);
      return ctx.system.fetch(url, init).then(function (res) {
        return res.json().catch(function () { return null; }).then(function (data) {
          if (!res.ok) throw new Error("请求失败 HTTP " + res.status + (data && data.base_resp && data.base_resp.status_msg ? "：" + data.base_resp.status_msg : ""));
          var br = data && data.base_resp;
          if (br && br.status_code && br.status_code !== 0) {
            var e = new Error((ERR[br.status_code] || "接口错误") + "（" + br.status_code + "）" + (br.status_msg ? "：" + br.status_msg : ""));
            e.code = br.status_code;
            throw e;
          }
          return data;
        });
      }, function (e) {
        throw new Error("网络请求失败（可能是跨域被拦）：" + ((e && e.message) || e));
      });
    }

    // ── 配额（失败不扣，只更新冷却时间）──
    function todayKey() {
      var d = new Date();
      return "used:" + d.getFullYear() + "-" + (d.getMonth() + 1) + "-" + d.getDate();
    }
    function used() { return Number(ctx.system.storage.get(todayKey()) || 0); }
    function quotaOk() {
      var limit = Number(S("dailyLimit"));
      if (!isFinite(limit)) limit = 3;
      if (limit <= 0) return false;
      if (used() >= limit) return false;
      var last = Number(ctx.system.storage.get("lastAt") || 0);
      var gap = Math.max(0, Number(S("minInterval")) || 0) * 60000;
      if (last && gap > 0 && Date.now() - last < gap) return false;
      return true;
    }
    function quotaUse() {
      ctx.system.storage.set(todayKey(), used() + 1);
      ctx.system.storage.set("lastAt", Date.now());
    }
    function quotaCool() { ctx.system.storage.set("lastAt", Date.now()); }

    function resolveRef(characterId) {
      var src = S("refSource") || "none";
      if (src === "none") return "";
      if (src === "custom") return String(S("refUrl") || "").trim();
      try {
        var c = characterId ? ctx.data.characters.get(characterId) : null;
        var av = c && c.avatar ? String(c.avatar) : "";
        if (av && (/^https?:\/\//i.test(av) || /^data:image\//i.test(av))) return av;
      } catch (e) { log("取头像失败", (e && e.message) || e); }
      return "";
    }

    function withStyle(text) {
      var style = String(S("styleSuffix") || "").trim();
      var base = String(text || "").trim();
      if (!style) return base;
      return base ? (base + "，" + style) : style;
    }

    function buildBody(desc, characterId) {
      var ref = resolveRef(characterId);
      var finalPrompt = withStyle(desc);
      var body = { model: S("model") || "MiniMax-Hailuo-2.3", prompt: finalPrompt, prompt_optimizer: true };
      if (ref) {
        body.model = "S2V-01";
        body.subject_reference = [{ type: "character", image: [ref] }];
      } else {
        body.duration = Number(S("duration")) || 6;
        body.resolution = S("resolution") || "768P";
      }
      return { body: body, refUsed: !!ref, finalPrompt: finalPrompt };
    }

    // 把聊天内容转写成合格的画面描述——直接拿对话原文当提示词是"画面莫名其妙"的根因。
    // 转写失败就退回原文，不影响主流程。
    function rewriteDescription(rawText, characterId) {
      if (S("rewriteManual") === false) return Promise.resolve(rawText);
      var characterName = "";
      try {
        var c = characterId ? ctx.data.characters.get(characterId) : null;
        characterName = (c && c.name) || "";
      } catch (e) { /* 无所谓 */ }
      var sys = "你是短视频分镜师。把用户给的聊天内容改写成一句可直接用于文生视频的画面描述：只描述画面（主体、外貌、动作、环境、光线、氛围、景别），不要对白、不要引号、不要解释、不要分点，60 字以内。";
      var prompt = (characterName ? "角色名：" + characterName + "\n" : "") + "聊天内容：\n" + rawText;
      return ctx.ai.chat({ prompt: prompt, system: sys, temperature: 0.7, maxTokens: 300 })
        .then(function (text) {
          var t = String(text || "").replace(/["“”]/g, "").trim();
          var line = t.split("\n").filter(function (l) { return l.trim(); })[0] || "";
          line = line.replace(/^[-\d.、\s]+/, "").slice(0, 200).trim();
          log("转写结果", line || "(空，用原文)");
          return line || rawText;
        })
        .catch(function (e) {
          log("转写失败，改用原文", (e && e.message) || e);
          return rawText;
        });
    }

    // ── 写消息（push 是同步的，直接拿返回值）──
    function pushBubble(sessionId, role, content, mediaData) {
      var msg = ctx.data.messages.push({
        sessionId: sessionId,
        role: role || "assistant",
        content: content,
        mediaType: "plugin:" + KIND,
        mediaData: mediaData
      });
      if (msg && msg.id) { recs[msg.id] = mediaData; sids[msg.id] = sessionId; }
      return msg;
    }

    function statusLabel(raw) {
      var k = String(raw || "").toLowerCase();
      var map = { preparing: "准备中", queueing: "排队中", processing: "生成中", pending: "准备中", success: "已完成", fail: "失败", failed: "失败" };
      return map[k] || (raw ? String(raw) : "准备中");
    }

    function isFinalStatus(raw) {
      var k = String(raw || "").toLowerCase();
      return k === "success" || k === "fail" || k === "failed";
    }

    function progressLine(cur) {
      if (cur.status === "Success") return "[视频] " + (cur.prompt || "");
      if (cur.status === "Fail") return "[视频失败] " + (cur.errorMsg || "生成失败");
      var secs = cur.startedAt ? Math.floor((Date.now() - cur.startedAt) / 1000) : 0;
      var mm = Math.floor(secs / 60);
      var ss = secs % 60;
      return "[视频] " + statusLabel(cur.status) + " " + mm + ":" + (ss < 10 ? "0" : "") + ss + " · " + (cur.prompt || "");
    }

    function notifyUpdate(id) {
      try {
        if (typeof window === "undefined") return;
        var sid = sids[id];
        if (!sid) return;
        window.dispatchEvent(new CustomEvent("chat-messages-updated", { detail: { sessionId: sid, message: { id: id } } }));
      } catch (e) { /* 派发失败不影响主流程 */ }
    }

    function patch(id, patchObj) {
      var cur = rec(id);
      var ks = Object.keys(patchObj);
      for (var i = 0; i < ks.length; i++) cur[ks[i]] = patchObj[ks[i]];
      recs[id] = cur;
      // 关键：宿主的 updateChatMessage 只写库、不通知界面重绘（它仅派发插件事件），
      // 而气泡重渲染的判据里含 content 变动 —— 所以改 mediaData 时一并改 content，
      // 否则气泡会永远停在最初那一帧（曾出现"卡在准备中"）。
      try {
        ctx.data.messages.update(id, { mediaData: cur, content: progressLine(cur) });
      } catch (e) { log("更新消息失败", (e && e.message) || e); }
      notifyUpdate(id);
      return cur;
    }

    function failBubble(sessionId, prompt, errMsg) {
      try {
        pushBubble(sessionId, "assistant", "[视频失败] " + errMsg, {
          status: "Fail", prompt: String(prompt || "").slice(0, 200), errorMsg: String(errMsg || "未知错误"),
          videoUrl: "", fileId: "", taskId: "", createdAt: new Date().toISOString()
        });
      } catch (e) { log("写失败气泡出错", (e && e.message) || e); }
    }

    function stopPoll(id) {
      var cur = inflight[id];
      if (cur && cur.timer) { try { cur.timer(); } catch (e) {} }
      delete inflight[id];
    }

    function fetchUrl(id, meta, fileId) {
      return api("/v1/files/retrieve", { query: { file_id: fileId } }).then(function (data) {
        var url = data && data.file && data.file.download_url;
        if (!url) throw new Error("接口没有返回下载地址");
        patch(id, { videoUrl: String(url), status: "Success", errorMsg: "" });
      }, function (e) {
        patch(id, { errorMsg: "视频已生成，但换取下载地址失败：" + ((e && e.message) || e) });
      });
    }

    function pollOnce(id) {
      var cur = rec(id);
      if (!cur.taskId) return Promise.resolve();
      return api("/v1/query/video_generation", { query: { task_id: cur.taskId } }).then(function (data) {
        var st = (data && data.status) || "Processing";
        var key = String(st).toLowerCase();
        if (key === "success") {
          patch(id, { status: "Success", fileId: data.file_id || "" });
          return fetchUrl(id, null, data.file_id || "");
        }
        if (key === "fail" || key === "failed") { patch(id, { status: "Fail", errorMsg: "生成失败，换个描述再试" }); return; }
        patch(id, { status: String(st) });
      }, function (e) {
        var c = e && e.code;
        if (c === 1026 || c === 1027 || c === 1008 || c === 1004 || c === 2049) {
          patch(id, { status: "Fail", errorMsg: (e && e.message) || "生成失败" });
          stopPoll(id);
        } else {
          patch(id, { hint: "查询暂时失败，会自动重试：" + ((e && e.message) || e) });
        }
      });
    }

    function startPoll(id) {
      if (inflight[id]) return;
      var startedAt = Date.now();
      var timer = ctx.system.timers.setInterval(function () {
        var cur = rec(id);
        if (!cur.taskId) { stopPoll(id); return; }
        if (isFinalStatus(cur.status)) { stopPoll(id); return; }
        if (Date.now() - startedAt > 30 * 60000) {
          patch(id, { hint: "等待超过 30 分钟，已暂停查询（可点「刷新链接」继续）" });
          stopPoll(id);
          return;
        }
        pollOnce(id);
      }, 6000);
      inflight[id] = { timer: timer, startedAt: startedAt };
      pollOnce(id);
    }

    // ── 提交（返回 Promise；失败时由调用方决定怎么提示）──
    function submit(opt, onSuccess) {
      var desc = String(opt.prompt || "").trim();
      if (!desc) return Promise.reject(new Error("没有画面描述"));
      var built = buildBody(desc, opt.characterId);
      return api("/v1/video_generation", { method: "POST", body: built.body }).then(function (data) {
        var taskId = data && data.task_id;
        if (!taskId) throw new Error("接口没有返回 task_id");
        var mediaData = {
          status: "Preparing", taskId: taskId, prompt: desc, model: built.body.model,
          refUsed: built.refUsed, videoUrl: "", fileId: "", errorMsg: "", hint: "", startedAt: Date.now(),
          createdAt: new Date().toISOString()
        };
        var msg = pushBubble(opt.sessionId, opt.role || "assistant", "[视频] " + desc, mediaData);
        if (!msg || !msg.id) throw new Error("消息写入失败");
        startPoll(msg.id);
        if (onSuccess) onSuccess();
        return msg.id;
      });
    }

    // ── 1) 气泡渲染 ──
    ctx.ui.messageKind(KIND, function (el, msg) {
      var id = msg.id;
      var d = recs[id] || msg.mediaData || {};
      if (!recs[id]) recs[id] = d;
      el.replaceChildren();
      var box = document.createElement("div");
      box.style.cssText = "max-width:min(280px,100%);font-size:12px;";

      var head = document.createElement("div");
      head.style.cssText = "opacity:.7;margin-bottom:4px;word-break:break-word;";
      head.textContent = "🎬 " + (d.prompt || "视频");
      box.appendChild(head);

      // 把"实际用了什么"摊开显示：判断"不像"时，先看参考图到底有没有被用上
      var refLine = document.createElement("div");
      refLine.style.cssText = "opacity:.5;margin-bottom:6px;";
      refLine.textContent = "参考图：" + (d.refUsed ? "已使用" : "未使用") + " · 模型：" + (d.model || "?");
      box.appendChild(refLine);

      function mkBtn(text, fn, extra) {
        var b = document.createElement("button");
        b.textContent = text;
        b.style.cssText = "margin-top:6px;font-size:11px;padding:5px 10px;border-radius:8px;border:1px solid rgba(128,128,128,.4);background:transparent;color:inherit;" + (extra || "");
        b.onclick = fn;
        return b;
      }

      if (d.status === "Success" && d.videoUrl) {
        var v = document.createElement("video");
        v.src = d.videoUrl; v.controls = true; v.playsInline = true; v.preload = "metadata";
        v.style.cssText = "width:100%;border-radius:10px;background:#000;";
        box.appendChild(v);
        var tip = document.createElement("div");
        tip.style.cssText = "opacity:.55;margin-top:5px;line-height:1.5;";
        tip.textContent = "下载链接 1 小时有效，过期点下面刷新";
        box.appendChild(tip);
        box.appendChild(mkBtn("刷新链接", function () {
          var c = rec(id);
          if (c.fileId) fetchUrl(id, null, c.fileId);
          else if (c.taskId) startPoll(id);
        }));
      } else if (d.status === "Fail") {
        var bad = document.createElement("div");
        bad.style.cssText = "color:#e06c6c;line-height:1.55;word-break:break-word;";
        bad.textContent = "生成失败：" + (d.errorMsg || "未知原因");
        box.appendChild(bad);
        box.appendChild(mkBtn("重试一次", function () {
          var c = rec(id);
          ctx.ui.toast("已重新提交…");
          submit({ sessionId: msg.sessionId, prompt: c.prompt || d.prompt, role: "assistant" }, null)
            .catch(function (e) { ctx.ui.toast("重试失败：" + ((e && e.message) || e)); });
        }));
      } else {
        var d2 = recs[id] || d;
        var st = document.createElement("div");
        st.textContent = "正在生成：" + statusLabel(d2.status) + "…";
        st.style.cssText = "line-height:1.6;";
        box.appendChild(st);
        var meta = document.createElement("div");
        meta.style.cssText = "opacity:.55;margin-top:3px;line-height:1.5;";
        var secs = d2.startedAt ? Math.floor((Date.now() - d2.startedAt) / 1000) : 0;
        var mm = Math.floor(secs / 60), ss = secs % 60;
        meta.textContent = "已等 " + mm + ":" + (ss < 10 ? "0" : "") + ss + " · 接口状态：" + (d2.status || "?");
        box.appendChild(meta);
        box.appendChild(mkBtn("立即查询", function () { pollOnce(id); ctx.ui.toast("已查询一次"); }));
        var bar = document.createElement("div");
        bar.style.cssText = "height:4px;border-radius:9px;background:rgba(128,128,128,.25);overflow:hidden;margin-top:6px;";
        var inn = document.createElement("div");
        inn.style.cssText = "height:100%;width:42%;border-radius:9px;background:linear-gradient(90deg,#4aa8ff,#38d39f);";
        bar.appendChild(inn); box.appendChild(bar);
        if (d.hint) {
          var h = document.createElement("div");
          h.style.cssText = "opacity:.6;margin-top:5px;";
          h.textContent = d.hint;
          box.appendChild(h);
        }
        if (d.taskId && !inflight[id]) startPoll(id);
      }
      el.appendChild(box);
      return function () { el.replaceChildren(); };
    });

    // ── 2) 提示词注入 ──
    function refreshPrompt() {
      if (S("allowProactive") === false) { ctx.prompts.clear(); return; }
      ctx.prompts.set([
        "你有一项能力：给对方发一段短视频（会真实生成）。",
        "只有当你真的想分享一个画面时才用，不要频繁使用，一天最多几次，不要连续两条回复都用。",
        "用法：在回复的最末尾单独写一行 [视频:画面描述]。描述要具体（场景、光线、动作、氛围），90 字以内。",
        "写了这个标记的那条回复不要再写别的视频标记。"
      ].join("\n"));
    }
    refreshPrompt();
    ctx.system.settings.onChange(function () { refreshPrompt(); });

    // ── 3) 拦截回复，抓取视频标记 ──
    ctx.hooks.transform("llm.response", function (p) {
      try {
        if (S("allowProactive") === false) return p;
        var m = String(p.text || "").match(MARK);
        if (!m) return p;
        p.text = String(p.text).replace(MARK, "").replace(/\n{3,}/g, "\n\n").trim();
        var sessionId = p.sessionId;
        if (!sessionId) return p;
        var isGroup = false, characterId = "";
        try {
          var s = ctx.data.sessions.get(sessionId);
          isGroup = !!(s && s.isGroup);
          if (s && s.contactId) {
            var list = ctx.data.contacts.list() || [];
            for (var i = 0; i < list.length; i++) {
              if (list[i].id === s.contactId) { characterId = list[i].characterId || ""; break; }
            }
          }
        } catch (e) { log("查会话失败", (e && e.message) || e); }
        if (isGroup && S("allowGroup") !== true) return p;
        if (!quotaOk()) { log("配额/冷却未通过，跳过自动生成"); return p; }
        var desc = m[1].trim();
        ctx.system.timers.setTimeout(function () {
          submit({ sessionId: sessionId, prompt: desc, characterId: characterId, role: "assistant" }, quotaUse)
            .catch(function (e) {
              quotaCool();
              var why = (e && e.message) || String(e);
              log("自动生成失败", why);
              failBubble(sessionId, desc, why);
            });
        }, 900);
      } catch (e) { log("transform 异常", (e && e.message) || e); }
      return p;
    }, { timeoutMs: 8000 });

    // ── 4) 手动触发 ──
    if (S("allowManual") !== false) {
      ctx.ui.messageAction({
        id: "hailuo-make-video",
        label: "给这段生成视频",
        filter: function (msg) { return !!msg && (msg.role === "assistant" || msg.role === "user"); },
        onSelect: function (msg, helpers) {
          var text = String(msg.content || "").replace(/\[[^\]]*\]/g, " ").trim().slice(0, 300);
          if (!text) { helpers.toast("这条消息没有可用内容"); return; }
          helpers.toast("正在整理画面描述…");
          var characterId = "";
          try {
            var s = ctx.data.sessions.get(msg.sessionId);
            var list = ctx.data.contacts.list() || [];
            if (s && s.contactId) {
              for (var i = 0; i < list.length; i++) {
                if (list[i].id === s.contactId) { characterId = list[i].characterId || ""; break; }
              }
            }
          } catch (e) {}
          rewriteDescription(text, characterId).then(function (desc) {
            helpers.toast("已提交，生成中…");
            return submit({ sessionId: msg.sessionId, prompt: desc, characterId: characterId, role: "assistant" }, null);
          }).catch(function (e) {
            failBubble(msg.sessionId, text, (e && e.message) || e);
          });
        }
      });
    }
  }
};
