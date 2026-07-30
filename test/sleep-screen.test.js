const test = require('node:test');
const assert = require('node:assert/strict');
const SleepScreenController = require('../public/sleep-screen');

class FakeEventTarget {
  constructor() {
    this.listeners = new Map();
  }

  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(listener);
  }

  removeEventListener(type, listener) {
    this.listeners.get(type)?.delete(listener);
  }

  dispatch(type, properties = {}) {
    const event = {
      type,
      defaultPrevented: false,
      propagationStopped: false,
      preventDefault() {
        this.defaultPrevented = true;
      },
      stopPropagation() {
        this.propagationStopped = true;
      },
      ...properties
    };
    for (const listener of this.listeners.get(type) || []) {
      listener(event);
    }
    return event;
  }

  listenerCount(type) {
    return this.listeners.get(type)?.size || 0;
  }
}

class FakeClassList {
  constructor(...initial) {
    this.values = new Set(initial);
  }

  add(value) {
    this.values.add(value);
  }

  remove(value) {
    this.values.delete(value);
  }

  contains(value) {
    return this.values.has(value);
  }
}

class FakeElement extends FakeEventTarget {
  constructor(document, { hidden = false } = {}) {
    super();
    this.document = document;
    this.classList = new FakeClassList(...(hidden ? ['app-hidden'] : []));
    this.attributes = new Map();
    this.textContent = '';
    this.value = '';
    this.focusCalls = 0;
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  getAttribute(name) {
    return this.attributes.get(name);
  }

  focus() {
    this.focusCalls += 1;
    this.document.activeElement = this;
  }
}

class FakeDocument extends FakeEventTarget {
  constructor() {
    super();
    this.body = { style: { overflow: '' } };
    this.activeElement = null;
    this.elements = new Map();
  }

  addElement(id, options) {
    const element = new FakeElement(this, options);
    this.elements.set(id, element);
    return element;
  }

  getElementById(id) {
    return this.elements.get(id) || null;
  }
}

class FakeTimerApi {
  constructor() {
    this.now = 0;
    this.nextId = 1;
    this.tasks = new Map();
  }

  setTimeout(callback, delay) {
    return this.addTask(callback, delay, null);
  }

  clearTimeout(id) {
    this.tasks.delete(id);
  }

  setInterval(callback, delay) {
    return this.addTask(callback, delay, delay);
  }

  clearInterval(id) {
    this.tasks.delete(id);
  }

  addTask(callback, delay, interval) {
    const id = this.nextId++;
    this.tasks.set(id, {
      id,
      callback,
      at: this.now + Number(delay),
      interval
    });
    return id;
  }

  advance(milliseconds) {
    const target = this.now + milliseconds;
    while (true) {
      const next = [...this.tasks.values()]
        .filter((task) => task.at <= target)
        .sort((left, right) => left.at - right.at || left.id - right.id)[0];
      if (!next) break;

      this.now = next.at;
      if (next.interval == null) {
        this.tasks.delete(next.id);
      } else if (this.tasks.has(next.id)) {
        next.at += next.interval;
      }
      next.callback();
    }
    this.now = target;
  }

  countIntervals() {
    return [...this.tasks.values()].filter((task) => task.interval != null)
      .length;
  }

  countTimeouts() {
    return [...this.tasks.values()].filter((task) => task.interval == null)
      .length;
  }
}

function createFixture({ authenticated = true } = {}) {
  const document = new FakeDocument();
  const overlay = document.addElement('sleepScreen', { hidden: true });
  const openButton = document.addElement('openSleepScreen');
  const closeButton = document.addElement('closeSleepScreen');
  document.addElement('sleepClock');
  document.addElement('sleepWeekday');
  document.addElement('sleepDate');
  document.addElement('sleepUser');
  const timerApi = new FakeTimerApi();
  let isAuthenticated = authenticated;
  let blockedCalls = 0;

  const controller = new SleepScreenController({
    document,
    timerApi,
    isAuthenticated: () => isAuthenticated,
    getUserLabel: () => 'Técnico Teste',
    onBlocked: () => {
      blockedCalls += 1;
    }
  });

  return {
    controller,
    document,
    timerApi,
    overlay,
    openButton,
    closeButton,
    setAuthenticated(value) {
      isAuthenticated = value;
    },
    getBlockedCalls() {
      return blockedCalls;
    }
  };
}

test('não agenda nem abre a tela de descanso no login', () => {
  const fixture = createFixture({ authenticated: false });
  fixture.controller.init();
  fixture.controller.activate();

  assert.equal(fixture.timerApi.countTimeouts(), 0);
  fixture.openButton.dispatch('click');
  assert.equal(fixture.controller.isOpen(), false);

  fixture.timerApi.advance(SleepScreenController.DEFAULT_TIMEOUT_MS * 2);
  assert.equal(fixture.controller.isOpen(), false);
});

test('modo manual fecha só pelo botão ou ESC e preserva conteúdo/foco', () => {
  const fixture = createFixture();
  const typedInput = new FakeElement(fixture.document);
  typedInput.value = 'conteúdo ainda digitado';
  typedInput.focus();

  fixture.controller.init();
  fixture.controller.init();
  fixture.controller.activate();
  assert.equal(fixture.document.listenerCount('keydown'), 1);
  assert.equal(fixture.timerApi.countTimeouts(), 1);

  fixture.openButton.dispatch('click');
  assert.equal(fixture.controller.isOpen(), true);
  assert.equal(fixture.controller.getMode(), 'manual');
  assert.equal(fixture.overlay.classList.contains('app-hidden'), false);
  assert.equal(fixture.overlay.getAttribute('aria-hidden'), 'false');
  assert.equal(fixture.timerApi.countTimeouts(), 0);
  assert.equal(fixture.timerApi.countIntervals(), 1);
  assert.equal(fixture.document.body.style.overflow, 'hidden');

  fixture.overlay.dispatch('click');
  fixture.document.dispatch('mousemove');
  fixture.document.dispatch('keydown', { key: 'A' });
  assert.equal(fixture.controller.isOpen(), true);

  const escapeEvent = fixture.document.dispatch('keydown', { key: 'Escape' });
  assert.equal(escapeEvent.defaultPrevented, true);
  assert.equal(fixture.controller.isOpen(), false);
  assert.equal(fixture.overlay.classList.contains('app-hidden'), true);
  assert.equal(fixture.overlay.getAttribute('aria-hidden'), 'true');
  assert.equal(fixture.timerApi.countIntervals(), 0);
  assert.equal(fixture.timerApi.countTimeouts(), 1);
  assert.equal(fixture.document.body.style.overflow, '');
  assert.equal(typedInput.value, 'conteúdo ainda digitado');
  assert.equal(fixture.document.activeElement, typedInput);

  fixture.openButton.dispatch('click');
  fixture.closeButton.dispatch('click');
  assert.equal(fixture.controller.isOpen(), false);
});

test('modo automático abre exatamente em cinco minutos e fecha por mouse ou tecla', () => {
  const fixture = createFixture();
  fixture.controller.init();
  fixture.controller.activate();

  fixture.timerApi.advance(SleepScreenController.DEFAULT_TIMEOUT_MS - 1);
  assert.equal(fixture.controller.isOpen(), false);
  fixture.timerApi.advance(1);
  assert.equal(fixture.controller.isOpen(), true);
  assert.equal(fixture.controller.getMode(), 'automatic');

  fixture.document.dispatch('mousemove');
  assert.equal(fixture.controller.isOpen(), false);
  assert.equal(fixture.timerApi.countTimeouts(), 1);

  fixture.timerApi.advance(SleepScreenController.DEFAULT_TIMEOUT_MS);
  assert.equal(fixture.controller.getMode(), 'automatic');
  fixture.document.dispatch('keydown', { key: 'x' });
  assert.equal(fixture.controller.isOpen(), false);
  assert.equal(fixture.timerApi.countTimeouts(), 1);
});

test('requisições e uploads pausam a ativação até todo o contador busy terminar', () => {
  const fixture = createFixture();
  fixture.controller.init();
  fixture.controller.activate();

  fixture.controller.beginBusy();
  fixture.controller.beginBusy();
  assert.equal(fixture.controller.isBusy(), true);
  assert.equal(fixture.timerApi.countTimeouts(), 0);

  fixture.openButton.dispatch('click');
  assert.equal(fixture.controller.isOpen(), false);
  assert.equal(fixture.getBlockedCalls(), 1);

  fixture.timerApi.advance(SleepScreenController.DEFAULT_TIMEOUT_MS * 2);
  assert.equal(fixture.controller.isOpen(), false);

  fixture.controller.endBusy();
  assert.equal(fixture.timerApi.countTimeouts(), 0);
  fixture.controller.endBusy();
  assert.equal(fixture.controller.isBusy(), false);
  assert.equal(fixture.timerApi.countTimeouts(), 1);

  fixture.timerApi.advance(SleepScreenController.DEFAULT_TIMEOUT_MS);
  assert.equal(fixture.controller.getMode(), 'automatic');
});

test('deactivate e destroy limpam timers e listeners', () => {
  const fixture = createFixture();
  fixture.controller.init();
  fixture.controller.activate();
  fixture.openButton.dispatch('click');
  assert.equal(fixture.timerApi.countIntervals(), 1);

  fixture.controller.deactivate();
  assert.equal(fixture.controller.isOpen(), false);
  assert.equal(fixture.timerApi.countIntervals(), 0);
  assert.equal(fixture.timerApi.countTimeouts(), 0);

  fixture.controller.destroy();
  assert.equal(fixture.document.listenerCount('keydown'), 0);
  assert.equal(fixture.document.listenerCount('mousemove'), 0);
  assert.equal(fixture.openButton.listenerCount('click'), 0);
  assert.equal(fixture.closeButton.listenerCount('click'), 0);
});
