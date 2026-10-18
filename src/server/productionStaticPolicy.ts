import path from "node:path";

export const shouldServeSpaDocument = (requestPath: string) => path.posix.extname(requestPath) === "";
