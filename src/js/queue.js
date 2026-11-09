// Очередь воспроизведения. Чистая логика без DOM и без Firebase.
// Треки внутри очереди хранятся как отдельные копии, поэтому один и тот же трек
// можно добавить дважды, и каждая копия остаётся отдельным элементом.

import { shuffled } from './utils.js';

export class Queue {
  constructor(rand = Math.random) {
    this.items = [];
    this.index = -1;
    this.shuffle = false;
    this.repeat = 'off'; // 'off' | 'all' | 'one'
    this._orig = null; // исходный порядок, пока включено перемешивание
    this._rand = rand;
  }

  get current() {
    return this.index >= 0 ? this.items[this.index] ?? null : null;
  }

  get length() {
    return this.items.length;
  }

  // Заменить очередь. start: с какого трека начать.
  set(tracks, start = 0) {
    this.items = tracks.map((t) => ({ ...t }));
    this._orig = null;
    if (!this.items.length) {
      this.index = -1;
      return;
    }
    this.index = Math.min(Math.max(start, 0), this.items.length - 1);
    if (this.shuffle) this._applyShuffle();
  }

  _applyShuffle() {
    if (!this.items.length) {
      this._orig = null;
      return;
    }
    this._orig = this.items.slice();
    const cur = this.items[this.index];
    const rest = shuffled(
      this.items.filter((_, i) => i !== this.index),
      this._rand,
    );
    this.items = [cur, ...rest];
    this.index = 0;
  }

  _restoreOrder() {
    if (!this._orig) return;
    const cur = this.current;
    const present = new Set(this.items);
    const known = new Set(this._orig);
    const kept = this._orig.filter((t) => present.has(t));
    const added = this.items.filter((t) => !known.has(t));
    this.items = [...kept, ...added];
    this.index = cur ? this.items.indexOf(cur) : -1;
    this._orig = null;
  }

  setShuffle(on) {
    on = Boolean(on);
    if (on === this.shuffle) return;
    this.shuffle = on;
    if (on) this._applyShuffle();
    else this._restoreOrder();
  }

  cycleRepeat() {
    this.repeat = this.repeat === 'off' ? 'all' : this.repeat === 'all' ? 'one' : 'off';
    return this.repeat;
  }

  // Следующий трек. auto = true, когда трек доиграл сам (тогда повтор "один" повторяет тот же).
  // Возвращает трек или null, если очередь закончилась.
  next(auto = false) {
    if (!this.items.length) return null;
    if (auto && this.repeat === 'one') return this.current;
    if (this.index < this.items.length - 1) {
      this.index += 1;
      return this.current;
    }
    if (this.repeat !== 'off') {
      this.index = 0;
      return this.current;
    }
    return null;
  }

  // Предыдущий трек. На первом треке остаётся на нём (плеер сам перемотает на начало).
  prev() {
    if (!this.items.length) return null;
    if (this.index > 0) {
      this.index -= 1;
      return this.current;
    }
    if (this.repeat !== 'off') {
      this.index = this.items.length - 1;
      return this.current;
    }
    return this.current;
  }

  jump(i) {
    if (i < 0 || i >= this.items.length) return null;
    this.index = i;
    return this.current;
  }

  add(track) {
    const copy = { ...track };
    this.items.push(copy);
    if (this.index === -1) this.index = 0;
    return copy;
  }

  addNext(track) {
    const copy = { ...track };
    if (this.index === -1) {
      this.items.push(copy);
      this.index = 0;
    } else {
      this.items.splice(this.index + 1, 0, copy);
    }
    return copy;
  }

  // Убрать трек. Если убрали играющий, hadNext говорит, есть ли после него следующий.
  remove(i) {
    if (i < 0 || i >= this.items.length) return { removedCurrent: false, hadNext: false };
    const [gone] = this.items.splice(i, 1);
    if (this._orig) this._orig = this._orig.filter((t) => t !== gone);
    let removedCurrent = false;
    if (i < this.index) {
      this.index -= 1;
    } else if (i === this.index) {
      removedCurrent = true;
      if (this.index >= this.items.length) this.index = this.items.length - 1;
    }
    return { removedCurrent, hadNext: removedCurrent && i < this.items.length };
  }

  move(from, to) {
    const n = this.items.length;
    if (from === to || from < 0 || to < 0 || from >= n || to >= n) return false;
    const cur = this.current;
    const [t] = this.items.splice(from, 1);
    this.items.splice(to, 0, t);
    this.index = cur ? this.items.indexOf(cur) : -1;
    return true;
  }

  clear() {
    this.items = [];
    this.index = -1;
    this._orig = null;
  }
}
