(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.SleepScreenController = factory();
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const DEFAULT_TIMEOUT_MS = 300000;
  const CLOCK_INTERVAL_MS = 1000;

  class SleepScreenController {
    constructor(options = {}) {
      this.document =
        options.document ||
        (typeof document !== "undefined" ? document : null);
      this.timerApi =
        options.timerApi ||
        (typeof globalThis !== "undefined" ? globalThis : null);
      this.timeoutMs = Number.isFinite(options.timeoutMs)
        ? options.timeoutMs
        : DEFAULT_TIMEOUT_MS;
      this.locale = options.locale || "pt-BR";
      this.isAuthenticated =
        typeof options.isAuthenticated === "function"
          ? options.isAuthenticated
          : () => false;
      this.getUserLabel =
        typeof options.getUserLabel === "function"
          ? options.getUserLabel
          : () => "Usuário conectado";
      this.onBlocked =
        typeof options.onBlocked === "function" ? options.onBlocked : null;

      this.ids = {
        overlay: options.overlayId || "sleepScreen",
        openButton: options.openButtonId || "openSleepScreen",
        closeButton: options.closeButtonId || "closeSleepScreen",
        clock: options.clockId || "sleepClock",
        weekday: options.weekdayId || "sleepWeekday",
        date: options.dateId || "sleepDate",
        user: options.userId || "sleepUser",
      };

      this.elements = {};
      this.initialized = false;
      this.active = false;
      this.opened = false;
      this.mode = null;
      this.busyCount = 0;
      this.idleTimer = null;
      this.clockTimer = null;
      this.previousBodyOverflow = "";
      this.previouslyFocusedElement = null;

      this.handleOpenClick = this.handleOpenClick.bind(this);
      this.handleCloseClick = this.handleCloseClick.bind(this);
      this.handleKeydown = this.handleKeydown.bind(this);
      this.handleActivity = this.handleActivity.bind(this);
      this.handleIdleTimeout = this.handleIdleTimeout.bind(this);
    }

    resolveElements() {
      if (!this.document) return;
      Object.entries(this.ids).forEach(([name, id]) => {
        this.elements[name] = this.document.getElementById(id);
      });
    }

    init() {
      if (this.initialized || !this.document) return this;
      this.resolveElements();

      this.elements.openButton?.addEventListener(
        "click",
        this.handleOpenClick,
      );
      this.elements.closeButton?.addEventListener(
        "click",
        this.handleCloseClick,
      );
      this.document.addEventListener("keydown", this.handleKeydown);
      this.document.addEventListener("mousemove", this.handleActivity, {
        passive: true,
      });
      this.document.addEventListener("mousedown", this.handleActivity, {
        passive: true,
      });
      this.document.addEventListener("touchstart", this.handleActivity, {
        passive: true,
      });

      this.initialized = true;
      this.elements.overlay?.setAttribute("aria-hidden", "true");
      return this;
    }

    destroy() {
      if (!this.initialized || !this.document) return;
      this.deactivate();
      this.elements.openButton?.removeEventListener(
        "click",
        this.handleOpenClick,
      );
      this.elements.closeButton?.removeEventListener(
        "click",
        this.handleCloseClick,
      );
      this.document.removeEventListener("keydown", this.handleKeydown);
      this.document.removeEventListener("mousemove", this.handleActivity);
      this.document.removeEventListener("mousedown", this.handleActivity);
      this.document.removeEventListener("touchstart", this.handleActivity);
      this.initialized = false;
    }

    activate() {
      this.active = true;
      this.scheduleIdleTimer();
    }

    deactivate() {
      this.active = false;
      this.clearIdleTimer();
      if (this.opened) this.close({ restartIdle: false, restoreFocus: false });
      this.clearClockTimer();
    }

    beginBusy() {
      this.busyCount += 1;
      this.clearIdleTimer();
      return this.busyCount;
    }

    endBusy() {
      this.busyCount = Math.max(0, this.busyCount - 1);
      if (this.busyCount === 0) this.scheduleIdleTimer();
      return this.busyCount;
    }

    isBusy() {
      return this.busyCount > 0;
    }

    isOpen() {
      return this.opened;
    }

    getMode() {
      return this.mode;
    }

    handleOpenClick() {
      this.open("manual");
    }

    handleCloseClick(event) {
      event?.stopPropagation();
      this.close();
    }

    handleKeydown(event) {
      if (this.opened && event.key === "Escape") {
        event.preventDefault();
        this.close();
        return;
      }
      this.handleActivity(event);
    }

    handleActivity() {
      if (!this.active || !this.isAuthenticated()) return;
      if (this.opened) {
        if (this.mode === "automatic") this.close();
        return;
      }
      this.scheduleIdleTimer();
    }

    handleIdleTimeout() {
      this.idleTimer = null;
      if (
        !this.active ||
        this.opened ||
        this.isBusy() ||
        !this.isAuthenticated()
      ) {
        return;
      }
      this.open("automatic");
    }

    scheduleIdleTimer() {
      this.clearIdleTimer();
      if (
        !this.timerApi ||
        !this.active ||
        this.opened ||
        this.isBusy() ||
        !this.isAuthenticated()
      ) {
        return;
      }
      this.idleTimer = this.timerApi.setTimeout(
        this.handleIdleTimeout,
        this.timeoutMs,
      );
    }

    clearIdleTimer() {
      if (this.idleTimer == null || !this.timerApi) return;
      this.timerApi.clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }

    open(mode = "manual") {
      if (
        !this.initialized ||
        !this.elements.overlay ||
        !this.active ||
        !this.isAuthenticated()
      ) {
        return false;
      }
      if (this.isBusy()) {
        if (mode === "manual") this.onBlocked?.();
        return false;
      }
      if (this.opened) return true;

      this.clearIdleTimer();
      this.opened = true;
      this.mode = mode === "automatic" ? "automatic" : "manual";
      this.previouslyFocusedElement = this.document.activeElement;
      this.updateClock();
      this.elements.overlay.classList.remove("app-hidden");
      this.elements.overlay.setAttribute("aria-hidden", "false");

      if (this.document.body) {
        this.previousBodyOverflow = this.document.body.style.overflow;
        this.document.body.style.overflow = "hidden";
      }

      this.startClockTimer();
      this.elements.closeButton?.focus({ preventScroll: true });
      return true;
    }

    close(options = {}) {
      if (!this.opened) return false;
      const restartIdle = options.restartIdle !== false;
      const restoreFocus = options.restoreFocus !== false;

      this.opened = false;
      this.mode = null;
      this.elements.overlay?.classList.add("app-hidden");
      this.elements.overlay?.setAttribute("aria-hidden", "true");
      this.clearClockTimer();

      if (this.document?.body) {
        this.document.body.style.overflow = this.previousBodyOverflow;
      }

      if (
        restoreFocus &&
        this.previouslyFocusedElement &&
        typeof this.previouslyFocusedElement.focus === "function"
      ) {
        this.previouslyFocusedElement.focus({ preventScroll: true });
      }
      this.previouslyFocusedElement = null;

      if (restartIdle) this.scheduleIdleTimer();
      return true;
    }

    startClockTimer() {
      this.clearClockTimer();
      if (!this.timerApi || !this.opened) return;
      this.clockTimer = this.timerApi.setInterval(
        () => this.updateClock(),
        CLOCK_INTERVAL_MS,
      );
    }

    clearClockTimer() {
      if (this.clockTimer == null || !this.timerApi) return;
      this.timerApi.clearInterval(this.clockTimer);
      this.clockTimer = null;
    }

    updateClock(now = new Date()) {
      if (this.elements.clock) {
        this.elements.clock.textContent = now.toLocaleTimeString(this.locale, {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        });
      }
      if (this.elements.weekday) {
        this.elements.weekday.textContent = now.toLocaleDateString(this.locale, {
          weekday: "long",
        });
      }
      if (this.elements.date) {
        this.elements.date.textContent = now.toLocaleDateString(this.locale, {
          day: "2-digit",
          month: "long",
          year: "numeric",
        });
      }
      if (this.elements.user) {
        this.elements.user.textContent =
          this.getUserLabel() || "Usuário conectado";
      }
    }
  }

  SleepScreenController.DEFAULT_TIMEOUT_MS = DEFAULT_TIMEOUT_MS;
  SleepScreenController.CLOCK_INTERVAL_MS = CLOCK_INTERVAL_MS;

  return SleepScreenController;
});
