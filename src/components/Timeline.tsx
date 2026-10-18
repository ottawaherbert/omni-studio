import { sceneVideoClips } from '../utils/sceneVideoClips';
import { splitTimelineShot, splitTimelineAudio, trimTimelineShot } from '../utils/timelineEditing';
import React, { useRef, useState, useMemo } from 'react';
import { Scene, Shot, AudioTrack } from '../clients/domainTypes';
import { Play, Pause, Scissors, Plus, Volume2, Image as ImageIcon, Video, Mic, Music, Trash2, AlertTriangle } from 'lucide-react';

interface TimelineProps {
  scene: Scene;
  currentTime: number;
  isPlaying: boolean;
  onSeek: (time: number) => void;
  onTogglePlay: () => void;
  onUpdateScene: (updates: Partial<Scene>) => void;
  activeShotId: string | null;
  onSelectShot: (shotId: string | null) => void;
  activeAudioTrackId: string | null;
  onSelectAudioTrack: (trackId: string | null) => void;
}

export default function Timeline({
  scene,
  currentTime,
  isPlaying,
  onSeek,
  onTogglePlay,
  onUpdateScene,
  activeShotId,
  onSelectShot,
  activeAudioTrackId,
  onSelectAudioTrack
}: TimelineProps) {
  const trimOrigin = useRef<{ shots: Shot[]; audioTracks: AudioTrack[] } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [draggingTrackId, setDraggingTrackId] = useState<string | null>(null);
  const [trimmingShotId, setTrimmingShotId] = useState<string | null>(null);
  const [trimEdge, setTrimEdge] = useState<'left' | 'right' | null>(null);
  const [trimmingAudioId, setTrimmingAudioId] = useState<string | null>(null);
  const [audioTrimEdge, setAudioTrimEdge] = useState<'left' | 'right' | null>(null);

  const shots = useMemo(() => sceneVideoClips(scene), [scene]);
  const audioTracks = scene.audioTracks || [];

  const totalDuration = useMemo(() => {
    return shots.reduce((acc, shot) => acc + (shot.duration || 5), 0);
  }, [shots]);

  // Ensure minimum duration for timeline rendering
  const displayDuration = Math.max(totalDuration, 10);
  const pixelsPerSecond = 50;

  // Calculate shot positions
  const shotPositions = useMemo(() => {
    let currentStart = 0;
    return shots.map(shot => {
      const start = currentStart;
      const duration = shot.duration || 5;
      currentStart += duration;
      return { ...shot, start, duration };
    });
  }, [shots]);

  const snapPoints = useMemo(() => {
    const points: number[] = [];
    // Shot boundaries
    shotPositions.forEach(sp => {
      points.push(sp.start);
      points.push(sp.start + sp.duration);
    });
    // Audio tracks boundaries
    audioTracks.forEach(t => {
      if (t.id !== draggingTrackId && t.id !== trimmingAudioId) {
        points.push(t.startTime);
        points.push(t.startTime + (t.duration || 5));
      }
    });
    return Array.from(new Set(points)).sort((a, b) => a - b);
  }, [shotPositions, audioTracks, draggingTrackId, trimmingAudioId]);

  const handleTimelineClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!containerRef.current || draggingTrackId || trimmingShotId) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left + containerRef.current.scrollLeft - 80;
    const newTime = Math.max(0, Math.min(x / pixelsPerSecond, displayDuration));
    onSeek(newTime);
  };

  const handleTrackDragStart = (e: React.MouseEvent, trackId: string) => {
    e.stopPropagation();
    setDraggingTrackId(trackId);
    onSelectAudioTrack(trackId);
  };

  const handleShotTrimStart = (e: React.MouseEvent, shotId: string, edge: 'left' | 'right') => {
    e.stopPropagation();
    trimOrigin.current = { shots, audioTracks };
    setTrimmingShotId(shotId);
    setTrimEdge(edge);
    onSelectShot(shotId);
  };

  const handleAudioTrimStart = (e: React.MouseEvent, trackId: string, edge: 'left' | 'right') => {
    e.stopPropagation();
    trimOrigin.current = { shots, audioTracks };
    setTrimmingAudioId(trackId);
    setAudioTrimEdge(edge);
    onSelectAudioTrack(trackId);
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left + containerRef.current.scrollLeft - 80;
    let timeAtCursor = Math.max(0, x / pixelsPerSecond);

    // Snap logic
    const SNAP_THRESHOLD = 0.3; // seconds
    if (e.shiftKey === false) { // Hold shift to disable snapping
      for (const point of snapPoints) {
        if (Math.abs(timeAtCursor - point) < SNAP_THRESHOLD) {
          timeAtCursor = point;
          break;
        }
      }
    }

    if (draggingTrackId) {
      const track = audioTracks.find(t => t.id === draggingTrackId);
      if (track) {
        onUpdateScene({
          audioTracks: audioTracks.map(a => a.id === track.id ? { ...a, startTime: timeAtCursor, shotId: undefined } : a)
        });
      }
    } else if (trimmingShotId && trimEdge) {
      const base = trimOrigin.current || { shots, audioTracks };
      const index = base.shots.findIndex(s => s.id === trimmingShotId);
      const edited = trimTimelineShot(base.shots, index, trimEdge, timeAtCursor, e.altKey);
      let start = 0;
      const starts = new Map(edited.map(shot => { const value = start; start += shot.duration; return [shot.id, value]; }));
      onUpdateScene({ shots: edited, audioTracks: base.audioTracks.map(track => track.shotId && starts.has(track.shotId)
        ? { ...track, startTime: starts.get(track.shotId)! } : track) });
    } else if (trimmingAudioId && audioTrimEdge) {
      const track = (trimOrigin.current?.audioTracks || audioTracks).find(t => t.id === trimmingAudioId);
      if (track) {
        if (audioTrimEdge === 'right') {
          const newDuration = Math.max(0.5, timeAtCursor - track.startTime);
          onUpdateScene({
            audioTracks: audioTracks.map(t => t.id === track.id ? { ...t, duration: newDuration } : t)
          });
        } else if (audioTrimEdge === 'left') {
          const endTime = track.startTime + (track.duration || 5);
          const newStartTime = Math.max(0, track.startTime - (track.sourceStartSeconds || 0), Math.min(timeAtCursor, endTime - 0.5));
          const newDuration = endTime - newStartTime;
          onUpdateScene({
            audioTracks: audioTracks.map(t => t.id === track.id ? { ...t, startTime: newStartTime, duration: newDuration, sourceStartSeconds: (track.sourceStartSeconds || 0) + newStartTime - track.startTime } : t)
          });
        }
      }
    }
  };

  const handleMouseUp = () => {
    trimOrigin.current = null;
    setDraggingTrackId(null);
    setTrimmingShotId(null);
    setTrimEdge(null);
    setTrimmingAudioId(null);
    setAudioTrimEdge(null);
  };

  const activeShot = shotPositions.find(s => s.id === activeShotId);

  return (
    <div 
      className="h-72 bg-white dark:bg-neutral-950 border-t border-gray-100 dark:border-neutral-800 flex flex-col select-none"
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
    >
      {/* Toolbar */}
      <div className="flex items-center justify-between px-8 py-4 border-b border-gray-100 dark:border-neutral-800 bg-white dark:bg-neutral-900/50">
        <div className="flex items-center gap-6">
          <button
            onClick={onTogglePlay}
            className="w-14 h-14 flex items-center justify-center bg-gray-900 hover:bg-black dark:bg-violet-600 dark:hover:bg-violet-500 text-white rounded-[1.5rem] transition-all shadow-xl shadow-gray-500/20 active:scale-90 group"
          >
            {isPlaying ? <Pause className="w-6 h-6 fill-current" /> : <Play className="w-6 h-6 fill-current ml-1 group-hover:scale-110 transition-transform" />}
          </button>
          <div className="flex flex-col">
            <span className="text-[10px] font-black text-gray-400 dark:text-neutral-500 uppercase tracking-[0.2em] mb-1">当前进度</span>
            <span className="text-sm font-mono font-black text-violet-600 dark:text-violet-400 tracking-tight">
              {currentTime.toFixed(1)}s <span className="text-gray-300 dark:text-neutral-700 mx-1">/</span> {totalDuration.toFixed(1)}s
            </span>
          </div>
        </div>
        <div className="flex items-center gap-4">
          {activeShot && (
            <div className="flex items-center gap-4 mr-2 bg-gray-50 dark:bg-neutral-900 px-4 py-2 rounded-2xl border border-gray-100 dark:border-neutral-800 shadow-inner">
              <span className="text-[10px] font-black text-gray-400 dark:text-neutral-500 uppercase tracking-widest">转场</span>
              <select
                value={activeShot.transition || 'none'}
                onChange={(e) => onUpdateScene({
                  shots: shots.map(s => s.id === activeShot.id ? { ...s, transition: e.target.value as any } : s)
                })}
                className="bg-transparent text-gray-900 dark:text-neutral-300 text-[10px] font-black uppercase tracking-widest outline-none cursor-pointer"
              >
                <option value="none">无</option>
                <option value="fade">淡入淡出（黑底）</option>
                <option value="black">黑场过渡</option>
              </select>
            </div>
          )}
          
          <div className="flex items-center gap-2 bg-gray-50 dark:bg-neutral-900 p-2 rounded-[2rem] border border-gray-100 dark:border-neutral-800 shadow-inner">
            <button 
              onClick={() => {
                const newShot: Shot = {
                  id: `shot-${Date.now()}`,
                  imagePrompt: '',
                  videoPrompt: '',
                  duration: 5,
                };
                onUpdateScene({ shots: [...shots, newShot] });
                onSelectShot(newShot.id);
              }}
              className="flex items-center gap-2.5 px-5 py-2.5 hover:bg-white dark:hover:bg-neutral-800 rounded-2xl text-[10px] font-black text-blue-600 dark:text-blue-400 transition-all uppercase tracking-widest shadow-sm border border-transparent hover:border-gray-100"
            >
              <Plus className="w-4 h-4" />
              镜头
            </button>
            <button 
              onClick={() => {
                const newTrack: AudioTrack = {
                  id: `audio-${Date.now()}`,
                  type: 'dialogue',
                  url: '',
                  startTime: currentTime,
                  duration: 5,
                  text: '',
                };
                onUpdateScene({ audioTracks: [...audioTracks, newTrack] });
                onSelectAudioTrack(newTrack.id);
              }}
              className="flex items-center gap-2.5 px-5 py-2.5 hover:bg-white dark:hover:bg-neutral-800 rounded-2xl text-[10px] font-black text-emerald-600 dark:text-emerald-400 transition-all uppercase tracking-widest shadow-sm border border-transparent hover:border-gray-100"
            >
              <Plus className="w-4 h-4" />
              配音
            </button>
            <button 
              onClick={() => {
                const newTrack: AudioTrack = {
                  id: `audio-${Date.now()}`,
                  type: 'bgm',
                  url: '',
                  startTime: currentTime,
                  duration: 10,
                };
                onUpdateScene({ audioTracks: [...audioTracks, newTrack] });
                onSelectAudioTrack(newTrack.id);
              }}
              className="flex items-center gap-2.5 px-5 py-2.5 hover:bg-white dark:hover:bg-neutral-800 rounded-2xl text-[10px] font-black text-violet-600 dark:text-violet-400 transition-all uppercase tracking-widest shadow-sm border border-transparent hover:border-gray-100"
            >
              <Plus className="w-4 h-4" />
              BGM
            </button>
            <button 
              onClick={() => {
                const newTrack: AudioTrack = {
                  id: `audio-${Date.now()}`,
                  type: 'sfx',
                  url: '',
                  startTime: currentTime,
                  duration: 2,
                };
                onUpdateScene({ audioTracks: [...audioTracks, newTrack] });
                onSelectAudioTrack(newTrack.id);
              }}
              className="flex items-center gap-2.5 px-5 py-2.5 hover:bg-white dark:hover:bg-neutral-800 rounded-2xl text-[10px] font-black text-amber-600 dark:text-amber-400 transition-all uppercase tracking-widest shadow-sm border border-transparent hover:border-gray-100"
            >
              <Plus className="w-4 h-4" />
              音效
            </button>
          </div>

          <div className="h-10 w-px bg-gray-100 dark:bg-neutral-800 mx-2"></div>
          
          <button 
            onClick={() => {
              if (activeShotId) {
                const shotIndex = shots.findIndex(s => s.id === activeShotId);
                if (shotIndex === -1) return;
                const shot = shots[shotIndex];
                const shotStart = shotPositions[shotIndex].start;
                if (currentTime > shotStart && currentTime < shotStart + (shot.duration || 5)) {
                  const duration1 = currentTime - shotStart;
                  const duration2 = (shot.duration || 5) - duration1;
                  const [newShot1, newShot2] = splitTimelineShot(shot, duration1, `shot-${crypto.randomUUID()}`);
                  const newShots = [...shots];
                  newShots.splice(shotIndex, 1, newShot1, newShot2);
                  
                  let currentStart = 0;
                  const newShotPositions = newShots.map(s => {
                    const start = currentStart;
                    currentStart += (s.duration || 5);
                    return { id: s.id, start };
                  });
                  
                  onUpdateScene({ 
                    shots: newShots,
                    audioTracks: audioTracks.map(t => {
                      if (t.shotId) {
                        const linkedShot = newShotPositions.find(s => s.id === t.shotId);
                        if (linkedShot) {
                          return { ...t, startTime: linkedShot.start };
                        }
                      }
                      return t;
                    })
                  });
                }
              } else if (activeAudioTrackId) {
                const trackIndex = audioTracks.findIndex(t => t.id === activeAudioTrackId);
                if (trackIndex === -1) return;
                const track = audioTracks[trackIndex];
                if (currentTime > track.startTime && currentTime < track.startTime + (track.duration || 5)) {
                  const duration1 = currentTime - track.startTime;
                  const duration2 = (track.duration || 5) - duration1;
                  const [newTrack1, newTrack2] = splitTimelineAudio(track, duration1, `audio-${crypto.randomUUID()}`);
                  const newTracks = [...audioTracks];
                  newTracks.splice(trackIndex, 1, newTrack1, newTrack2);
                  onUpdateScene({ audioTracks: newTracks });
                }
              }
            }}
            className="w-12 h-12 flex items-center justify-center hover:bg-gray-100 dark:hover:bg-neutral-800 rounded-2xl text-gray-400 hover:text-gray-900 dark:text-neutral-500 dark:hover:text-white transition-all disabled:opacity-30 active:scale-90 shadow-sm border border-transparent hover:border-gray-100" 
            title="分割 (Split)"
            disabled={!activeShotId && !activeAudioTrackId}
          >
            <Scissors className="w-5 h-5" />
          </button>
          <button 
            onClick={() => {
              if (activeShotId) {
                onUpdateScene({ 
                  shots: shots.filter(s => s.id !== activeShotId),
                  audioTracks: audioTracks.filter(t => t.shotId !== activeShotId)
                });
                onSelectShot(null);
              } else if (activeAudioTrackId) {
                onUpdateScene({ audioTracks: audioTracks.filter(t => t.id !== activeAudioTrackId) });
                onSelectAudioTrack(null);
              }
            }}
            className="w-12 h-12 flex items-center justify-center hover:bg-red-50 dark:hover:bg-red-900/20 rounded-2xl text-gray-400 hover:text-red-600 dark:text-neutral-500 dark:hover:text-red-400 transition-all disabled:opacity-30 active:scale-90 shadow-sm border border-transparent hover:border-red-100" 
            title="删除 (Delete)"
            disabled={!activeShotId && !activeAudioTrackId}
          >
            <Trash2 className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Tracks Container */}
      <div 
        className="flex-1 overflow-x-auto overflow-y-auto custom-scrollbar relative bg-gray-50/30 dark:bg-neutral-950"
        ref={containerRef}
        onClick={handleTimelineClick}
      >
        <div 
          className="relative min-w-full"
          style={{ width: `${Math.max(displayDuration * pixelsPerSecond + 80, 800)}px`, height: '100%' }}
        >
          {/* Playhead */}
          <div 
            className="absolute top-0 bottom-0 w-0.5 bg-violet-600 z-50 pointer-events-none"
            style={{ left: `${currentTime * pixelsPerSecond + 80}px` }}
          >
            <div className="absolute -top-0 -left-2 w-4 h-4 rounded-full bg-violet-600 shadow-lg shadow-violet-500/50 border-2 border-white dark:border-neutral-900"></div>
          </div>

          {/* Time Ruler */}
          <div className="h-10 border-b border-gray-100 dark:border-neutral-800 relative bg-white dark:bg-neutral-900 sticky top-0 z-40">
            {Array.from({ length: Math.ceil(displayDuration) + 1 }).map((_, i) => (
              <div 
                key={i} 
                className="absolute top-0 bottom-0 border-l border-gray-100 dark:border-neutral-800"
                style={{ left: `${i * pixelsPerSecond + 80}px` }}
              >
                <span className="text-[10px] font-black text-gray-400 dark:text-neutral-500 ml-2 mt-2 block uppercase tracking-tighter">{i}s</span>
              </div>
            ))}
          </div>

          {/* Tracks */}
          <div className="py-6 space-y-3">
            {/* Video Track (V1) */}
            <div className="flex relative h-24 group">
              <div className="absolute left-0 top-0 bottom-0 w-20 bg-white dark:bg-neutral-900 border-r border-gray-100 dark:border-neutral-800 z-30 flex items-center justify-center sticky left-0 shadow-[4px_0_12px_rgba(0,0,0,0.02)]">
                <span className="text-[10px] font-black text-blue-600 dark:text-blue-500 uppercase tracking-[0.2em]">V1</span>
              </div>
              <div className="ml-20 relative w-full h-full">
                {shotPositions.map((shot, index) => (
                  <div
                    key={shot.id}
                    className={`absolute top-0 bottom-0 rounded-[1.25rem] overflow-hidden transition-all shadow-sm ${
                      activeShotId === shot.id 
                        ? 'bg-blue-500/10 border-2 border-blue-500 z-10 scale-[1.02] shadow-lg shadow-blue-500/20' 
                        : 'bg-white dark:bg-neutral-900 border border-gray-100 dark:border-neutral-800 hover:border-blue-300 dark:hover:border-blue-500/50'
                    }`}
                    style={{
                      left: `${shot.start * pixelsPerSecond}px`,
                      width: `${shot.duration * pixelsPerSecond}px`
                    }}
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelectShot(shot.id);
                    }}
                  >
                    {shot.imageUrl && (
                      <img src={shot.imageUrl} alt="" className="h-full w-full object-cover opacity-60 pointer-events-none group-hover:scale-110 transition-transform duration-700" />
                    )}
                    <div className="absolute inset-0 p-3 flex flex-col justify-between pointer-events-none bg-gradient-to-b from-black/20 to-transparent">
                      <div className="text-[10px] text-white font-black drop-shadow-md uppercase tracking-[0.2em]">
                        Shot {index + 1}
                      </div>
                      <div className="flex gap-2">
                        <div className="w-6 h-6 bg-black/30 backdrop-blur-md rounded-lg flex items-center justify-center border border-white/10">
                          {shot.videoUrl ? <Video className="w-3.5 h-3.5 text-white" /> : <ImageIcon className="w-3.5 h-3.5 text-white/70" />}
                        </div>
                      </div>
                    </div>
                    {/* Trim Handles */}
                    {activeShotId === shot.id && (
                      <>
                        {(
                          <div 
                            className="absolute left-0 top-0 bottom-0 w-3 bg-blue-500 cursor-col-resize hover:bg-blue-400 z-20 flex items-center justify-center"
                            onMouseDown={(e) => handleShotTrimStart(e, shot.id, 'left')}
                          >
                            <div className="w-0.5 h-4 bg-white/50 rounded-full"></div>
                          </div>
                        )}
                        <div 
                          className="absolute right-0 top-0 bottom-0 w-3 bg-blue-500 cursor-col-resize hover:bg-blue-400 z-20 flex items-center justify-center"
                          onMouseDown={(e) => handleShotTrimStart(e, shot.id, 'right')}
                        >
                          <div className="w-0.5 h-4 bg-white/50 rounded-full"></div>
                        </div>
                      </>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Audio Track 1 (Dialogue) */}
            <div className="flex relative h-16 group">
              <div className="absolute left-0 top-0 bottom-0 w-20 bg-white dark:bg-neutral-900 border-r border-gray-100 dark:border-neutral-800 z-30 flex flex-col items-center justify-center sticky left-0 group/header shadow-[4px_0_12px_rgba(0,0,0,0.02)]">
                <span className="text-[10px] font-black text-emerald-600 dark:text-emerald-500 uppercase tracking-[0.2em]">A1</span>
                <button 
                  onClick={(e) => {
                    e.stopPropagation();
                    const newTrack: AudioTrack = {
                      id: 'dialogue-' + Date.now().toString(),
                      type: 'dialogue',
                      url: '',
                      startTime: 0,
                      duration: 5,
                    };
                    onUpdateScene({ audioTracks: [...audioTracks, newTrack] });
                    onSelectAudioTrack(newTrack.id);
                  }}
                  className="opacity-0 group-hover/header:opacity-100 absolute top-2 right-2 p-1.5 text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-900/30 rounded-xl transition-all shadow-sm border border-emerald-100"
                  title="添加配音"
                >
                  <Plus className="w-3.5 h-3.5" />
                </button>
              </div>
              <div className="ml-20 relative w-full h-full">
                {audioTracks.filter(t => t.type === 'dialogue').map(track => (
                  <div
                    key={track.id}
                    className={`absolute top-0 bottom-0 rounded-[1rem] overflow-hidden cursor-ew-resize transition-all shadow-sm ${
                      activeAudioTrackId === track.id
                        ? 'bg-emerald-500/10 border-2 border-emerald-500 z-10 scale-[1.02] shadow-lg shadow-emerald-500/20'
                        : 'bg-white dark:bg-neutral-900 border border-gray-100 dark:border-neutral-800 hover:border-emerald-300'
                    }`}
                    style={{
                      left: `${track.startTime * pixelsPerSecond}px`,
                      width: `${(track.duration || 5) * pixelsPerSecond}px`
                    }}
                    onMouseDown={(e) => handleTrackDragStart(e, track.id)}
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelectAudioTrack(track.id);
                    }}
                  >
                    <div className="absolute inset-0 px-4 flex items-center gap-3 text-[10px] font-bold text-emerald-600 truncate pointer-events-none">
                      <div className="w-6 h-6 bg-emerald-100 dark:bg-emerald-900/30 rounded-lg flex items-center justify-center">
                        <Mic className="w-3.5 h-3.5 shrink-0" />
                      </div>
                      <span className="truncate tracking-tight">{track.text || '空台词'}</span>
                    </div>
                    {/* Trim Handles */}
                    {activeAudioTrackId === track.id && (
                      <>
                        <div 
                          className="absolute left-0 top-0 bottom-0 w-3 bg-emerald-500 cursor-col-resize hover:bg-emerald-400 z-20 flex items-center justify-center"
                          onMouseDown={(e) => handleAudioTrimStart(e, track.id, 'left')}
                        >
                          <div className="w-0.5 h-4 bg-white/50 rounded-full"></div>
                        </div>
                        <div 
                          className="absolute right-0 top-0 bottom-0 w-3 bg-emerald-500 cursor-col-resize hover:bg-emerald-400 z-20 flex items-center justify-center"
                          onMouseDown={(e) => handleAudioTrimStart(e, track.id, 'right')}
                        >
                          <div className="w-0.5 h-4 bg-white/50 rounded-full"></div>
                        </div>
                      </>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Audio Track 2 (BGM) */}
            <div className="flex relative h-14 group">
              <div className="absolute left-0 top-0 bottom-0 w-20 bg-white dark:bg-neutral-900 border-r border-gray-100 dark:border-neutral-800 z-30 flex flex-col items-center justify-center sticky left-0 group/header shadow-[4px_0_12px_rgba(0,0,0,0.02)]">
                <span className="text-[10px] font-black text-violet-600 dark:text-violet-500 uppercase tracking-[0.2em]">A2</span>
                <button 
                  onClick={(e) => {
                    e.stopPropagation();
                    const newTrack: AudioTrack = {
                      id: 'bgm-' + Date.now().toString(),
                      type: 'bgm',
                      url: '',
                      startTime: 0,
                      duration: 10,
                    };
                    onUpdateScene({ audioTracks: [...audioTracks, newTrack] });
                    onSelectAudioTrack(newTrack.id);
                  }}
                  className="opacity-0 group-hover/header:opacity-100 absolute top-2 right-2 p-1.5 text-violet-600 hover:bg-violet-50 dark:hover:bg-violet-900/30 rounded-xl transition-all shadow-sm border border-violet-100"
                  title="添加背景音乐"
                >
                  <Plus className="w-3.5 h-3.5" />
                </button>
              </div>
              <div className="ml-20 relative w-full h-full">
                {audioTracks.filter(t => t.type === 'bgm').map(track => {
                  const isBroken = track.linkedAssetId && !track.url;
                  return (
                  <div
                    key={track.id}
                    className={`absolute top-0 bottom-0 rounded-[1rem] overflow-hidden cursor-ew-resize transition-all shadow-sm ${
                      activeAudioTrackId === track.id
                        ? 'bg-violet-500/10 border-2 border-violet-500 z-10 scale-[1.02] shadow-lg shadow-violet-500/20'
                        : isBroken
                          ? 'bg-red-500/10 border border-dashed border-red-400 dark:border-red-500/50 hover:bg-red-500/20'
                          : 'bg-white dark:bg-neutral-900 border border-gray-100 dark:border-neutral-800 hover:border-violet-300'
                    }`}
                    style={{
                      left: `${track.startTime * pixelsPerSecond}px`,
                      width: `${(track.duration || 10) * pixelsPerSecond}px`
                    }}
                    onMouseDown={(e) => handleTrackDragStart(e, track.id)}
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelectAudioTrack(track.id);
                    }}
                  >
                    <div className={`absolute inset-0 px-4 flex items-center gap-3 text-[10px] font-bold truncate pointer-events-none ${isBroken ? 'text-red-500 dark:text-red-400' : 'text-violet-600 dark:text-violet-400'}`}>
                      <div className={`w-6 h-6 rounded-lg flex items-center justify-center ${isBroken ? 'bg-red-100 dark:bg-red-900/30' : 'bg-violet-100 dark:bg-violet-900/30'}`}>
                        {isBroken ? <AlertTriangle className="w-3.5 h-3.5 shrink-0" /> : <Music className="w-3.5 h-3.5 shrink-0" />}
                      </div>
                      {isBroken ? (
                        <span className="tracking-tight">缺失资源，请点击替换</span>
                      ) : (
                        <span className="uppercase tracking-[0.2em]">BGM</span>
                      )}
                    </div>
                    {/* Trim Handles */}
                    {activeAudioTrackId === track.id && (
                      <>
                        <div 
                          className={`absolute left-0 top-0 bottom-0 w-3 cursor-col-resize z-20 flex items-center justify-center ${isBroken ? 'bg-red-500 hover:bg-red-400' : 'bg-violet-500 hover:bg-violet-400'}`}
                          onMouseDown={(e) => handleAudioTrimStart(e, track.id, 'left')}
                        >
                          <div className="w-0.5 h-4 bg-white/50 rounded-full"></div>
                        </div>
                        <div 
                          className={`absolute right-0 top-0 bottom-0 w-3 cursor-col-resize z-20 flex items-center justify-center ${isBroken ? 'bg-red-500 hover:bg-red-400' : 'bg-violet-500 hover:bg-violet-400'}`}
                          onMouseDown={(e) => handleAudioTrimStart(e, track.id, 'right')}
                        >
                          <div className="w-0.5 h-4 bg-white/50 rounded-full"></div>
                        </div>
                      </>
                    )}
                  </div>
                )})}
              </div>
            </div>

            {/* Audio Track 3 (SFX) */}
            <div className="flex relative h-14 group">
              <div className="absolute left-0 top-0 bottom-0 w-20 bg-white dark:bg-neutral-900 border-r border-gray-100 dark:border-neutral-800 z-30 flex flex-col items-center justify-center sticky left-0 group/header shadow-[4px_0_12px_rgba(0,0,0,0.02)]">
                <span className="text-[10px] font-black text-amber-600 dark:text-amber-500 uppercase tracking-[0.2em]">A3</span>
                <button 
                  onClick={(e) => {
                    e.stopPropagation();
                    const newTrack: AudioTrack = {
                      id: 'sfx-' + Date.now().toString(),
                      type: 'sfx',
                      url: '',
                      startTime: 0,
                      duration: 5,
                    };
                    onUpdateScene({ audioTracks: [...audioTracks, newTrack] });
                    onSelectAudioTrack(newTrack.id);
                  }}
                  className="opacity-0 group-hover/header:opacity-100 absolute top-2 right-2 p-1.5 text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-900/30 rounded-xl transition-all shadow-sm border border-amber-100"
                  title="添加音效"
                >
                  <Plus className="w-3.5 h-3.5" />
                </button>
              </div>
              <div className="ml-20 relative w-full h-full">
                {audioTracks.filter(t => t.type === 'sfx').map(track => {
                  const isBroken = track.linkedAssetId && !track.url;
                  return (
                  <div
                    key={track.id}
                    className={`absolute top-0 bottom-0 rounded-[1rem] overflow-hidden cursor-ew-resize transition-all shadow-sm ${
                      activeAudioTrackId === track.id
                        ? 'bg-amber-500/10 border-2 border-amber-500 z-10 scale-[1.02] shadow-lg shadow-amber-500/20'
                        : isBroken
                          ? 'bg-red-500/10 border border-dashed border-red-400 dark:border-red-500/50 hover:bg-red-500/20'
                          : 'bg-white dark:bg-neutral-900 border border-gray-100 dark:border-neutral-800 hover:border-amber-300'
                    }`}
                    style={{
                      left: `${track.startTime * pixelsPerSecond}px`,
                      width: `${(track.duration || 2) * pixelsPerSecond}px`
                    }}
                    onMouseDown={(e) => handleTrackDragStart(e, track.id)}
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelectAudioTrack(track.id);
                    }}
                  >
                    <div className={`absolute inset-0 px-4 flex items-center gap-3 text-[10px] font-bold truncate pointer-events-none ${isBroken ? 'text-red-500 dark:text-red-400' : 'text-amber-600 dark:text-amber-400'}`}>
                      <div className={`w-6 h-6 rounded-lg flex items-center justify-center ${isBroken ? 'bg-red-100 dark:bg-red-900/30' : 'bg-amber-100 dark:bg-amber-900/30'}`}>
                        {isBroken ? <AlertTriangle className="w-3.5 h-3.5 shrink-0" /> : <Volume2 className="w-3.5 h-3.5 shrink-0" />}
                      </div>
                      {isBroken ? (
                        <span className="tracking-tight">缺失资源</span>
                      ) : (
                        <span className="uppercase tracking-[0.2em]">SFX</span>
                      )}
                    </div>
                    {/* Trim Handles */}
                    {activeAudioTrackId === track.id && (
                      <>
                        <div 
                          className={`absolute left-0 top-0 bottom-0 w-3 cursor-col-resize z-20 flex items-center justify-center ${isBroken ? 'bg-red-500 hover:bg-red-400' : 'bg-amber-500 hover:bg-amber-400'}`}
                          onMouseDown={(e) => handleAudioTrimStart(e, track.id, 'left')}
                        >
                          <div className="w-0.5 h-4 bg-white/50 rounded-full"></div>
                        </div>
                        <div 
                          className={`absolute right-0 top-0 bottom-0 w-3 cursor-col-resize z-20 flex items-center justify-center ${isBroken ? 'bg-red-500 hover:bg-red-400' : 'bg-amber-500 hover:bg-amber-400'}`}
                          onMouseDown={(e) => handleAudioTrimStart(e, track.id, 'right')}
                        >
                          <div className="w-0.5 h-4 bg-white/50 rounded-full"></div>
                        </div>
                      </>
                    )}
                  </div>
                )})}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
