interface Response<Result> {
  id: number
  result?: Result
  error?: string
}

/** Serialize jobs per worker; abort removes queued work without cancelling other callers. */
export function createWorkerClient<Request, Result>(
  factory: () => Worker,
  errorMessage: string,
  timeoutMs = 60_000,
) {
  interface Job {
    id: number
    payload: Request
    transfer: Transferable[]
    signal?: AbortSignal
    abort(): void
    resolve(result: Result): void
    reject(error: Error): void
  }
  let worker: Worker | undefined
  let nextId = 0
  let running: Job | undefined
  let timeout: ReturnType<typeof setTimeout> | undefined
  const queue: Job[] = []
  const cancelled = () =>
    new DOMException('Geometry generation was cancelled.', 'AbortError')
  const finish = (job: Job) =>
    job.signal?.removeEventListener('abort', job.abort)

  function reset() {
    if (worker) {
      worker.onmessage = worker.onerror = worker.onmessageerror = null
      worker.terminate()
      worker = undefined
    }
    clearTimeout(timeout)
    if (running) {
      finish(running)
      running.reject(new Error(errorMessage))
      running = undefined
    }
    pump()
  }

  function pump() {
    if (running || queue.length === 0) return
    const job = queue.shift()!
    running = job
    try {
      if (!worker) {
        worker = factory()
        worker.onmessage = (event: MessageEvent<Response<Result>>) => {
          const current = running
          if (!current || current.id !== event.data.id) return
          clearTimeout(timeout)
          finish(current)
          running = undefined
          if (event.data.result !== undefined)
            current.resolve(event.data.result)
          else current.reject(new Error(event.data.error || errorMessage))
          pump()
        }
        worker.onerror = reset
        worker.onmessageerror = reset
      }
      timeout = setTimeout(reset, timeoutMs)
      worker.postMessage({ id: job.id, payload: job.payload }, job.transfer)
    } catch {
      reset()
    }
  }

  return {
    request(
      payload: Request,
      transfer: Transferable[] = [],
      signal?: AbortSignal,
    ): Promise<Result> {
      if (signal?.aborted) return Promise.reject(cancelled())
      return new Promise((resolve, reject) => {
        const job: Job = {
          id: ++nextId,
          payload,
          transfer,
          signal,
          resolve,
          reject,
          abort() {
            const index = queue.indexOf(job)
            if (index !== -1) queue.splice(index, 1)
            finish(job)
            // A synchronous worker operation may finish; the rejected promise
            // prevents its obsolete arrays from being turned into preview meshes.
            reject(cancelled())
          },
        }
        queue.push(job)
        signal?.addEventListener('abort', job.abort, { once: true })
        pump()
      })
    },
  }
}
