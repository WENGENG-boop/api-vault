/* ============================================================
   API Vault site — interactions
   i18n (EN/ZH) · tabs · copy · mobile nav.  No build step.
   ============================================================ */
(function () {
  'use strict';

  /* ---------- i18n dictionary ---------- */
  var I18N = {
    en: {
      'nav.product': 'Product',
      'nav.features': 'Features',
      'nav.how': 'How it works',
      'nav.start': 'Quick start',

      'hero.badge': 'Local-first · Open source',
      'hero.title': 'Every AI API key, request, and token — in one <span class="accent">local vault</span>.',
      'hero.lede': 'API Vault is an open-source, local-first proxy and dashboard. It encrypts your API keys on your own machine, forwards OpenAI- and Anthropic-compatible requests, and records every token, cost, and latency — without sending anything to the cloud.',
      'hero.cta1': 'Get started',
      'hero.cta2': 'View on GitHub',
      'hero.note1': 'Runs locally at',
      'hero.note2': 'Docker or one-click Windows start',

      'shot.tab.overview': 'Overview',
      'shot.tab.models': 'Models',
      'shot.tokens': 'tokens · today',
      'shot.range.all': 'All',
      'shot.range.30': '30d',
      'shot.range.7': '7d',
      'shot.range.today': 'Today',

      'compat.label': 'Works with',
      'compat.more': '+ any compatible API',

      'product.kicker': 'The dashboard',
      'product.title': 'A clear view of every call that passes through',
      'product.sub': 'API Vault records each request locally and turns it into usage, health, and model insights you can act on.',

      'r1.kicker': 'Usage analytics',
      'r1.title': 'See exactly where your tokens go',
      'r1.text': 'Per-model breakdowns of input and output tokens, request counts, and cost. Filter by today, 7 days, 30 days, or all time.',
      'r1.li1': 'Input / output token split per model',
      'r1.li2': 'Request counts and success ratio',
      'r1.li3': 'Cost when the provider reports it',
      'r1.calls': 'calls · today',

      'r2.kicker': 'Provider status',
      'r2.title': 'Know which providers are healthy',
      'r2.text': 'Aggregated success rate, latency, and call volume per provider over a rolling window, so you can spot outages and degradations early.',
      'r2.li1': 'Healthy / degraded / outage at a glance',
      'r2.li2': 'Rolling 7-day success and latency',

      'status.outage': 'Outage',
      'status.degraded': 'Degraded',
      'status.healthy': 'Healthy',
      'status.notraffic': 'No traffic',
      'status.success': 'Success',
      'status.latency': 'Latency',

      'r3.kicker': 'Model directory',
      'r3.title': 'One catalog for every model',
      'r3.text': 'Automatically groups models discovered across providers, with capabilities, call counts, and cost — searchable and filterable.',
      'r3.li1': 'Grouped by name across providers',
      'r3.li2': 'Capability tags: text, tools, reasoning',
      'r3.search': 'Search model ID, alias, or provider',
      'badge.text': 'Text',
      'badge.tools': 'Tools',
      'badge.reasoning': 'Reasoning',
      'badge.calls': 'calls',
      'badge.nocost': 'No cost',

      'feat.kicker': 'Features',
      'feat.title': 'Built for control and privacy',
      'feat.sub': 'Everything you need to manage AI API usage in one local tool.',
      'feat.1.t': 'Local-first security',
      'feat.1.d': 'Credentials are encrypted in a local vault file. Nothing is stored in the cloud.',
      'feat.2.t': 'Multi-provider proxy',
      'feat.2.d': 'Forwards OpenAI- and Anthropic-compatible requests to any upstream provider.',
      'feat.3.t': 'Token & latency audit',
      'feat.3.d': 'Records status, latency, and input/output tokens for every single call.',
      'feat.4.t': 'Balance sync',
      'feat.4.d': 'Custom HTTP polling and JSON-path rules sync provider-reported balances.',
      'feat.5.t': 'Cloudflared tunnels',
      'feat.5.d': 'Safely expose your local vault to remote apps through Cloudflare Tunnel.',
      'feat.6.t': 'Consolidated metrics',
      'feat.6.d': 'Groups keys by provider for both aggregate and per-key reports.',

      'how.kicker': 'How it works',
      'how.title': 'A local proxy between your apps and the providers',
      'how.sub': 'Point any third-party app at the API Vault Base URL. It injects the real key, forwards the call, and records the result.',
      'flow.app': 'Third-party app',
      'flow.app.sub': 'IDE, agent, or script',
      'flow.vault.sub': 'Decrypts key · forwards · records',
      'flow.up': 'Upstream providers',
      'flow.url.lab': 'API Vault Base URL',
      'step.1.t': 'Run locally',
      'step.1.d': 'Start with Docker or the Windows script, then open localhost:3210.',
      'step.2.t': 'Add your keys',
      'step.2.d': 'Store API keys in your encrypted local vault file.',
      'step.3.t': 'Point apps to API Vault',
      'step.3.d': 'Copy the API Vault Base URL into any third-party app.',
      'step.4.t': 'Track everything',
      'step.4.d': 'Calls are forwarded and recorded automatically.',

      'start.kicker': 'Quick start',
      'start.title': 'Up and running in two steps',
      'start.sub': 'Choose Docker or the Windows start script. Your data stays on your machine.',
      'start.win': 'Windows script',
      'copy': 'Copy',
      'copied': 'Copied',

      'cta.title': 'Keep your keys. Keep your data.',
      'cta.text': 'API Vault gives you full visibility into AI API usage and cost — locally, without exposing your credentials to the cloud.',
      'cta.btn': 'Get it on GitHub',
      'cta.btn2': 'Read the quick start',

      'footer.tag': 'Local-first AI API proxy and usage dashboard. Open source, MIT licensed.',
      'footer.product': 'Product',
      'footer.resources': 'Resources',
      'footer.readme': 'Documentation',
      'footer.start': 'Get started',
      'footer.docker': 'Docker Compose',
      'footer.windows': 'Windows script',
      'footer.license': 'MIT License',
      'footer.totop': 'Back to top'
    },
    zh: {
      'nav.product': '产品',
      'nav.features': '功能',
      'nav.how': '工作原理',
      'nav.start': '快速开始',

      'hero.badge': '本地优先 · 开源',
      'hero.title': '所有 AI API 密钥、请求与用量，统一在<span class="accent">本地保管</span>。',
      'hero.lede': 'API Vault 是一个开源、本地优先的代理与仪表盘。它在你自己的机器上加密保管 API 密钥，转发 OpenAI / Anthropic 兼容请求，并记录每一次调用的用量、成本与延迟——数据不出本机。',
      'hero.cta1': '开始使用',
      'hero.cta2': '在 GitHub 查看',
      'hero.note1': '本地运行于',
      'hero.note2': '支持 Docker 或 Windows 一键启动',

      'shot.tab.overview': '总览',
      'shot.tab.models': '模型',
      'shot.tokens': 'tokens · 今天',
      'shot.range.all': '全部',
      'shot.range.30': '30天',
      'shot.range.7': '7天',
      'shot.range.today': '今天',

      'compat.label': '兼容',
      'compat.more': '+ 任意兼容 API',

      'product.kicker': '仪表盘',
      'product.title': '每一次经过的调用，都看得清清楚楚',
      'product.sub': 'API Vault 在本地记录每个请求，并把它们转化为可用的用量、健康度与模型洞察。',

      'r1.kicker': '用量分析',
      'r1.title': '清楚看到每一个 token 花在哪',
      'r1.text': '按模型拆分输入 / 输出 token、请求数与成本；可按今天、7 天、30 天或全部时间筛选。',
      'r1.li1': '按模型拆分输入 / 输出 token',
      'r1.li2': '请求数与成功率',
      'r1.li3': '服务商返回时显示成本',
      'r1.calls': '次调用 · 今天',

      'r2.kicker': '服务商状态',
      'r2.title': '一眼看清哪些服务商正常',
      'r2.text': '在滚动时间窗内聚合每个服务商的成功率、延迟与调用量，及时发现故障与降级。',
      'r2.li1': '正常 / 降级 / 故障一目了然',
      'r2.li2': '滚动 7 天的成功率与延迟',

      'status.outage': '故障',
      'status.degraded': '降级',
      'status.healthy': '正常',
      'status.notraffic': '无流量',
      'status.success': '成功率',
      'status.latency': '延迟',

      'r3.kicker': '模型目录',
      'r3.title': '所有模型，一个目录',
      'r3.text': '自动归并各服务商发现的模型，标注能力、调用数与成本，支持搜索与筛选。',
      'r3.li1': '跨服务商按名称归并',
      'r3.li2': '能力标签：文本、工具、推理',
      'r3.search': '搜索模型 ID、别名或服务商',
      'badge.text': '文本',
      'badge.tools': '工具',
      'badge.reasoning': '推理',
      'badge.calls': '次调用',
      'badge.nocost': '无成本',

      'feat.kicker': '功能',
      'feat.title': '为掌控与隐私而构建',
      'feat.sub': '在一个本地工具中，管理 AI API 用量所需的一切。',
      'feat.1.t': '本地优先的安全',
      'feat.1.d': '凭据加密存储在本地 vault 文件中，不上传云端。',
      'feat.2.t': '多服务商代理',
      'feat.2.d': '将 OpenAI / Anthropic 兼容请求转发到任意上游服务商。',
      'feat.3.t': '用量与延迟审计',
      'feat.3.d': '记录每一次调用的状态、延迟与输入 / 输出 token。',
      'feat.4.t': '余额同步',
      'feat.4.d': '通过自定义 HTTP 轮询与 JSON 路径规则同步服务商余额。',
      'feat.5.t': 'Cloudflared 隧道',
      'feat.5.d': '通过 Cloudflare Tunnel 安全地把本地 vault 暴露给远程应用。',
      'feat.6.t': '聚合统计',
      'feat.6.d': '按服务商归并密钥，提供聚合与单密钥两级报表。',

      'how.kicker': '工作原理',
      'how.title': '位于你的应用与服务商之间的本地代理',
      'how.sub': '把任意第三方应用指向 API Vault Base URL；它会注入真实密钥、转发请求并记录结果。',
      'flow.app': '第三方应用',
      'flow.app.sub': 'IDE、智能体或脚本',
      'flow.vault.sub': '解密密钥 · 转发 · 记录',
      'flow.up': '上游服务商',
      'flow.url.lab': 'API Vault Base URL',
      'step.1.t': '本地启动',
      'step.1.d': '用 Docker 或 Windows 脚本启动，然后打开 localhost:3210。',
      'step.2.t': '添加密钥',
      'step.2.d': '将 API 密钥保存到加密的本地 vault 文件。',
      'step.3.t': '指向 API Vault',
      'step.3.d': '把 API Vault Base URL 复制到任意第三方应用。',
      'step.4.t': '全程记录',
      'step.4.d': '调用被自动转发并记录。',

      'start.kicker': '快速开始',
      'start.title': '两步即可运行',
      'start.sub': '选择 Docker 或 Windows 启动脚本，数据始终留在你的机器上。',
      'start.win': 'Windows 脚本',
      'copy': '复制',
      'copied': '已复制',

      'cta.title': '密钥在手，数据在本机。',
      'cta.text': 'API Vault 让你在本地完全掌握 AI API 的用量与成本，凭据不暴露给云端。',
      'cta.btn': '前往 GitHub',
      'cta.btn2': '查看快速开始',

      'footer.tag': '本地优先的 AI API 代理与用量仪表盘。开源，MIT 协议。',
      'footer.product': '产品',
      'footer.resources': '资源',
      'footer.readme': '文档',
      'footer.start': '开始使用',
      'footer.docker': 'Docker Compose',
      'footer.windows': 'Windows 脚本',
      'footer.license': 'MIT 协议',
      'footer.totop': '回到顶部'
    }
  };

  var HTML_KEYS = { 'hero.title': true };
  var STORE_KEY = 'apivault.lang';

  function applyLang(lang) {
    var dict = I18N[lang] || I18N.en;

    // data-i18n -> textContent
    document.querySelectorAll('[data-i18n]').forEach(function (el) {
      var k = el.getAttribute('data-i18n');
      if (dict[k] != null) el.textContent = dict[k];
    });
    // data-i18n-html -> innerHTML (trusted, our own strings)
    document.querySelectorAll('[data-i18n-html]').forEach(function (el) {
      var k = el.getAttribute('data-i18n-html');
      if (dict[k] != null) el.innerHTML = dict[k];
    });

    document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';

    document.querySelectorAll('#lang button').forEach(function (b) {
      b.classList.toggle('active', b.getAttribute('data-lang') === lang);
    });

    try { localStorage.setItem(STORE_KEY, lang); } catch (e) {}
    window.__copyLabel = dict['copy'];
    window.__copiedLabel = dict['copied'];
  }

  function initLang() {
    var saved;
    try { saved = localStorage.getItem(STORE_KEY); } catch (e) {}
    var lang = saved || ((navigator.language || 'en').toLowerCase().indexOf('zh') === 0 ? 'zh' : 'en');
    applyLang(lang);

    var box = document.getElementById('lang');
    if (box) box.addEventListener('click', function (e) {
      var btn = e.target.closest('button[data-lang]');
      if (btn) applyLang(btn.getAttribute('data-lang'));
    });
  }

  /* ---------- Quick-start tabs ---------- */
  function initTabs() {
    var btns = document.querySelectorAll('.tab-btn');
    btns.forEach(function (btn) {
      btn.addEventListener('click', function () {
        btns.forEach(function (b) { b.classList.remove('active'); });
        document.querySelectorAll('.panel').forEach(function (p) { p.classList.remove('active'); });
        btn.classList.add('active');
        var panel = document.getElementById('panel-' + btn.getAttribute('data-tab'));
        if (panel) panel.classList.add('active');
      });
    });
  }

  /* ---------- Copy buttons ---------- */
  function initCopy() {
    document.querySelectorAll('.copy').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var pre = document.getElementById(btn.getAttribute('data-copy'));
        if (!pre) return;
        var text = pre.innerText.replace(/ /g, ' ');
        var label = btn.querySelector('span');
        var done = function () {
          if (!label) return;
          var prev = label.textContent;
          label.textContent = window.__copiedLabel || 'Copied';
          setTimeout(function () { label.textContent = window.__copyLabel || prev; }, 1400);
        };
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).then(done).catch(done);
        } else {
          var ta = document.createElement('textarea');
          ta.value = text; document.body.appendChild(ta); ta.select();
          try { document.execCommand('copy'); } catch (e) {}
          document.body.removeChild(ta); done();
        }
      });
    });
  }

  /* ---------- Mobile nav ---------- */
  function initNav() {
    var nav = document.getElementById('nav');
    var toggle = document.getElementById('navToggle');
    if (toggle) toggle.addEventListener('click', function () { nav.classList.toggle('open'); });
    document.querySelectorAll('#navLinks a').forEach(function (a) {
      a.addEventListener('click', function () { nav.classList.remove('open'); });
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    initLang();
    initTabs();
    initCopy();
    initNav();
  });
})();
