import { runInteractiveManualFlowSelfCheck } from "../src/utils/interactiveManualFlowSelfCheck";

const result = runInteractiveManualFlowSelfCheck();

console.log("Interactive manual flow self-check passed.");
console.log(JSON.stringify(result, null, 2));
