document.addEventListener('DOMContentLoaded', () => {
  // Theme Toggle
  const themeToggleBtn = document.getElementById('theme-toggle');
  const themeIcon = themeToggleBtn.querySelector('.theme-icon');
  
  // Set theme from storage or system preference
  const savedTheme = localStorage.getItem('theme');
  const systemPrefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  
  if (savedTheme === 'dark' || (!savedTheme && systemPrefersDark)) {
    document.documentElement.classList.add('dark-theme');
    updateThemeIcon(true);
  } else {
    document.documentElement.classList.remove('dark-theme');
    updateThemeIcon(false);
  }
  
  themeToggleBtn.addEventListener('click', () => {
    const isDark = document.documentElement.classList.toggle('dark-theme');
    localStorage.setItem('theme', isDark ? 'dark' : 'light');
    updateThemeIcon(isDark);
  });
  
  function updateThemeIcon(isDark) {
    if (isDark) {
      themeIcon.innerHTML = `
        <svg class="svg-icon" viewBox="0 0 24 24">
          <path d="M12 7c-2.76 0-5 2.24-5 5s2.24 5 5 5 5-2.24 5-5-2.24-5-5-5zM2 13h2c.55 0 1-.45 1-1s-.45-1-1-1H2c-.55 0-1 .45-1 1s.45 1 1 1zm18 0h2c.55 0 1-.45 1-1s-.45-1-1-1h-2c-.55 0-1 .45-1 1s.45 1 1 1zM11 2v2c0 .55.45 1 1 1s1-.45 1-1V2c0-.55-.45-1-1-1s-1 .45-1 1zm0 18v2c0 .55.45 1 1 1s1-.45 1-1v-2c0-.55-.45-1-1-1s-1 .45-1 1zM5.99 4.58c-.39-.39-1.03-.39-1.41 0s-.39 1.03 0 1.41l1.06 1.06c.39.39 1.03.39 1.41 0s.39-1.03 0-1.41L5.99 4.58zm12.37 12.37c-.39-.39-1.03-.39-1.41 0s-.39 1.03 0 1.41l1.06 1.06c.39.39 1.03.39 1.41 0s.39-1.03 0-1.41l-1.06-1.06zm1.06-12.37c-.39-.39-1.03-.39-1.41 0l-1.06 1.06c-.39.39-.39 1.03 0 1.41s1.03.39 1.41 0l1.06-1.06c.39-.39.39-1.03 0-1.41zm-12.37 12.37c-.39-.39-1.03-.39-1.41 0l-1.06 1.06c-.39.39-.39 1.03 0 1.41s1.03.39 1.41 0l1.06-1.06c.39-.39.39-1.03 0-1.41z"/>
        </svg>`;
    } else {
      themeIcon.innerHTML = `
        <svg class="svg-icon" viewBox="0 0 24 24">
          <path d="M12.3 2a10 10 0 0 0-1.9 19.8 10 10 0 0 0 11.6-11.6A10 10 0 0 0 12.3 2zm0 18a8 8 0 1 1 0-16 8 8 0 0 1 0 16z"/>
        </svg>`;
    }
  }

  // Setup Commands Tabs
  const tabBtns = document.querySelectorAll('.tab-btn');
  const setupPanels = document.querySelectorAll('.setup-panel');
  
  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      tabBtns.forEach(b => b.classList.remove('active'));
      setupPanels.forEach(p => p.classList.remove('active'));
      
      btn.classList.add('active');
      const tabId = btn.getAttribute('data-tab');
      document.getElementById(`${tabId}-panel`).classList.add('active');
    });
  });

  // Copy Code Action
  const copyBtns = document.querySelectorAll('.copy-btn');
  
  copyBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const codeId = btn.getAttribute('data-code-id');
      const codeText = document.getElementById(codeId).innerText;
      
      navigator.clipboard.writeText(codeText).then(() => {
        const originalText = btn.innerHTML;
        btn.classList.add('copied');
        btn.innerHTML = `
          <svg class="svg-icon" viewBox="0 0 24 24" style="fill:white;">
            <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z"/>
          </svg> Copied!`;
        
        setTimeout(() => {
          btn.classList.remove('copied');
          btn.innerHTML = originalText;
        }, 2000);
      }).catch(err => {
        console.error('Failed to copy text: ', err);
      });
    });
  });

  // Sandbox Mock Dashboard Tab Switching
  const dashTabBtns = document.querySelectorAll('.dash-tab-btn');
  const dashTabContents = document.querySelectorAll('.dash-tab-content');
  
  dashTabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      dashTabBtns.forEach(b => b.classList.remove('active'));
      dashTabContents.forEach(c => c.classList.remove('active'));
      
      btn.classList.add('active');
      const targetId = `dash-${btn.getAttribute('data-dash-tab')}`;
      document.getElementById(targetId).classList.add('active');
    });
  });

  // Interactive Playground Simulator
  const modelSelect = document.getElementById('model-select');
  const simulateBtn = document.getElementById('simulate-btn');
  const proxyUrlDisplay = document.getElementById('proxy-url-display');
  
  const line1 = document.getElementById('line-client-proxy');
  const line2 = document.getElementById('line-proxy-provider');
  
  // Dashboard mock variables
  let directoryTotalCalls = 4952;
  const directoryModels = {
    haiku: { calls: 3450, cost: 0.966 },
    opus: { calls: 863, cost: 12.945 },
    gemini: { calls: 639, cost: 0.047 }
  };

  const providerCalls = {
    'prov-a': 204,
    'prov-b': 58,
    'prov-c': 25,
    'prov-d': 155,
    'prov-e': 0
  };

  let analyticsTotalTokens = 144474006;
  const analyticsBars = {
    opus7: { val: 863603, out: 126028, pct: 36.4 },
    dsv4: { val: 390714, out: 102811, pct: 19.8 },
    haiku20: { val: 5103289, out: 233762, pct: 13.2 },
    sonnet6: { val: 142445, out: 144717, pct: 10.4 }
  };

  const consoleBody = document.getElementById('console-body');
  
  // Model Select changes local base URL dynamically
  modelSelect.addEventListener('change', () => {
    const selectedModel = modelSelect.value;
    const providerId = selectedModel.split('/')[0];
    proxyUrlDisplay.innerText = `http://127.0.0.1:3210/proxy/${providerId}_provider/v1`;
    
    // Highlight provider in UI list
    document.querySelectorAll('.provider-item').forEach(item => {
      item.classList.remove('active');
    });
    document.getElementById(`prov-${providerId}`).classList.add('active');
  });
  
  // Trigger simulation
  simulateBtn.addEventListener('click', () => {
    const fullModelName = modelSelect.value;
    const providerName = fullModelName.split('/')[0];
    const modelName = fullModelName.split('/')[1];
    
    simulateBtn.disabled = true;
    simulateBtn.innerText = 'Processing Request...';
    
    // Add console log starting the call
    addConsoleLine('POST', `/proxy/${providerName}_provider/v1/chat/completions`, `Routing request for model <strong>${modelName}</strong>...`);
    
    // Animate flow: Client -> Proxy
    line1.classList.add('active');
    
    setTimeout(() => {
      // Reaches proxy, proxy logs authentication & key injection
      addConsoleLine('INFO', 'API Vault', `Validating client key. Injecting real encrypted upstream key. Forwarding request...`);
      line2.classList.add('active');
      
      setTimeout(() => {
        // Reaches provider, success returns
        const tokensIn = Math.floor(Math.random() * 200) + 100;
        const tokensOut = Math.floor(Math.random() * 400) + 150;
        const totalTokens = tokensIn + tokensOut;
        const latency = getLatencyForProvider(providerName);
        const cost = calculateCost(providerName, tokensIn, tokensOut);
        
        addConsoleLine('SUCCESS', '200 OK', `Upstream response in <strong>${latency}ms</strong>. Tokens: <strong>${totalTokens}</strong> (${tokensIn} in, ${tokensOut} out). Cost: <strong>$${cost.toFixed(5)}</strong>`);
        
        // ------------------------------------
        // Dynamic Updates in Mockup Views
        // ------------------------------------
        
        // Update variables
        directoryTotalCalls += 1;
        document.getElementById('mock-total-calls').innerText = `${directoryTotalCalls.toLocaleString()} calls recorded`;

        // 1. UPDATE TAB 1: MODEL DIRECTORY
        if (fullModelName === 'openai/gpt-4o') {
          // openai/gpt-4o -> updates gemini mock row (as example)
          const row = document.getElementById('row-gemini-flash');
          row.classList.add('flash-highlight');
          setTimeout(() => row.classList.remove('flash-highlight'), 800);
          
          directoryModels.gemini.calls += 1;
          directoryModels.gemini.cost += cost;
          document.getElementById('calls-gemini').innerText = `${directoryModels.gemini.calls} calls`;
          document.getElementById('cost-gemini').innerText = `$${directoryModels.gemini.cost.toFixed(3)}`;

          // Provider updates -> provider-d row
          updateProviderRow('prov-d', latency, 84.6);
          
          // Analytics updates -> claude-sonnet-4-6
          updateAnalyticsRow('sonnet6', tokensIn, tokensOut);
          
        } else if (fullModelName === 'deepseek/deepseek-chat') {
          // deepseek-chat -> updates claude-opus mock row
          const row = document.getElementById('row-claude-opus');
          row.classList.add('flash-highlight');
          setTimeout(() => row.classList.remove('flash-highlight'), 800);
          
          directoryModels.opus.calls += 1;
          directoryModels.opus.cost += cost;
          document.getElementById('calls-opus').innerText = `${directoryModels.opus.calls} calls`;
          document.getElementById('cost-opus').innerText = `$${directoryModels.opus.cost.toFixed(3)}`;

          // Provider updates -> provider-c row
          updateProviderRow('prov-c', latency, 69.1, true);

          // Analytics updates -> claude-deepseek-v4
          updateAnalyticsRow('dsv4', tokensIn, tokensOut);

        } else if (fullModelName === 'claude/claude-3-5-sonnet') {
          // claude-3-5-sonnet -> updates claude-haiku mock row
          const row = document.getElementById('row-claude-haiku');
          row.classList.add('flash-highlight');
          setTimeout(() => row.classList.remove('flash-highlight'), 800);
          
          directoryModels.haiku.calls += 1;
          directoryModels.haiku.cost += cost;
          document.getElementById('calls-haiku').innerText = `${directoryModels.haiku.calls} calls`;
          document.getElementById('cost-haiku').innerText = `$${directoryModels.haiku.cost.toFixed(3)}`;

          // Provider updates -> provider-a row
          updateProviderRow('prov-a', latency, 66.8, true);

          // Analytics updates -> claude-opus-4-7
          updateAnalyticsRow('opus7', tokensIn, tokensOut);
        }

        // Reset flow animation lines
        line1.classList.remove('active');
        line2.classList.remove('active');
        simulateBtn.disabled = false;
        simulateBtn.innerText = 'Send Mock Request';
        
      }, 1000);
      
    }, 800);
  });
  
  function getLatencyForProvider(provider) {
    if (provider === 'openai') return Math.floor(Math.random() * 200) + 300; // 300-500ms
    if (provider === 'deepseek') return Math.floor(Math.random() * 150) + 200; // 200-350ms
    return Math.floor(Math.random() * 400) + 500; // 500-900ms for Claude
  }
  
  function calculateCost(provider, prompt, completion) {
    let rateIn = 0.005; 
    let rateOut = 0.015;
    if (provider === 'deepseek') {
      rateIn = 0.00014;
      rateOut = 0.00028;
    } else if (provider === 'claude') {
      rateIn = 0.003;
      rateOut = 0.015;
    }
    return (prompt * rateIn + completion * rateOut) / 1000;
  }
  
  function updateProviderRow(providerId, latency, successRate, recoverFromOutage = false) {
    const row = document.getElementById(`status-row-${providerId}`);
    row.classList.add('flash-highlight');
    setTimeout(() => row.classList.remove('flash-highlight'), 800);

    providerCalls[providerId] += 1;
    document.getElementById(`prov-calls-${providerId}`).innerText = providerCalls[providerId];
    document.getElementById(`prov-latency-${providerId}`).innerText = `${latency}ms`;
    document.getElementById(`prov-success-${providerId}`).innerText = `${successRate.toFixed(1)}%`;

    if (recoverFromOutage) {
      // Temporarily mark status as Online (green)
      const statusCell = document.getElementById(`prov-status-${providerId}`);
      const originalText = statusCell.innerText;
      
      row.className = 'prov-status-row online';
      statusCell.className = 'm-val stat-online';
      statusCell.innerText = 'Online';
      row.querySelector('.prov-health-icon').innerText = '✓';

      setTimeout(() => {
        row.className = 'prov-status-row outage';
        statusCell.className = 'm-val stat-outage';
        statusCell.innerText = originalText;
        row.querySelector('.prov-health-icon').innerText = '✕';
      }, 3000);
    }
  }

  function updateAnalyticsRow(barId, promptTokens, completionTokens) {
    const totalTokens = promptTokens + completionTokens;
    
    // Add to total counter
    analyticsTotalTokens += totalTokens;
    const totalsEl = document.getElementById('analytics-total-tokens');
    totalsEl.innerText = analyticsTotalTokens.toLocaleString();
    totalsEl.classList.add('flash-highlight');
    setTimeout(() => totalsEl.classList.remove('flash-highlight'), 800);

    // Update model tokens in layout
    analyticsBars[barId].val += promptTokens;
    analyticsBars[barId].out += completionTokens;
    
    document.getElementById(`token-val-${barId}`).innerText = `${analyticsBars[barId].val.toLocaleString()} in - ${analyticsBars[barId].out.toLocaleString()} out`;

    // Shift bar percentage values slightly
    analyticsBars[barId].pct = (analyticsBars[barId].pct + 0.1);
    document.getElementById(`bar-pct-${barId}`).innerText = `${analyticsBars[barId].pct.toFixed(1)}%`;
    document.getElementById(`bar-fill-${barId}`).style.width = `${analyticsBars[barId].pct}%`;
  }
  
  function addConsoleLine(type, source, message) {
    const time = new Date().toLocaleTimeString();
    const line = document.createElement('div');
    line.className = 'console-line';
    
    let typeSpan = '';
    if (type === 'POST') {
      typeSpan = `<span class="method">POST</span><span class="url">${source}</span>`;
    } else if (type === 'SUCCESS') {
      typeSpan = `<span class="success">[${source}]</span>`;
    } else if (type === 'INFO') {
      typeSpan = `<span style="color:#61afef">[INFO] [${source}]</span>`;
    }
    
    line.innerHTML = `<span class="time">${time}</span> ${typeSpan} ${message}`;
    consoleBody.appendChild(line);
    consoleBody.scrollTop = consoleBody.scrollHeight;
  }
});
