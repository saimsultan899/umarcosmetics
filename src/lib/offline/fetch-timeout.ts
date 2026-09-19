/**
 * Fetch helpers with hard timeouts so offline UI never hangs forever.
 */

export class TimeoutError extends Error {
  constructor(message = "Request timed out") {
    super(message);
    this.name = "TimeoutError";
  }
}

export async function withTimeout<T>(
  promise: PromiseLike<T>,
  ms = 8000,
  label = "operation",
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve(promise),
      new Promise<T>((_, reject) => {
        timer = setTimeout(
          () => reject(new TimeoutError(`${label} timed out after ${ms}ms`)),
          ms,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Race a supabase-js builder (thenable) against a timeout. */
export async function supabaseTimeout<T>(
  thenable: PromiseLike<{ data: T; error: { message: string } | null }>,
  ms = 8000,
) {
  return withTimeout(thenable, ms, "supabase");
}
