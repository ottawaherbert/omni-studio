import React, { Suspense } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Environment, useTexture } from '@react-three/drei';
import * as THREE from 'three';
import { Loader2 } from 'lucide-react';
import { summarizeUnknownError } from '../../utils/logging';

interface PanoramaViewerProps {
  imageUrl: string;
}

const PanoramaSphere = ({ imageUrl }: { imageUrl: string }) => {
  const [blobUrl, setBlobUrl] = React.useState<string | null>(null);

  React.useEffect(() => {
    let active = true;
    let url: string | null = null;
    fetch(imageUrl, { referrerPolicy: 'no-referrer' })
      .then((res) => res.blob())
      .then((blob) => {
        if (active) {
          url = URL.createObjectURL(blob);
          setBlobUrl(url);
        }
      })
      .catch((err) => {
        console.error("Failed to fetch texture blob", summarizeUnknownError(err));
      });
    return () => {
      active = false;
      if (url) {
        URL.revokeObjectURL(url);
      }
    };
  }, [imageUrl]);

  if (!blobUrl) {
    return null; // Will show Suspense fallback from parent if we suspended, but here we just return null until loaded
  }

  return <PanoramaSphereTexture blobUrl={blobUrl} />;
};

const PanoramaSphereTexture = ({ blobUrl }: { blobUrl: string }) => {
  const texture = useTexture(blobUrl);
  texture.colorSpace = THREE.SRGBColorSpace;
  
  return (
    <mesh>
      <sphereGeometry args={[500, 60, 40]} />
      <meshBasicMaterial map={texture} side={THREE.BackSide} />
    </mesh>
  );
};

export const PanoramaViewer: React.FC<PanoramaViewerProps> = ({ imageUrl }) => {
  return (
    <div className="w-full h-full relative bg-black rounded-3xl overflow-hidden">
      <Suspense fallback={
        <div className="absolute inset-0 flex items-center justify-center text-white">
          <Loader2 className="w-8 h-8 animate-spin" />
        </div>
      }>
        <Canvas camera={{ position: [0, 0, 0.1], fov: 75 }}>
          <OrbitControls enableZoom={true} enablePan={false} enableDamping dampingFactor={0.05} autoRotate autoRotateSpeed={0.5} />
          <PanoramaSphere imageUrl={imageUrl} />
        </Canvas>
      </Suspense>
    </div>
  );
};
