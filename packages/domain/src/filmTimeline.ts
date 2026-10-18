export type FilmTransition = 'none' | 'fade' | 'black';

// Transitions sit inside the clips; they never shift dialogue or scene boundaries.
export const filmTransition = (kind: FilmTransition | undefined, duration: number) => ({
  seconds: kind && kind !== 'none' ? Math.min(0.3, duration / 2) : 0,
  hold: kind === 'black' ? Math.min(0.1, duration / 6) : 0,
});

export const filmPreviewOpacity = (localTime: number, duration: number, incoming?: FilmTransition, outgoing?: FilmTransition) => {
  const a = filmTransition(incoming, duration);
  const b = filmTransition(outgoing, duration);
  const fadeIn = a.seconds ? (localTime - a.hold) / (a.seconds - a.hold) : 1;
  const fadeOut = b.seconds ? (duration - b.hold - localTime) / (b.seconds - b.hold) : 1;
  return Math.max(0, Math.min(1, fadeIn, fadeOut));
};
