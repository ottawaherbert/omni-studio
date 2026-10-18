import {
  createInitialStateContext,
  evaluatePredicate,
  applyStateEffects,
} from '../src/domains/interactive/interpreter/stateInterpreter.ts';
import type { PredicateAST, StateEffectAST, StateSchema } from '../src/domains/interactive/types/schema.ts';

function runDomainCoreSelfCheck() {
  console.log('[Interactive Domain Core Self-Check] Running AST & Interpreter verification...');

  const schema: StateSchema = {
    variables: [
      { key: 'courage', type: 'number', scope: 'session', defaultValue: 10, min: 0, max: 100 },
      { key: 'hasKey', type: 'boolean', scope: 'session', defaultValue: false },
    ],
    factDefinitions: ['PROLOGUE_COMPLETE', 'CHEST_OPENED'],
    initialFactIds: ['PROLOGUE_COMPLETE'],
  };

  let ctx = createInitialStateContext(schema);

  // 1. Initial State assertions
  if (ctx.variables.courage !== 10 || ctx.variables.hasKey !== false) {
    throw new Error('Initial variable values failed schema defaults');
  }
  if (!ctx.facts.has('PROLOGUE_COMPLETE')) {
    throw new Error('Initial facts failed schema loading');
  }
  const noInitialFacts = createInitialStateContext({
    ...schema,
    initialFactIds: [],
  });
  if (noInitialFacts.facts.has('PROLOGUE_COMPLETE')) {
    throw new Error('Fact definitions must not be treated as initial owned facts');
  }
  // 2. Predicate AST evaluation
  const predicateAlways: PredicateAST = { op: 'always' };
  const predicateHasFact: PredicateAST = { op: 'has_fact', fact: 'PROLOGUE_COMPLETE' };
  const predicateMissingFact: PredicateAST = { op: 'has_fact', fact: 'SECRET_FOUND' };
  const predicateCompareCourage: PredicateAST = {
    op: 'compare',
    variable: 'courage',
    comparator: 'gte',
    value: 10,
  };

  const complexPredicate: PredicateAST = {
    op: 'all',
    predicates: [predicateAlways, predicateHasFact, predicateCompareCourage, { op: 'not', predicate: predicateMissingFact }],
  };

  if (!evaluatePredicate(complexPredicate, ctx)) {
    throw new Error('Complex Predicate AST evaluation failed unexpectedly');
  }

  // 3. StateEffect AST application
  const effects: StateEffectAST[] = [
    { type: 'increment', variable: 'courage', amount: 50 },
    { type: 'set', variable: 'hasKey', value: true },
    { type: 'add_fact', fact: 'CHEST_OPENED' },
  ];

  ctx = applyStateEffects(effects, ctx, schema);

  if (ctx.variables.courage !== 60 || ctx.variables.hasKey !== true || !ctx.facts.has('CHEST_OPENED')) {
    throw new Error('StateEffect AST application failed');
  }

  // 4. Boundary clamping (max = 100)
  const overflowEffects: StateEffectAST[] = [
    { type: 'increment', variable: 'courage', amount: 100 },
  ];
  ctx = applyStateEffects(overflowEffects, ctx, schema);
  if (ctx.variables.courage !== 100) {
    throw new Error(`StateEffect boundary clamping failed: expected 100, got ${ctx.variables.courage}`);
  }

  console.log('[Interactive Domain Core Self-Check] PASSED. Eval-free AST Interpreter & Schema boundary verification complete.');
}

runDomainCoreSelfCheck();
