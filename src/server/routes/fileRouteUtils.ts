import path from "path";

export const isPathSafe = (baseDir: string, relativePath: string): boolean => {
  const resolved = path.resolve(baseDir, relativePath);
  const baseResolved = path.resolve(baseDir);
  return resolved.startsWith(baseResolved + path.sep) || resolved === baseResolved;
};
