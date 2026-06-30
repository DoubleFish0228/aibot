/**
 * PaperFinder — 智能论文检索
 * 基于 DeepSeek Chat API (OpenAI 兼容)
 */

// ========== State ==========
const state = {
  apiBase: 'https://api.deepseek.com/v1',
  apiKey: '',
  model: 'deepseek-chat',
  connected: false,
  resultCount: 5,
  searchResults: [],
  currentPage: 1,
  pageSize: 10,
  totalResults: 0,
  lastQuery: '',
  isLoading: false
};

// ========== DOM refs ==========
const $ = (s) => document.querySelector(s);

const D = {
  drawer: $('#drawer'),
  drawerOverlay: $('#drawerOverlay'),
  btnCloseDrawer: $('#btnCloseDrawer'),
  apiBase: $('#apiBase'),
  apiKey: $('#apiKey'),
  toggleKey: $('#toggleKey'),
  modelSelect: $('#modelSelect'),
  resultCount: $('#resultCount'),
  resultCountValue: $('#resultCountValue'),
  domainCheckboxes: $('#domainCheckboxes'),
  btnConnect: $('#btnConnect'),
  connectStatus: $('#connectStatus'),
  connDot: $('#connDot'),
  connLabel: $('#connLabel'),
  btnSettings: $('#btnSettings'),
  searchInput: $('#searchInput'),
  btnSearch: $('#btnSearch'),
  searchSuggestions: $('#searchSuggestions'),
  resultsArea: $('#resultsArea'),
  resultsToolbar: $('#resultsToolbar'),
  resultsStats: $('#resultsStats'),
  btnClear: $('#btnClear'),
  sortBy: $('#sortBy'),
  resultsList: $('#resultsList'),
  loadingOverlay: $('#loadingOverlay'),
  loadingText: $('#loadingText'),
  emptyState: $('#emptyState'),
  noResults: $('#noResults'),
  pagination: $('#pagination'),
  modalOverlay: $('#modalOverlay'),
  modalBadge: $('#modalBadge'),
  modalTitle: $('#modalTitle'),
  modalBody: $('#modalBody'),
  btnCloseModal: $('#btnCloseModal')
};

// ========== API ==========
async function callDeepSeek(systemPrompt, userMessage) {
  const url = `${state.apiBase}/chat/completions`;
  const headers = {
    'Authorization': `Bearer ${state.apiKey}`,
    'Content-Type': 'application/json'
  };
  const body = {
    model: state.model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage }
    ],
    temperature: 0.3,
    max_tokens: 4096,
    stream: false
  };
  try {
    const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: { message: res.statusText } }));
      throw new Error(err.error?.message || `HTTP ${res.status}`);
    }
    return await res.json();
  } catch (e) {
    if (e.name === 'TypeError' && e.message.includes('fetch'))
      throw new Error('网络连接失败，请检查 API URL');
    throw e;
  }
}

function buildSystemPrompt() {
  const checks = D.domainCheckboxes.querySelectorAll('input:checked');
  const domains = Array.from(checks).map(c => {
    const map = { cs:'计算机科学', ai:'人工智能', math:'数学', physics:'物理学', bio:'生物学', econ:'经济学' };
    return map[c.value] || c.value;
  });
  const count = state.resultCount;

  return `你是一个专业的学术论文检索助手。你的任务是帮用户查找学术论文。

重要：你的回答必须是纯 JSON 格式，不要包含任何 Markdown、代码块标记或其他文本。

当用户提出查询时，请检索并返回 ${count} 篇最相关的论文。优先检索以下领域：${domains.join('、')}。

请严格按以下 JSON 格式输出：
{
  "papers": [
    {
      "title": "论文标题（英文）",
      "title_cn": "中文译名",
      "authors": ["作者1", "作者2"],
      "year": 2024,
      "journal": "期刊/会议名称",
      "doi": "DOI号（如10.xxx/xxx）",
      "abstract": "论文摘要，约150-300字",
      "keywords": ["关键词1", "关键词2"],
      "citations": 引用次数（整数）,
      "url": "论文链接（如有）"
    }
  ]
}

注意事项：
1. 只返回真实存在的论文，不要编造
2. 优先返回知名期刊和顶会论文
3. 摘要使用中文总结核心贡献
4. 如果没有找到相关论文，返回 {"papers": []}`;
}

function parseSearchResult(data) {
  if (!data || !data.choices || !data.choices.length) return [];
  const content = data.choices[0]?.message?.content || '';
  try {
    // 尝试直接解析 JSON
    let json = JSON.parse(content);
    return json.papers || [];
  } catch {
    // 尝试提取 JSON 块（可能被 markdown 包裹）
    const match = content.match(/```(?:json)?\s*([\s\S]*?)```/) || content.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        const json = JSON.parse(match[1] || match[0]);
        return json.papers || [];
      } catch { /* fall through */ }
    }
    return [];
  }
}

// ========== Drawer ==========
function openDrawer() {
  D.drawer.classList.add('open');
  D.drawerOverlay.classList.add('open');
  document.body.style.overflow = 'hidden';
}
function closeDrawer() {
  D.drawer.classList.remove('open');
  D.drawerOverlay.classList.remove('open');
  document.body.style.overflow = '';
}

D.btnSettings.addEventListener('click', openDrawer);
D.btnCloseDrawer.addEventListener('click', closeDrawer);
D.drawerOverlay.addEventListener('click', closeDrawer);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && D.drawer.classList.contains('open')) closeDrawer();
});

// ========== Connection ==========
function setConnectionStatus(type) {
  D.connDot.className = 'connection-dot';
  if (type === 'connected') {
    D.connDot.classList.add('connected');
    D.connLabel.textContent = '已连接';
  } else if (type === 'error') {
    D.connDot.classList.add('error');
    D.connLabel.textContent = '连接失败';
  } else {
    D.connLabel.textContent = '未连接';
  }
}

function showStatus(msg, type) {
  D.connectStatus.textContent = msg;
  D.connectStatus.className = `conn-msg ${type}`;
}

async function testConnection() {
  const baseUrl = D.apiBase.value.trim();
  const apiKey = D.apiKey.value.trim();
  if (!apiKey) { showStatus('请输入 API Key', 'error'); return; }
  state.apiBase = baseUrl.replace(/\/+$/, '');
  state.apiKey = apiKey;
  state.model = D.modelSelect.value;
  state.resultCount = parseInt(D.resultCount.value);

  showStatus('连接中...', 'loading');
  D.btnConnect.disabled = true;

  try {
    // 发送一个简单请求测试连接
    const result = await callDeepSeek('请用JSON格式回复：{"status":"ok"}', '你好');
    state.connected = true;
    setConnectionStatus('connected');
    showStatus(`已连接 — 模型: ${state.model}`, 'success');
    D.btnSearch.disabled = false;
    D.searchInput.disabled = false;
    D.searchInput.placeholder = '输入论文关键词、标题或作者...';
  } catch (e) {
    state.connected = false;
    setConnectionStatus('error');
    showStatus(`连接失败: ${e.message}`, 'error');
    D.btnSearch.disabled = true;
    D.searchInput.disabled = true;
  } finally {
    D.btnConnect.disabled = false;
  }
}

D.btnConnect.addEventListener('click', testConnection);
D.apiKey.addEventListener('keydown', (e) => { if (e.key === 'Enter') testConnection(); });

// ========== Suggestions ==========
function renderSuggestions() {
  const tags = [
    '深度学习', '大语言模型', '计算机视觉',
    '自然语言处理', '知识图谱', '强化学习',
    '图神经网络', 'Transformer', '扩散模型'
  ];
  D.searchSuggestions.innerHTML = '<span class="tags-label">热门：</span>';
  tags.forEach(t => {
    const sp = document.createElement('span');
    sp.className = 'tag';
    sp.textContent = t;
    sp.addEventListener('click', () => { D.searchInput.value = t; performSearch(1); });
    D.searchSuggestions.appendChild(sp);
  });
}

// ========== Search ==========
async function performSearch(page = 1) {
  const q = D.searchInput.value.trim();
  if (!q) return;
  if (!state.connected) { showStatus('请先连接 DeepSeek API', 'error'); openDrawer(); return; }

  state.lastQuery = q;
  state.currentPage = page;
  state.isLoading = true;

  D.emptyState.style.display = 'none';
  D.noResults.style.display = 'none';
  D.resultsList.innerHTML = '';
  D.resultsToolbar.style.display = 'none';
  D.pagination.style.display = 'none';
  D.loadingOverlay.style.display = 'flex';
  D.loadingText.textContent = 'DeepSeek 正在检索论文...';

  try {
    const domains = getUserDomains();
    const systemPrompt = buildSystemPrompt();
    const userMessage = `请帮我检索关于「${q}」的学术论文。优先考虑${domains.join('、')}领域。`;

    const data = await callDeepSeek(systemPrompt, userMessage);
    const papers = parseSearchResult(data);

    state.searchResults = papers;
    state.totalResults = papers.length;
    sortResults();

    D.loadingOverlay.style.display = 'none';
    D.resultsToolbar.style.display = 'flex';
    D.resultsStats.innerHTML = `找到 <strong>${state.totalResults}</strong> 篇论文 · "<strong>${esc(q)}</strong>" · 模型: ${state.model}`;

    if (papers.length === 0) {
      D.noResults.style.display = 'block';
      D.resultsList.innerHTML = '';
      D.resultsToolbar.style.display = 'flex';
    } else {
      renderResults();
      renderPagination();
    }
  } catch (err) {
    D.loadingOverlay.style.display = 'none';
    D.resultsList.innerHTML = `<div class="empty"><h3>检索失败</h3><p>${esc(err.message)}</p></div>`;
  } finally {
    state.isLoading = false;
  }
}

function getUserDomains() {
  const checks = D.domainCheckboxes.querySelectorAll('input:checked');
  const map = { cs:'计算机科学', ai:'人工智能', math:'数学', physics:'物理学', bio:'生物学', econ:'经济学' };
  return Array.from(checks).map(c => map[c.value]);
}

D.btnSearch.addEventListener('click', () => performSearch(1));
D.searchInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') performSearch(1); });

D.btnClear.addEventListener('click', () => {
  D.searchInput.value = '';
  state.searchResults = [];
  D.resultsList.innerHTML = '';
  D.resultsToolbar.style.display = 'none';
  D.pagination.style.display = 'none';
  D.noResults.style.display = 'none';
  D.emptyState.style.display = 'block';
  D.resultsArea.style.display = 'block';
});

function sortResults() {
  const by = D.sortBy.value;
  if (by === 'year') {
    state.searchResults.sort((a, b) => (b.year || 0) - (a.year || 0));
  } else {
    state.searchResults.sort((a, b) => (b.citations || 0) - (a.citations || 0));
  }
}
D.sortBy.addEventListener('change', () => {
  sortResults(); state.currentPage = 1; renderResults(); renderPagination();
});

// ========== Results rendering ==========
function renderResults() {
  const start = (state.currentPage - 1) * state.pageSize;
  const end = start + state.pageSize;
  const page = state.searchResults.slice(start, end);

  if (!page.length) { D.resultsList.innerHTML = ''; return; }

  D.resultsList.innerHTML = page.map((p, i) => {
    const gi = start + i;
    const year = p.year || '—';
    const cite = p.citations ?? '—';
    return `
    <article class="card" onclick="showDetail(${gi})">
      <div class="card-head">
        <h3 class="card-title">${esc(p.title || '未知标题')}</h3>
        <span class="score-badge high">${year}</span>
      </div>
      ${p.title_cn ? `<p class="card-title-cn">${esc(p.title_cn)}</p>` : ''}
      <div class="card-meta">
        <span>👤 ${esc((p.authors || []).slice(0, 3).join(', ') || '—')}</span>
        <span>📰 ${esc(p.journal || '—')}</span>
      </div>
      <p class="card-snippet">${esc(p.abstract || '暂无摘要')}</p>
      <div class="card-foot">
        <span class="doc-name">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          ${year} 年 · 引用 ${cite}
        </span>
        <span class="card-link">
          查看详情
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
        </span>
      </div>
    </article>`;
  }).join('');

  D.emptyState.style.display = 'none';
  D.noResults.style.display = 'none';
}

// ========== Pagination ==========
function renderPagination() {
  const tp = Math.ceil(state.totalResults / state.pageSize);
  if (tp <= 1) { D.pagination.style.display = 'none'; return; }
  D.pagination.style.display = 'flex';

  let h = '';
  h += `<button ${state.currentPage === 1 ? 'disabled' : ''} data-page="${state.currentPage - 1}">‹</button>`;

  const mv = 5;
  let sp = Math.max(1, state.currentPage - Math.floor(mv / 2));
  let ep = Math.min(tp, sp + mv - 1);
  if (ep - sp < mv - 1) sp = Math.max(1, ep - mv + 1);

  if (sp > 1) { h += `<button data-page="1">1</button>`; if (sp > 2) h += `<span class="dots">...</span>`; }
  for (let i = sp; i <= ep; i++) h += `<button class="${i === state.currentPage ? 'current' : ''}" data-page="${i}">${i}</button>`;
  if (ep < tp) { if (ep < tp - 1) h += `<span class="dots">...</span>`; h += `<button data-page="${tp}">${tp}</button>`; }

  h += `<button ${state.currentPage === tp ? 'disabled' : ''} data-page="${state.currentPage + 1}">›</button>`;
  D.pagination.innerHTML = h;

  D.pagination.querySelectorAll('button[data-page]').forEach(btn => {
    btn.addEventListener('click', () => goToPage(parseInt(btn.dataset.page)));
  });
}

function goToPage(p) {
  if (state.isLoading) return;
  state.currentPage = p;
  sortResults(); renderResults(); renderPagination();
  window.scrollTo({ top: D.resultsArea.offsetTop - 80, behavior: 'smooth' });
}

// ========== Modal detail ==========
function showDetail(idx) {
  const p = state.searchResults[idx];
  if (!p) return;

  D.modalBadge.textContent = '论文详情';
  D.modalTitle.textContent = p.title || '文档详情';
  D.modalBody.innerHTML = `
    <div class="detail-block">
      <div class="dl">中文译名</div>
      <div class="dv">${esc(p.title_cn || '暂无')}</div>
    </div>
    <div class="detail-block">
      <div class="dl">摘要</div>
      <div class="dv content-block">${esc(p.abstract || '暂无摘要')}</div>
    </div>
    <div class="detail-block">
      <div class="dl">详细信息</div>
      <div class="detail-grid">
        <div class="dg-item"><div class="dg-label">作者</div><div class="dg-value">${esc((p.authors || []).join(', ') || '—')}</div></div>
        <div class="dg-item"><div class="dg-label">发表年份</div><div class="dg-value">${p.year || '—'}</div></div>
        <div class="dg-item"><div class="dg-label">期刊/会议</div><div class="dg-value">${esc(p.journal || '—')}</div></div>
        <div class="dg-item"><div class="dg-label">DOI</div><div class="dg-value" style="font-family:monospace;font-size:.75rem">${esc(p.doi || '—')}</div></div>
        <div class="dg-item"><div class="dg-label">引用次数</div><div class="dg-value">${p.citations ?? '—'}</div></div>
        <div class="dg-item"><div class="dg-label">关键词</div><div class="dg-value">${esc((p.keywords || []).join(', ') || '—')}</div></div>
      </div>
    </div>
    ${p.url ? `<div class="detail-block"><div class="dl">链接</div><div class="dv"><a href="${esc(p.url)}" target="_blank" rel="noopener" style="color:var(--c-accent)">${esc(p.url)}</a></div></div>` : ''}
  `;

  D.modalOverlay.classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeModal() {
  D.modalOverlay.classList.remove('open');
  document.body.style.overflow = '';
}

D.btnCloseModal.addEventListener('click', closeModal);
D.modalOverlay.addEventListener('click', (e) => { if (e.target === D.modalOverlay) closeModal(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && D.modalOverlay.classList.contains('open')) closeModal(); });

// ========== Settings controls ==========
D.resultCount.addEventListener('input', () => {
  state.resultCount = parseInt(D.resultCount.value);
  D.resultCountValue.textContent = state.resultCount;
});

D.modelSelect.addEventListener('change', () => {
  state.model = D.modelSelect.value;
  // 更换模型后需要重新测试连接
  if (state.connected) {
    state.connected = false;
    D.btnSearch.disabled = true;
    D.searchInput.disabled = true;
    setConnectionStatus();
    showStatus('模型已更改，请重新测试连接', 'loading');
  }
});

D.toggleKey.addEventListener('click', () => {
  const isPass = D.apiKey.type === 'password';
  D.apiKey.type = isPass ? 'text' : 'password';
  D.toggleKey.innerHTML = isPass
    ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>'
    : '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
});

// ========== Utils ==========
function esc(s) {
  if (!s) return '';
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

// ========== Init ==========
(function init() {
  const sb = localStorage.getItem('deepseek_api_base');
  const sk = localStorage.getItem('deepseek_api_key');
  const sm = localStorage.getItem('deepseek_model');
  if (sb) D.apiBase.value = sb;
  if (sk) D.apiKey.value = sk;
  if (sm) D.modelSelect.value = sm;

  D.apiBase.addEventListener('change', () => localStorage.setItem('deepseek_api_base', D.apiBase.value.trim()));
  D.apiKey.addEventListener('change', () => localStorage.setItem('deepseek_api_key', D.apiKey.value.trim()));
  D.modelSelect.addEventListener('change', () => localStorage.setItem('deepseek_model', D.modelSelect.value));

  renderSuggestions();
  D.resultsArea.style.display = 'block';
  console.log('📄 PaperFinder — DeepSeek Edition ready');
})();
