'use strict';

const { randomInt } = require('node:crypto');
const BANK = require('./late-answer-questions.json');
const MIN_PLAYERS = 3;
const MAX_PLAYERS = 8;
const RESUME_MS = 60_000;
const INTRO_MS = 3_000;
const SUMMARY_MS = 4_000;
const DEFAULT_SETTINGS = Object.freeze({ questions: 7, seconds: 10, visibility: 'private' });

function validateSettings(value) {
  if (!value || Object.getPrototypeOf(value) !== Object.prototype ||
      ![5, 7, 10].includes(value.questions) || ![7, 10, 15].includes(value.seconds) ||
      !['public', 'private'].includes(value.visibility)) return null;
  return { questions: value.questions, seconds: value.seconds, visibility: value.visibility };
}

function drawQuestions(count, rng = randomInt, bank = BANK) {
  if (!Number.isInteger(count) || count < 1 || count > bank.length) throw new RangeError('Geçersiz soru sayısı');
  const pool = [...bank];
  for (let i = 0; i < count; i++) {
    const j = i + rng(pool.length - i);
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, count);
}

function createRoom(code, host, settings) {
  return { code, host: host.id, settings: { ...settings }, players: [host], phase: 'lobby',
    deadline: null, turn: -1, step: -1, sequence: 0, matchId: null, deck: [],
    order: [], votes: new Map(), usedQuestions: new Set(), last: null, persisted: false };
}

function canStart(room) {
  return room.phase === 'lobby' && room.players.length >= MIN_PLAYERS &&
    room.players.length <= MAX_PLAYERS && room.players.every(p => p.online && p.ready);
}
function needsNewRoom(room) {
  return BANK.length - room.usedQuestions.size < room.players.length * room.settings.questions;
}
function start(room, now, matchId, rng) {
  if (!canStart(room) || needsNewRoom(room)) return false;
  room.matchId = matchId;
  room.order = room.players.map(p => p.id);
  room.deck = drawQuestions(room.order.length * room.settings.questions, rng, BANK.filter(q=>!room.usedQuestions.has(q.question)));
  for(const q of room.deck) room.usedQuestions.add(q.question);
  for (const p of room.players) Object.assign(p, {score:0, correct:0, juryAgreed:0, completed:false, left:false});
  room.turn = -1;
  nextTurn(room, now);
  return true;
}

function nextTurn(room, now) {
  do { room.turn++; } while (room.turn < room.order.length &&
    room.players.find(p => p.id === room.order[room.turn])?.left);
  room.votes.clear();
  if (room.turn >= room.order.length) {
    room.phase = 'final';
    room.deadline = null;
    return;
  }
  room.step = 0;
  room.sequence++;
  room.last = null;
  if (room.turn === 0) beginTurn(room, now);
  else {
    room.phase = 'turn_ready';
    room.deadline = null;
  }
}

function beginTurn(room, now) {
  checkpoint(room);
  room.phase = 'intro';
  room.deadline = now + INTRO_MS;
}

function readyTurn(room, playerId, sequence, now) {
  const player = contestant(room);
  if (room.phase !== 'turn_ready' || !player?.online || player.id !== playerId || sequence !== room.sequence) return false;
  beginTurn(room, now);
  return true;
}

function contestant(room) {
  return room.players.find(p => p.id === room.order[room.turn]);
}

function scheduleAnswer(room, now) {
  room.phase = 'answer';
  room.step++;
  room.sequence++;
  room.votes.clear();
  room.deadline = now + room.settings.seconds * 1000;
}

function jury(room) {
  return room.players.filter(p => !p.left && p.id !== room.order[room.turn]);
}

function resolveAnswer(room, now) {
  const player = contestant(room);
  const valid = jury(room).filter(p => room.votes.has(p.id));
  const yes = valid.filter(p => room.votes.get(p.id)).length;
  const correct = valid.length > 0 && yes * 2 >= valid.length;
  if (correct) {
    player.correct++;
    player.score += 2;
  }
  for (const p of valid) if (room.votes.get(p.id) === correct) {
    p.score++;
    p.juryAgreed++;
  }
  room.last = {kind:'answer', correct, votes:valid.length, questionNumber:room.step};
  if (room.step === room.settings.questions) {
    player.completed = true;
    room.phase = 'summary';
    room.deadline = now + SUMMARY_MS;
  } else scheduleAnswer(room, now);
}

function advance(room, now) {
  if (room.deadline === null || now < room.deadline) return false;
  if (room.phase === 'intro') scheduleAnswer(room, now);
  else if (room.phase === 'answer') resolveAnswer(room, now);
  else if (room.phase === 'summary') nextTurn(room, now);
  else return false;
  return true;
}

function vote(room, playerId, input, now) {
  if (room.phase !== 'answer' || (room.deadline===null || now >= room.deadline) || !input ||
      typeof input.correct !== 'boolean' || input.sequence !== room.sequence ||
      room.votes.has(playerId) || !jury(room).some(p => p.id === playerId && p.online)) return false;
  room.votes.set(playerId, input.correct);
  if (jury(room).every(p => room.votes.has(p.id))) resolveAnswer(room, now);
  return true;
}

function removePlayer(room, id, now) {
  const player = room.players.find(p => p.id === id && !p.left);
  if (!player) return false;
  player.online = false;
  if (room.phase === 'lobby' || room.phase === 'final') {
    room.players = room.players.filter(p => p.id !== id);
  } else {
    player.left = true;
    room.votes.delete(id);
    if (contestant(room) === player && ['intro','answer'].includes(room.phase)) {
      // Points from this unfinished turn are restored without touching earlier turns.
      for (const p of room.players) {
        const base = room.turnStart?.get(p.id);
        if (base) Object.assign(p, base);
      }
      room.votes.clear();
      room.last = {kind:'cancelled'};
      room.phase = 'summary';
      room.deadline = now + SUMMARY_MS;
    } else if (contestant(room) === player && room.phase === 'turn_ready') {
      nextTurn(room, now);
    } else if (room.phase === 'answer' && jury(room).length &&
               jury(room).every(p => room.votes.has(p.id))) resolveAnswer(room, now);
    if (room.players.filter(p => !p.left).length < 2) {
      room.phase = 'final';
      room.deadline = null;
    }
  }
  if (room.host === id) room.host =
    (room.players.find(p => !p.left && p.online) || room.players.find(p => !p.left))?.id ?? null;
  return true;
}

function checkpoint(room) {
  room.turnStart = new Map(room.players.map(p => [p.id,{score:p.score,correct:p.correct,juryAgreed:p.juryAgreed}]));
}

function rows(room) {
  const eligible = room.players.filter(p => !p.left && p.completed);
  const high = eligible.length >= 2 ? Math.max(...eligible.map(p => p.score)) : -1;
  return room.players.map(p => ({
    accountId:p.id,
    result:{complete:!p.left && p.completed, forfeited:!!p.left,
      win:!p.left && p.completed && p.score === high, scoreHalf:p.score, correct:p.correct, juryAgreed:p.juryAgreed}
  }));
}

function snapshot(room, id, now) {
  const player = contestant(room);
  const me = room.players.find(p => p.id === id && !p.left);
  const questions = room.settings.questions;
  const showing = ['intro','answer'].includes(room.phase);
  const offset = room.turn * questions;
  const question = showing && room.step < questions ? room.deck[offset + room.step] : null;
  const expected = room.phase === 'answer' && me && me.id !== player?.id ? room.deck[offset + room.step - 1] : null;
  const final = room.phase === 'final' ? new Map((room.finalRows||rows(room)).map(r => [r.accountId,r.result])) : null;
  return {code:room.code, settings:room.settings, phase:room.phase, now, deadline:room.deadline,
    me:me?.username, host:room.players.find(p=>p.id===room.host)?.username,
    contestant:player?.username ?? null, turn:Math.min(room.turn+1,room.order.length), turns:room.order.length,
    sequence:room.sequence, questionNumber:room.step+1, question:question?.question ?? null,
    category:question?.category ?? null, answers:expected?.answers ?? null,
    voted:room.votes.has(id), last:room.last, persisted:room.persisted, savingError:!!room.savingError,
    players:room.players.map(p=>({username:p.username, score:(p.score||0)/2, online:p.online, ready:p.ready,
      left:!!p.left, microphone:!!p.microphone, win:final?.get(p.id)?.win ?? false,
      complete:final?.get(p.id)?.complete ?? false}))};
}

module.exports = { MIN_PLAYERS, MAX_PLAYERS, RESUME_MS, DEFAULT_SETTINGS, validateSettings,
  drawQuestions, createRoom, canStart, needsNewRoom, start, readyTurn, advance, vote, removePlayer, snapshot, rows };
