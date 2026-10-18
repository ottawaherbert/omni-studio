import { Asset, Character } from "../types/project";

/**
 * Deduplicates newly generated assets against existing ones based on name and type.
 * @param existingAssets List of existing assets in the project.
 * @param newAssets List of newly generated assets.
 * @returns A filtered list of new assets that don't already exist.
 */
export function deduplicateAssets(existingAssets: Asset[], newAssets: Asset[]): Asset[] {
  return newAssets.filter(na => {
    const isDuplicate = existingAssets.some(ea => 
      ea.name.trim().toLowerCase() === na.name.trim().toLowerCase() && 
      ea.type === na.type
    );
    return !isDuplicate;
  });
}

/**
 * Deduplicates newly generated characters against existing ones based on name.
 * @param existingCharacters List of existing characters in the project.
 * @param newCharacters List of newly generated characters.
 * @returns A filtered list of new characters that don't already exist.
 */
export function deduplicateCharacters(existingCharacters: Character[], newCharacters: Character[]): Character[] {
  return newCharacters.filter(nc => {
    const isDuplicate = existingCharacters.some(ec => 
      ec.name.trim().toLowerCase() === nc.name.trim().toLowerCase()
    );
    return !isDuplicate;
  });
}
