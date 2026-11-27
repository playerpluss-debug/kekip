'use strict';

const BASE_CARD_CHANCE = 20;
const PETS = Object.freeze([
  Object.freeze({id:'pet_moon_cat',slot:'pet',name:'Ay Kedisi',icon:'🐈',rarity:'Nadir',price:6000,cardBonus:4,chestMultiplier:110,description:'Gümüş tüyleri yıldız ışığında parlayan gece kedisi.'}),
  Object.freeze({id:'pet_rune_owl',slot:'pet',name:'Rün Baykuşu',icon:'🦉',rarity:'Epik',price:12000,cardBonus:8,chestMultiplier:120,description:'Kadim rünlerin izini süren sessiz bir orman gözcüsü.'}),
  Object.freeze({id:'pet_ember_fox',slot:'pet',name:'Kor Tilkisi',icon:'🦊',rarity:'Efsanevi',price:22000,cardBonus:14,chestMultiplier:135,description:'Kuyruğunda volkan közleri taşıyan çevik bir ruh tilkisi.'}),
  Object.freeze({id:'pet_astral_dragon',slot:'pet',name:'Yıldız Ejderi',icon:'🐉',rarity:'Mitik',price:36000,cardBonus:22,chestMultiplier:150,description:'Kanatlarında uzak galaksilerin ışığını taşıyan bir ejder.'})
]);
const PET_IDS = PETS.map(pet => pet.id);

function strongestPet(owned) {
  const ids = new Set(owned);
  for (let i = PETS.length - 1; i >= 0; i--) {
    if (ids.has(PETS[i].id)) return PETS[i];
  }
  return null;
}

async function accountPet(db, accountId) {
  const result = await db.query(
    'SELECT item_id FROM kekip_cosmetic_inventory WHERE account_id=$1 AND item_id=ANY($2::text[])',
    [accountId, PET_IDS]
  );
  return strongestPet(result.rows.map(row => row.item_id));
}

function cardChance(pet) {
  return BASE_CARD_CHANCE + (pet?.cardBonus ?? 0);
}

module.exports = {PETS, strongestPet, accountPet, cardChance};
