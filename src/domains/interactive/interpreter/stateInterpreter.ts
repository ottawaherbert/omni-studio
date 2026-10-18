import {
  getInitialFactIds,
  type PredicateAST,
  type StateEffectAST,
  type StateSchema,
} from '../types/schema.ts';

export interface RuntimeStateContext {
  variables: Record<string, boolean | number | string>;
  facts: Set<string>;
  visitedNodes: Record<string, number>;
}

export function createInitialStateContext(schema?: StateSchema): RuntimeStateContext {
  const variables: Record<string, boolean | number | string> = {};
  if (schema?.variables) {
    for (const v of schema.variables) {
      variables[v.key] = v.defaultValue;
    }
  }
  return {
    variables,
    facts: new Set<string>(getInitialFactIds(schema)),
    visitedNodes: {},
  };
}

export function evaluatePredicate(predicate: PredicateAST, ctx: RuntimeStateContext): boolean {
  switch (predicate.op) {
    case 'always':
      return true;
    case 'never':
      return false;
    case 'all':
      return predicate.predicates.every((p) => evaluatePredicate(p, ctx));
    case 'any':
      return predicate.predicates.some((p) => evaluatePredicate(p, ctx));
    case 'not':
      return !evaluatePredicate(predicate.predicate, ctx);
    case 'has_fact':
      return ctx.facts.has(predicate.fact);
    case 'visited': {
      const times = ctx.visitedNodes[predicate.nodeId] || 0;
      const min = predicate.minTimes ?? 1;
      return times >= min;
    }
    case 'compare': {
      const val = ctx.variables[predicate.variable];
      if (val === undefined) return false;
      const target = predicate.value;

      switch (predicate.comparator) {
        case 'eq':
          return val === target;
        case 'neq':
          return val !== target;
        case 'gt':
          return typeof val === 'number' && typeof target === 'number' ? val > target : false;
        case 'gte':
          return typeof val === 'number' && typeof target === 'number' ? val >= target : false;
        case 'lt':
          return typeof val === 'number' && typeof target === 'number' ? val < target : false;
        case 'lte':
          return typeof val === 'number' && typeof target === 'number' ? val <= target : false;
        default:
          return false;
      }
    }
    default:
      return false;
  }
}

export function applyStateEffects(
  effects: StateEffectAST[],
  ctx: RuntimeStateContext,
  schema?: StateSchema
): RuntimeStateContext {
  const nextVariables = { ...ctx.variables };
  const nextFacts = new Set(ctx.facts);

  for (const effect of effects) {
    switch (effect.type) {
      case 'set': {
        const varSchema = schema?.variables.find((v) => v.key === effect.variable);
        let val = effect.value;
        if (varSchema && varSchema.type === 'number' && typeof val === 'number') {
          if (varSchema.min !== undefined) val = Math.max(varSchema.min, val);
          if (varSchema.max !== undefined) val = Math.min(varSchema.max, val);
        }
        nextVariables[effect.variable] = val;
        break;
      }
      case 'increment': {
        const current = Number(nextVariables[effect.variable] || 0);
        let nextVal = current + effect.amount;
        const varSchema = schema?.variables.find((v) => v.key === effect.variable);
        if (varSchema) {
          if (varSchema.max !== undefined) nextVal = Math.min(varSchema.max, nextVal);
        }
        nextVariables[effect.variable] = nextVal;
        break;
      }
      case 'decrement': {
        const current = Number(nextVariables[effect.variable] || 0);
        let nextVal = current - effect.amount;
        const varSchema = schema?.variables.find((v) => v.key === effect.variable);
        if (varSchema) {
          if (varSchema.min !== undefined) nextVal = Math.max(varSchema.min, nextVal);
        }
        nextVariables[effect.variable] = nextVal;
        break;
      }
      case 'add_fact':
        nextFacts.add(effect.fact);
        break;
      case 'remove_fact':
        nextFacts.delete(effect.fact);
        break;
    }
  }

  return {
    ...ctx,
    variables: nextVariables,
    facts: nextFacts,
  };
}
