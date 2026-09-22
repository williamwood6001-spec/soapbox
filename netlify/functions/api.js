// SusuBox API — single Netlify Function, routed by "action" in the POST body.
// Storage: Netlify Blobs (no external database needed).
//
// IMPORTANT SCOPE NOTE (read this before extending):
// This backend handles accounts, groups, KYC document storage, payment-status
// tracking, and chat. It deliberately does NOT move real money or extend
// credit — those activities require Bank of Ghana licensing. Members still
// pay each other directly via MoMo; this system only records and verifies
// that it happened.

const { getStore } = require('@netlify/blobs');
const crypto = require('crypto');

const USERS = 'susubox-users';
const SESSIONS = 'susubox-sessions';
const GROUPS = 'susubox-groups';
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 days

function store(name) {
  return getStore(name);
}

function jsonResponse(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

function hashPassword(password, salt) {
  const useSalt = salt || crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, useSalt, 64).toString('hex');
  return { hash, salt: useSalt };
}

function verifyPassword(password, salt, hash) {
  const check = crypto.scryptSync(password, salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(check), Buffer.from(hash));
}

function newToken() {
  return crypto.randomBytes(24).toString('hex');
}

function newGroupCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no ambiguous chars
  let code = '';
  for (let i = 0; i < 6; i++) code += chars[crypto.randomInt(chars.length)];
  return code;
}

async function getSessionPhone(token) {
  if (!token) return null;
  const sessions = store(SESSIONS);
  const session = await sessions.get(token, { type: 'json' });
  if (!session) return null;
  if (Date.now() > session.expiresAt) {
    await sessions.delete(token);
    return null;
  }
  return session.phone;
}

function publicUser(user) {
  if (!user) return null;
  return {
    phone: user.phone,
    name: user.name,
    kycStatus: user.kycStatus,
    trustScore: user.trustScore,
    cyclesCompleted: user.cyclesCompleted,
    createdAt: user.createdAt,
  };
}

function publicGroup(group) {
  return {
    id: group.id,
    code: group.code,
    name: group.name,
    amount: group.amount,
    size: group.size,
    week: group.week,
    totalWeeks: group.totalWeeks,
    members: group.members.map(m => ({ name: m.name, phone: m.phone, status: m.status })),
    chat: group.chat.slice(-100),
    createdAt: group.createdAt,
  };
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return jsonResponse(405, { error: 'POST only' });
  }

  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch (e) {
    return jsonResponse(400, { error: 'Invalid JSON' });
  }

  const { action, token } = payload;
  const users = store(USERS);
  const sessions = store(SESSIONS);
  const groups = store(GROUPS);

  try {
    switch (action) {

      case 'signup': {
        const { phone, name, password } = payload;
        if (!phone || !name || !password) {
          return jsonResponse(400, { error: 'phone, name and password are required' });
        }
        if (password.length < 6) {
          return jsonResponse(400, { error: 'Password must be at least 6 characters' });
        }
        const existing = await users.get(phone, { type: 'json' });
        if (existing) {
          return jsonResponse(409, { error: 'An account with this phone number already exists' });
        }
        const { hash, salt } = hashPassword(password);
        const user = {
          phone,
          name,
          passwordHash: hash,
          passwordSalt: salt,
          kycStatus: 'none',
          ghanaCardImage: null,
          selfieImage: null,
          trustScore: 100,
          cyclesCompleted: 0,
          createdAt: Date.now(),
        };
        await users.setJSON(phone, user);

        const sessionToken = newToken();
        await sessions.setJSON(sessionToken, { phone, expiresAt: Date.now() + SESSION_TTL_MS });

        return jsonResponse(200, { token: sessionToken, user: publicUser(user) });
      }

      case 'login': {
        const { phone, password } = payload;
        if (!phone || !password) return jsonResponse(400, { error: 'phone and password are required' });
        const user = await users.get(phone, { type: 'json' });
        if (!user || !verifyPassword(password, user.passwordSalt, user.passwordHash)) {
          return jsonResponse(401, { error: 'Incorrect phone number or password' });
        }
        const sessionToken = newToken();
        await sessions.setJSON(sessionToken, { phone, expiresAt: Date.now() + SESSION_TTL_MS });
        return jsonResponse(200, { token: sessionToken, user: publicUser(user) });
      }

      case 'profile-get': {
        const phone = await getSessionPhone(token);
        if (!phone) return jsonResponse(401, { error: 'Not signed in' });
        const user = await users.get(phone, { type: 'json' });
        return jsonResponse(200, { user: publicUser(user) });
      }

      case 'kyc-upload': {
        const phone = await getSessionPhone(token);
        if (!phone) return jsonResponse(401, { error: 'Not signed in' });
        const { ghanaCardImage, selfieImage } = payload;
        if (!ghanaCardImage || !selfieImage) {
          return jsonResponse(400, { error: 'Both the Ghana Card photo and selfie are required' });
        }
        const user = await users.get(phone, { type: 'json' });
        user.ghanaCardImage = ghanaCardImage;
        user.selfieImage = selfieImage;
        user.kycStatus = 'submitted'; // no automated verification service wired up yet
        await users.setJSON(phone, user);
        return jsonResponse(200, { user: publicUser(user) });
      }

      case 'groups-create': {
        const phone = await getSessionPhone(token);
        if (!phone) return jsonResponse(401, { error: 'Not signed in' });
        const user = await users.get(phone, { type: 'json' });
        const { name, amount, size } = payload;
        if (!name || !amount || !size) return jsonResponse(400, { error: 'name, amount and size are required' });

        const id = crypto.randomUUID();
        const code = newGroupCode();
        const group = {
          id,
          code,
          name,
          amount: Number(amount),
          size: Number(size),
          week: 1,
          totalWeeks: Number(size),
          members: [{ phone: user.phone, name: user.name, status: 'due' }],
          chat: [],
          createdAt: Date.now(),
          createdBy: phone,
        };
        await groups.setJSON(id, group);
        return jsonResponse(200, { group: publicGroup(group) });
      }

      case 'groups-join': {
        const phone = await getSessionPhone(token);
        if (!phone) return jsonResponse(401, { error: 'Not signed in' });
        const user = await users.get(phone, { type: 'json' });
        const { code } = payload;
        if (!code) return jsonResponse(400, { error: 'Group code is required' });

        const list = await groups.list();
        let target = null;
        for (const entry of list.blobs) {
          const g = await groups.get(entry.key, { type: 'json' });
          if (g && g.code === code.toUpperCase()) { target = g; break; }
        }
        if (!target) return jsonResponse(404, { error: 'No group found with that code' });
        if (target.members.some(m => m.phone === phone)) {
          return jsonResponse(200, { group: publicGroup(target) });
        }
        if (target.members.length >= target.size) {
          return jsonResponse(400, { error: 'This group is already full' });
        }
        target.members.push({ phone: user.phone, name: user.name, status: 'due' });
        await groups.setJSON(target.id, target);
        return jsonResponse(200, { group: publicGroup(target) });
      }

      case 'groups-list': {
        const phone = await getSessionPhone(token);
        if (!phone) return jsonResponse(401, { error: 'Not signed in' });
        const list = await groups.list();
        const mine = [];
        for (const entry of list.blobs) {
          const g = await groups.get(entry.key, { type: 'json' });
          if (g && g.members.some(m => m.phone === phone)) mine.push(publicGroup(g));
        }
        mine.sort((a, b) => b.createdAt - a.createdAt);
        return jsonResponse(200, { groups: mine });
      }

      case 'group-get': {
        const phone = await getSessionPhone(token);
        if (!phone) return jsonResponse(401, { error: 'Not signed in' });
        const { groupId } = payload;
        const g = await groups.get(groupId, { type: 'json' });
        if (!g || !g.members.some(m => m.phone === phone)) {
          return jsonResponse(404, { error: 'Group not found' });
        }
        return jsonResponse(200, { group: publicGroup(g) });
      }

      case 'contribution-toggle': {
        const phone = await getSessionPhone(token);
        if (!phone) return jsonResponse(401, { error: 'Not signed in' });
        const { groupId } = payload;
        const g = await groups.get(groupId, { type: 'json' });
        if (!g) return jsonResponse(404, { error: 'Group not found' });
        const member = g.members.find(m => m.phone === phone);
        if (!member) return jsonResponse(403, { error: 'You are not in this group' });

        member.status = member.status === 'paid' ? 'due' : 'paid';
        await groups.setJSON(g.id, g);

        // Bump the user's trust score a little for a completed on-time mark-as-paid.
        // (Self-reported for now — a receiver-confirmation step is the natural next addition.)
        if (member.status === 'paid') {
          const user = await users.get(phone, { type: 'json' });
          if (user) {
            user.trustScore = Math.min(100, user.trustScore + 1);
            await users.setJSON(phone, user);
          }
        }
        return jsonResponse(200, { group: publicGroup(g) });
      }

      case 'chat-post': {
        const phone = await getSessionPhone(token);
        if (!phone) return jsonResponse(401, { error: 'Not signed in' });
        const { groupId, text } = payload;
        if (!text || !text.trim()) return jsonResponse(400, { error: 'Message text is required' });
        const g = await groups.get(groupId, { type: 'json' });
        if (!g) return jsonResponse(404, { error: 'Group not found' });
        const member = g.members.find(m => m.phone === phone);
        if (!member) return jsonResponse(403, { error: 'You are not in this group' });

        g.chat.push({ who: member.name, text: text.trim(), at: Date.now() });
        await groups.setJSON(g.id, g);
        return jsonResponse(200, { group: publicGroup(g) });
      }

      case 'logout': {
        if (token) await sessions.delete(token);
        return jsonResponse(200, { ok: true });
      }

      default:
        return jsonResponse(400, { error: 'Unknown action' });
    }
  } catch (err) {
    console.error(err);
    return jsonResponse(500, { error: 'Server error' });
  }
};
