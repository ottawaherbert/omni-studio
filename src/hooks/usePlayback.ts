import { useState, useRef, useCallback, useEffect } from 'react';

interface PlaybackOptions {
  totalDuration: number;
  onTimeUpdate?: (time: number) => void;
  onEnded?: () => void;
}

export function usePlayback({ totalDuration, onTimeUpdate, onEnded }: PlaybackOptions) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const playIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const lastTimeRef = useRef<number>(0);

  const stop = useCallback(() => {
    setIsPlaying(false);
    if (playIntervalRef.current) {
      clearInterval(playIntervalRef.current);
      playIntervalRef.current = null;
    }
  }, []);

  const play = useCallback(() => {
    if (isPlaying) return;

    setIsPlaying(true);
    if (currentTime >= totalDuration) {
      setCurrentTime(0);
    }

    lastTimeRef.current = Date.now();
    playIntervalRef.current = setInterval(() => {
      const now = Date.now();
      const delta = (now - lastTimeRef.current) / 1000;
      lastTimeRef.current = now;

      setCurrentTime(prev => {
        const nextTime = prev + delta;
        if (nextTime >= totalDuration) {
          stop();
          if (onEnded) onEnded();
          return totalDuration;
        }
        if (onTimeUpdate) onTimeUpdate(nextTime);
        return nextTime;
      });
    }, 1000 / 60);
  }, [isPlaying, currentTime, totalDuration, stop, onEnded, onTimeUpdate]);

  const pause = useCallback(() => {
    stop();
  }, [stop]);

  const toggle = useCallback(() => {
    if (isPlaying) {
      pause();
    } else {
      play();
    }
  }, [isPlaying, play, pause]);

  const seek = useCallback((time: number) => {
    const newTime = Math.max(0, Math.min(time, totalDuration));
    setCurrentTime(newTime);
    if (onTimeUpdate) onTimeUpdate(newTime);
  }, [totalDuration, onTimeUpdate]);

  useEffect(() => {
    return () => {
      if (playIntervalRef.current) {
        clearInterval(playIntervalRef.current);
      }
    };
  }, []);

  return {
    isPlaying,
    currentTime,
    play,
    pause,
    stop,
    toggle,
    seek,
    setCurrentTime,
  };
}
