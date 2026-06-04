(function () {
  "use strict";

  var COPY_RESET_DELAY = 1500;
  var STORE_KEY = "apivault.lang";
  var I18N = {
    en: {
      "nav.workflow": "How it works",
      "nav.features": "Features",
      "nav.start": "Quick Start",
      "nav.faq": "FAQ",
      "nav.github": "View on GitHub",
      "hero.eyebrow": "Local-first and open source",
      "hero.title": "One local control plane for every AI API.",
      "hero.lede": "Store keys locally, route compatible requests, and understand usage across every provider.",
      "hero.github": "View on GitHub",
      "hero.start": "Quick Start",
      "hero.proof.local": "Keys stay under your control",
      "hero.proof.proxy": "One compatible proxy endpoint",
      "hero.proof.audit": "Every routed call becomes visible",
      "preview.note": "Illustrative product preview",
      "preview.search": "Search providers, models, requests",
      "preview.overview": "Overview",
      "preview.providers": "Providers",
      "preview.usage": "Usage",
      "preview.models": "Models",
      "preview.tokens": "Proxy tokens",
      "preview.local": "Local service healthy",
      "preview.today": "Today",
      "preview.heading": "Control plane overview",
      "preview.requests": "Requests",
      "preview.tokensUsed": "Tokens used",
      "preview.latency": "Median latency",
      "preview.traffic": "Traffic by provider",
      "preview.routed": "Routed requests",
      "preview.health": "Provider health",
      "preview.live": "Live",
      "providers.label": "Built for compatible AI APIs",
      "providers.more": "and more",
      "problems.kicker": "The problem",
      "problems.title": "Your AI stack grew. Your visibility did not.",
      "problems.lede": "Multiple providers are useful until keys, base URLs, and usage records become another system to maintain.",
      "problems.keys.title": "Keys live everywhere",
      "problems.keys.text": "Credentials end up spread across tools, config files, and provider dashboards.",
      "problems.routing.title": "Every provider behaves differently",
      "problems.routing.text": "Endpoints, model names, and account balances are hard to compare at a glance.",
      "problems.usage.title": "Usage is hard to explain",
      "problems.usage.text": "Without one request trail, it is difficult to see what succeeded, slowed down, or cost more.",
      "workflow.kicker": "How it works",
      "workflow.title": "Add one local layer. Keep your existing tools.",
      "workflow.lede": "Point compatible clients at API Vault. It resolves the provider, forwards the request, and records the result locally.",
      "workflow.client.title": "Your client",
      "workflow.client.text": "IDE, agent, script, or application",
      "workflow.vault.text": "Matches key, routes request, records usage",
      "workflow.provider.title": "Upstream provider",
      "workflow.provider.text": "Receives the compatible request",
      "workflow.limit": "API Vault can only measure requests that pass through its proxy URL.",
      "features.kicker": "What you get",
      "features.title": "A calmer way to operate multiple AI providers.",
      "features.lede": "The useful controls are together, without turning your local setup into a cloud platform.",
      "features.proxy.title": "One proxy for compatible requests",
      "features.proxy.text": "Give each provider a stable API Vault Base URL, then keep using the clients you already know.",
      "features.local.title": "Keys stay local",
      "features.local.text": "Credentials are encrypted in the local vault and decrypted only when needed.",
      "features.local.badge": "Encrypted vault",
      "features.audit.title": "A request trail you can read",
      "features.audit.text": "Review status, latency, model, and reported token usage for routed calls.",
      "features.providers.title": "Providers, keys, models, and balances in context",
      "features.providers.text": "Group keys by provider, discover models, inspect health, and configure custom balance sync rules.",
      "trust.kicker": "Trust through clarity",
      "trust.title": "Your local control plane, with honest boundaries.",
      "trust.lede": "API Vault is designed to make your own AI API traffic easier to control and understand, not to hide how it works.",
      "trust.link": "Inspect the source on GitHub →",
      "trust.local.title": "Local-first by default",
      "trust.local.text": "Vault data and request records live on the machine running API Vault.",
      "trust.open.title": "Open source",
      "trust.open.text": "Read the implementation, run it yourself, and adapt the setup to your needs.",
      "trust.scope.title": "Clear measurement scope",
      "trust.scope.text": "Only traffic routed through API Vault can appear in its usage and status views.",
      "start.kicker": "Quick Start",
      "start.title": "Run it locally. Add your first provider.",
      "start.lede": "Choose Docker Compose or the Windows starter, then open the dashboard at localhost:3210.",
      "start.windows": "Windows starter",
      "copy": "Copy",
      "copied": "Copied",
      "faq.kicker": "FAQ",
      "faq.title": "The practical questions, answered.",
      "faq.lede": "API Vault is intentionally straightforward about where it runs and what it can see.",
      "faq.data.q": "Where does API Vault store data?",
      "faq.data.a": "On the machine where you run it. Keys are encrypted in the local vault file, while app state and usage records remain local.",
      "faq.compat.q": "Which providers work with it?",
      "faq.compat.a": "It is built around OpenAI- and Anthropic-compatible request formats and can route to compatible upstream providers.",
      "faq.track.q": "Can it see requests sent directly to a provider?",
      "faq.track.a": "No. A request must pass through an API Vault proxy URL before it can be recorded.",
      "faq.remote.q": "Can I use it from another machine?",
      "faq.remote.a": "Yes, when you deliberately expose or deploy it through a secure reachable endpoint. Use proxy tokens instead of exposing real provider keys.",
      "cta.kicker": "Open source · Local-first",
      "cta.title": "Bring your AI APIs into one clear view.",
      "cta.text": "Run API Vault yourself and see exactly what passes through.",
      "cta.github": "View on GitHub",
      "footer.tagline": "A local-first AI API proxy and usage dashboard.",
      "footer.docs": "Documentation",
      "footer.top": "Back to top"
    },
    zh: {
      "nav.workflow": "工作原理",
      "nav.features": "核心功能",
      "nav.start": "快速开始",
      "nav.faq": "常见问题",
      "nav.github": "在 GitHub 查看",
      "hero.eyebrow": "本地优先 · 开源",
      "hero.title": "一个本地控制台，管理你的所有 AI API。",
      "hero.lede": "在本机保管密钥，通过兼容代理转发请求，并看清每个服务商的调用情况。",
      "hero.github": "在 GitHub 查看",
      "hero.start": "快速开始",
      "hero.proof.local": "密钥始终由你掌控",
      "hero.proof.proxy": "一个兼容代理入口",
      "hero.proof.audit": "每次代理调用都有记录",
      "preview.note": "产品界面示意",
      "preview.search": "搜索服务商、模型、请求",
      "preview.overview": "总览",
      "preview.providers": "服务商",
      "preview.usage": "用量",
      "preview.models": "模型",
      "preview.tokens": "代理令牌",
      "preview.local": "本地服务运行正常",
      "preview.today": "今天",
      "preview.heading": "控制台总览",
      "preview.requests": "请求数",
      "preview.tokensUsed": "Token 用量",
      "preview.latency": "延迟中位数",
      "preview.traffic": "服务商流量",
      "preview.routed": "已代理请求",
      "preview.health": "服务商状态",
      "preview.live": "实时",
      "providers.label": "面向兼容的 AI API",
      "providers.more": "以及更多",
      "problems.kicker": "现实问题",
      "problems.title": "AI 工具越来越多，调用情况却越来越难看清。",
      "problems.lede": "多个服务商很有用，但密钥、Base URL 和用量记录很快就会变成另一套需要维护的系统。",
      "problems.keys.title": "密钥散落在各处",
      "problems.keys.text": "凭据分散在不同工具、配置文件和服务商后台中。",
      "problems.routing.title": "每个服务商都不一样",
      "problems.routing.text": "接口地址、模型名称与账户余额很难放在一起比较。",
      "problems.usage.title": "调用情况难以解释",
      "problems.usage.text": "没有统一请求记录，就很难判断哪些调用成功、变慢或成本更高。",
      "workflow.kicker": "工作原理",
      "workflow.title": "增加一个本地代理层，继续使用现有工具。",
      "workflow.lede": "把兼容客户端指向 API Vault。它会匹配服务商、转发请求，并在本地记录结果。",
      "workflow.client.title": "你的客户端",
      "workflow.client.text": "IDE、智能体、脚本或应用",
      "workflow.vault.text": "匹配密钥、路由请求、记录用量",
      "workflow.provider.title": "上游服务商",
      "workflow.provider.text": "接收兼容格式的请求",
      "workflow.limit": "API Vault 只能统计经过其代理地址的请求。",
      "features.kicker": "你将获得",
      "features.title": "用更从容的方式管理多个 AI 服务商。",
      "features.lede": "把真正需要的控制项集中起来，同时保持本地工具的简单与透明。",
      "features.proxy.title": "一个代理，转发兼容请求",
      "features.proxy.text": "为每个服务商提供稳定的 API Vault Base URL，继续使用你熟悉的客户端。",
      "features.local.title": "密钥留在本机",
      "features.local.text": "凭据加密保存在本地 vault 中，仅在需要时解密。",
      "features.local.badge": "加密本地仓库",
      "features.audit.title": "清楚易读的请求记录",
      "features.audit.text": "查看已代理调用的状态、延迟、模型与服务商返回的 Token 用量。",
      "features.providers.title": "把服务商、密钥、模型与余额放在同一上下文",
      "features.providers.text": "按服务商归类密钥、发现模型、检查状态，并配置自定义余额同步规则。",
      "trust.kicker": "透明带来信任",
      "trust.title": "属于你的本地控制台，也清楚说明能力边界。",
      "trust.lede": "API Vault 帮你更容易地掌控和理解自己的 AI API 流量，同时保持工作方式透明。",
      "trust.link": "在 GitHub 检查源代码 →",
      "trust.local.title": "默认本地优先",
      "trust.local.text": "Vault 数据与请求记录保存在运行 API Vault 的机器上。",
      "trust.open.title": "开源",
      "trust.open.text": "阅读实现、自己运行，并按实际需要调整部署方式。",
      "trust.scope.title": "明确的统计范围",
      "trust.scope.text": "只有经过 API Vault 的流量才会出现在用量和状态页面中。",
      "start.kicker": "快速开始",
      "start.title": "在本机运行，然后添加第一个服务商。",
      "start.lede": "选择 Docker Compose 或 Windows 启动脚本，然后打开 localhost:3210。",
      "start.windows": "Windows 启动脚本",
      "copy": "复制",
      "copied": "已复制",
      "faq.kicker": "常见问题",
      "faq.title": "直接回答实际使用问题。",
      "faq.lede": "API Vault 会清楚说明它在哪里运行，以及它能看到什么。",
      "faq.data.q": "API Vault 把数据保存在哪里？",
      "faq.data.a": "保存在运行它的机器上。密钥加密存放在本地 vault 文件中，应用状态与用量记录也留在本机。",
      "faq.compat.q": "它支持哪些服务商？",
      "faq.compat.a": "它围绕 OpenAI 与 Anthropic 兼容请求格式构建，并可转发到兼容的上游服务商。",
      "faq.track.q": "它能看到直接发送给服务商的请求吗？",
      "faq.track.a": "不能。请求必须经过 API Vault 代理地址后才能被记录。",
      "faq.remote.q": "我能从其他机器使用它吗？",
      "faq.remote.a": "可以，但需要主动通过安全且可访问的入口暴露或部署它。远程使用时应使用代理令牌，而不是暴露真实服务商密钥。",
      "cta.kicker": "开源 · 本地优先",
      "cta.title": "把你的 AI API 放进一个清晰视图。",
      "cta.text": "自己运行 API Vault，看清每一次经过代理的调用。",
      "cta.github": "在 GitHub 查看",
      "footer.tagline": "本地优先的 AI API 代理与用量仪表盘。",
      "footer.docs": "文档",
      "footer.top": "回到顶部"
    }
  };

  function getPreferredLanguage() {
    try {
      var saved = localStorage.getItem(STORE_KEY);
      if (saved === "en" || saved === "zh") return saved;
    } catch (error) {}
    return (navigator.language || "en").toLowerCase().startsWith("zh") ? "zh" : "en";
  }

  function applyLanguage(lang) {
    var dictionary = I18N[lang] || I18N.en;
    document.querySelectorAll("[data-i18n]").forEach(function (element) {
      var key = element.getAttribute("data-i18n");
      if (dictionary[key] != null) element.textContent = dictionary[key];
    });
    document.querySelectorAll("[data-lang]").forEach(function (button) {
      var isActive = button.getAttribute("data-lang") === lang;
      button.classList.toggle("active", isActive);
      button.setAttribute("aria-pressed", String(isActive));
    });
    document.documentElement.lang = lang === "zh" ? "zh-CN" : "en";
    window.__apiVaultCopyLabel = dictionary.copy;
    window.__apiVaultCopiedLabel = dictionary.copied;
    try { localStorage.setItem(STORE_KEY, lang); } catch (error) {}
  }

  function initLanguage() {
    applyLanguage(getPreferredLanguage());
    var switcher = document.getElementById("languageSwitcher");
    if (!switcher) return;
    switcher.addEventListener("click", function (event) {
      var button = event.target.closest("[data-lang]");
      if (button) applyLanguage(button.getAttribute("data-lang"));
    });
  }

  function initNavigation() {
    var nav = document.getElementById("siteNav");
    var toggle = document.getElementById("navToggle");
    if (!nav || !toggle) return;
    toggle.addEventListener("click", function () {
      var isOpen = nav.classList.toggle("open");
      toggle.setAttribute("aria-expanded", String(isOpen));
    });
    document.querySelectorAll("#navLinks a").forEach(function (link) {
      link.addEventListener("click", function () {
        nav.classList.remove("open");
        toggle.setAttribute("aria-expanded", "false");
      });
    });
  }

  function initTabs() {
    var tabs = document.querySelectorAll(".start-tab");
    tabs.forEach(function (tab) {
      tab.addEventListener("click", function () {
        tabs.forEach(function (item) {
          item.classList.remove("active");
          item.setAttribute("aria-selected", "false");
        });
        document.querySelectorAll(".code-panel").forEach(function (panel) {
          panel.classList.remove("active");
          panel.hidden = true;
        });
        tab.classList.add("active");
        tab.setAttribute("aria-selected", "true");
        var panel = document.getElementById("panel-" + tab.getAttribute("data-tab"));
        if (panel) {
          panel.hidden = false;
          panel.classList.add("active");
        }
      });
    });
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text);
    }
    return new Promise(function (resolve) {
      var textarea = document.createElement("textarea");
      textarea.value = text;
      document.body.appendChild(textarea);
      textarea.select();
      try { document.execCommand("copy"); } catch (error) {}
      textarea.remove();
      resolve();
    });
  }

  function initCopyButtons() {
    document.querySelectorAll(".copy-button").forEach(function (button) {
      button.addEventListener("click", function () {
        var target = document.getElementById(button.getAttribute("data-copy"));
        var label = button.querySelector("span");
        if (!target || !label) return;
        copyText(target.innerText).then(function () {
          label.textContent = window.__apiVaultCopiedLabel || "Copied";
          setTimeout(function () {
            label.textContent = window.__apiVaultCopyLabel || "Copy";
          }, COPY_RESET_DELAY);
        }).catch(function () {});
      });
    });
  }

  function init() {
    initLanguage();
    initNavigation();
    initTabs();
    initCopyButtons();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
