import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  it,
  onTestFinished,
  test,
  vi,
} from 'vitest';

const createNodeContext = () => ({
  after: (callback: () => unknown | Promise<unknown>) => {
    onTestFinished(async () => {
      await callback();
    });
  },
});

const wrapTestCallback = <T extends ((context?: unknown) => unknown) | undefined>(callback: T): T => {
  if (typeof callback !== 'function' || callback.length === 0) {
    return callback;
  }

  return ((...args: unknown[]) => callback(createNodeContext(), ...args)) as T;
};

const createNodeCompatibleTest = <T extends typeof test>(base: T): T => {
  const wrapped = ((name: string, callback?: Parameters<T>[1], timeout?: Parameters<T>[2]) =>
    base(name, wrapTestCallback(callback), timeout)) as T;

  Object.assign(wrapped, base);
  return wrapped;
};

const createMockFn = <T extends (...args: any[]) => any>(implementation?: T) => {
  const fn = vi.fn((...args: Parameters<T>) => {
    const result = implementation?.(...args);
    const lastCall = fn.mock.calls.at(-1);
    if (lastCall && !Object.prototype.hasOwnProperty.call(lastCall, 'arguments')) {
      Object.defineProperty(lastCall, 'arguments', {
        configurable: true,
        enumerable: false,
        value: lastCall,
      });
    }
    return result as ReturnType<T>;
  }) as ReturnType<typeof vi.fn<T>> & {
    mock: ReturnType<typeof vi.fn<T>>['mock'] & {
      resetCalls?: () => ReturnType<typeof vi.fn<T>>;
    };
  };

  fn.mock.resetCalls ??= () => {
    fn.mockClear();
    return fn;
  };

  return fn;
};

export const mock = {
  fn: createMockFn,
};

const nodeCompatibleIt = createNodeCompatibleTest(it);
const nodeCompatibleTest = createNodeCompatibleTest(test);

export {
  afterAll as after,
  afterEach,
  beforeAll as before,
  beforeEach,
  describe,
  nodeCompatibleIt as it,
  nodeCompatibleTest as test,
};

export default nodeCompatibleTest;
