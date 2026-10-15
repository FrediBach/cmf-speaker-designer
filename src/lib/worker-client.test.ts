import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createWorkerClient } from './worker-client'

interface Request {
  id: number
  payload: string
}

class TestWorker {
  onmessage: ((event: MessageEvent) => void) | null = null
  onerror: (() => void) | null = null
  onmessageerror: (() => void) | null = null
  postMessage = vi.fn<(request: Request, transfer: Transferable[]) => void>()
  terminate = vi.fn()

  respond(id: number, result: number) {
    this.message({ id, result })
  }

  message(data: unknown) {
    this.onmessage?.({ data } as MessageEvent)
  }

  request(index = 0) {
    return this.postMessage.mock.calls[index][0]
  }
}

const failureMessage = 'The generator failed. Please retry.'

function setup(timeoutMs = 100) {
  const workers: TestWorker[] = []
  const factory = vi.fn(() => {
    const worker = new TestWorker()
    workers.push(worker)
    return worker as unknown as Worker
  })
  const client = createWorkerClient<string, number>(
    factory,
    failureMessage,
    timeoutMs,
  )
  return { client, factory, workers }
}

beforeEach(() => vi.useFakeTimers())

afterEach(() => {
  const pendingTimers = vi.getTimerCount()
  vi.useRealTimers()
  vi.restoreAllMocks()
  expect(pendingTimers).toBe(0)
})

describe('shared geometry worker queue', () => {
  it('runs concurrent callers in order and forwards their transfer lists', async () => {
    const { client, workers, factory } = setup()
    const buffer = new ArrayBuffer(16)
    const first = client.request('first', [buffer])
    const second = client.request('second')
    const worker = workers[0]
    expect(worker.postMessage).toHaveBeenCalledTimes(1)
    expect(worker.postMessage.mock.calls[0][1]).toEqual([buffer])
    worker.respond(worker.request().id, 0)
    await expect(first).resolves.toBe(0)
    expect(worker.request(1).payload).toBe('second')
    worker.respond(worker.request(1).id, 2)
    await expect(second).resolves.toBe(2)
    expect(factory).toHaveBeenCalledTimes(1)
    expect(worker.terminate).not.toHaveBeenCalled()
  })

  it('rejects already aborted callers without creating a worker', async () => {
    const { client, factory } = setup()
    const controller = new AbortController()
    controller.abort()
    await expect(
      client.request('obsolete', [], controller.signal),
    ).rejects.toMatchObject({
      name: 'AbortError',
    })
    expect(factory).not.toHaveBeenCalled()
  })

  it('removes an aborted queued job while preserving the other callers', async () => {
    const { client, workers } = setup()
    const controller = new AbortController()
    const removeListener = vi.spyOn(controller.signal, 'removeEventListener')
    const first = client.request('first')
    const canceled = client.request('canceled', [], controller.signal)
    const rejected = expect(canceled).rejects.toMatchObject({
      name: 'AbortError',
    })
    const third = client.request('third')
    controller.abort()
    await rejected
    expect(removeListener).toHaveBeenCalledWith('abort', expect.any(Function))

    const worker = workers[0]
    expect(worker.postMessage).toHaveBeenCalledTimes(1)
    worker.respond(worker.request().id, 1)
    await expect(first).resolves.toBe(1)
    expect(worker.request(1).payload).toBe('third')
    worker.respond(worker.request(1).id, 3)
    await expect(third).resolves.toBe(3)
    expect(worker.postMessage).toHaveBeenCalledTimes(2)
  })

  it('keeps the worker occupied after active cancellation until the obsolete response arrives', async () => {
    const { client, workers, factory } = setup()
    const controller = new AbortController()
    const canceled = client.request('canceled', [], controller.signal)
    const rejected = expect(canceled).rejects.toMatchObject({
      name: 'AbortError',
    })
    const second = client.request('second')
    controller.abort()
    await rejected

    const worker = workers[0]
    expect(worker.postMessage).toHaveBeenCalledTimes(1)
    expect(worker.terminate).not.toHaveBeenCalled()
    worker.respond(worker.request().id, 999)
    expect(worker.request(1).payload).toBe('second')
    worker.respond(worker.request(1).id, 2)
    await expect(second).resolves.toBe(2)
    await expect(canceled).rejects.toMatchObject({ name: 'AbortError' })
    expect(factory).toHaveBeenCalledTimes(1)
  })

  it('ignores unknown, out-of-order, and duplicate responses without advancing the queue', async () => {
    const { client, workers } = setup()
    const first = client.request('first')
    const second = client.request('second')
    const firstSettled = vi.fn()
    const secondSettled = vi.fn()
    void first.then(firstSettled)
    void second.then(secondSettled)
    const worker = workers[0]
    const firstId = worker.request().id

    worker.respond(999, 999)
    worker.respond(firstId + 1, 222)
    await Promise.resolve()
    expect(firstSettled).not.toHaveBeenCalled()
    expect(secondSettled).not.toHaveBeenCalled()
    expect(worker.postMessage).toHaveBeenCalledTimes(1)

    worker.respond(firstId, 1)
    await expect(first).resolves.toBe(1)
    worker.respond(firstId, 111)
    await Promise.resolve()
    expect(secondSettled).not.toHaveBeenCalled()
    expect(worker.postMessage).toHaveBeenCalledTimes(2)
    worker.respond(worker.request(1).id, 2)
    await expect(second).resolves.toBe(2)
  })

  it.each(['error', 'messageerror', 'timeout'] as const)(
    'recovers a queued caller in a new worker after %s',
    async (failure) => {
      const { client, workers, factory } = setup()
      const controller = new AbortController()
      const removeListener = vi.spyOn(controller.signal, 'removeEventListener')
      const first = client.request('first', [], controller.signal)
      const rejected = expect(first).rejects.toThrow(failureMessage)
      const second = client.request('second')
      const broken = workers[0]

      if (failure === 'timeout') await vi.advanceTimersByTimeAsync(100)
      else if (failure === 'error') broken.onerror?.()
      else broken.onmessageerror?.()

      await rejected
      expect(broken.terminate).toHaveBeenCalledTimes(1)
      expect(broken.onmessage).toBeNull()
      expect(broken.onerror).toBeNull()
      expect(broken.onmessageerror).toBeNull()
      expect(removeListener).toHaveBeenCalledWith('abort', expect.any(Function))
      expect(factory).toHaveBeenCalledTimes(2)
      const recovered = workers[1]
      expect(recovered.request().payload).toBe('second')
      recovered.respond(recovered.request().id, 2)
      await expect(second).resolves.toBe(2)
    },
  )

  it('times out an aborted active request so pending callers can still recover', async () => {
    const { client, workers } = setup()
    const controller = new AbortController()
    const canceled = client.request('canceled', [], controller.signal)
    const rejected = expect(canceled).rejects.toMatchObject({
      name: 'AbortError',
    })
    const second = client.request('second')
    controller.abort()
    await rejected
    await vi.advanceTimersByTimeAsync(100)
    expect(workers[0].terminate).toHaveBeenCalledTimes(1)
    expect(workers[1].request().payload).toBe('second')
    workers[1].respond(workers[1].request().id, 2)
    await expect(second).resolves.toBe(2)
  })

  it('starts each timeout when the job is dispatched and clears finished job timers', async () => {
    const { client, workers } = setup()
    const controller = new AbortController()
    const removeListener = vi.spyOn(controller.signal, 'removeEventListener')
    const first = client.request('first', [], controller.signal)
    const second = client.request('second')
    const worker = workers[0]
    await vi.advanceTimersByTimeAsync(90)
    worker.respond(worker.request().id, 1)
    await expect(first).resolves.toBe(1)
    expect(removeListener).toHaveBeenCalledWith('abort', expect.any(Function))
    controller.abort()
    await vi.advanceTimersByTimeAsync(90)
    expect(worker.terminate).not.toHaveBeenCalled()
    worker.respond(worker.request(1).id, 2)
    await expect(second).resolves.toBe(2)
    await vi.advanceTimersByTimeAsync(100)
    expect(worker.terminate).not.toHaveBeenCalled()
  })

  it('rejects a generation error while keeping the worker available for other callers', async () => {
    const { client, workers, factory } = setup()
    const first = client.request('first')
    const rejected = expect(first).rejects.toThrow('Invalid geometry')
    const second = client.request('second')
    const worker = workers[0]
    worker.message({ id: worker.request().id, error: 'Invalid geometry' })
    await rejected
    expect(worker.request(1).payload).toBe('second')
    worker.respond(worker.request(1).id, 2)
    await expect(second).resolves.toBe(2)
    expect(factory).toHaveBeenCalledTimes(1)
    expect(worker.terminate).not.toHaveBeenCalled()
  })

  it('recovers following a worker construction exception', async () => {
    const { client, workers, factory } = setup()
    factory.mockImplementationOnce(() => {
      throw new Error('Worker blocked')
    })
    await expect(client.request('first')).rejects.toThrow(failureMessage)
    const second = client.request('second')
    expect(factory).toHaveBeenCalledTimes(2)
    workers[0].respond(workers[0].request().id, 2)
    await expect(second).resolves.toBe(2)
  })

  it('recovers the next queued caller when posting a request throws', async () => {
    const { client, workers, factory } = setup()
    const first = client.request('first')
    const second = client.request('second')
    const rejected = expect(second).rejects.toThrow(failureMessage)
    const third = client.request('third')
    const broken = workers[0]
    broken.postMessage.mockImplementationOnce(() => {
      throw new DOMException('Cannot clone request', 'DataCloneError')
    })
    broken.respond(broken.request().id, 1)
    await expect(first).resolves.toBe(1)
    await rejected
    expect(broken.terminate).toHaveBeenCalledTimes(1)
    expect(factory).toHaveBeenCalledTimes(2)
    expect(workers[1].request().payload).toBe('third')
    workers[1].respond(workers[1].request().id, 3)
    await expect(third).resolves.toBe(3)
  })
})
