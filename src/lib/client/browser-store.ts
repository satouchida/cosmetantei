/**
 * ブラウザ（localStorage）に保存する値を、useSyncExternalStore で読める形にする。
 * 「使えるコスメ」（src/lib/usable-products.ts）と、利用規約への同意（src/lib/consent.ts）、
 * 画像で保存するおすすめの設定（src/lib/client/export-reminder.ts）で使う。
 *
 * - 最初に読むときだけ保存先を読み、その後は同じ値（同じ参照）を返す。変えたときだけ新しい値にする
 * - 保存できない環境（プライベートウィンドウ、サイトデータのブロック、容量不足）では、このページを開いている間だけ
 *   メモリの値で動く。保存に失敗している間は、ほかのタブの変更で上書きしない（メモリにしか無い値を消さない）
 * - ほかのタブで変えた・サイトデータを消した（storage イベントの key が null）ときは、保存された値を読み直す
 * - legacyKey：以前の保存先。新しい保存先に何も無く、以前の保存先に値があれば、最初に読むときにそれを読んで新しい保存先へ
 *   移し、以前の保存先を消す
 */

export interface BrowserStoreOptions<T> {
  key: string;
  /** 保存された文字列を値にする。保存されていない・読めないときは null が渡る */
  parse: (raw: string | null) => T;
  serialize: (value: T) => string;
  /** ほかのタブの変更を、このタブの値に合わせる（省略時は保存された値をそのまま使う） */
  merge?: (stored: T, current: T | null) => T;
  /** 以前の保存先（最初に読むときに移して消す。parse で読める形であること） */
  legacyKey?: string;
}

export interface BrowserStore<T> {
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => T;
  set: (value: T) => void;
  /** テスト用：保存先を読み直す状態に戻す */
  resetForTests: () => void;
}

export function createBrowserStore<T>({ key, parse, serialize, merge, legacyKey }: BrowserStoreOptions<T>): BrowserStore<T> {
  let memory: T | null = null;
  /** 保存に失敗した（メモリにしか無い値がある）。ほかのタブの値で上書きしない */
  let persistFailed = false;
  const listeners = new Set<() => void>();

  function readStorage(): T {
    try {
      const raw = window.localStorage.getItem(key);
      if (raw === null && legacyKey) {
        const legacy = window.localStorage.getItem(legacyKey);
        if (legacy !== null) return migrate(legacy, legacyKey);
      }
      return parse(raw);
    } catch {
      return parse(null);
    }
  }

  /** 以前の保存先の値を新しい保存先へ移す。移せなければ以前の保存先を残す（次に開いたときにまた移す） */
  function migrate(legacy: string, from: string): T {
    const value = parse(legacy);
    try {
      window.localStorage.setItem(key, serialize(value));
      window.localStorage.removeItem(from);
    } catch {
      // 保存できない環境では、このページを開いている間だけ使う
    }
    return value;
  }

  function notify(): void {
    for (const listener of listeners) listener();
  }

  function onStorage(event: StorageEvent): void {
    if ((event.key !== key && event.key !== null) || persistFailed) return;
    const stored = readStorage();
    memory = merge ? merge(stored, memory) : stored;
    notify();
  }

  return {
    subscribe(listener) {
      if (listeners.size === 0) window.addEventListener('storage', onStorage);
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) window.removeEventListener('storage', onStorage);
      };
    },
    getSnapshot() {
      if (memory === null) memory = readStorage();
      return memory;
    },
    set(value) {
      memory = value;
      try {
        window.localStorage.setItem(key, serialize(value));
        persistFailed = false;
      } catch {
        // 保存できない環境では、このページを開いている間だけ使う
        persistFailed = true;
      }
      notify();
    },
    resetForTests() {
      memory = null;
      persistFailed = false;
    },
  };
}
