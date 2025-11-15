/**
 * BookmarkMind - Error Handler
 * Context-aware error wrapping, aggregation, and user-friendly messaging
 */

/**
 * Error Aggregation Service
 * Prevents duplicate error notifications and provides error tracking
 */
class ErrorAggregator {
  constructor() {
    this.errors = new Map();
    this.errorWindow = 60000; // 1 minute
    this.cleanupInterval = 30000; // 30 seconds
    this._startCleanup();
  }

  _startCleanup() {
    setInterval(() => {
      const now = Date.now();
      for (const [key, error] of this.errors.entries()) {
        if (now - error.firstOccurrence > this.errorWindow) {
          this.errors.delete(key);
        }
      }
    }, this.cleanupInterval);
  }

  add(errorKey, error, context) {
    const existing = this.errors.get(errorKey);
    const now = Date.now();

    if (existing) {
      existing.count++;
      existing.lastOccurrence = now;
      existing.contexts.push(context);
      return false; // Don't notify - duplicate
    }

    this.errors.set(errorKey, {
      error,
      context,
      count: 1,
      firstOccurrence: now,
      lastOccurrence: now,
      contexts: [context]
    });
    return true; // Notify - first occurrence
  }

  getSummary() {
    return Array.from(this.errors.values()).map(e => ({
      message: e.error.message,
      userMessage: e.error.userMessage,
      count: e.count,
      contexts: e.contexts,
      firstOccurrence: e.firstOccurrence,
      lastOccurrence: e.lastOccurrence
    }));
  }

  clear() {
    this.errors.clear();
  }

  getCount() {
    return this.errors.size;
  }
}

/**
 * Context-aware error wrapper
 * Captures operation context for better error reporting
 */
class ContextError extends Error {
  constructor(message, context, originalError) {
    super(message);
    this.name = 'ContextError';
    this.context = context;
    this.originalError = originalError;
    this.timestamp = Date.now();
    this.errorType = this._categorizeError();
    this.userMessage = this._generateUserMessage();
    this.recoverySteps = this._generateRecoverySteps();
  }

  _categorizeError() {
    const message = (this.message || '').toLowerCase();
    const originalMessage = (this.originalError?.message || '').toLowerCase();
    const combinedMessage = `${message} ${originalMessage}`;

    if (combinedMessage.includes('network') || combinedMessage.includes('fetch') || 
        combinedMessage.includes('connection') || combinedMessage.includes('econnreset') ||
        combinedMessage.includes('failed to fetch')) {
      return 'network';
    }
    if (combinedMessage.includes('api key') || combinedMessage.includes('unauthorized') || 
        combinedMessage.includes('authentication') || combinedMessage.includes('invalid_api_key') ||
        combinedMessage.includes('401')) {
      return 'api_key';
    }
    if (combinedMessage.includes('rate limit') || combinedMessage.includes('429') || 
        combinedMessage.includes('quota') || combinedMessage.includes('resource_exhausted') ||
        combinedMessage.includes('too many requests')) {
      return 'rate_limit';
    }
    if (combinedMessage.includes('permission') || combinedMessage.includes('forbidden') || 
        combinedMessage.includes('403')) {
      return 'permission';
    }
    if (combinedMessage.includes('not found') || combinedMessage.includes('404') || 
        combinedMessage.includes('does not exist')) {
      return 'not_found';
    }
    if (combinedMessage.includes('invalid') || combinedMessage.includes('malformed') || 
        combinedMessage.includes('parse') || combinedMessage.includes('400') ||
        combinedMessage.includes('bad request')) {
      return 'invalid_data';
    }
    if (combinedMessage.includes('timeout') || combinedMessage.includes('timed out') || 
        combinedMessage.includes('etimedout') || combinedMessage.includes('deadline')) {
      return 'timeout';
    }
    if (combinedMessage.includes('500') || combinedMessage.includes('502') || 
        combinedMessage.includes('503') || combinedMessage.includes('504') ||
        combinedMessage.includes('server error') || combinedMessage.includes('service unavailable')) {
      return 'server_error';
    }

    return 'unknown';
  }

  _generateUserMessage() {
    const { operation } = this.context;
    const opText = operation || 'performing operation';

    const messages = {
      network: `Network issue while ${opText}. Please check your internet connection.`,
      api_key: `API key issue while ${opText}. Please verify your API key in settings.`,
      rate_limit: `Rate limit reached while ${opText}. Please wait a moment and try again.`,
      permission: `Permission denied while ${opText}. Please check extension permissions.`,
      not_found: `Resource not found while ${opText}. The item may have been deleted.`,
      invalid_data: `Invalid data encountered while ${opText}. Please try again.`,
      timeout: `Operation timed out while ${opText}. Please try again with smaller batches.`,
      server_error: `Server error while ${opText}. The service may be temporarily unavailable.`,
      unknown: `An error occurred while ${opText}. Please try again.`
    };

    return messages[this.errorType] || messages.unknown;
  }

  _generateRecoverySteps() {
    const steps = {
      network: [
        'Check your internet connection',
        'Verify you can access other websites',
        'Try again in a few moments',
        'Contact support if the issue persists'
      ],
      api_key: [
        'Open extension settings',
        'Verify your Gemini API key is correct',
        'Check if your API key has quota remaining',
        'Try generating a new API key at ai.google.dev'
      ],
      rate_limit: [
        'Wait 60 seconds before trying again',
        'Reduce batch size in settings',
        'Consider upgrading your API plan',
        'Process bookmarks in smaller groups'
      ],
      permission: [
        'Check Chrome extension permissions',
        'Reload the extension at chrome://extensions',
        'Grant any requested permissions',
        'Restart Chrome if needed'
      ],
      not_found: [
        'Refresh the bookmark list',
        'Check if the item still exists',
        'Try reloading the extension',
        'Create a new item if needed'
      ],
      invalid_data: [
        'Check bookmark data for corruption',
        'Try processing fewer items at once',
        'Review recent changes',
        'Contact support with error details'
      ],
      timeout: [
        'Reduce batch size in settings',
        'Process fewer bookmarks at once',
        'Check your internet speed',
        'Try again during off-peak hours'
      ],
      server_error: [
        'Wait a few minutes and try again',
        'Check API service status',
        'Try using a different API provider',
        'Contact support if issue continues'
      ],
      unknown: [
        'Try the operation again',
        'Reload the extension',
        'Check browser console for details',
        'Contact support if issue continues'
      ]
    };

    return steps[this.errorType] || steps.unknown;
  }

  toJSON() {
    return {
      message: this.message,
      userMessage: this.userMessage,
      errorType: this.errorType,
      recoverySteps: this.recoverySteps,
      context: this.context,
      timestamp: this.timestamp,
      originalError: this.originalError ? {
        message: this.originalError.message,
        name: this.originalError.name,
        stack: this.originalError.stack
      } : null
    };
  }

  toString() {
    return `[${this.errorType}] ${this.userMessage}\nContext: ${JSON.stringify(this.context)}\nSteps: ${this.recoverySteps.join(', ')}`;
  }
}

/**
 * API Request Wrapper with context and error handling
 * Provides graceful degradation for API failures
 */
class APIRequestHandler {
  constructor(errorAggregator) {
    this.errorAggregator = errorAggregator || new ErrorAggregator();
    this.retryConfig = {
      maxRetries: 3,
      baseDelay: 1000,
      maxDelay: 30000,
      jitterFactor: 0.3
    };
  }

  async fetchWithContext(url, options, context) {
    const requestContext = {
      ...context,
      url,
      method: options.method || 'GET',
      timestamp: Date.now()
    };

    let lastError = null;

    for (let attempt = 0; attempt <= this.retryConfig.maxRetries; attempt++) {
      try {
        const response = await fetch(url, options);

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        return response;
      } catch (error) {
        lastError = error;
        console.warn(`Request attempt ${attempt + 1} failed:`, error.message);

        if (attempt < this.retryConfig.maxRetries && this._shouldRetry(error)) {
          const delay = this._calculateRetryDelay(attempt + 1);
          console.log(`Retrying in ${Math.round(delay)}ms...`);
          await this._delay(delay);
        } else {
          break;
        }
      }
    }

    // All retries exhausted
    const contextError = new ContextError(
      'Request failed after retries',
      requestContext,
      lastError
    );

    const errorKey = `fetch_${url}_${lastError.message}`;
    if (this.errorAggregator.add(errorKey, contextError, requestContext)) {
      console.error('User-friendly error:', contextError.userMessage);
      console.error('Recovery steps:', contextError.recoverySteps);
    }

    throw contextError;
  }

  _shouldRetry(error) {
    const retryableErrors = [
      'rate limit',
      'timeout',
      'network',
      '429',
      '500',
      '502',
      '503',
      '504',
      'econnreset',
      'etimedout',
      'failed to fetch'
    ];

    const errorMessage = error.message?.toLowerCase() || '';
    return retryableErrors.some(pattern => errorMessage.includes(pattern));
  }

  _calculateRetryDelay(retryCount) {
    const exponentialDelay = Math.min(
      this.retryConfig.baseDelay * Math.pow(2, retryCount - 1),
      this.retryConfig.maxDelay
    );

    const jitter = exponentialDelay * this.retryConfig.jitterFactor * (Math.random() * 2 - 1);

    return Math.max(0, exponentialDelay + jitter);
  }

  _delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Export for use in other modules
if (typeof window !== 'undefined') {
  window.ErrorAggregator = ErrorAggregator;
  window.ContextError = ContextError;
  window.APIRequestHandler = APIRequestHandler;
}

// For service worker context (global scope)
if (typeof self !== 'undefined' && typeof window === 'undefined') {
  self.ErrorAggregator = ErrorAggregator;
  self.ContextError = ContextError;
  self.APIRequestHandler = APIRequestHandler;
}
