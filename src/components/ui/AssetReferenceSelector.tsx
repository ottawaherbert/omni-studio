import React, { useState } from 'react';
import { Asset, Character, AssetVariant } from '../../clients/domainTypes';
import { X, Check } from 'lucide-react';

interface AssetReferenceSelectorProps {
  asset: Asset | Character;
  currentOverrideUrl?: string;
  onSelect: (url: string) => void;
  onClose: () => void;
}

export const AssetReferenceSelector: React.FC<AssetReferenceSelectorProps> = ({
  asset,
  currentOverrideUrl,
  onSelect,
  onClose
}) => {
  const isCharacter = 'referenceImageUrl' in asset;
  const baseImageUrl = isCharacter ? (asset as Character).referenceImageUrl : (asset as Asset).imageUrl;
  const defaultReferenceUrl = asset.defaultReferenceUrl;
  
  const allImages: { url: string; label: string; isDefault: boolean }[] = [];
  
  if (baseImageUrl) {
    allImages.push({
      url: baseImageUrl,
      label: '基础设计图',
      isDefault: defaultReferenceUrl === baseImageUrl || (!defaultReferenceUrl && !((asset as Character).multiViewUrl || (asset as Asset).multiViewUrl || (asset as Asset).panoramaUrl)) 
    });
  }

  // Include Multi-view / Panorama images if available
  if (isCharacter && (asset as Character).multiViewUrl) {
    allImages.push({
      url: (asset as Character).multiViewUrl as string,
      label: '多视图设计',
      isDefault: defaultReferenceUrl === (asset as Character).multiViewUrl
    });
  } else if (!isCharacter) {
    const a = asset as Asset;
    if (a.multiViewUrl) {
      allImages.push({
        url: a.multiViewUrl,
        label: '多视图设计',
        isDefault: defaultReferenceUrl === a.multiViewUrl
      });
    }
    if (a.panoramaUrl) {
      allImages.push({
        url: a.panoramaUrl,
        label: '全景空间参考',
        isDefault: defaultReferenceUrl === a.panoramaUrl
      });
    }
  }
  
  if (asset.variants) {
    asset.variants.forEach(v => {
      if (v.imageUrl) {
        allImages.push({
          url: v.imageUrl,
          label: v.name,
          isDefault: defaultReferenceUrl === v.imageUrl
        });
      }
    });
  }

  // Deduplicate by URL
  const uniqueImages = Array.from(new Map(allImages.map(item => [item.url, item])).values());

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-white dark:bg-neutral-900 rounded-[2rem] w-full max-w-2xl overflow-hidden shadow-2xl border border-gray-100 dark:border-neutral-800 flex flex-col max-h-[80vh]">
        <div className="flex items-center justify-between p-6 border-b border-gray-100 dark:border-neutral-800">
          <div>
            <h3 className="text-lg font-black text-gray-900 dark:text-white tracking-tight">选择镜头参考图</h3>
            <p className="text-xs text-gray-500 dark:text-neutral-400 mt-1">为当前镜头指定 {asset.name} 的参考图</p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 dark:hover:bg-neutral-800 rounded-xl transition-all">
            <X className="w-5 h-5 text-gray-500 dark:text-neutral-400" />
          </button>
        </div>
        
        <div className="p-6 overflow-y-auto custom-scrollbar">
          {uniqueImages.length === 0 ? (
            <div className="text-center py-12 text-gray-500 dark:text-neutral-400 text-sm">
              该资产暂无可用图片
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
              {uniqueImages.map((img, idx) => {
                // If there is an override, only the overridden image is selected.
                // If there is no override, the default image is selected.
                const isSelected = currentOverrideUrl 
                  ? img.url === currentOverrideUrl 
                  : img.isDefault;
                
                return (
                  <div 
                    key={idx}
                    onClick={() => {
                      if (currentOverrideUrl === img.url) {
                        onSelect(''); // Clear override
                      } else {
                        onSelect(img.url);
                      }
                      onClose();
                    }}
                    className={`relative aspect-square rounded-2xl overflow-hidden cursor-pointer border-2 transition-all group ${
                      isSelected ? 'border-violet-500 shadow-lg shadow-violet-500/20' : 'border-transparent hover:border-violet-300 dark:hover:border-violet-700'
                    }`}
                  >
                    <img src={img.url} alt={img.label} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                    <div className="absolute inset-x-0 bottom-0 bg-black/60 p-2 text-[10px] text-white truncate text-center font-black backdrop-blur-md">
                      {img.label}
                    </div>
                    {isSelected && (
                      <div className="absolute top-2 right-2 bg-violet-500 text-white p-1 rounded-full shadow-sm">
                        <Check className="w-3 h-3" />
                      </div>
                    )}
                    {img.isDefault && (
                      <div className="absolute top-2 left-2 bg-amber-500 text-white text-[8px] font-black px-2 py-0.5 rounded-full shadow-sm">
                        主参考
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
