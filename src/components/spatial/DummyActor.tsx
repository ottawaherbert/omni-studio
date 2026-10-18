import React, { useRef, Suspense } from 'react';
import { TransformControls, Text, useGLTF } from '@react-three/drei';
import { useSpatialStore } from '../../clients/stateClient';
import * as THREE from 'three';

interface DummyActorProps {
  id: string;
  position: [number, number, number];
  rotation: [number, number, number];
  label?: string;
  model3dUrl?: string;
}

const GLTFModel = ({ url, isActive }: { url: string, isActive: boolean }) => {
  const { scene } = useGLTF(url);
  // Clone the scene so we can mutate it safely
  const clonedScene = React.useMemo(() => scene.clone(), [scene]);
  
  // Highlight if active
  React.useEffect(() => {
    clonedScene.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        if (isActive) {
          child.material = new THREE.MeshStandardMaterial({ color: "#8b5cf6", wireframe: true });
        } else {
          // Reset to original material if needed, or just keep it simple
          // For now, we'll just let it be its original material if not active
          // But since we cloned it, we'd need to keep track of original materials.
          // Let's just use a simple approach: if active, add a bounding box or wireframe overlay.
        }
      }
    });
  }, [clonedScene, isActive]);

  return <primitive object={clonedScene} />;
};

export const DummyActor: React.FC<DummyActorProps> = ({ id, position, rotation, label, model3dUrl }) => {
  const updateEntity = useSpatialStore(state => state.updateEntity);
  const activeEntityId = useSpatialStore(state => state.activeEntityId);
  const setActiveEntity = useSpatialStore(state => state.setActiveEntity);
  const groupRef = useRef<THREE.Group>(null);

  const isActive = activeEntityId === id;

  return (
    <TransformControls
      object={groupRef}
      mode="translate"
      showX={isActive}
      showY={isActive}
      showZ={isActive}
      onMouseUp={() => {
        if (groupRef.current) {
          updateEntity(id, {
            position: groupRef.current.position.toArray() as [number, number, number],
            rotation: groupRef.current.rotation.toArray().slice(0, 3) as [number, number, number]
          });
        }
      }}
    >
      <group
        ref={groupRef}
        position={position}
        rotation={rotation}
        onClick={(e) => {
          e.stopPropagation();
          setActiveEntity(id);
        }}
      >
        {model3dUrl ? (
          <Suspense fallback={
            <mesh position={[0, 0.5, 0]}>
              <boxGeometry args={[1, 1, 1]} />
              <meshStandardMaterial color="#fbbf24" wireframe />
            </mesh>
          }>
            <GLTFModel url={model3dUrl} isActive={isActive} />
          </Suspense>
        ) : (
          <group>
            {/* Low-poly Body (Hexagonal Prism) */}
            <mesh position={[0, 0.7, 0]}>
              <cylinderGeometry args={[0.25, 0.2, 1.4, 6]} />
              <meshStandardMaterial color={isActive ? "#8b5cf6" : "#9ca3af"} flatShading />
            </mesh>
            {/* Low-poly Head (Icosahedron) */}
            <mesh position={[0, 1.55, 0]}>
              <icosahedronGeometry args={[0.2, 0]} />
              <meshStandardMaterial color={isActive ? "#a78bfa" : "#d1d5db"} flatShading />
            </mesh>
            {/* Direction Indicator (Nose/Visor) */}
            <mesh position={[0, 1.55, 0.2]}>
              <boxGeometry args={[0.15, 0.05, 0.1]} />
              <meshStandardMaterial color={isActive ? "#ffffff" : "#4b5563"} flatShading />
            </mesh>
          </group>
        )}
        {/* Label */}
        {label && (
          <Text 
            position={[0, 2.0, 0]} 
            fontSize={0.15} 
            color="white" 
            anchorX="center" 
            anchorY="middle"
            outlineWidth={0.02}
            outlineColor="black"
          >
            {label}
          </Text>
        )}
      </group>
    </TransformControls>
  );
};
