/**
 * BookmarkMind - Centralized Logging System
 * Provides structured logging with levels, categories, and environment-aware output
 */

class Logger {
  static LOG_LEVELS = {
    DEBUG: 0,
    INFO: 1,
    WARN: 2,
    ERROR: 3
  };

  static EMOJI_MAP = {
    DEBUG: '🔍',
    INFO: 'ℹ️',
    WARN: '⚠️',
    ERROR: '❌'
  };

  constructor(category = 'General', options = {}) {
    this.category = category;
    this.options = {
      minLevel: Logger.LOG_LEVELS.INFO,
      enableProduction: false,
      ...options
    };

    this._detectEnvironment();
  }

  _detectEnvironment() {
    try {
      this.isProduction = chrome.runtime && chrome.runtime.id && !chrome.runtime.getManifest().key;
    } catch {
      this.isProduction = false;
    }
  }

  _shouldLog(level) {
    if (this.isProduction && !this.options.enableProduction) {
      return level >= Logger.LOG_LEVELS.WARN;
    }
    return level >= this.options.minLevel;
  }

  _formatMessage(level, message, data) {
    const timestamp = new Date().toISOString().split('T')[1].split('.')[0];
    const emoji = Logger.EMOJI_MAP[level] || '';
    const prefix = `${emoji} [${timestamp}] [${this.category}] [${level}]`;

    if (data !== undefined) {
      return [prefix, message, data];
    }
    return [prefix, message];
  }

  debug(message, data) {
    if (this._shouldLog(Logger.LOG_LEVELS.DEBUG)) {
      console.log(...this._formatMessage('DEBUG', message, data));
    }
  }

  info(message, data) {
    if (this._shouldLog(Logger.LOG_LEVELS.INFO)) {
      console.log(...this._formatMessage('INFO', message, data));
    }
  }

  warn(message, data) {
    if (this._shouldLog(Logger.LOG_LEVELS.WARN)) {
      console.warn(...this._formatMessage('WARN', message, data));
    }
  }

  error(message, data) {
    if (this._shouldLog(Logger.LOG_LEVELS.ERROR)) {
      console.error(...this._formatMessage('ERROR', message, data));
    }
  }

  group(title, level = 'INFO') {
    if (this._shouldLog(Logger.LOG_LEVELS[level])) {
      console.group(...this._formatMessage(level, title));
    }
  }

  groupEnd() {
    if (!this.isProduction || this.options.enableProduction) {
      console.groupEnd();
    }
  }

  static setGlobalLevel(level) {
    Logger.globalMinLevel = Logger.LOG_LEVELS[level] || Logger.LOG_LEVELS.INFO;
  }

  static create(category, options = {}) {
    return new Logger(category, {
      ...options,
      minLevel: Logger.globalMinLevel || options.minLevel
    });
  }
}

Logger.globalMinLevel = Logger.LOG_LEVELS.INFO;
