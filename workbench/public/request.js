// Keep JSON requests and raw file uploads bound to the same account.
export function accountHeaders(accountId, contentType) {
  return {"X-Workbench-Request": "1", ...(accountId ? {"X-Workbench-Account": accountId} : {}), ...(contentType ? {"Content-Type": contentType} : {})};
}
