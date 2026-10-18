/* Layman-grade provenance phrasing. Copied verbatim from the v4 renderer so
   the honesty language stays consistent across the redesign. */

/** Human phrase for where a preview file was found. */
export function whereIsPreview(proxy) {
  if (!proxy) return 'nowhere';
  if (proxy.location === 'captures') return 'in Setlist Captures';
  if (proxy.location === 'export') {
    const folder = proxy.foundIn
      ? proxy.foundIn.replace(/[\\/]+$/, '').split(/[\\/]/).pop()
      : 'an export folder';
    return `in ${folder} (outside this project)`;
  }
  return 'in the project folder';
}

/** Why the app believes this file is this set's preview. */
export function whyPreview(proxy) {
  if (!proxy) return '';
  const parts = [];
  if (proxy.matchedOn === 'folder') parts.push("named after this project's folder");
  else if (proxy.nameMatched) parts.push('named after this set');
  else parts.push("its name doesn't match the set");
  if (proxy.contested && proxy.claimants > 1) {
    parts.push(`${proxy.claimants} projects share this name, so it went to the one saved closest in time`);
  }
  return parts.join(' · ');
}

/** The sentence shown under the player for the current audio file. */
export function provenanceText(proxy) {
  if (!proxy) return '';
  return proxy.nameMatched
    ? `Playing ${proxy.audioName} - found ${whereIsPreview(proxy)}, ${whyPreview(proxy)}.`
    : `Playing ${proxy.audioName} - it sits ${whereIsPreview(proxy)} but isn't named ` +
        `after this set, so it may be a partial edit, a promo cut, or a different song.`;
}

export const STALE_NOTE =
  'This preview is from an older version of the project - the .als file was saved after the preview was made. ' +
  'Drop a fresh bounce on the card (or use Add audio) to update it.';
