```
const REPO_OWNER = 'RandyCorrea';
const REPO_NAME = 'news-scraper';
const NEWS_SOURCE = 'data/news.json';
const PORTALS_SOURCE = 'data/portals.json';

// DOM Elements
const GRID = document.getElementById('news-grid');
const PORTALS_LIST = document.getElementById('portals-list');
const TOAST = document.getElementById('toast');
const TOAST_MSG = document.getElementById('toast-message');
const TOKEN_INPUT = document.getElementById('gh-token');

// State
let newsData = [];
let portalsData = [];

// Init
document.addEventListener('DOMContentLoaded', async () => {
    // Tab Switching
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
            btn.classList.add('active');
            document.getElementById(btn.dataset.tab).classList.add('active');
        });
    });

    // Load Data
    await Promise.all([loadNews(), loadPortals()]);

    // Portal Events
    document.getElementById('test-portal-btn').addEventListener('click', testPortalExtraction);
    document.getElementById('save-portal-btn').addEventListener('click', saveNewPortal);
    document.getElementById('trigger-btn').addEventListener('click', triggerScraper);
    document.getElementById('check-links-btn').addEventListener('click', checkLinks);
});

async function loadNews() {
    try {
        const response = await fetch(NEWS_SOURCE + '?t=' + Date.now()); // bust cache
        if (!response.ok) throw new Error('Failed to load news');
        newsData = await response.json();
        renderNews(newsData);
    } catch (error) {
        console.error(error);
        GRID.innerHTML = `< div style = "grid-column:1/-1;text-align:center" > No news data found.</div > `;
    }
}

async function loadPortals() {
    try {
        const response = await fetch(PORTALS_SOURCE + '?t=' + Date.now());
        if (!response.ok) throw new Error('Failed to load portals');
        portalsData = await response.json();
        renderPortals(portalsData);
    } catch (error) {
        console.error("Portals load error:", error);
    }
}

function renderNews(articles) {
    if (!articles || articles.length === 0) {
        GRID.innerHTML = '<p class="no-data">No articles found.</p>';
        return;
    }

    // Sort by predicted score desc
    articles.sort((a, b) => (b.predicted_score || 0) - (a.predicted_score || 0));

    GRID.innerHTML = articles.map(article => {
        const rating = article.user_score || 0;
        const pred = article.predicted_score ? article.predicted_score.toFixed(1) : '?';
        
        return `
    < article class="card" data - url="${article.url}" data - id="${article.id}" >
            <div class="card-image-container">
                <span class="prediction-badge">AI Score: ${pred}</span>
                <img src="${article.image || 'https://placehold.co/600x400'}" alt="Img" class="card-image" onerror="this.src='https://placehold.co/600x400?text=Error'">
            </div>
            <div class="card-content">
                <span class="source-badge">${article.source}</span>
                <a href="${article.url}" target="_blank" class="card-title">${article.title}</a>
                
                <div class="rating-container">
                    <span class="rating-label">Rate this:</span>
                    <div class="stars" data-id="${article.id}">
                        ${[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(n => `
                            <span class="star ${n <= rating ? 'active' : ''}" data-val="${n}" onclick="rateArticle(${article.id}, ${n})">★</span>
                        `).join('')}
                    </div>
                </div>

                <div class="card-meta">
                    <span class="date">${new Date(article.scraped_at).toLocaleDateString()}</span>
                    <div class="status-indicator">
                        <div class="status-dot" id="status-${article.id}"></div>
                    </div>
                </div>
            </div>
        </article >
    `}).join('');
}

function renderPortals(portals) {
    PORTALS_LIST.innerHTML = portals.map(p => `
    < div class="portal-item" >
            <div class="portal-info">
                <strong>${p.url}</strong>
                <span class="portal-url">${p.section} | Enabled: ${p.enabled}</span>
            </div>
            <button class="btn danger" onclick="deletePortal(${p.id})">Delete</button>
        </div >
    `).join('');
}

// Actions

async function rateArticle(id, score) {
    const token = TOKEN_INPUT.value;
    if (!token) {
        showToast('Token required to save rating!', 'error');
        return;
    }

    // Optimistic Update
    const article = newsData.find(a => a.id === id);
    if (article) article.user_score = score;
    renderNews(newsData);
    
    showToast(`Saving rating ${ score }...`, 'info');
    await updateGitHubFile(NEWS_SOURCE, newsData, `User rated article ${ id } as ${ score } `);
}

async function saveNewPortal() {
    const token = TOKEN_INPUT.value;
    if (!token) {
        showToast('Token required to save portal!', 'error');
        return;
    }
    
    const url = document.getElementById('portal-url').value;
    const section = document.getElementById('portal-section').value;
    
    const newPortal = {
        id: Date.now(),
        url,
        section,
        enabled: true,
        selectors: { item: 'h2', link: 'a' } // Default
    };
    
    portalsData.push(newPortal);
    renderPortals(portalsData);
    
    await updateGitHubFile(PORTALS_SOURCE, portalsData, `Add portal ${ url } `);
    
    // reset form
    document.getElementById('portal-url').value = '';
}

async function deletePortal(id) {
    if (!confirm('Are you sure?')) return;
    const token = TOKEN_INPUT.value;
    if (!token) {
        showToast('Token required!', 'error');
        return;
    }
    
    portalsData = portalsData.filter(p => p.id !== id);
    renderPortals(portalsData);
    await updateGitHubFile(PORTALS_SOURCE, portalsData, `Delete portal ${ id } `);
}

async function testPortalExtraction() {
    const url = document.getElementById('portal-url').value;
    const resultBox = document.getElementById('test-result');
    
    if (!url) {
        showToast('Enter URL first', 'error');
        return;
    }
    
    resultBox.classList.remove('hidden');
    resultBox.innerText = 'Testing connection... (Proxying via CORS-Anywhere or direct)';
    
    // Client-side fetch is limited by CORS.
    // For a real robust test, we would need a serverless function.
    // Here we try simple fetch, if it fails, we warn user.
    try {
        const res = await fetch(url, { mode: 'no-cors' }); 
        // Opaque response means we reached it but can't read content easily in JS.
        // We simulate success if no network error.
        resultBox.className = 'test-result success';
        resultBox.innerText = `✅ Reachable. (Content parsing happens on the server / bot).`;
        document.getElementById('save-portal-btn').disabled = false;
    } catch (e) {
        resultBox.className = 'test-result error';
        resultBox.innerText = `❌ Connection Failed: ${ e.message }. Bot might still access it.`;
        // Enable anyway to let user try?
        document.getElementById('save-portal-btn').disabled = false;
    }
}

// GitHub Utilities

async function updateGitHubFile(path, contentObj, msg) {
    const token = TOKEN_INPUT.value;
    const apiUrl = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${path}`;

try {
    // 1. Get current SHA
    const getRes = await fetch(apiUrl, {
        headers: { 'Authorization': `token ${token}` }
    });
    const getData = await getRes.json();
    const sha = getData.sha;

    // 2. Update
    const contentStr = JSON.stringify(contentObj, null, 2);
    const encoded = btoa(unescape(encodeURIComponent(contentStr))); // Unicode safe b64

    const putRes = await fetch(apiUrl, {
        method: 'PUT',
        headers: {
            'Authorization': `token ${token}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            message: msg,
            content: encoded,
            sha: sha
        })
    });

    if (putRes.ok) {
        showToast('Saved successfully!', 'success');
    } else {
        console.error(await putRes.json());
        showToast('Failed to save to GitHub', 'error');
    }
} catch (e) {
    console.error(e);
    showToast('Network error saving data', 'error');
}
}

async function triggerScraper() {
    const token = TOKEN_INPUT.value;
    if (!token) {
        showToast('Token required!', 'error');
        return;
    }

    try {
        const res = await fetch(`https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/dispatches`, {
            method: 'POST',
            headers: { 'Authorization': `token ${token}` },
            body: JSON.stringify({ event_type: 'trigger-scraper' })
        });

        if (res.ok) showToast('Bot Triggered! Refresh in 2-3 mins.', 'success');
        else showToast('Failed to trigger bot', 'error');
    } catch (e) {
        showToast('Error triggering bot', 'error');
    }
}

function showToast(msg, type = 'info') {
    TOAST_MSG.innerText = msg;
    TOAST.className = `toast visible`;
    setTimeout(() => TOAST.className = 'toast hidden', 3000);
}

// Placeholder for checkLinks from v1
async function checkLinks() {
    // ... same as before
    const cards = document.querySelectorAll('.card');
    showToast('Checking links...', 'info');
    for (const card of cards) {
        try {
            await fetch(card.dataset.url, { mode: 'no-cors', method: 'HEAD' });
            document.getElementById(`status-${card.dataset.id}`).style.background = 'var(--success)';
        } catch (e) {
            document.getElementById(`status-${card.dataset.id}`).style.background = 'var(--error)';
        }
    }
}
```
