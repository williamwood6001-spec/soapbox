const API = '/.netlify/functions/api';

function apiCall(action, data = {}) {
  const token = localStorage.getItem('susubox_token');
  return fetch(API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, token, ...data }),
  }).then(async res => {
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || 'Something went wrong');
    return body;
  });
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// ===== View switching =====
const views = {
  landing: document.getElementById('landing'),
  auth: document.getElementById('auth'),
  app: document.getElementById('app'),
};
function showView(name) {
  Object.values(views).forEach(v => v.classList.add('hidden'));
  views[name].classList.remove('hidden');
}

document.getElementById('openAuthTop').addEventListener('click', () => showView('auth'));
document.getElementById('openAuthHero').addEventListener('click', () => showView('auth'));
document.getElementById('backToLandingFromAuth').addEventListener('click', () => showView('landing'));

// ===== Auth tabs =====
document.querySelectorAll('.auth-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById('loginForm').classList.toggle('hidden', tab.dataset.auth !== 'login');
    document.getElementById('signupForm').classList.toggle('hidden', tab.dataset.auth !== 'signup');
  });
});

let currentUser = null;

document.getElementById('loginForm').addEventListener('submit', async e => {
  e.preventDefault();
  const errEl = document.getElementById('loginError');
  errEl.textContent = '';
  try {
    const phone = document.getElementById('loginPhone').value.trim();
    const password = document.getElementById('loginPassword').value;
    const { token, user } = await apiCall('login', { phone, password });
    localStorage.setItem('susubox_token', token);
    currentUser = user;
    enterApp();
  } catch (err) {
    errEl.textContent = err.message;
  }
});

document.getElementById('signupForm').addEventListener('submit', async e => {
  e.preventDefault();
  const errEl = document.getElementById('signupError');
  errEl.textContent = '';
  try {
    const name = document.getElementById('signupName').value.trim();
    const phone = document.getElementById('signupPhone').value.trim();
    const password = document.getElementById('signupPassword').value;
    const { token, user } = await apiCall('signup', { name, phone, password });
    localStorage.setItem('susubox_token', token);
    currentUser = user;
    enterApp();
  } catch (err) {
    errEl.textContent = err.message;
  }
});

document.getElementById('logoutBtn').addEventListener('click', async () => {
  await apiCall('logout').catch(() => {});
  localStorage.removeItem('susubox_token');
  currentUser = null;
  stopLedgerPolling();
  showView('landing');
});

// ===== Entering the app =====
async function enterApp() {
  showView('app');
  await refreshProfile();
  await refreshGroups();
  switchToTab('groups');
}

async function refreshProfile() {
  const { user } = await apiCall('profile-get');
  currentUser = user;
  document.getElementById('whoami').textContent = user.name;
  document.getElementById('profileName').textContent = user.name;
  document.getElementById('profilePhone').textContent = user.phone;
  document.getElementById('avatarInitials').textContent = user.name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase();
  document.getElementById('statTrust').textContent = user.trustScore;
  document.getElementById('statCycles').textContent = user.cyclesCompleted;

  const kycLine = document.getElementById('kycStatusLine');
  const banner = document.getElementById('kycBanner');
  if (user.kycStatus === 'submitted') {
    kycLine.innerHTML = '<span class="stamp paid small-stamp">✓ submitted</span>';
    banner.classList.add('hidden');
  } else {
    kycLine.innerHTML = '<span class="stamp late small-stamp">not verified</span>';
    banner.classList.remove('hidden');
  }
}

// ===== Tabs =====
const tabs = document.querySelectorAll('.tab');
const panels = document.querySelectorAll('.tab-panel');
tabs.forEach(tab => {
  tab.addEventListener('click', () => switchToTab(tab.dataset.tab));
});
function switchToTab(name) {
  tabs.forEach(t => t.classList.toggle('active', t.dataset.tab === name));
  panels.forEach(p => p.classList.toggle('active', p.id === 'tab-' + name));
  if (name !== 'ledger') stopLedgerPolling();
}

// ===== Groups list =====
const groupList = document.getElementById('groupList');
let myGroups = [];

async function refreshGroups() {
  const { groups } = await apiCall('groups-list');
  myGroups = groups;
  document.getElementById('statGroups').textContent = groups.length;
  groupList.innerHTML = '';
  document.getElementById('groupListEmpty').style.display = groups.length ? 'none' : 'block';
  groups.forEach(group => {
    const paidCount = group.members.filter(m => m.status === 'paid').length;
    const card = document.createElement('div');
    card.className = 'group-card';
    card.innerHTML = `
      <div>
        <h4></h4>
        <p>${group.members.length} members · week ${group.week} of ${group.totalWeeks} · ${paidCount}/${group.members.length} paid</p>
      </div>
      <div class="amount">GH₵${group.amount}</div>
    `;
    card.querySelector('h4').textContent = group.name;
    card.addEventListener('click', () => openLedger(group.id));
    groupList.appendChild(card);
  });
}

// ===== New group modal =====
const modalOverlay = document.getElementById('modalOverlay');
document.getElementById('newGroupBtn').addEventListener('click', () => modalOverlay.classList.remove('hidden'));
document.getElementById('cancelNewGroup').addEventListener('click', () => modalOverlay.classList.add('hidden'));

document.getElementById('newGroupForm').addEventListener('submit', async e => {
  e.preventDefault();
  const errEl = document.getElementById('ngError');
  errEl.textContent = '';
  try {
    const name = document.getElementById('ngName').value.trim();
    const amount = document.getElementById('ngAmount').value;
    const size = document.getElementById('ngSize').value;
    const { group } = await apiCall('groups-create', { name, amount, size });
    e.target.reset();
    modalOverlay.classList.add('hidden');
    await refreshGroups();
    openLedger(group.id);
  } catch (err) {
    errEl.textContent = err.message;
  }
});

// ===== Join group modal =====
const joinOverlay = document.getElementById('joinOverlay');
document.getElementById('joinGroupBtn').addEventListener('click', () => joinOverlay.classList.remove('hidden'));
document.getElementById('cancelJoinGroup').addEventListener('click', () => joinOverlay.classList.add('hidden'));

document.getElementById('joinGroupForm').addEventListener('submit', async e => {
  e.preventDefault();
  const errEl = document.getElementById('jgError');
  errEl.textContent = '';
  try {
    const code = document.getElementById('jgCode').value.trim();
    const { group } = await apiCall('groups-join', { code });
    e.target.reset();
    joinOverlay.classList.add('hidden');
    await refreshGroups();
    openLedger(group.id);
  } catch (err) {
    errEl.textContent = err.message;
  }
});

// ===== Ledger =====
const ledgerEmpty = document.getElementById('ledgerEmpty');
const ledgerContent = document.getElementById('ledgerContent');
let activeGroupId = null;
let ledgerPollTimer = null;

function openLedger(groupId) {
  activeGroupId = groupId;
  switchToTab('ledger');
  renderLedger();
  stopLedgerPolling();
  ledgerPollTimer = setInterval(renderLedger, 5000);
}
function stopLedgerPolling() {
  if (ledgerPollTimer) { clearInterval(ledgerPollTimer); ledgerPollTimer = null; }
}

async function renderLedger() {
  if (!activeGroupId) { ledgerEmpty.classList.remove('hidden'); ledgerContent.classList.add('hidden'); return; }
  let group;
  try {
    const res = await apiCall('group-get', { groupId: activeGroupId });
    group = res.group;
  } catch (err) {
    stopLedgerPolling();
    ledgerEmpty.classList.remove('hidden');
    ledgerContent.classList.add('hidden');
    return;
  }
  ledgerEmpty.classList.add('hidden');
  ledgerContent.classList.remove('hidden');

  document.getElementById('ledgerTitle').textContent = group.name;
  document.getElementById('ledgerMeta').textContent = `Week ${group.week} of ${group.totalWeeks} · GH₵${group.amount} per member`;
  document.getElementById('ledgerCode').textContent = group.code;

  const rows = document.getElementById('ledgerRows');
  rows.innerHTML = '';
  group.members.forEach(member => {
    const tr = document.createElement('tr');
    const statusLabel = { paid: '✓ paid', due: 'awaiting', late: 'not paid' }[member.status] || member.status;
    const isMe = currentUser && member.phone === currentUser.phone;
    tr.innerHTML = `
      <td></td>
      <td><span class="stamp ${member.status}">${statusLabel}</span></td>
      <td class="amount-cell">GH₵${group.amount}</td>
    `;
    tr.children[0].textContent = member.name + (isMe ? ' (you)' : '');
    if (isMe) {
      tr.style.cursor = 'pointer';
      tr.title = 'Tap to mark your payment sent';
      tr.addEventListener('click', async () => {
        try {
          await apiCall('contribution-toggle', { groupId: group.id });
          renderLedger();
          refreshProfile();
        } catch (err) { /* ignore */ }
      });
    }
    rows.appendChild(tr);
  });

  const chatMessages = document.getElementById('chatMessages');
  chatMessages.innerHTML = '';
  group.chat.forEach(msg => {
    const div = document.createElement('div');
    div.className = 'chat-msg';
    div.innerHTML = `<span class="who"></span>`;
    div.querySelector('.who').textContent = msg.who;
    div.appendChild(document.createTextNode(msg.text));
    chatMessages.appendChild(div);
  });
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

document.getElementById('chatForm').addEventListener('submit', async e => {
  e.preventDefault();
  const input = document.getElementById('chatInput');
  const text = input.value.trim();
  if (!text || !activeGroupId) return;
  input.value = '';
  try {
    await apiCall('chat-post', { groupId: activeGroupId, text });
    renderLedger();
  } catch (err) { /* ignore */ }
});

// ===== KYC =====
const kycOverlay = document.getElementById('kycOverlay');
document.getElementById('kycOpenBtn').addEventListener('click', () => kycOverlay.classList.remove('hidden'));
document.getElementById('kycBannerBtn').addEventListener('click', () => kycOverlay.classList.remove('hidden'));
document.getElementById('cancelKyc').addEventListener('click', () => kycOverlay.classList.add('hidden'));

document.getElementById('kycForm').addEventListener('submit', async e => {
  e.preventDefault();
  const errEl = document.getElementById('kycError');
  errEl.textContent = '';
  const submitBtn = e.target.querySelector('button[type=submit]');
  submitBtn.disabled = true;
  try {
    const cardFile = document.getElementById('kycCard').files[0];
    const selfieFile = document.getElementById('kycSelfie').files[0];
    if (!cardFile || !selfieFile) throw new Error('Both photos are required');
    const [ghanaCardImage, selfieImage] = await Promise.all([fileToDataUrl(cardFile), fileToDataUrl(selfieFile)]);
    await apiCall('kyc-upload', { ghanaCardImage, selfieImage });
    e.target.reset();
    kycOverlay.classList.add('hidden');
    await refreshProfile();
  } catch (err) {
    errEl.textContent = err.message;
  } finally {
    submitBtn.disabled = false;
  }
});

// ===== Resume session on load =====
(async function init() {
  const token = localStorage.getItem('susubox_token');
  if (!token) return;
  try {
    await enterApp();
  } catch (err) {
    localStorage.removeItem('susubox_token');
  }
})();
