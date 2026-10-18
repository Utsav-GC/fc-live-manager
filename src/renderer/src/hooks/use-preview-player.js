import { useCallback, useEffect, useRef, useState } from 'react';

import { api } from '@/lib/api';
import { registerPlayer, reportPlay } from '@/lib/player-bus';

/**
 * Auditioning straight from the list: one shared <audio> for the whole grid.
 * The detail sheet keeps its own player - the bus makes sure only one of the
 * two ever plays.
 */
export function usePreviewPlayer() {
  const audioRef = useRef(null);
  const keyRef = useRef(null);
  const tokenRef = useRef(0);
  const [playingKey, setPlayingKey] = useState(null);

  useEffect(() => {
    const a = new Audio();
    a.preload = 'none';
    audioRef.current = a;
    const offBus = registerPlayer('grid', () => {
      if (!a.paused) a.pause();
    });
    const clear = () => {
      keyRef.current = null;
      setPlayingKey(null);
    };
    a.addEventListener('pause', clear);
    a.addEventListener('ended', clear);
    return () => {
      offBus();
      a.removeEventListener('pause', clear);
      a.removeEventListener('ended', clear);
      a.pause();
      audioRef.current = null;
    };
  }, []);

  /** Play (or pause) the preview of project `p`; safe to spam-click. */
  const toggle = useCallback(async (p) => {
    const a = audioRef.current;
    const audioPath = p && p.proxy ? p.proxy.audioPath : null;
    if (!a || !audioPath) return;
    if (keyRef.current === p.key && !a.paused) {
      a.pause();
      return;
    }
    const token = ++tokenRef.current;
    let url = null;
    try {
      url = await api.mediaUrl(audioPath);
    } catch {
      /* protocol refused - nothing to play */
    }
    if (!url || token !== tokenRef.current) return; // superseded by a newer click
    if (a.src !== url) a.src = url;
    try {
      await a.play();
    } catch {
      return; // unreadable audio - the card just stays on "play"
    }
    if (token !== tokenRef.current) return;
    keyRef.current = p.key;
    setPlayingKey(p.key);
    reportPlay('grid');
  }, []);

  const stop = useCallback(() => {
    const a = audioRef.current;
    if (a && !a.paused) a.pause(); // the 'pause' listener clears playingKey
  }, []);

  return { playingKey, toggle, stop };
}
