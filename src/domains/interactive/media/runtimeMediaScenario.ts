import { evaluatePredicate, type RuntimeStateContext } from "../interpreter/stateInterpreter";
import type { PredicateAST } from "../types/schema";

export interface RuntimeMediaScenarioLike {
  entryPredicate: PredicateAST | null;
}

/**
 * Selects a frozen media scenario from the same state snapshot used by choice
 * evaluation. A null predicate is a compatibility fallback, never preferred
 * over an explicit matching state.
 */
export const selectRuntimeMediaScenario = <T extends RuntimeMediaScenarioLike>(
  scenarios: T[] | undefined,
  state: RuntimeStateContext | null | undefined,
): T | undefined => {
  if (!scenarios?.length || !state) return undefined;
  return scenarios.find((scenario) => (
    scenario.entryPredicate !== null && evaluatePredicate(scenario.entryPredicate, state)
  )) || scenarios.find((scenario) => scenario.entryPredicate === null);
};
