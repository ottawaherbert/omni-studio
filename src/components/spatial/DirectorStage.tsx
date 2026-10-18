import React, { Suspense, useEffect } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls, Grid, Environment, useTexture } from '@react-three/drei';
import { DummyActor } from './DummyActor';
import { useSpatialStore } from '../../clients/stateClient';
import * as THREE from 'three';
import { SpatialComposition } from '../../clients/domainTypes';

const BackgroundImage = ({ url }: { url: string }) => {
  const texture = useTexture(url);
  texture.colorSpace = THREE.SRGBColorSpace;
  return (
    <mesh position={[0, 0, -10]} scale={[30, 15, 1]}>
      <planeGeometry />
      <meshBasicMaterial map={texture} depthWrite={false} />
    </mesh>
  );
};

const PanoramaBackground = ({ url }: { url: string }) => {
  const texture = useTexture(url);
  texture.colorSpace = THREE.SRGBColorSpace;
  return (
    <mesh>
      <sphereGeometry args={[500, 60, 40]} />
      <meshBasicMaterial map={texture} side={THREE.BackSide} />
    </mesh>
  );
};

const CameraSync = ({ shotSize, cameraAngle }: { shotSize?: string, cameraAngle?: string }) => {
  const { camera } = useThree();
  
  useEffect(() => {
    // Basic camera positioning based on shot size
    let z = 5;
    let y = 2;
    
    if (shotSize === 'CU' || shotSize === 'ECU') z = 2;
    if (shotSize === 'WS' || shotSize === 'EWS') z = 10;
    
    if (cameraAngle === 'High') y = 5;
    if (cameraAngle === 'Low') y = 0.5;
    if (cameraAngle === 'Bird') { y = 10; z = 0.1; }
    
    camera.position.set(0, y, z);
    camera.lookAt(0, 1, 0);
  }, [shotSize, cameraAngle, camera]);
  
  return null;
};

const CaptureManager = ({ onCapture }: { onCapture: (data: SpatialComposition) => void }) => {
  const { gl, camera, scene } = useThree();
  const isCapturing = useSpatialStore(state => state.isCapturing);
  const setIsCapturing = useSpatialStore(state => state.setIsCapturing);
  const entities = useSpatialStore(state => state.entities);

  useEffect(() => {
    if (isCapturing) {
      // 1. Render the scene to ensure it's up to date
      gl.render(scene, camera);
      
      // 2. Get the screenshot
      const imageUrl = gl.domElement.toDataURL('image/jpeg', 0.8);
      
      // 3. Calculate 2D bounding boxes for all entities
      const width = gl.domElement.width;
      const height = gl.domElement.height;
      
      const entityData = entities.map(entity => {
        // Create a vector for the entity's position
        const pos = new THREE.Vector3(...entity.position);
        
        // Project to normalized device coordinates (-1 to +1)
        pos.project(camera);
        
        // Convert to pixel coordinates
        const x = (pos.x * .5 + .5) * width;
        const y = (pos.y * -.5 + .5) * height;
        
        // Estimate a bounding box (simplified, assuming fixed size for now)
        // In a real app, you'd project the bounding box of the actual 3D mesh
        const boxWidth = 100; // pixels
        const boxHeight = 200; // pixels
        
        return {
          id: entity.id,
          type: entity.type,
          position: entity.position,
          rotationY: entity.rotation[1],
          scale: [1, 1, 1], // Default scale for now
          screenBox: {
            x: Math.max(0, x - boxWidth / 2),
            y: Math.max(0, y - boxHeight / 2),
            w: boxWidth,
            h: boxHeight
          }
        };
      });

      const compositionData: SpatialComposition = {
        imageUrl,
        cameraState: {
          position: camera.position.toArray(),
          target: [0, 0, 0], // Assuming looking at center for now
          fov: (camera as THREE.PerspectiveCamera).fov || 50
        },
        entities: entityData
      };

      onCapture(compositionData);
      setIsCapturing(false);
    }
  }, [isCapturing, gl, camera, scene, entities, onCapture, setIsCapturing]);

  return null;
};

interface DirectorStageProps {
  backgroundImageUrl?: string;
  isPanorama?: boolean;
  shotSize?: string;
  cameraAngle?: string;
  onCapture?: (data: SpatialComposition) => void;
}

export const DirectorStage: React.FC<DirectorStageProps> = ({ backgroundImageUrl, isPanorama, shotSize, cameraAngle, onCapture }) => {
  const entities = useSpatialStore(state => state.entities);
  const setActiveEntity = useSpatialStore(state => state.setActiveEntity);

  return (
    <div className="w-full h-full bg-neutral-900 rounded-xl overflow-hidden relative" style={{ minHeight: '500px' }}>
      <Canvas 
        camera={{ position: [0, 2, 5], fov: 50 }} 
        onPointerMissed={() => setActiveEntity(null)}
        gl={{ preserveDrawingBuffer: true }}
      >
        {onCapture && <CaptureManager onCapture={onCapture} />}
        <CameraSync shotSize={shotSize} cameraAngle={cameraAngle} />
        <ambientLight intensity={0.5} />
        <directionalLight position={[5, 5, 5]} intensity={1} castShadow />

        {backgroundImageUrl && (
          <Suspense fallback={null}>
            {isPanorama ? (
              <PanoramaBackground url={backgroundImageUrl} />
            ) : (
              <BackgroundImage url={backgroundImageUrl} />
            )}
          </Suspense>
        )}

        <Grid 
          infiniteGrid 
          fadeDistance={20} 
          sectionColor="#666" 
          cellColor="#333" 
          position={[0, -0.01, 0]} 
        />

        {entities.map(entity => (
          <DummyActor 
            key={entity.id} 
            id={entity.id}
            position={entity.position}
            rotation={entity.rotation}
            label={entity.label}
            model3dUrl={entity.model3dUrl}
          />
        ))}

        <OrbitControls makeDefault />
        <Environment preset="city" />
      </Canvas>
      
      {/* UI Overlay */}
      <div className="absolute top-4 left-4 pointer-events-none flex flex-col gap-2">
        <div className="bg-black/50 backdrop-blur-md text-white px-3 py-1.5 rounded-lg text-sm font-medium border border-white/10 inline-block">
          3D 导演台 (Director's Stage)
        </div>
        {!backgroundImageUrl && (
          <div className="bg-amber-500/20 text-amber-400 px-3 py-1.5 rounded-lg text-xs font-medium border border-amber-500/30 inline-block">
            提示：当前场地尚未生成全景图/背景图，显示默认网格。
          </div>
        )}
      </div>
      <div className="absolute bottom-4 left-4 pointer-events-none text-xs text-white/50">
        左键旋转视角 | 右键平移视角 | 滚轮缩放 | 点击假人进行拖拽
      </div>
    </div>
  );
};
