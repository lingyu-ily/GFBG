export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export async function api<T = any>(
  path: string,
  body?: unknown,
  csrf?: string,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      method: body === undefined ? "GET" : "POST",
      credentials: "same-origin",
      headers:
        body === undefined
          ? undefined
          : { "Content-Type": "application/json", "X-CSRF-Token": csrf || "" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    throw new ApiError(0, "連線中斷，操作結果尚未確認。請恢復連線後重試。");
  }
  const data = await response
    .json()
    .catch(() => ({ error: "服務暫時無法使用。" }));
  if (!response.ok)
    throw new ApiError(response.status, data.error || "操作失敗");
  return data;
}
