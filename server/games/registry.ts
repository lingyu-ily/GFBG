import { loveLetter } from "./love-letter.js";
import { shadowHunters } from "./shadow-hunters.js";
import { shadowRaidersAirship } from "./shadow-raiders.js";
import type { GameDefinition } from "../../shared/game.js";
// The transport treats game state as opaque; validation belongs to its registered module.
export const games = new Map<string, GameDefinition<any, any, any>>([
  [loveLetter.info.id, loveLetter],
  [shadowHunters.info.id, shadowHunters],
  [shadowRaidersAirship.info.id, shadowRaidersAirship],
]);
export function getGame(id: string) {
  const game = games.get(id);
  if (!game) throw new Error("遊戲不存在");
  return game;
}
