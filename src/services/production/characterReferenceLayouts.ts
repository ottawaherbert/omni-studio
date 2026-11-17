export * from '../../../packages/production/src/services/production/characterReferenceLayouts';

import type { Project } from '../../types/project';
import type { ManualProductionAssetBoard } from './manualProductionAssets';
import { characterReferenceOwner, characterReferenceUsage } from '../../../packages/production/src/services/production/characterReferenceLayouts';
export const withCharacterReferenceUsage = (project: Project, boards: ManualProductionAssetBoard[]) => boards.map(board => {
  if (board.assetType !== 'character') return board;
  const character = project.characters.find(c => c.id === board.assetId);
  const layout = character ? characterReferenceOwner(character, board.variantId)?.cleanReferenceLayout : undefined;
  return { ...board, characterReferenceLayout: layout, referenceUsageNote: characterReferenceUsage(layout, board.variantName) };
}).filter((board,_,all) => board.assetType !== 'character' || board.variantId || board.boardItemId.startsWith('appearance:') || !all.some(other => other.assetId === board.assetId && other.variantId && other.characterReferenceLayout === 'body_face'));
