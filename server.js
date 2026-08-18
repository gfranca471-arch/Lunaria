const express = require('express');
const http = require('http');
const https = require('https');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const dns = require('dns');
const net = require('net');

let Pool = null;
try { ({ Pool } = require('pg')); } catch (_) {}
let nodemailer = null;
try { nodemailer = require('nodemailer'); } catch (_) {}
let sharp = null;
try { sharp = require('sharp'); } catch (err) { console.warn('⚠️ sharp indisponível; conversão avançada de imagens desativada:', err?.message || err); }
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: '*', methods: ['GET', 'POST'] },
    transports: ['websocket', 'polling'],
    // Base64 aumenta o tamanho dos arquivos. 16 MB cobre músicas de até 5 MB
    // e imagens de cenário/tokens sem derrubar a conexão.
    maxHttpBufferSize: 16 * 1024 * 1024,
    pingInterval: 10000,
    pingTimeout: 20000
});

const PUBLIC_DIR = path.resolve(__dirname);
const INDEX_FILE = path.join(PUBLIC_DIR, 'index.html');
const TABLE_FILE = path.join(PUBLIC_DIR, 'mesa.html');
const DATA_FILE = process.env.ROOMS_DATA_FILE || path.join(PUBLIC_DIR, '.runtime', 'rooms.json');
const LEGACY_DATA_FILES = [
    path.join(PUBLIC_DIR, 'runtime-data', 'rooms.json'),
    path.join(PUBLIC_DIR, 'data', 'rooms.json')
];

app.use(express.json({ limit: '1mb' }));
app.use((req, res, next) => {
    res.setHeader('Permissions-Policy', 'camera=(self), microphone=(self)');
    next();
});

app.get('/', (req, res) => res.sendFile(INDEX_FILE));
app.get('/index.html', (req, res) => res.sendFile(INDEX_FILE));
app.get('/mesa.html', (req, res) => res.sendFile(TABLE_FILE));
// Nunca exponha o arquivo de persistência pela raiz estática. Ele pode conter
// fichas, perfis, imagens e hashes de senha. A pasta .runtime também é ignorada
// pelo Express por ser dotfile, mas este bloqueio cobre caminhos legados.
app.use((req,res,next)=>{
    const p=String(req.path||'').toLowerCase();
    if(p==='/data/rooms.json' || p.startsWith('/runtime-data/') || p.startsWith('/.runtime/')) return res.status(404).end();
    next();
});
app.use(express.static(PUBLIC_DIR, { index: false, fallthrough: true, dotfiles:'ignore' }));

const rooms = Object.create(null);
let pgPool = null;
let storageMode = 'json';
let disablePostgres = false;
let jsonSaveTimer = null;
const roomPersistTimers = new Map();
const v6ApprovalRequests = new Map();
const V6_APPROVAL_EMAIL = process.env.V6_APPROVAL_EMAIL || 'v.f.lune@gmail.com';
const V6_APPROVAL_TTL_MS = 30 * 60 * 1000;

// Configuração WebRTC enviada aos clientes ao entrar na sala.
// Esta função é deliberadamente tolerante a falhas: TURN é opcional e uma
// configuração incompleta nunca pode impedir a criação/entrada na campanha.
function rtcConfig() {
    const iceServers = [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
    ];
    try {
        const rawTurn = String(process.env.TURN_URL || '').trim();
        if (rawTurn) {
            const urls = rawTurn.split(',').map(v => v.trim()).filter(Boolean);
            if (urls.length) {
                const turn = { urls: urls.length === 1 ? urls[0] : urls };
                const username = String(process.env.TURN_USERNAME || '').trim();
                const credential = String(process.env.TURN_CREDENTIAL || '').trim();
                if (username) turn.username = username;
                if (credential) turn.credential = credential;
                iceServers.push(turn);
            }
        }
    } catch (err) {
        console.warn('⚠️ TURN inválido; usando apenas STUN:', err?.message || err);
    }
    return {
        iceServers,
        iceCandidatePoolSize: 8,
        bundlePolicy: 'max-bundle',
        rtcpMuxPolicy: 'require'
    };
}


function cleanCode(value) {
    return String(value || '').trim().toUpperCase().replace(/\s+/g, '-').slice(0, 80);
}
function cleanName(value) {
    return String(value || 'Anônimo').trim().slice(0, 80) || 'Anônimo';
}
function cleanLabel(value, max=100) {
    return String(value || '').trim().replace(/\s+/g, ' ').slice(0, max);
}
function keyForLabel(value) {
    return cleanLabel(value, 120).toLocaleLowerCase('pt-BR').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}
function validSystem(value) {
    return ['vampiro', 'vampirov6', 'lobisomem', 'dnd', 'changeling'].includes(value) ? value : '';
}
function systemCampaignKey(system, campaignKey) {
    return `${validSystem(system) || 'lobisomem'}:${campaignKey || ''}`;
}
function secretMatches(given, expected) {
    if (!expected) return false;
    const a = crypto.createHash('sha256').update(String(given || '')).digest();
    const b = crypto.createHash('sha256').update(String(expected)).digest();
    return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function ownerKeyFor(name) {
    return 'player:' + cleanName(name).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64);
}

const CHAT_COLORS = [
    '#4facfe','#00d9a5','#ffd166','#c792ea','#ff9f43','#67e8f9',
    '#a8e6cf','#d4a5ff','#7ee787','#f0a6ca','#8ab4f8','#f7c873'
];
function normalizeHexColor(value, fallback='') {
    const v=String(value||'').trim();
    return /^#[0-9a-fA-F]{6}$/.test(v) ? v.toLowerCase() : fallback;
}
function randomChatColor(room) {
    const used=new Set(Object.values(room?.profiles||{}).map(p=>String(p?.chatColor||'').toLowerCase()).filter(Boolean));
    const available=CHAT_COLORS.filter(c=>!used.has(c.toLowerCase()));
    const pool=available.length?available:CHAT_COLORS;
    return pool[crypto.randomInt(0,pool.length)];
}

function passwordRecord(password) {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
    return { passwordSalt: salt, passwordHash: hash };
}
function passwordMatches(room, password) {
    if (room.passwordHash && room.passwordSalt) {
        const actual = Buffer.from(room.passwordHash, 'hex');
        const candidate = crypto.scryptSync(String(password), room.passwordSalt, 64);
        return actual.length === candidate.length && crypto.timingSafeEqual(actual, candidate);
    }
    // Migração de salas antigas que ainda tinham senha em texto simples.
    return room.password !== undefined && String(room.password) === String(password);
}
function normalizeGridConfig(cfg) {
    cfg = cfg && typeof cfg === 'object' ? cfg : {};
    const clamp = (v, min, max, fallback) => {
        const n = Math.round(Number(v));
        return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
    };
    return {
        enabled: Boolean(cfg.enabled),
        size: clamp(cfg.size, 16, 180, 50),
        offsetX: clamp(cfg.offsetX, -500, 500, 0),
        offsetY: clamp(cfg.offsetY, -500, 500, 0),
        snap: Boolean(cfg.snap)
    };
}

function normalizeSceneState(scene) {
    scene = scene && typeof scene === 'object' ? scene : {};
    const defaults = { map:true, grid:true, tokens:true, objects:true, lights:true, effects:true, fog:true, templates:true, vision:true };
    const layers = { ...defaults, ...(scene.layers && typeof scene.layers === 'object' ? scene.layers : {}) };
    for (const k of Object.keys(defaults)) layers[k] = layers[k] !== false;
    const fog = scene.fog && typeof scene.fog === 'object' ? scene.fog : {};
    const dayNight = scene.dayNight && typeof scene.dayNight === 'object' ? scene.dayNight : {};
    return {
        layers,
        fog: {
            base: fog.base === 'hidden' ? 'hidden' : 'visible',
            ops: Array.isArray(fog.ops) ? fog.ops.slice(-350) : []
        },
        lights: Array.isArray(scene.lights) ? scene.lights.slice(-30) : [],
        effects: Array.isArray(scene.effects) ? scene.effects.slice(-24) : [],
        objects: Array.isArray(scene.objects) ? scene.objects.slice(-30) : [],
        templates: Array.isArray(scene.templates) ? scene.templates.slice(-30) : [],
        walls: Array.isArray(scene.walls) ? scene.walls.slice(-120) : [],
        dynamicLighting: { enabled:Boolean(scene.dynamicLighting?.enabled), visionSquares:Math.max(2,Math.min(40,Number(scene.dynamicLighting?.visionSquares)||8)) },
        dayNight: {
            enabled: Boolean(dayNight.enabled),
            minutes: (() => { const n=Number(dayNight.minutes); return Math.max(0, Math.min(1439, Math.round(Number.isFinite(n) ? n : 720))); })(),
            daySfxId: String(dayNight.daySfxId || '').slice(0,120),
            nightSfxId: String(dayNight.nightSfxId || '').slice(0,120)
        }
    };
}
function isNandaSalima(name) {
    return keyForLabel(name) === 'nanda-salima';
}
function mediaTrackMeta(track) {
    if (!track || typeof track !== 'object') return track;
    const { url, ...meta } = track;
    return meta;
}
function sceneSnapshot(room) {
    return {
        currentImage: room.currentImage || null,
        gridConfig: normalizeGridConfig(room.gridConfig),
        tokens: Array.isArray(room.tokens) ? room.tokens : [],
        sceneState: normalizeSceneState(room.sceneState),
        sharedMusic: Array.isArray(room.sharedMusic) ? room.sharedMusic.map(mediaTrackMeta) : [],
        musicState: musicPayload(room),
        sharedSfx: Array.isArray(room.sharedSfx) ? room.sharedSfx.map(mediaTrackMeta) : [],
        sfxState: room.sfxState || { trackId:null, playing:false, loop:false, startedAt:null }
    };
}
function normalizeRoom(room, code) {
    if (!room) return null;
    room.code = code;
    room.system = ['vampiro', 'vampirov6', 'lobisomem', 'dnd', 'changeling'].includes(room.system) ? room.system : 'lobisomem';
    room.campaignName = room.campaignName || 'Campanha ' + code;
    room.campaignKey = room.campaignKey || keyForLabel(room.campaignName);
    room.systemCampaignKey = systemCampaignKey(room.system, room.campaignKey);
    room.roomName = room.roomName || code;
    room.roomNameKey = room.roomNameKey || keyForLabel(room.roomName);
    room.currentImage = room.currentImage || null;
    room.currentImageAsset = room.currentImageAsset && typeof room.currentImageAsset === 'object' ? room.currentImageAsset : null;
    room.gridConfig = normalizeGridConfig(room.gridConfig);
    room.tokens = Array.isArray(room.tokens) ? room.tokens : [];
    room.sceneState = normalizeSceneState(room.sceneState);
    room.sharedMusic = Array.isArray(room.sharedMusic) ? room.sharedMusic : [];
    room.musicState = room.musicState || { trackId: null, playing: false, position: 0, startedAt: null, loop: true };
    room.sharedSfx = Array.isArray(room.sharedSfx) ? room.sharedSfx.slice(-24) : [];
    room.sfxState = room.sfxState || { trackId:null, playing:false, loop:false, startedAt:null };
    room.sheets = room.sheets && typeof room.sheets === 'object' ? room.sheets : {};
    room.rollHistory = Array.isArray(room.rollHistory) ? room.rollHistory.slice(-100) : [];
    room.profiles = room.profiles && typeof room.profiles === 'object' ? room.profiles : {};
    room.players = room.players && typeof room.players === 'object' ? room.players : {};
    room.mediaSources = room.mediaSources && typeof room.mediaSources === 'object' ? room.mediaSources : {};
    // Ordem lógica dos cards de jogadores. Usa ownerKey (não socket.id), portanto
    // permanece estável mesmo quando o jogador fecha a mesa ou troca de aparelho.
    room.cameraOrder = Array.isArray(room.cameraOrder)
        ? [...new Set(room.cameraOrder.map(String).filter(Boolean))]
        : [];
    room.cameraNumberHidden = Array.isArray(room.cameraNumberHidden)
        ? [...new Set(room.cameraNumberHidden.map(String).filter(Boolean))]
        : [];
    room.createdAt = room.createdAt || Date.now();
    room.updatedAt = room.updatedAt || Date.now();
    return room;
}
function persistableRoom(room) {
    const copy = { ...room };
    delete copy.players;
    delete copy.mediaSources;
    delete copy.code;
    return copy;
}

async function initStorage() {
    if (!disablePostgres && process.env.DATABASE_URL && Pool) {
        pgPool = new Pool({
            connectionString: process.env.DATABASE_URL,
            ssl: process.env.DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false }
        });
        await pgPool.query(`
            CREATE TABLE IF NOT EXISTS rpg_rooms (
                room_code TEXT PRIMARY KEY,
                room_data JSONB NOT NULL,
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        `);
        storageMode = 'postgres';
        console.log('💾 Persistência: PostgreSQL');
        return;
    }
    fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
    const sourceFile = fs.existsSync(DATA_FILE) ? DATA_FILE : LEGACY_DATA_FILES.find(f=>fs.existsSync(f));
    if (sourceFile) {
        try {
            const parsed = JSON.parse(fs.readFileSync(sourceFile, 'utf8') || '{}');
            for (const [code, data] of Object.entries(parsed)) rooms[code] = normalizeRoom({ ...data, players: {} }, code);
            if (sourceFile !== DATA_FILE) scheduleJsonSave();
        } catch (err) {
            console.error('⚠️ Não foi possível ler arquivo de salas:', err.message);
        }
    }
    storageMode = 'json';
    console.log(`💾 Persistência: JSON (${DATA_FILE})`);
}
async function loadRoom(code) {
    if (rooms[code]) return rooms[code];
    if (storageMode === 'postgres' && pgPool) {
        const result = await pgPool.query('SELECT room_data FROM rpg_rooms WHERE room_code = $1', [code]);
        if (result.rows[0]) {
            rooms[code] = normalizeRoom({ ...result.rows[0].room_data, players: {} }, code);
            return rooms[code];
        }
    }
    return null;
}
function scheduleJsonSave() {
    // Espelho JSON separado do código. Quando ROOMS_DATA_FILE aponta para um
    // disco persistente do Render, este arquivo sobrevive aos deploys. Mesmo com
    // PostgreSQL ativo mantemos este backup legível por humanos.
    clearTimeout(jsonSaveTimer);
    jsonSaveTimer = setTimeout(() => {
        try {
            const output = {};
            for (const [code, room] of Object.entries(rooms)) output[code] = persistableRoom(room);
            fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
            const temp = DATA_FILE + '.tmp';
            fs.writeFileSync(temp, JSON.stringify(output, null, 2));
            fs.renameSync(temp, DATA_FILE);
        } catch (err) { console.error('Erro ao persistir salas:', err); }
    }, 120);
}
async function persistRoom(code) {
    const room = rooms[code];
    if (!room) return;
    room.updatedAt = Date.now();
    if (storageMode === 'postgres' && pgPool) {
        try {
            await pgPool.query(
                `INSERT INTO rpg_rooms(room_code, room_data, updated_at)
                 VALUES($1, $2::jsonb, NOW())
                 ON CONFLICT(room_code) DO UPDATE SET room_data=EXCLUDED.room_data, updated_at=NOW()`,
                [code, JSON.stringify(persistableRoom(room))]
            );
        } catch (err) { console.error(`Erro ao persistir ${code} no Postgres:`, err); }
    }
    scheduleJsonSave();
}
function schedulePersistRoom(code, delay=180) {
    clearTimeout(roomPersistTimers.get(code));
    roomPersistTimers.set(code, setTimeout(() => {
        roomPersistTimers.delete(code);
        persistRoom(code);
    }, delay));
}

async function roomNameConflict(campaignKey, roomNameKey, exceptCode='') {
    for (const [code, room] of Object.entries(rooms)) {
        if (code !== exceptCode && room.campaignKey === campaignKey && room.roomNameKey === roomNameKey) return code;
    }
    if (storageMode === 'postgres' && pgPool) {
        const q = await pgPool.query(
            `SELECT room_code FROM rpg_rooms
             WHERE room_code <> $1
               AND COALESCE(room_data->>'campaignKey','') = $2
               AND COALESCE(room_data->>'roomNameKey','') = $3
             LIMIT 1`,
            [exceptCode, campaignKey, roomNameKey]
        );
        return q.rows[0]?.room_code || null;
    }
    return null;
}


async function loadRoomByCampaignKey(campaignKey, system='') {
    if (!campaignKey) return null;
    const requestedSystem = validSystem(system);
    for (const room of Object.values(rooms)) {
        if (!room) continue;
        if (requestedSystem) {
            if (room.system === requestedSystem && room.campaignKey === campaignKey) return room;
        } else if (room.campaignKey === campaignKey) return room;
    }
    if (storageMode === 'postgres' && pgPool) {
        const result = requestedSystem
            ? await pgPool.query(
                `SELECT room_code, room_data FROM rpg_rooms
                 WHERE COALESCE(room_data->>'campaignKey','') = $1
                   AND COALESCE(room_data->>'system','') = $2
                 ORDER BY updated_at DESC LIMIT 1`, [campaignKey, requestedSystem])
            : await pgPool.query(
                `SELECT room_code, room_data FROM rpg_rooms
                 WHERE COALESCE(room_data->>'campaignKey','') = $1
                 ORDER BY updated_at DESC LIMIT 1`, [campaignKey]);
        if (result.rows[0]) {
            const code = result.rows[0].room_code;
            rooms[code] = normalizeRoom({ ...result.rows[0].room_data, players:{} }, code);
            return rooms[code];
        }
    }
    return null;
}
async function loadRoomByV6ApprovalId(approvalId) {
    if (!approvalId) return null;
    for (const room of Object.values(rooms)) if (room?.v6ApprovalId === approvalId) return room;
    if (storageMode === 'postgres' && pgPool) {
        const result = await pgPool.query(
            `SELECT room_code, room_data FROM rpg_rooms
             WHERE COALESCE(room_data->>'v6ApprovalId','') = $1
             ORDER BY updated_at DESC LIMIT 1`, [approvalId]
        );
        if (result.rows[0]) {
            const code = result.rows[0].room_code;
            rooms[code] = normalizeRoom({ ...result.rows[0].room_data, players:{} }, code);
            return rooms[code];
        }
    }
    return null;
}
function approvalRequestFromRoom(room) {
    if (!room?.v6ApprovalId || !room?.v6ApprovalToken) return null;
    return {
        id:room.v6ApprovalId, token:room.v6ApprovalToken, campaignName:room.campaignName,
        campaignKey:room.campaignKey, requestedBy:room.v6RequestedBy || 'Narrador',
        baseUrl:room.v6ApprovalBaseUrl || '', status:room.v6ApprovalStatus || 'pending',
        createdAt:room.v6ApprovalCreatedAt || room.createdAt || Date.now(),
        expiresAt:room.v6ApprovalExpiresAt || (Date.now()+V6_APPROVAL_TTL_MS),
        emailed:Boolean(room.v6ApprovalEmailed), emailMethod:room.v6ApprovalEmailMethod || '',
        emailError:room.v6ApprovalEmailError || ''
    };
}
function internalCodeForCampaign(campaignKey, system='lobisomem') {
    const digest = crypto.createHash('sha256').update(systemCampaignKey(system, campaignKey)).digest('hex').slice(0, 16).toUpperCase();
    return 'CAMP-' + digest;
}
function baseUrlFromSocket(socket) {
    if (process.env.PUBLIC_BASE_URL) return String(process.env.PUBLIC_BASE_URL).replace(/\/$/, '');
    const headers = socket.handshake?.headers || {};
    const proto = String(headers['x-forwarded-proto'] || 'https').split(',')[0].trim();
    const host = String(headers['x-forwarded-host'] || headers.host || '').split(',')[0].trim();
    return host ? `${proto}://${host}` : '';
}
function cleanupV6Approvals() {
    const now = Date.now();
    for (const [id, req] of v6ApprovalRequests.entries()) if (!req || req.expiresAt <= now || req.status === 'used') v6ApprovalRequests.delete(id);
}
function findPendingV6Approval(campaignKey) {
    cleanupV6Approvals();
    for (const req of v6ApprovalRequests.values()) if (req.campaignKey === campaignKey && ['pending','approved'].includes(req.status)) return req;
    return null;
}
function buildV6ApprovalLinks(req, socket) {
    const base = req.baseUrl || baseUrlFromSocket(socket || {});
    if (!base) throw new Error('PUBLIC_BASE_URL não configurada e host indisponível');
    return {
        base,
        approveUrl: `${base}/v6/approve?id=${encodeURIComponent(req.id)}&token=${encodeURIComponent(req.token)}`,
        rejectUrl: `${base}/v6/reject?id=${encodeURIComponent(req.id)}&token=${encodeURIComponent(req.token)}`
    };
}
function postJsonHttps(urlString, data, extraHeaders={}) {
    return new Promise((resolve, reject) => {
        const u = new URL(urlString);
        const body = Buffer.from(JSON.stringify(data));
        const request = https.request({
            protocol:u.protocol, hostname:u.hostname, port:u.port || 443,
            path:u.pathname + u.search, method:'POST',
            headers:{
                'Content-Type':'application/json', 'Accept':'application/json',
                'Content-Length':body.length,
                'User-Agent':'Mesa-RPG-Online/1.9.2',
                ...extraHeaders
            },
            timeout:12000
        }, res => {
            let raw='';
            res.setEncoding('utf8');
            res.on('data', chunk => raw += chunk);
            res.on('end', () => {
                let parsed=null; try{ parsed=JSON.parse(raw); }catch(_){}
                if(res.statusCode>=200 && res.statusCode<300 && (!parsed || parsed.success !== 'false')) resolve(parsed || {success:true});
                else reject(new Error((parsed && parsed.message) || `serviço de e-mail respondeu HTTP ${res.statusCode}`));
            });
        });
        request.on('timeout',()=>request.destroy(new Error('tempo limite ao enviar e-mail')));
        request.on('error',reject);
        request.end(body);
    });
}
async function sendV6ApprovalViaFormSubmit(req, socket) {
    const {base, approveUrl, rejectUrl} = buildV6ApprovalLinks(req, socket);
    const endpoint = `https://formsubmit.co/ajax/${encodeURIComponent(V6_APPROVAL_EMAIL)}`;
    const payload = {
        _subject:`Autorizar campanha Vampiro V6: ${req.campaignName}`,
        Campanha:req.campaignName,
        Narrador:req.requestedBy,
        Autorizar:approveUrl,
        Recusar:rejectUrl,
        Mensagem:'Pedido de criação de campanha Vampiro V6. O pedido expira em 30 minutos.'
    };
    try {
        await postJsonHttps(endpoint, payload, { Origin:base, Referer:base+'/' });
        return 'formsubmit';
    } catch (err) {
        const msg=String(err?.message||err||'');
        if (/needs Activation|Activate Form|form.*activation/i.test(msg)) return 'formsubmit-activation';
        throw err;
    }
}
async function sendV6ApprovalEmail(req, socket) {
    const user = process.env.SMTP_USER || '';
    const pass = process.env.SMTP_PASS || '';
    const {approveUrl, rejectUrl} = buildV6ApprovalLinks(req, socket);

    // Se SMTP estiver configurado, ele continua sendo a primeira opção.
    if (nodemailer && user && pass) {
        const host = process.env.SMTP_HOST || 'smtp.gmail.com';
        const port = Number(process.env.SMTP_PORT || 465);
        const secure = String(process.env.SMTP_SECURE || (port === 465 ? 'true' : 'false')).toLowerCase() !== 'false';
        const transport = nodemailer.createTransport({ host, port, secure, auth:{ user, pass } });
        await transport.sendMail({
            from: process.env.V6_APPROVAL_FROM || user,
            to: V6_APPROVAL_EMAIL,
            subject: `Autorizar campanha Vampiro V6: ${req.campaignName}`,
            text: `Pedido de criação da campanha Vampiro V6\n\nCampanha: ${req.campaignName}\nNarrador: ${req.requestedBy}\n\nAUTORIZAR: ${approveUrl}\nRECUSAR: ${rejectUrl}\n\nO pedido expira em 30 minutos.`,
            html: `<div style="font-family:Arial,sans-serif;max-width:620px"><h2>Autorizar campanha Vampiro V6</h2><p><b>Campanha:</b> ${escapeHtmlServer(req.campaignName)}</p><p><b>Narrador:</b> ${escapeHtmlServer(req.requestedBy)}</p><p><a href="${approveUrl}" style="display:inline-block;padding:12px 18px;background:#8b1734;color:white;text-decoration:none;border-radius:8px">Autorizar campanha</a> &nbsp; <a href="${rejectUrl}" style="display:inline-block;padding:12px 18px;background:#444;color:white;text-decoration:none;border-radius:8px">Recusar</a></p><p>O pedido expira em 30 minutos.</p></div>`
        });
        return 'smtp';
    }

    // Fallback sem SMTP: FormSubmit encaminha o pedido ao e-mail da administradora.
    // No primeiro uso desse endereço o próprio FormSubmit pode enviar uma confirmação
    // de ativação; depois de confirmada, os pedidos seguintes chegam normalmente.
    return await sendV6ApprovalViaFormSubmit(req, socket);
}
function escapeHtmlServer(value) {
    return String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
}
async function createOrReuseV6Approval({ campaignName, campaignKey, requestedBy, socket }) {
    let req = findPendingV6Approval(campaignKey);
    if (req) return req;
    req = {
        id: crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(18).toString('hex'),
        token: crypto.randomBytes(32).toString('hex'),
        campaignName, campaignKey, requestedBy, baseUrl:baseUrlFromSocket(socket),
        status:'pending', createdAt:Date.now(), expiresAt:Date.now()+V6_APPROVAL_TTL_MS,
        emailed:false, emailMethod:'', emailError:''
    };
    v6ApprovalRequests.set(req.id, req);
    try { req.emailMethod = await sendV6ApprovalEmail(req, socket); req.emailed = true; }
    catch (err) { req.emailError = err.message || String(err); console.error('V6 approval email:', err); }
    return req;
}
function approvalResponsePage(title, body, ok=true) {
    return `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtmlServer(title)}</title><body style="margin:0;background:#0a0a12;color:#eee;font-family:Arial,sans-serif;display:grid;place-items:center;min-height:100vh"><main style="max-width:560px;padding:28px;background:#151521;border-radius:16px;border:1px solid #333"><h1 style="color:${ok?'#00d9a5':'#ff5577'}">${escapeHtmlServer(title)}</h1><p style="line-height:1.6">${escapeHtmlServer(body)}</p></main></body></html>`;
}
app.get('/v6/approve', async (req, res) => {
    cleanupV6Approvals();
    const id=String(req.query.id||''), token=String(req.query.token||'');
    const item=v6ApprovalRequests.get(id) || null;
    const room=await loadRoomByV6ApprovalId(id);
    const expectedToken=item?.token || room?.v6ApprovalToken || '';
    if((!item && !room) || !secretMatches(token,expectedToken)) return res.status(404).send(approvalResponsePage('Pedido inválido','Este pedido não existe ou já expirou.',false));
    if(item){ item.status='approved'; item.approvedAt=Date.now(); }
    if(room){
        // Fonte de verdade permanente: uma campanha V6 aprovada NUNCA volta
        // a pedir autorização nos próximos logins de narrador ou jogadores.
        room.v6Authorized=true;
        room.v6ApprovalStatus='approved';
        room.v6ApprovedAt=Date.now();
        room.v6ApprovalEmailError='';
        await persistRoom(room.code);
    }
    const campaignName=room?.campaignName || item?.campaignName || 'Vampiro V6';
    res.send(approvalResponsePage('Campanha autorizada',`A campanha “${campaignName}” foi autorizada e já está pronta. Se o narrador estiver aguardando, entrará automaticamente; se tiver saído, basta entrar novamente com o mesmo nome da campanha e senha.`));
});
app.get('/v6/reject', async (req, res) => {
    cleanupV6Approvals();
    const id=String(req.query.id||''), token=String(req.query.token||'');
    const item=v6ApprovalRequests.get(id) || null;
    const room=await loadRoomByV6ApprovalId(id);
    const expectedToken=item?.token || room?.v6ApprovalToken || '';
    if((!item && !room) || !secretMatches(token,expectedToken)) return res.status(404).send(approvalResponsePage('Pedido inválido','Este pedido não existe ou já expirou.',false));
    if(item){ item.status='rejected'; item.rejectedAt=Date.now(); }
    if(room){ room.v6Authorized=false; room.v6ApprovalStatus='rejected'; room.v6RejectedAt=Date.now(); await persistRoom(room.code); }
    const campaignName=room?.campaignName || item?.campaignName || 'Vampiro V6';
    res.send(approvalResponsePage('Campanha recusada',`A criação da campanha “${campaignName}” foi recusada.`,false));
});
app.get('/api/v6-approval-status', async (req,res) => {
    cleanupV6Approvals();
    const id=String(req.query.id||'');
    const item=v6ApprovalRequests.get(id) || null;
    const room=await loadRoomByV6ApprovalId(id);
    if(!item && !room) return res.status(404).json({status:'expired'});
    res.json({
        status:room?.v6Authorized===true ? 'approved' : (room?.v6ApprovalStatus || item?.status || 'pending'),
        emailed:room ? Boolean(room.v6ApprovalEmailed) : Boolean(item?.emailed),
        emailMethod:room?.v6ApprovalEmailMethod || item?.emailMethod || '',
        emailError:room?.v6ApprovalEmailError || item?.emailError || '',
        expiresAt:room?.v6ApprovalExpiresAt || item?.expiresAt || null
    });
});
app.post('/api/v6-resend-approval', async (req,res) => {
    cleanupV6Approvals();
    const id=String(req.body?.id||'');
    let item=v6ApprovalRequests.get(id) || null;
    const room=await loadRoomByV6ApprovalId(id);
    if(!item && room){ item=approvalRequestFromRoom(room); if(item) v6ApprovalRequests.set(item.id,item); }
    const status=room?.v6Authorized===true ? 'approved' : (room?.v6ApprovalStatus || item?.status);
    if(!item || status!=='pending') return res.status(404).json({ok:false,message:'Pedido não encontrado ou não está pendente.'});
    try {
        item.emailMethod=await sendV6ApprovalEmail(item,null); item.emailed=true; item.emailError='';
        if(room){ room.v6ApprovalEmailed=true; room.v6ApprovalEmailMethod=item.emailMethod; room.v6ApprovalEmailError=''; await persistRoom(room.code); }
        return res.json({ok:true,emailMethod:item.emailMethod,email:V6_APPROVAL_EMAIL});
    } catch(err) {
        const msg=err.message||String(err); item.emailed=false; item.emailError=msg;
        if(room){ room.v6ApprovalEmailed=false; room.v6ApprovalEmailError=msg; await persistRoom(room.code); }
        return res.status(502).json({ok:false,message:msg});
    }
});


// ─────────────────────────────────────────────────────────────
// CENÁRIO / IMAGENS
// Uploads passam por HTTP e são normalizados para WebP no servidor. O Socket.IO
// recebe apenas a URL final, evitando transportar vários MB junto da chamada,
// dos dados e dos efeitos em tempo real.
// ─────────────────────────────────────────────────────────────
const SCENE_IMAGE_INPUT_LIMIT = 20 * 1024 * 1024;
const SCENE_IMAGE_OUTPUT_LIMIT = 14 * 1024 * 1024;

function isPrivateIp(address) {
    const ip=String(address||'').toLowerCase();
    if(net.isIP(ip)===4){
        const p=ip.split('.').map(Number);
        return p[0]===10 || p[0]===127 || p[0]===0 || (p[0]===169&&p[1]===254) || (p[0]===172&&p[1]>=16&&p[1]<=31) || (p[0]===192&&p[1]===168) || (p[0]===100&&p[1]>=64&&p[1]<=127) || (p[0]===198&&(p[1]===18||p[1]===19));
    }
    if(net.isIP(ip)===6){
        if(ip==='::1'||ip==='::') return true;
        if(ip.startsWith('fc')||ip.startsWith('fd')||ip.startsWith('fe8')||ip.startsWith('fe9')||ip.startsWith('fea')||ip.startsWith('feb')) return true;
        const mapped=ip.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/); if(mapped) return isPrivateIp(mapped[1]);
    }
    return false;
}
async function publicAddressForHost(hostname){
    const all=await dns.promises.lookup(hostname,{all:true,verbatim:true});
    const good=all.find(x=>!isPrivateIp(x.address));
    if(!good || all.some(x=>isPrivateIp(x.address))) throw new Error('Endereço privado/local não é permitido.');
    return good;
}
function downloadRemoteImage(urlString, redirects=0){
    return new Promise(async (resolve,reject)=>{
        try{
            if(redirects>4) throw new Error('Redirecionamentos demais ao abrir a imagem.');
            const u=new URL(String(urlString||''));
            if(!['http:','https:'].includes(u.protocol)) throw new Error('Use um link http:// ou https://.');
            const resolved=await publicAddressForHost(u.hostname);
            const lib=u.protocol==='https:'?https:require('http');
            const req=lib.request({
                protocol:u.protocol, hostname:u.hostname, port:u.port || (u.protocol==='https:'?443:80),
                path:u.pathname+u.search, method:'GET',
                headers:{'User-Agent':'Mesa-RPG-Online/2.1.7','Accept':'image/avif,image/webp,image/png,image/jpeg,image/gif,image/*;q=.9,*/*;q=.2'},
                lookup:(_host,_opts,cb)=>cb(null,resolved.address,resolved.family), timeout:15000
            },res=>{
                if(res.statusCode>=300&&res.statusCode<400&&res.headers.location){
                    res.resume(); const next=new URL(res.headers.location,u).toString();
                    downloadRemoteImage(next,redirects+1).then(resolve,reject); return;
                }
                if(res.statusCode<200||res.statusCode>=300){res.resume();return reject(new Error(`O link respondeu HTTP ${res.statusCode}.`));}
                const len=Number(res.headers['content-length']||0); if(len>SCENE_IMAGE_INPUT_LIMIT){res.destroy();return reject(new Error('Imagem do link excede 20 MB.'));}
                const chunks=[];let total=0;
                res.on('data',chunk=>{total+=chunk.length;if(total>SCENE_IMAGE_INPUT_LIMIT){req.destroy(new Error('Imagem do link excede 20 MB.'));return;}chunks.push(chunk);});
                res.on('end',()=>resolve({buffer:Buffer.concat(chunks),contentType:String(res.headers['content-type']||'').split(';')[0]}));
            });
            req.on('timeout',()=>req.destroy(new Error('Tempo limite ao abrir o link da imagem.'))); req.on('error',reject); req.end();
        }catch(err){reject(err);}
    });
}
async function normalizeSceneImageBuffer(buffer, sourceName='imagem'){
    if(!Buffer.isBuffer(buffer)||!buffer.length) throw new Error('Arquivo de imagem vazio.');
    if(buffer.length>SCENE_IMAGE_INPUT_LIMIT) throw new Error('Imagem muito grande (máx. 20 MB).');
    if(!sharp) throw new Error('Conversor de imagens indisponível no servidor. Execute npm install após atualizar o projeto.');
    try{
        const base=sharp(buffer,{limitInputPixels:120000000,animated:false,failOn:'error'});
        const meta=await base.metadata();
        if(!meta.width||!meta.height) throw new Error('Formato de imagem não reconhecido.');
        const result=await base.rotate().resize({width:6144,height:6144,fit:'inside',withoutEnlargement:true}).webp({quality:90,effort:4,smartSubsample:true}).toBuffer({resolveWithObject:true});
        if(result.data.length>SCENE_IMAGE_OUTPUT_LIMIT) throw new Error('A imagem convertida ficou grande demais para a mesa.');
        return {buffer:result.data,mime:'image/webp',width:result.info.width||meta.width,height:result.info.height||meta.height,originalFormat:meta.format||'',sourceName:cleanLabel(sourceName,160)};
    }catch(err){
        const msg=String(err?.message||err||'');
        throw new Error(/unsupported image format|Input buffer contains unsupported image format/i.test(msg)?'Este formato de imagem não pôde ser convertido. Tente JPEG, PNG, WebP, AVIF, TIFF, GIF ou SVG.':msg);
    }
}
function decodedHeader(value){try{return decodeURIComponent(String(value||''));}catch(_){return String(value||'');}}
async function httpRoomAuth(req){
    const code=cleanCode(req.headers['x-room-code'] || req.body?.room || req.query?.room || '');
    const password=req.headers['x-room-password']!==undefined ? decodedHeader(req.headers['x-room-password']) : String(req.body?.password || '');
    const room=await loadRoom(code);
    if(!room || !passwordMatches(room,password)) return null;
    return room;
}
async function storeSceneImage(room, normalized, by='Jogador'){
    const id=crypto.randomBytes(18).toString('hex');
    room.currentImageAsset={id,mime:normalized.mime,data:normalized.buffer.toString('base64'),name:normalized.sourceName||'imagem',width:normalized.width,height:normalized.height,originalFormat:normalized.originalFormat||'',updatedAt:Date.now()};
    room.currentImage=`/api/room-image/${encodeURIComponent(room.code)}/${id}`;
    room.sceneState=normalizeSceneState(room.sceneState); room.sceneState.layers.map=true;
    await persistRoom(room.code);
    io.to(room.code).emit('image-changed',{url:room.currentImage,by});
    io.to(room.code).emit('scene-command',{command:'layers-set',payload:{layers:{map:true}},by,ownerKey:''});
    return room.currentImage;
}
app.get('/api/room-image/:room/:assetId',async(req,res)=>{
    try{
        const room=await loadRoom(cleanCode(req.params.room)); const asset=room?.currentImageAsset;
        if(!asset || String(asset.id)!==String(req.params.assetId)) return res.status(404).end();
        const data=Buffer.from(String(asset.data||''),'base64'); if(!data.length) return res.status(404).end();
        res.setHeader('Content-Type',asset.mime||'image/webp'); res.setHeader('X-Content-Type-Options','nosniff'); res.setHeader('Cache-Control','public, max-age=31536000, immutable');
        res.setHeader('Content-Length',data.length); res.end(data);
    }catch(_){res.status(404).end();}
});
app.post('/api/room-image/upload',express.raw({type:()=>true,limit:'20mb'}),async(req,res)=>{
    try{
        const room=await httpRoomAuth(req); if(!room) return res.status(403).json({ok:false,message:'Sala ou senha inválida.'});
        let filename='imagem'; try{filename=decodeURIComponent(String(req.headers['x-file-name']||'imagem'));}catch(_){}
        const normalized=await normalizeSceneImageBuffer(req.body,filename);
        const url=await storeSceneImage(room,normalized,cleanName(decodedHeader(req.headers['x-player-name']||'Jogador')));
        res.json({ok:true,url,width:normalized.width,height:normalized.height,format:'webp'});
    }catch(err){console.warn('Upload de cenário:',err?.message||err);res.status(400).json({ok:false,message:err?.message||'Não foi possível abrir a imagem.'});}
});
app.post('/api/room-image/from-url',async(req,res)=>{
    try{
        const room=await httpRoomAuth(req); if(!room) return res.status(403).json({ok:false,message:'Sala ou senha inválida.'});
        const source=String(req.body?.url||'').trim(); if(!source) return res.status(400).json({ok:false,message:'Informe o link da imagem.'});
        const remote=await downloadRemoteImage(source); const normalized=await normalizeSceneImageBuffer(remote.buffer,new URL(source).pathname.split('/').pop()||'imagem-link');
        const url=await storeSceneImage(room,normalized,cleanName(req.body?.playerName||'Jogador'));
        res.json({ok:true,url,width:normalized.width,height:normalized.height,format:'webp'});
    }catch(err){console.warn('Imagem por link:',err?.message||err);res.status(400).json({ok:false,message:err?.message||'Não foi possível abrir o link da imagem.'});}
});

app.get('/health', (req, res) => {
    res.status(200).json({
        ok: true,
        index: fs.existsSync(INDEX_FILE),
        mesa: fs.existsSync(TABLE_FILE),
        storage: storageMode,
        turnConfigured: Boolean(process.env.TURN_URL),
        v6ApprovalEmail: V6_APPROVAL_EMAIL,
        v6EmailConfigured: Boolean(process.env.SMTP_USER && process.env.SMTP_PASS),
        v6EmailFallback: 'formsubmit'
    });
});

function isRoomMember(socket, roomCode) {
    return socket.data.roomCode === roomCode && rooms[roomCode] && rooms[roomCode].players[socket.id];
}
function roomOwnerEndpoints(room, ownerKey) {
    return Object.values(room?.players || {}).filter(p => p.ownerKey === ownerKey);
}
function logicalPlayerCount(room) {
    return new Set(Object.values(room?.players || {}).map(p => p.ownerKey || p.id)).size;
}
function updateOwnerEndpoints(room, ownerKey, patch) {
    for (const player of Object.values(room?.players || {})) {
        if (player.ownerKey === ownerKey) Object.assign(player, patch);
    }
}
function currentMusicPosition(room, now = Date.now()) {
    const m = room.musicState || {};
    if (!m.playing || !m.startedAt) return Number(m.position) || 0;
    return Math.max(0, (now - m.startedAt) / 1000);
}
function musicPayload(room) {
    const now = Date.now();
    return { ...room.musicState, position: currentMusicPosition(room, now), serverTime: now };
}

io.on('connection', (socket) => {
    console.log('🔌 Cliente:', socket.id);
    socket.on('join-room', async (data) => {
        try {
            const role = data.role === 'narrador' ? 'narrador' : 'jogador';
            const name = cleanName(data.name);
            const suppliedPassword = String(data.password || '').trim();
            const campaignName = cleanLabel(data.campaignName || data.roomName || data.room, 100);
            const campaignKey = keyForLabel(campaignName);
            if (!campaignName || !campaignKey) return socket.emit('room-error', 'Informe o nome da campanha.');
            if (!suppliedPassword) return socket.emit('room-error', 'A senha da campanha é obrigatória.');

            const requestedSystem = validSystem(data.system);
            if (!requestedSystem) return socket.emit('room-error', 'Escolha o sistema correto da campanha.');
            // A identidade da sala é SISTEMA + NOME. O mesmo nome pode existir
            // simultaneamente em Lobisomem, V5, V6, D&D e Changeling.
            let room = await loadRoomByCampaignKey(campaignKey, requestedSystem);
            let code = room?.code || internalCodeForCampaign(campaignKey, requestedSystem);
            if (!room) {
                if (role !== 'narrador') return socket.emit('room-error', 'Campanha não existe neste sistema. Confirme sistema, nome e senha com o Narrador.');

                if (requestedSystem === 'vampirov6') {
                    const passwordFields=passwordRecord(suppliedPassword);
                    if (isNandaSalima(name)) {
                        room=normalizeRoom({
                            ...passwordFields, campaignName,campaignKey,roomName:campaignName,roomNameKey:campaignKey,
                            system:'vampirov6',v6Alpha:true,v6Authorized:true,v6ApprovalStatus:'approved',
                            v6ApprovedBy:'Nanda Salima',v6ApprovedAt:Date.now(),v6Bypass:true,
                            currentImage:null,gridConfig:normalizeGridConfig(),tokens:[],sceneState:normalizeSceneState(),
                            sharedMusic:[],sharedSfx:[],sheets:{},rollHistory:[],profiles:{},cameraOrder:[],
                            musicState:{trackId:null,playing:false,position:0,startedAt:null,loop:true},
                            sfxState:{trackId:null,playing:false,loop:false,startedAt:null},
                            players:{},createdAt:Date.now(),updatedAt:Date.now()
                        },code);
                        rooms[code]=room; await persistRoom(code);
                    } else {
                        const approval=await createOrReuseV6Approval({campaignName,campaignKey,requestedBy:name,socket});
                        room=normalizeRoom({
                            ...passwordFields, campaignName,campaignKey,roomName:campaignName,roomNameKey:campaignKey,
                            system:'vampirov6',v6Alpha:true,v6Authorized:false,
                            v6ApprovalStatus:'pending',v6ApprovalId:approval.id,v6ApprovalToken:approval.token,
                            v6ApprovalCreatedAt:approval.createdAt,v6ApprovalExpiresAt:approval.expiresAt,
                            v6ApprovalBaseUrl:approval.baseUrl,v6RequestedBy:name,
                            v6ApprovalEmailed:Boolean(approval.emailed),v6ApprovalEmailMethod:approval.emailMethod||'',
                            v6ApprovalEmailError:approval.emailError||'',
                            currentImage:null,gridConfig:normalizeGridConfig(),tokens:[],sceneState:normalizeSceneState(),
                            sharedMusic:[],sharedSfx:[],sheets:{},rollHistory:[],profiles:{},cameraOrder:[],
                            musicState:{trackId:null,playing:false,position:0,startedAt:null,loop:true},
                            sfxState:{trackId:null,playing:false,loop:false,startedAt:null},
                            players:{},createdAt:Date.now(),updatedAt:Date.now()
                        },code);
                        rooms[code]=room; await persistRoom(code);
                        socket.emit('v6-authorization-pending',{
                            approvalId:approval.id,email:V6_APPROVAL_EMAIL,expiresAt:approval.expiresAt,
                            emailMethod:approval.emailMethod||(approval.emailError?'pending-with-warning':'email'),
                            emailWarning:approval.emailError||''
                        });
                        return;
                    }
                }
                // Salas V6 criadas pela exceção Nanda Salima já existem neste ponto.
                // Só execute o criador genérico se nenhuma sala tiver sido criada acima.
                if (!room) {
                    const passwordFields = passwordRecord(suppliedPassword);
                    room = normalizeRoom({
                        ...passwordFields,
                        campaignName, campaignKey, roomName:campaignName, roomNameKey:campaignKey,
                        system: requestedSystem, v6Alpha:false, currentImage: null, gridConfig: normalizeGridConfig(),
                        tokens: [], sceneState:normalizeSceneState(), sharedMusic: [], sharedSfx: [], sheets: {}, rollHistory: [], profiles: {}, cameraOrder: [],
                        musicState: { trackId: null, playing: false, position: 0, startedAt: null, loop: true },
                        sfxState:{trackId:null,playing:false,loop:false,startedAt:null},
                        players: {}, createdAt: Date.now(), updatedAt: Date.now()
                    }, code);
                    rooms[code] = room;
                    await persistRoom(code);
                }
            }
            if (!passwordMatches(room, suppliedPassword)) return socket.emit('room-error', 'Senha incorreta!');
            if (room.password !== undefined) {
                Object.assign(room, passwordRecord(data.password || ''));
                delete room.password;
                await persistRoom(code);
            }

            if (room.system === 'vampirov6') {
                // Autorização é exigida SOMENTE na primeira criação pelo Narrador.
                // Depois de aprovada, v6Authorized=true fica persistido na própria sala
                // e narrador/jogadores entram normalmente para sempre.
                const approvalStatus=room.v6ApprovalStatus || '';
                const wasLegacyApproved = room.v6Authorized === undefined && (!approvalStatus || approvalStatus === 'approved');
                if (room.v6Authorized === true || approvalStatus === 'approved' || wasLegacyApproved) {
                    if (room.v6Authorized !== true || room.v6ApprovalStatus !== 'approved') {
                        room.v6Authorized=true;
                        room.v6ApprovalStatus='approved';
                        await persistRoom(code);
                    }
                } else if (approvalStatus === 'pending' || room.v6Authorized === false) {
                    if (approvalStatus === 'rejected') return socket.emit('room-error','A criação desta campanha Vampiro V6 foi recusada.');
                    if(role!=='narrador') return socket.emit('room-error','Esta campanha Vampiro V6 ainda aguarda autorização do Narrador responsável.');
                    let approval=v6ApprovalRequests.get(room.v6ApprovalId)||approvalRequestFromRoom(room);
                    if(approval&&!v6ApprovalRequests.has(approval.id)) v6ApprovalRequests.set(approval.id,approval);
                    socket.emit('v6-authorization-pending',{
                        approvalId:room.v6ApprovalId,email:V6_APPROVAL_EMAIL,expiresAt:room.v6ApprovalExpiresAt,
                        emailMethod:room.v6ApprovalEmailMethod||(room.v6ApprovalEmailError?'pending-with-warning':'email'),
                        emailWarning:room.v6ApprovalEmailError||''
                    });
                    return;
                } else if(approvalStatus==='rejected') {
                    return socket.emit('room-error','A criação desta campanha Vampiro V6 foi recusada.');
                }
            }

            // A identidade lógica do jogador é o Nome de Jogador dentro da sala.
            // Dois aparelhos com o mesmo nome/senha usam a mesma ficha/perfil e contam
            // como UM jogador, embora cada aparelho mantenha seu socket WebRTC próprio.
            const ownerKey = ownerKeyFor(name);
            const alreadyOnline = roomOwnerEndpoints(room, ownerKey);
            if (!alreadyOnline.length && logicalPlayerCount(room) >= 8) {
                return socket.emit('room-error', 'Sala cheia (8 jogadores). Um segundo aparelho do mesmo jogador pode entrar normalmente.');
            }
            const savedProfile = room.profiles[ownerKey] || {};
            const effectiveRole = alreadyOnline[0]?.role || savedProfile.role || role;
            const profile = {
                name,
                role: effectiveRole,
                color: normalizeHexColor(data.color, normalizeHexColor(savedProfile.color,'#e94560')),
                chatColor: normalizeHexColor(data.chatColor, normalizeHexColor(savedProfile.chatColor, randomChatColor(room))),
                charImage: savedProfile.charImage || data.charImage || '',
                updatedAt: Date.now()
            };
            room.profiles[ownerKey] = profile;
            // A ordem das câmeras é por jogador lógico e fica salva na campanha.
            // Novos jogadores entram no fim; reconexões mantêm a posição anterior.
            if (effectiveRole !== 'narrador' && !room.cameraOrder.includes(ownerKey)) {
                room.cameraOrder.push(ownerKey);
            }

            socket.join(code);
            socket.data.roomCode = code;
            socket.data.ownerKey = ownerKey;
            socket.data.playerName = name;
            socket.data.playerRole = effectiveRole;
            room.players[socket.id] = {
                id: socket.id, ownerKey, name, role: effectiveRole, system: room.system,
                color: profile.color, chatColor:profile.chatColor, charImage: profile.charImage,
                cameraOn: Boolean(data.cameraOn), micOn: Boolean(data.micOn), screenSharing: false,
                deviceIndex: alreadyOnline.length + 1, joinedAt: Date.now()
            };
            // O aparelho mais recente assume câmera/microfone quando ele realmente
            // conseguiu abrir alguma mídia. Se o navegador móvel ainda estiver aguardando
            // permissão, preservamos a fonte anterior para não derrubar uma chamada ativa.
            // O usuário pode assumir a mídia manualmente depois pelo botão da aba Sala.
            const autoClaimMedia = !alreadyOnline.length || Boolean(data.cameraOn || data.micOn);
            if (autoClaimMedia || !room.mediaSources[ownerKey]) room.mediaSources[ownerKey] = socket.id;
            schedulePersistRoom(code, 300);

            socket.emit('room-joined', {
                room: code,
                roomName: room.roomName,
                campaignName: room.campaignName,
                system: room.system,
                ownerKey,
                players: room.players,
                logicalPlayerCount: logicalPlayerCount(room),
                mediaSources: room.mediaSources,
                cameraOrder: room.cameraOrder,
                cameraNumberHidden: room.cameraNumberHidden,
                gridConfig: room.gridConfig,
                currentImage: room.currentImage,
                tokens: room.tokens,
                sceneState: room.sceneState,
                sharedMusic: room.sharedMusic.map(mediaTrackMeta),
                musicState: musicPayload(room),
                sharedSfx: room.sharedSfx.map(mediaTrackMeta),
                sfxState: room.sfxState,
                sheetKey: ownerKey,
                mySheet: room.sheets[ownerKey] || null,
                rollHistory: room.rollHistory || [],
                rtcConfig: rtcConfig(),
                storageMode
            });
            socket.to(code).emit('user-joined', { ...room.players[socket.id], samePlayer: alreadyOnline.length > 0 });
            io.to(code).emit('camera-order-changed', { cameraOrder: room.cameraOrder });
            io.to(code).emit('camera-number-visibility-changed', { cameraNumberHidden: room.cameraNumberHidden });
            io.to(code).emit('media-source-selected', { ownerKey, socketId:room.mediaSources[ownerKey], name, automatic:true, deviceCount:alreadyOnline.length+1 });
            console.log(`👤 ${name} (${effectiveRole}) entrou em ${code}${alreadyOnline.length ? ' em outro aparelho' : ''}`);
        } catch (err) {
            console.error('join-room:', err);
            socket.emit('room-error', 'Não foi possível abrir a sala.');
        }
    });

    function randomDie(sides) {
        return crypto.randomInt(1, Math.max(2, Number(sides) || 2) + 1);
    }

    // Todos na sala recebem o MESMO lançamento. O resultado é definido uma vez
    // no servidor; cada navegador anima seus próprios dados 3D e termina na
    // mesma face/resultado. Isso evita o narrador ver um valor e outro jogador outro.
    socket.on('dice-roll-request', (data) => {
        const code = cleanCode(data.room);
        if (!isRoomMember(socket, code)) return;
        const room = rooms[code];
        const rawMode = String(data.diceMode || data.diceType || '20');
        const isV5 = rawMode === 'v5' && room.system === 'vampiro';
        const isV6 = room.system === 'vampirov6';
        const diceType = (isV5 || isV6) ? 10 : Math.max(2, Math.min(100, parseInt(rawMode, 10) || 20));
        const totalPool = Math.max(1, Math.min(10, parseInt(data.totalPool, 10) || 1));
        const hungerCount = isV5 ? Math.max(0, Math.min(totalPool, 5, parseInt(data.hungerCount, 10) || 0)) : 0;
        const mode = isV6 ? 'v6' : (isV5 ? 'v5' : (diceType === 20 ? 'd20' : (diceType === 100 ? 'd100' : 'normal')));
        const difficulty = (mode === 'd20' || mode === 'v6') ? null : Math.max(1, Math.min(diceType, parseInt(data.difficulty, 10) || (isV5 ? 6 : 1)));
        const minSuccess = (mode === 'd20' || mode === 'v6') ? null : Math.max(0, parseInt(data.minSuccess, 10) || 0);
        const criticalCount = Math.max(1, parseInt(data.criticalCount, 10) || 2);
        const resultsDetailed = [];
        for (let i = 0; i < totalPool; i++) {
            resultsDetailed.push({ value: randomDie(diceType), hunger: isV5 && i >= totalPool - hungerCount });
        }
        const roll = {
            rollId: crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex'),
            room: code, who: socket.data.playerName || 'Jogador', rollerId: socket.id, rollerOwnerKey: socket.data.ownerKey,
            diceMode: isV5 ? 'v5' : String(diceType), diceType, mode, totalPool, hungerCount,
            difficulty, minSuccess, criticalCount, resultsDetailed, createdAt: Date.now()
        };
        room.rollHistory.push(roll);
        if (room.rollHistory.length > 100) room.rollHistory = room.rollHistory.slice(-100);
        schedulePersistRoom(code, 250);
        io.to(code).emit('dice-roll-start', roll);
    });

    // V5: reroll seletivo das falhas comuns. Dados de Fome e sucessos ficam
    // exatamente como estavam; somente os D10 normais abaixo da dificuldade rolam de novo.
    socket.on('v5-reroll-failures-request', (data) => {
        const code=cleanCode(data?.room); if(!isRoomMember(socket,code)) return;
        const room=rooms[code]; if(room.system!=='vampiro') return socket.emit('dice-reroll-error','Reroll de falhas está disponível apenas no Vampiro V5.');
        const rollId=String(data?.rollId||'');
        const source=[...(room.rollHistory||[])].reverse().find(r=>String(r.rollId)===rollId);
        if(!source || source.mode!=='v5') return socket.emit('dice-reroll-error','A rolagem V5 anterior não foi encontrada.');
        if(source.rerollOf) return socket.emit('dice-reroll-error','Esta jogada já é uma re-rolagem. Cada jogada original permite apenas 1 re-rolagem.');
        if(source.rerollUsed || (room.rollHistory||[]).some(r=>String(r.rerollOf||'')===String(source.rollId))) return socket.emit('dice-reroll-error','Esta jogada já usou a única re-rolagem permitida.');
        const sameOwner=source.rollerOwnerKey ? source.rollerOwnerKey===socket.data.ownerKey : source.rollerId===socket.id;
        if(!sameOwner) return socket.emit('dice-reroll-error','Somente quem fez a rolagem pode re-rolar as próprias falhas.');
        const difficulty=Math.max(1,Math.min(10,Number(source.difficulty)||6));
        const previous=Array.isArray(source.resultsDetailed)?source.resultsDetailed.map(r=>({value:Number(r.value)||1,hunger:Boolean(r.hunger)})):[];
        const rerolledIndices=[]; const animationResultsDetailed=[];
        const resultsDetailed=previous.map((r,index)=>{
            if(!r.hunger && r.value<difficulty){
                const value=randomDie(10); rerolledIndices.push(index); animationResultsDetailed.push({value,hunger:false,rerolled:true,rerollFrom:r.value,originalIndex:index});
                return {value,hunger:false,rerolled:true,rerollFrom:r.value};
            }
            return {...r,kept:true};
        });
        if(!rerolledIndices.length) return socket.emit('dice-reroll-error','Não há falhas comuns para re-rolar. Dados de Fome nunca entram neste reroll.');
        source.rerollUsed=true; source.rerollUsedAt=Date.now();
        const roll={
            ...source,
            rollId:crypto.randomUUID?crypto.randomUUID():crypto.randomBytes(16).toString('hex'),
            who:socket.data.playerName||source.who||'Jogador',rollerId:socket.id,rollerOwnerKey:socket.data.ownerKey,
            resultsDetailed,animationResultsDetailed,rerolledIndices,rerollOf:source.rollId,createdAt:Date.now()
        };
        room.rollHistory.push(roll); if(room.rollHistory.length>100)room.rollHistory=room.rollHistory.slice(-100);
        schedulePersistRoom(code,250); io.to(code).emit('dice-roll-start',roll);
    });

    // Compatibilidade com clientes antigos: só replica o resultado textual.
    socket.on('roll-dice', (data) => {
        const code = cleanCode(data.room);
        if (isRoomMember(socket, code)) socket.to(code).emit('dice-rolled', data);
    });

    // CENÁRIO: qualquer participante pode alterar; o servidor guarda e replica.
    socket.on('change-image', async (data) => {
        const code = cleanCode(data.room);
        if (!isRoomMember(socket, code)) return;
        const room = rooms[code];
        room.currentImage = String(data.url || '').slice(0, 15 * 1024 * 1024) || null;
        room.currentImageAsset = null;
        room.sceneState=normalizeSceneState(room.sceneState); room.sceneState.layers.map=true;
        io.to(code).emit('image-changed', { url: room.currentImage, by: socket.data.playerName });
        io.to(code).emit('scene-command',{command:'layers-set',payload:{layers:{map:true}},by:socket.data.playerName,ownerKey:socket.data.ownerKey});
        persistRoom(code);
    });

    // GRADE DO MAPA: somente o Narrador configura; todos recebem e a sala persiste.
    socket.on('update-grid-config', async (data) => {
        const code = cleanCode(data.room);
        if (!isRoomMember(socket, code) || socket.data.playerRole !== 'narrador') return;
        const room = rooms[code];
        room.gridConfig = normalizeGridConfig({ ...(room.gridConfig || {}), ...(data.gridConfig || {}) });
        room.updatedAt = Date.now();
        await persistRoom(code);
        io.to(code).emit('grid-config-changed', { gridConfig: room.gridConfig, by: socket.data.playerName });
    });

    // SINCRONIZAÇÃO COMPLETA DO CENÁRIO. Serve também como recuperação após
    // reconexão: mapa, grade, tokens e ferramentas avançadas voltam a convergir.
    socket.on('scene-sync-request', (data) => {
        const code=cleanCode(data?.room);
        if(!isRoomMember(socket,code)) return;
        socket.emit('scene-sync', sceneSnapshot(rooms[code]));
    });

    socket.on('scene-command', async (data) => {
        const code=cleanCode(data?.room);
        if(!isRoomMember(socket,code)) return;
        const room=rooms[code], command=String(data?.command||'');
        const isNarrator=socket.data.playerRole==='narrador';
        const scene=room.sceneState=normalizeSceneState(room.sceneState);
        let payload=data?.payload && typeof data.payload==='object' ? data.payload : {};
        const narratorOnly = !['template-upsert','template-remove'].includes(command);
        if(narratorOnly && !isNarrator) return;

        const upsert=(arr,obj,max)=>{
            if(!obj?.id) return false;
            const i=arr.findIndex(x=>x.id===obj.id);
            if(i>=0) arr[i]={...arr[i],...obj}; else arr.push(obj);
            if(arr.length>max) arr.splice(0,arr.length-max);
            return true;
        };
        let changed=false;
        if(command==='layers-set'){
            scene.layers={...scene.layers,...(payload.layers||{})};
            scene.layers=normalizeSceneState({layers:scene.layers}).layers; changed=true;
        } else if(command==='fog-reset'){
            scene.fog={base:payload.base==='hidden'?'hidden':'visible',ops:[]}; changed=true;
        } else if(command==='fog-op' && payload.op){
            const op={...payload.op,id:String(payload.op.id||crypto.randomBytes(6).toString('hex')),by:socket.data.playerName};
            scene.fog.ops.push(op); if(scene.fog.ops.length>350) scene.fog.ops=scene.fog.ops.slice(-350); payload={op}; changed=true;
        } else if(command==='light-upsert') changed=upsert(scene.lights,payload.item,30);
        else if(command==='light-remove'){scene.lights=scene.lights.filter(x=>x.id!==payload.id);changed=true;}
        else if(command==='effect-upsert') changed=upsert(scene.effects,payload.item,24);
        else if(command==='effect-remove'){scene.effects=scene.effects.filter(x=>x.id!==payload.id);changed=true;}
        else if(command==='object-upsert') changed=upsert(scene.objects,payload.item,30);
        else if(command==='object-remove'){scene.objects=scene.objects.filter(x=>x.id!==payload.id);changed=true;}
        else if(command==='day-night-set'){
            scene.dayNight={enabled:Boolean(payload.enabled),minutes:Math.max(0,Math.min(1439,Math.round(Number(payload.minutes)||0))),daySfxId:String(payload.daySfxId||scene.dayNight?.daySfxId||'').slice(0,120),nightSfxId:String(payload.nightSfxId||scene.dayNight?.nightSfxId||'').slice(0,120)};changed=true;
        } else if(command==='dynamic-lighting-set'){
            scene.dynamicLighting={enabled:Boolean(payload.enabled),visionSquares:Math.max(2,Math.min(40,Number(payload.visionSquares)||8))};changed=true;
        } else if(command==='wall-upsert' && payload.item){
            changed=upsert(scene.walls,payload.item,120);
        } else if(command==='wall-remove'){
            scene.walls=scene.walls.filter(x=>x.id!==payload.id);changed=true;
        } else if(command==='walls-clear'){
            scene.walls=[];changed=true;
        } else if(command==='template-upsert' && room.system==='dnd'){
            const item={...(payload.item||{})};
            if(!item.id) return;
            const existing=scene.templates.find(x=>x.id===item.id);
            if(existing && !isNarrator && existing.ownerKey!==socket.data.ownerKey) return;
            item.ownerKey=item.ownerKey||socket.data.ownerKey; item.ownerName=item.ownerName||socket.data.playerName;
            changed=upsert(scene.templates,item,30); payload={item};
        } else if(command==='template-remove' && room.system==='dnd'){
            const existing=scene.templates.find(x=>x.id===payload.id);
            if(!existing || (!isNarrator && existing.ownerKey!==socket.data.ownerKey)) return;
            scene.templates=scene.templates.filter(x=>x.id!==payload.id);changed=true;
        }
        if(!changed) return;
        room.sceneState=normalizeSceneState(scene);
        schedulePersistRoom(code,160);
        io.to(code).emit('scene-command',{command,payload,by:socket.data.playerName,ownerKey:socket.data.ownerKey});
    });

    // TOKENS: posição, tamanho, cor da borda e estado morto ficam no objeto inteiro.
    socket.on('token-added', async (data) => {
        const code = cleanCode(data.room); if (!isRoomMember(socket, code) || !data.token?.id) return;
        const room = rooms[code];
        const token = { ...data.token, ownerKey:socket.data.ownerKey, owner:socket.id, updatedAt: Date.now() };
        const existing = room.tokens.findIndex(t => t.id === token.id);
        if (existing >= 0) room.tokens[existing] = token; else room.tokens.push(token);
        io.to(code).emit('token-added', token);
        persistRoom(code);
    });
    socket.on('token-moved', async (data) => {
        const code = cleanCode(data.room); if (!isRoomMember(socket, code) || !data.token?.id) return;
        const room = rooms[code];
        const i = room.tokens.findIndex(t => t.id === data.token.id);
        if (i < 0) return;
        const existing=room.tokens[i],canEdit=socket.data.playerRole==='narrador'||!existing.ownerKey||existing.ownerKey===socket.data.ownerKey;
        if(!canEdit)return;
        room.tokens[i] = { ...existing, ...data.token, ownerKey:existing.ownerKey||socket.data.ownerKey, updatedAt: Date.now() };
        schedulePersistRoom(code, 220);
        socket.to(code).emit('token-moved', room.tokens[i]);
    });
    socket.on('token-removed', async (data) => {
        const code = cleanCode(data.room); if (!isRoomMember(socket, code)) return;
        const room = rooms[code],token=room.tokens.find(t=>t.id===data.id);if(!token)return;
        const canEdit=socket.data.playerRole==='narrador'||!token.ownerKey||token.ownerKey===socket.data.ownerKey;if(!canEdit)return;
        room.tokens = room.tokens.filter(t => t.id !== data.id);
        io.to(code).emit('token-removed', data.id);
        persistRoom(code);
    });

    // MÚSICA: biblioteca + estado de reprodução são próprios da sala.
    socket.on('share-music', async (data) => {
        const code = cleanCode(data.room); if (!isRoomMember(socket, code) || !data.track?.id) return;
        const room = rooms[code];
        if (!room.sharedMusic.some(t => t.id === data.track.id)) {
            room.sharedMusic.push(data.track);
            // Evita crescimento ilimitado do arquivo da sala.
            if (room.sharedMusic.length > 30) room.sharedMusic.shift();
            persistRoom(code);
        }
        io.to(code).emit('shared-music', { track: mediaTrackMeta(data.track) });
    });
    socket.on('remove-music', async (data) => {
        const code = cleanCode(data.room); if (!isRoomMember(socket, code)) return;
        const room = rooms[code];
        room.sharedMusic = room.sharedMusic.filter(t => t.id !== data.trackId);
        if (room.musicState.trackId === data.trackId) room.musicState = { trackId:null, playing:false, position:0, startedAt:null, loop:true };
        io.to(code).emit('music-removed', { trackId: data.trackId, musicState: musicPayload(room) });
        persistRoom(code);
    });
    socket.on('music-track-request', (data) => {
        const code=cleanCode(data?.room); if(!isRoomMember(socket,code))return;
        const track=rooms[code].sharedMusic.find(t=>t.id===data?.trackId); if(track)socket.emit('music-track-data',{track});
    });
    socket.on('sfx-track-request', (data) => {
        const code=cleanCode(data?.room); if(!isRoomMember(socket,code))return;
        const track=rooms[code].sharedSfx.find(t=>t.id===data?.trackId); if(track)socket.emit('sfx-track-data',{track});
    });

    socket.on('music-sync-request', (data) => {
        const code = cleanCode(data.room); if (!isRoomMember(socket, code)) return;
        socket.emit('music-state', musicPayload(rooms[code]));
    });

    socket.on('music-control', async (data) => {
        const code = cleanCode(data.room); if (!isRoomMember(socket, code)) return;
        const room = rooms[code];
        const now = Date.now();
        const action = data.action || 'play';
        if (action === 'play') {
            const trackId = data.trackId || room.sharedMusic[data.trackIndex]?.id;
            if (!room.sharedMusic.some(t => t.id === trackId)) return;
            const position = Math.max(0, Number(data.position) || 0);
            room.musicState = { trackId, playing:true, position, startedAt:now - position*1000, loop:data.loop !== false };
        } else if (action === 'pause') {
            room.musicState.position = currentMusicPosition(room, now);
            room.musicState.playing = false;
            room.musicState.startedAt = null;
        } else if (action === 'seek') {
            const position = Math.max(0, Number(data.position) || 0);
            room.musicState.position = position;
            if (room.musicState.playing) room.musicState.startedAt = now - position*1000;
        } else if (action === 'loop') {
            room.musicState.loop = Boolean(data.loop);
        }
        io.to(code).emit('music-state', musicPayload(room));
        persistRoom(code);
    });

    // EFEITOS / AMBIÊNCIA DE ÁUDIO: biblioteca separada da trilha principal.
    socket.on('share-sfx', async (data) => {
        const code=cleanCode(data?.room); if(!isRoomMember(socket,code)||!data?.track?.id)return;
        const room=rooms[code];
        if(!room.sharedSfx.some(t=>t.id===data.track.id)) room.sharedSfx.push(data.track);
        if(room.sharedSfx.length>24) room.sharedSfx=room.sharedSfx.slice(-24);
        await persistRoom(code); io.to(code).emit('sfx-shared',{track:mediaTrackMeta(data.track)});
    });
    socket.on('remove-sfx', async (data)=>{
        const code=cleanCode(data?.room); if(!isRoomMember(socket,code))return;
        const room=rooms[code]; room.sharedSfx=room.sharedSfx.filter(t=>t.id!==data.trackId);
        if(room.sfxState?.trackId===data.trackId) room.sfxState={trackId:null,playing:false,loop:false,startedAt:null};
        await persistRoom(code); io.to(code).emit('sfx-removed',{trackId:data.trackId,sfxState:room.sfxState});
    });
    socket.on('sfx-play', async (data)=>{
        const code=cleanCode(data?.room); if(!isRoomMember(socket,code))return;
        const room=rooms[code],track=room.sharedSfx.find(t=>t.id===data.trackId); if(!track)return;
        const loop=Boolean(data.loop||track.category==='ambiente');
        room.sfxState=loop?{trackId:track.id,playing:true,loop:true,startedAt:Date.now()}:{trackId:null,playing:false,loop:false,startedAt:null};
        if(loop) schedulePersistRoom(code,200);
        io.to(code).emit('sfx-play',{trackId:track.id,loop,at:Date.now(),by:socket.data.playerName});
    });
    socket.on('sfx-stop', async (data)=>{
        const code=cleanCode(data?.room); if(!isRoomMember(socket,code))return;
        rooms[code].sfxState={trackId:null,playing:false,loop:false,startedAt:null};
        schedulePersistRoom(code,200); io.to(code).emit('sfx-stop',{});
    });

    socket.on('chat-message', (data) => {
        const code=cleanCode(data?.room); if(!isRoomMember(socket,code))return;
        const player=rooms[code].players[socket.id];
        const text=String(data?.text||'').trim().slice(0,1200);if(!text)return;
        const payload={author:player.name,text,time:String(data?.time||new Date().toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})),color:player.chatColor||rooms[code].profiles?.[player.ownerKey]?.chatColor||'#4facfe'};
        socket.to(code).emit('chat-message',payload);
    });

    // FICHA PRIVADA: chave estável por nome dentro da sala. O conteúdo não é broadcast
    // para os demais jogadores; cada participante recebe sua própria ficha no join.
    socket.on('update-sheet', async (data) => {
        const code = cleanCode(data.room); if (!isRoomMember(socket, code)) return;
        const room = rooms[code];
        const key = socket.data.ownerKey;
        if (!key) return;
        room.sheets[key] = { system: room.system, data: data.sheet?.data || {}, ownerName: socket.data.playerName, updatedAt: Date.now() };
        await persistRoom(code);
        socket.emit('sheet-updated', { key, sheet: room.sheets[key], name: socket.data.playerName });
    });

    // ORDEM DAS CÂMERAS: somente o Narrador define a posição numérica (001, 002...).
    // cameraOrder usa ownerKey, então a posição fica salva mesmo com o jogador offline,
    // reconectando ou usando outro aparelho. Ao escolher uma posição, o jogador é
    // inserido naquele ponto e os demais são deslocados, evitando números duplicados.
    socket.on('set-camera-position', async (data) => {
        const code=cleanCode(data.room);
        if(!isRoomMember(socket,code) || socket.data.playerRole!=='narrador') return;
        const room=rooms[code];
        const ownerKey=String(data.ownerKey||'');
        const validPlayer=k=>room.profiles?.[k] && room.profiles[k].role!=='narrador';
        if(!ownerKey || !validPlayer(ownerKey)) return;
        if(!room.cameraOrder.includes(ownerKey)) room.cameraOrder.push(ownerKey);
        const max=Math.max(1,room.cameraOrder.length);
        const requested=Math.trunc(Number(data.position));
        if(!Number.isFinite(requested)) return;
        const position=Math.max(1,Math.min(requested,max));
        room.cameraOrder=room.cameraOrder.filter(k=>k!==ownerKey);
        room.cameraOrder.splice(position-1,0,ownerKey);
        await persistRoom(code);
        io.to(code).emit('camera-order-changed',{cameraOrder:room.cameraOrder,by:socket.data.playerName,ownerKey,position});
    });

    socket.on('set-camera-number-visible', async (data) => {
        const code=cleanCode(data.room);
        if(!isRoomMember(socket,code) || socket.data.playerRole!=='narrador') return;
        const room=rooms[code],ownerKey=String(data.ownerKey||'');
        if(!ownerKey || !room.profiles?.[ownerKey] || room.profiles[ownerKey].role==='narrador') return;
        const hidden=new Set(Array.isArray(room.cameraNumberHidden)?room.cameraNumberHidden:[]);
        if(data.visible===false)hidden.add(ownerKey);else hidden.delete(ownerKey);
        room.cameraNumberHidden=[...hidden];await persistRoom(code);
        io.to(code).emit('camera-number-visibility-changed',{cameraNumberHidden:room.cameraNumberHidden,ownerKey,visible:!hidden.has(ownerKey),by:socket.data.playerName});
    });

    socket.on('change-border', (data) => {
        const code = cleanCode(data.room); if (!isRoomMember(socket, code)) return;
        const key=socket.data.ownerKey;
        if(!key) return;
        const safeColor=normalizeHexColor(data.color,'#e94560');
        updateOwnerEndpoints(rooms[code], key, { color:safeColor });
        rooms[code].profiles[key] = { ...(rooms[code].profiles[key]||{}), name:socket.data.playerName, role:socket.data.playerRole, color:safeColor, updatedAt:Date.now() };
        schedulePersistRoom(code);
        io.to(code).emit('border-changed', { ownerKey:key, color:safeColor });
    });
    socket.on('change-char-image', (data) => {
        const code = cleanCode(data.room); if (!isRoomMember(socket, code)) return;
        const key=socket.data.ownerKey;
        if(!key) return;
        updateOwnerEndpoints(rooms[code], key, { charImage:data.url });
        rooms[code].profiles[key] = { ...(rooms[code].profiles[key]||{}), name:socket.data.playerName, role:socket.data.playerRole, charImage:data.url, updatedAt:Date.now() };
        schedulePersistRoom(code);
        io.to(code).emit('char-image-changed', { ownerKey:key, url:data.url });
    });
    function selectMediaSourceForOwner(ownerKey, targetSocketId, automatic=false) {
        const code = socket.data.roomCode;
        const room = rooms[code];
        if (!room || !ownerKey || !targetSocketId) return false;
        const target = room.players[targetSocketId];
        if (!target || target.ownerKey !== ownerKey) return false;
        room.mediaSources ||= {};
        room.mediaSources[ownerKey] = targetSocketId;
        io.to(code).emit('media-source-selected', {
            ownerKey, socketId:targetSocketId, name:target.name || socket.data.playerName,
            automatic, deviceCount:roomOwnerEndpoints(room, ownerKey).length
        });
        return true;
    }
    socket.on('claim-media-source', () => {
        const code = socket.data.roomCode;
        const room = rooms[code];
        if (!room || !room.players[socket.id]) return;
        selectMediaSourceForOwner(socket.data.ownerKey, socket.id, false);
    });
    socket.on('select-media-source', (data) => {
        const code = socket.data.roomCode;
        const room = rooms[code];
        if (!room || !room.players[socket.id]) return;
        // O usuário só pode escolher entre endpoints pertencentes ao mesmo jogador.
        selectMediaSourceForOwner(socket.data.ownerKey, String(data?.socketId || ''), false);
    });

    socket.on('media-state', (data) => {
        const code = socket.data.roomCode; if (!code || !rooms[code]?.players[socket.id]) return;
        const player = rooms[code].players[socket.id];
        if (typeof data.cameraOn === 'boolean') player.cameraOn = data.cameraOn;
        if (typeof data.micOn === 'boolean') player.micOn = data.micOn;
        if (typeof data.screenSharing === 'boolean') player.screenSharing = data.screenSharing;
        socket.to(code).emit('media-state', { id:socket.id, cameraOn:player.cameraOn, micOn:player.micOn, screenSharing:player.screenSharing });
    });

    // WebRTC signaling fica somente entre membros da mesma sala.
    function relayRtc(event, data) {
        const code = socket.data.roomCode;
        const target = io.sockets.sockets.get(data.target);
        if (!code || !target || target.data.roomCode !== code) return;
        target.emit(event, { from: socket.id, ...data.payload });
    }
    socket.on('webrtc-offer', data => relayRtc('webrtc-offer', { target:data.target, payload:{ offer:data.offer } }));
    socket.on('webrtc-answer', data => relayRtc('webrtc-answer', { target:data.target, payload:{ answer:data.answer } }));
    socket.on('webrtc-ice', data => relayRtc('webrtc-ice', { target:data.target, payload:{ candidate:data.candidate } }));
    socket.on('webrtc-reconnect-request', data => relayRtc('webrtc-reconnect-request', { target:data.target, payload:{} }));

    socket.on('disconnect', () => {
        const code = socket.data.roomCode;
        if (code && rooms[code]?.players[socket.id]) {
            const room = rooms[code];
            const leaving = room.players[socket.id];
            delete room.players[socket.id];
            const remaining = roomOwnerEndpoints(room, leaving.ownerKey);
            const ownerStillOnline = remaining.length > 0;
            if(room.mediaSources?.[leaving.ownerKey] === socket.id){
                if(ownerStillOnline){
                    const fallback=[...remaining].sort((a,b)=>(b.joinedAt||0)-(a.joinedAt||0))[0];
                    room.mediaSources[leaving.ownerKey]=fallback.id;
                    io.to(code).emit('media-source-selected',{ownerKey:leaving.ownerKey,socketId:fallback.id,name:fallback.name,automatic:true,deviceCount:remaining.length});
                } else delete room.mediaSources[leaving.ownerKey];
            }
            io.to(code).emit('user-left', { id:socket.id, ownerKey:leaving.ownerKey, name:leaving.name, ownerStillOnline });
        }
        console.log('❌ Saiu:', socket.id);
        // A sala NÃO é apagada quando fica vazia: configuração, fichas, tokens,
        // cenário e música devem existir quando os jogadores voltarem.
    });
});

async function flushAllRooms() {
    for (const code of Object.keys(rooms)) {
        try { await persistRoom(code); } catch (_) {}
    }
    // Dá tempo para o espelho JSON gravar a última versão antes do encerramento.
    await new Promise(resolve => setTimeout(resolve, 220));
}

let shuttingDown = false;
async function gracefulShutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`🛑 ${signal}: salvando salas...`);
    try { await flushAllRooms(); } catch (err) { console.error('Falha ao salvar no encerramento:', err); }
    try { if (pgPool) await pgPool.end(); } catch (_) {}
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3500).unref();
}
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

const PORT = process.env.PORT || 3000;
(async () => {
    try { await initStorage(); }
    catch (err) {
        console.error('Falha ao iniciar persistência; usando JSON local:', err);
        pgPool = null; storageMode = 'json'; disablePostgres = true;
        await initStorage();
    }
    server.listen(PORT, () => {
        console.log(`🚀 Servidor RPG Mesa na porta ${PORT}`);
        console.log(`📁 Diretório público: ${PUBLIC_DIR}`);
        console.log(`🏠 index.html: ${fs.existsSync(INDEX_FILE) ? 'OK' : 'AUSENTE'}`);
        console.log(`🎲 mesa.html: ${fs.existsSync(TABLE_FILE) ? 'OK' : 'AUSENTE'}`);
    });
})();
