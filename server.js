const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });
app.use(express.static(path.join(__dirname, 'public')));
app.get('/health', (_req, res) => res.json({ ok: true }));

const rooms = new Map();
const SHIPS = [5, 4, 3, 3, 2];
const makeCode = () => {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  do { code = Array.from({ length: 5 }, () => chars[Math.floor(Math.random() * chars.length)]).join(''); }
  while (rooms.has(code));
  return code;
};
const publicState = room => ({
  code: room.code,
  players: room.players.map(p => ({ id: p.id, name: p.name, ready: p.ready })),
  phase: room.phase,
  turn: room.turn,
  winner: room.winner,
  boards: room.players.map((p, i) => ({
    shots: p.shots,
    ownHits: p.hits,
    sunk: p.sunk,
    // Ship coordinates are intentionally never sent to clients.
    opponentShots: room.players[1 - i] ? room.players[1 - i].shots : []
  }))
});
const sendState = room => room.players.forEach((p, i) => io.to(p.id).emit('gameState', { ...publicState(room), you: i }));
const validFleet = ships => {
  if (!Array.isArray(ships) || ships.length !== SHIPS.length) return false;
  const occupied = new Set();
  for (let i = 0; i < SHIPS.length; i++) {
    const cells = ships[i];
    if (!Array.isArray(cells) || cells.length !== SHIPS[i]) return false;
    const coords = new Set();
    for (const c of cells) {
      if (!c || !Number.isInteger(c.r) || !Number.isInteger(c.c) || c.r < 0 || c.r > 9 || c.c < 0 || c.c > 9) return false;
      const key = `${c.r},${c.c}`;
      if (coords.has(key) || occupied.has(key)) return false;
      coords.add(key); occupied.add(key);
    }
    const rows = cells.map(c => c.r), cols = cells.map(c => c.c);
    const sameRow = rows.every(r => r === rows[0]);
    const sameCol = cols.every(c => c === cols[0]);
    if (!sameRow && !sameCol) return false;
    const sorted = (sameRow ? cols : rows).slice().sort((a,b) => a-b);
    if (sorted.some((v, j) => j && v !== sorted[j-1] + 1)) return false;
  }
  return true;
};
function removePlayer(socket) {
  for (const [code, room] of rooms) {
    const idx = room.players.findIndex(p => p.id === socket.id);
    if (idx !== -1) {
      room.players.splice(idx, 1);
      if (room.players.length === 0) rooms.delete(code);
      else { room.phase = 'waiting'; room.turn = null; room.players[0].ready = false; io.to(room.players[0].id).emit('opponentLeft'); sendState(room); }
      break;
    }
  }
}
io.on('connection', socket => {
  socket.on('createRoom', ({ name } = {}, cb = () => {}) => {
    removePlayer(socket);
    const code = makeCode();
    const room = { code, players: [{ id: socket.id, name: String(name || 'Oyuncu 1').slice(0, 18), ready: false, ships: [], shots: [], hits: [], sunk: [] }], phase: 'waiting', turn: null, winner: null };
    rooms.set(code, room); socket.join(code); cb({ ok: true, code }); sendState(room);
  });
  socket.on('joinRoom', ({ code, name } = {}, cb = () => {}) => {
    const room = rooms.get(String(code || '').toUpperCase().trim());
    if (!room) return cb({ ok: false, error: 'Bu oda koduyla açık bir oyun bulunamadı.' });
    if (room.players.length >= 2) return cb({ ok: false, error: 'Bu oda zaten dolu.' });
    if (room.phase !== 'waiting') return cb({ ok: false, error: 'Bu oyun başlamış.' });
    removePlayer(socket);
    room.players.push({ id: socket.id, name: String(name || 'Oyuncu 2').slice(0, 18), ready: false, ships: [], shots: [], hits: [], sunk: [] });
    socket.join(room.code); cb({ ok: true, code: room.code }); sendState(room);
  });
  socket.on('ready', ({ ships } = {}, cb = () => {}) => {
    const room = [...rooms.values()].find(r => r.players.some(p => p.id === socket.id));
    if (!room || room.players.length !== 2 || room.phase !== 'waiting') return cb({ ok: false, error: 'Önce iki oyuncunun da odaya katılması gerekiyor.' });
    const player = room.players.find(p => p.id === socket.id);
    if (!validFleet(ships)) return cb({ ok: false, error: 'Gemilerin yerleşimi geçersiz.' });
    player.ships = ships.map((cells, i) => ({ id: i, cells })); player.ready = true;
    if (room.players.every(p => p.ready)) { room.phase = 'playing'; room.turn = room.players[0].id; }
    cb({ ok: true }); sendState(room);
  });
  socket.on('fire', ({ r, c } = {}, cb = () => {}) => {
    const room = [...rooms.values()].find(rm => rm.players.some(p => p.id === socket.id));
    if (!room || room.phase !== 'playing') return cb({ ok: false, error: 'Oyun şu anda atışa hazır değil.' });
    if (room.turn !== socket.id) return cb({ ok: false, error: 'Şu anda sıra sende değil.' });
    if (!Number.isInteger(r) || !Number.isInteger(c) || r < 0 || r > 9 || c < 0 || c > 9) return cb({ ok: false, error: 'Geçersiz koordinat.' });
    const me = room.players.find(p => p.id === socket.id);
    const foe = room.players.find(p => p.id !== socket.id);
    if (me.shots.some(s => s.r === r && s.c === c)) return cb({ ok: false, error: 'Bu kareye zaten ateş ettin.' });
    const ship = foe.ships.find(s => s.cells.some(cell => cell.r === r && cell.c === c));
    const hit = !!ship;
    me.shots.push({ r, c, hit });
    if (hit) {
      foe.hits.push({ r, c });
      const sunk = ship.cells.every(cell => foe.hits.some(h => h.r === cell.r && h.c === cell.c));
      if (sunk && !foe.sunk.includes(ship.id)) foe.sunk.push(ship.id);
    }
    const allSunk = foe.ships.every(s => s.cells.every(cell => foe.hits.some(h => h.r === cell.r && h.c === cell.c)));
    if (allSunk) { room.phase = 'finished'; room.winner = socket.id; }
    else room.turn = foe.id;
    cb({ ok: true, hit, sunk: hit && foe.sunk.includes(ship.id) }); sendState(room);
  });
  socket.on('disconnect', () => removePlayer(socket));
});
const port = process.env.PORT || 3000;
server.listen(port, () => console.log(`KEKIP server listening on ${port}`));
