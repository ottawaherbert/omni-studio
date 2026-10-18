import { createHash, timingSafeEqual } from "node:crypto";

export interface OperatorSecurityPolicyInput {
  token?: string;
  allowedProjectIds?: string | string[];
}

export interface OperatorSecurityPolicy {
  tokenRequired: boolean;
  tokenSha256?: string;
  allowedProjectIds: string[];
  localDevelopmentOpen: boolean;
}

export class OperatorSecurityError extends Error {
  statusCode: number;
  code: string;

  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.name = "OperatorSecurityError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

const hashToken = (value: string) => createHash("sha256").update(value).digest("hex");

const normalizeAllowedProjectIds = (value?: string | string[]) => {
  const items = Array.isArray(value) ? value : String(value || "").split(",");
  return Array.from(new Set(items.map((item) => item.trim()).filter(Boolean)));
};

export const createOperatorSecurityPolicy = ({
  token,
  allowedProjectIds,
}: OperatorSecurityPolicyInput = {}): OperatorSecurityPolicy => {
  const normalizedToken = String(token || "").trim();
  const normalizedAllowedProjectIds = normalizeAllowedProjectIds(allowedProjectIds);
  return {
    tokenRequired: Boolean(normalizedToken),
    tokenSha256: normalizedToken ? hashToken(normalizedToken) : undefined,
    allowedProjectIds: normalizedAllowedProjectIds,
    localDevelopmentOpen: !normalizedToken,
  };
};

export const extractOperatorTokenFromHeaders = (headers: Record<string, unknown>) => {
  const authorization = headers.authorization || headers.Authorization;
  const authValue = Array.isArray(authorization) ? authorization[0] : authorization;
  if (typeof authValue === "string") {
    const match = authValue.match(/^Bearer\s+(.+)$/i);
    if (match?.[1]?.trim()) return match[1].trim();
  }

  const headerValue = headers["x-operator-token"] || headers["X-Operator-Token"];
  const tokenValue = Array.isArray(headerValue) ? headerValue[0] : headerValue;
  return typeof tokenValue === "string" ? tokenValue.trim() : "";
};

export const isOperatorTokenAuthorized = (
  policy: OperatorSecurityPolicy,
  presentedToken?: string,
) => {
  if (!policy.tokenRequired) return true;
  if (!policy.tokenSha256 || !presentedToken) return false;
  const presentedHash = hashToken(presentedToken);
  const expected = Buffer.from(policy.tokenSha256, "hex");
  const actual = Buffer.from(presentedHash, "hex");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
};

export const assertOperatorTokenAuthorized = (
  policy: OperatorSecurityPolicy,
  presentedToken?: string,
) => {
  if (!isOperatorTokenAuthorized(policy, presentedToken)) {
    throw new OperatorSecurityError(401, "operator_token_required", "Operator API token is required or invalid.");
  }
};

export const assertOperatorProjectAllowed = (
  policy: OperatorSecurityPolicy,
  projectId?: string,
) => {
  const normalizedProjectId = String(projectId || "").trim();
  if (!normalizedProjectId) return;
  if (policy.allowedProjectIds.length > 0 && !policy.allowedProjectIds.includes(normalizedProjectId)) {
    throw new OperatorSecurityError(403, "operator_project_forbidden", "Operator is not allowed to access this project.");
  }
};

export const summarizeOperatorSecurityPolicy = (policy: OperatorSecurityPolicy) => ({
  tokenRequired: policy.tokenRequired,
  localDevelopmentOpen: policy.localDevelopmentOpen,
  projectScope: policy.allowedProjectIds.length > 0 ? "restricted" : "all",
  allowedProjectCount: policy.allowedProjectIds.length,
});
