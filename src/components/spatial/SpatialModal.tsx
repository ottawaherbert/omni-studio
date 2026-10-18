import React from 'react';
import { X } from 'lucide-react';
import { DirectorStage } from './DirectorStage';
import { useSpatialStore } from '../../clients/stateClient';
import { SpatialComposition } from '../../clients/domainTypes';

interface SpatialModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (data: SpatialComposition) => void;
  shotId: string;
  backgroundImageUrl?: string;
  isPanorama?: boolean;
  shotSize?: string;
  cameraAngle?: string;
}

export const SpatialModal: React.FC<SpatialModalProps> = ({ 
  isOpen, 
  onClose, 
  onConfirm, 
  shotId, 
  backgroundImageUrl,
  isPanorama,
  shotSize,
  cameraAngle
}) => {
  const setIsCapturing = useSpatialStore(state => state.setIsCapturing);

  if (!isOpen) return null;

  const handleConfirmClick = () => {
    // Trigger the capture process inside the Canvas
    setIsCapturing(true);
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      
      <div className="relative w-full max-w-6xl h-[80vh] bg-neutral-900 rounded-3xl shadow-2xl flex flex-col border border-white/10 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 bg-black/20">
          <div>
            <h3 className="text-lg font-bold text-white">3D 导演台 (Director's Stage)</h3>
            <p className="text-xs text-white/50 mt-1">拖拽角色进行空间构图，系统将自动编译为 AI 提示词</p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={handleConfirmClick}
              className="px-6 py-2 bg-violet-600 hover:bg-violet-500 text-white text-sm font-bold rounded-xl transition-colors"
            >
              确认构图
            </button>
            <button
              onClick={onClose}
              className="p-2 text-white/50 hover:text-white hover:bg-white/10 rounded-xl transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* 3D Canvas Area */}
        <div className="flex-1 relative">
          <DirectorStage 
            backgroundImageUrl={backgroundImageUrl} 
            isPanorama={isPanorama}
            shotSize={shotSize}
            cameraAngle={cameraAngle}
            onCapture={onConfirm}
          />
        </div>
      </div>
    </div>
  );
};
