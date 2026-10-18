export interface SystemGarbageCollectionResponse {
  success: boolean;
  message?: string;
  error?: string;
  files?: { relativePath: string; bytes: number }[];
}
