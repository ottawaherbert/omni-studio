import { db } from '../../../../src/server/db';
import { createScriptRepository } from './scriptStore';

// Explicit document and candidate operations only; no background authoring loop.
export const scriptRepository = createScriptRepository(db);
export const ensureScriptSchema = () => scriptRepository.ensureSchema();
