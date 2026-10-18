/** One preview at a time: whoever starts playing stops the others (grid ↔ detail player). */

const players = new Map();

/** Register a stop() callback under an id; returns an unregister function. */
export function registerPlayer(id, stop) {
  players.set(id, stop);
  return () => {
    if (players.get(id) === stop) players.delete(id);
  };
}

/** Call when playback starts: every other registered player is stopped. */
export function reportPlay(id) {
  for (const [other, stop] of players) {
    if (other !== id) stop();
  }
}
