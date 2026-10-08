import { useRef } from "react";

/**
 * One click, one save. A second click is ignored until the first save
 * finishes, then the form works again as usual.
 */
export function useSingleSubmit() {
  const lock = useRef(false);

  return function singleSubmit<T>(task: () => Promise<T> | T): Promise<T | undefined> {
    if (lock.current) return Promise.resolve(undefined);
    lock.current = true;
    return Promise.resolve()
      .then(task)
      .finally(() => {
        lock.current = false;
      });
  };
}
