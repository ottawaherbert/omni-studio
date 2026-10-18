import React, { useState } from "react";
import { Video, Camera, Mic, Music, Volume2 } from "lucide-react";
import { Shot, AudioTrack } from "../clients/domainTypes";

interface StudioAssetListProps {
  shotPositions: (Shot & { start: number; duration: number })[];
  audioTracks?: AudioTrack[];
  selectedShotId: string | null;
  selectedAudioTrackId: string | null;
  onSelectShot: (id: string, start: number) => void;
  onSelectAudioTrack: (id: string, start: number) => void;
}

export const StudioAssetList: React.FC<StudioAssetListProps> = ({
  shotPositions,
  audioTracks,
  selectedShotId,
  selectedAudioTrackId,
  onSelectShot,
  onSelectAudioTrack,
}) => {
  const [activeTab, setActiveTab] = useState<'shots' | 'audio'>('shots');

  return (
    <div className="flex-1 flex flex-col shrink-0 min-h-0 transition-colors duration-200">
      <div className="h-14 px-4 border-b border-border-soft/10 flex items-center justify-between bg-bg-surface sticky top-0 z-10">
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 mr-1">
            <div className="w-7 h-7 bg-bg-surface-soft rounded-lg flex items-center justify-center border border-border-soft/20 shrink-0">
              <Video className="w-3.5 h-3.5 text-gold" />
            </div>
            <h2 className="text-xs font-bold text-text-primary tracking-tight whitespace-nowrap">
              媒体池
            </h2>
          </div>

          <div className="flex bg-bg-surface-soft p-0.5 rounded-lg border border-border-soft/20">
            <button
              onClick={() => setActiveTab('shots')}
              className={`flex items-center gap-1 px-2.5 py-1 text-[10px] font-bold rounded transition-all cursor-pointer ${
                activeTab === 'shots'
                  ? 'bg-bg-surface text-gold shadow-sm border border-border-soft/30'
                  : 'text-text-muted hover:text-text-primary'
              }`}
            >
              镜头
            </button>
            <button
              onClick={() => setActiveTab('audio')}
              className={`flex items-center gap-1 px-2.5 py-1 text-[10px] font-bold rounded transition-all cursor-pointer ${
                activeTab === 'audio'
                  ? 'bg-bg-surface text-gold shadow-sm border border-border-soft/30'
                  : 'text-text-muted hover:text-text-primary'
              }`}
            >
              音频
            </button>
          </div>
        </div>

      </div>

      <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-2 custom-scrollbar bg-bg-primary">
        {activeTab === 'shots' ? (
          shotPositions.map((shot, index) => {
            const isSelected = selectedShotId === shot.id;

            return (
              <button
                key={shot.id}
                data-studio-shot-id={shot.id}
                data-has-video={shot.videoUrl ? "true" : "false"}
                onClick={() => onSelectShot(shot.id, shot.start)}
                className={`text-left p-2.5 rounded-xl border transition-all flex gap-3 group relative cursor-pointer ${
                  isSelected
                    ? "bg-bg-surface-soft border-border-soft/60 text-gold shadow-sm"
                    : "bg-bg-surface border-border-soft/20 text-text-secondary hover:border-border-soft/40"
                }`}
              >
                <div className="w-16 h-12 bg-bg-surface-soft rounded-lg flex-shrink-0 flex items-center justify-center overflow-hidden relative border border-border-soft/20">
                  {shot.imageUrl ? (
                    <img src={shot.imageUrl} alt="preview" className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" referrerPolicy="no-referrer" />
                  ) : (
                    <Camera className="w-4 h-4 text-text-muted opacity-50" />
                  )}
                  {shot.videoUrl && (
                    <div className="absolute bottom-1 right-1 bg-black/60 rounded p-0.5 backdrop-blur-sm border border-white/20">
                      <Video className="w-2.5 h-2.5 text-gold" />
                    </div>
                  )}
                </div>
                <div className="flex flex-col justify-center overflow-hidden flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-1">
                    <span className={`text-xs font-bold truncate ${isSelected ? "text-gold" : "text-text-primary"}`}>
                      镜头 {index + 1}
                    </span>
                    <span className="text-[9px] font-bold text-text-muted bg-bg-surface-soft px-1.5 py-0.5 rounded border border-border-soft/20">
                      {shot.duration}s
                    </span>
                  </div>
                  <span className="text-[10px] text-text-muted truncate font-medium">
                    {shot.cameraAngle} | {shot.shotSize}
                  </span>
                </div>
              </button>
            );
          })
        ) : (
          audioTracks?.map((track, index) => {
            const isDeadLink = track.linkedAssetId && !track.url;
            return (
              <button
                key={track.id}
                onClick={() => onSelectAudioTrack(track.id, track.startTime)}
                className={`text-left p-2.5 rounded-xl border transition-all flex items-center gap-3 relative cursor-pointer ${
                  selectedAudioTrackId === track.id
                    ? "bg-bg-surface-soft border-border-soft/60 text-gold shadow-sm"
                    : isDeadLink
                    ? "bg-red-500/10 border-red-500/30 text-red-400"
                    : "bg-bg-surface border-border-soft/20 text-text-secondary hover:border-border-soft/40"
                }`}
              >
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center transition-all shrink-0 border border-border-soft/20 ${
                  isDeadLink ? 'bg-red-500/20 text-red-400' : 'bg-bg-surface-soft text-text-muted'
                }`}>
                  {track.type === 'dialogue' ? <Mic className="w-4 h-4" /> :
                   track.type === 'bgm' ? <Music className="w-4 h-4" /> :
                   <Volume2 className="w-4 h-4" />}
                </div>
                <div className="flex flex-col overflow-hidden flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-0.5">
                    <span className={`text-xs font-bold truncate ${
                      isDeadLink ? "text-red-400" :
                      selectedAudioTrackId === track.id ? "text-gold" : "text-text-primary"
                    }`}>
                      {track.type === 'dialogue' ? '配音' : track.type === 'bgm' ? '背景音乐' : '音效'} {index + 1}
                    </span>
                  </div>
                  <span className={`text-[10px] truncate font-medium leading-tight ${isDeadLink ? "text-red-400/80" : "text-text-muted"}`}>
                    {isDeadLink ? "⚠️ 资产已丢失" : (track.text || '无台词')}
                  </span>
                </div>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
};
