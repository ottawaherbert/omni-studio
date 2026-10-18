import type { ProductionRepository } from "./repositories";
import { createStoreProductionRepository } from "./storeProductionRepository";

let activeProductionRepository: ProductionRepository | undefined;

export const setProductionRepository = (repository: ProductionRepository | undefined) => {
  activeProductionRepository = repository;
};

export const getProductionRepository = (): ProductionRepository => {
  if (!activeProductionRepository) {
    activeProductionRepository = createStoreProductionRepository();
  }
  return activeProductionRepository;
};
