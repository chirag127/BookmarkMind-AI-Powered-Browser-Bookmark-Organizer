# Error Handling & Recovery Enhancement

## Overview

This document describes the comprehensive error handling and recovery system implemented across BookmarkMind. The system includes context-aware error wrapping, graceful degradation for API failures, user-friendly error messages, and error aggregation to prevent duplicate notifications.

## Architecture

### Core Components

1. **ErrorAggregator** (`scripts/errorHandler.js`)
   - Prevents duplicate error notifications
   - Tracks error frequency and context
   - Provides error summaries

2. **ContextError** (`scripts/errorHandler.js`)
   - Wraps errors with operation context
   - Categorizes errors for better handling
   - Generates user-friendly messages
   - Provides actionable recovery steps

3. **APIRequestHandler** (`scripts/errorHandler.js`)
   - Wraps API requests with retry logic
   - Provides graceful degradation
   - Integrates with error aggregation

## Features

### 1. Context-Aware Error Wrapping

Every error is wrapped with rich context information:

```javascript
const context = {
  operation: 'moving bookmark',
  method: 'moveBookmark',
  bookmarkId: '123',
  targetParentId: '456',
  timestamp: Date.now()
};

throw new ContextError('Failed to move bookmark', context, originalError);
```

**Benefits:**
- Understand exactly what operation failed
- Track error patterns across the application
- Provide detailed logs for debugging
- Generate context-specific recovery steps

### 2. Error Categorization

Errors are automatically categorized into types:

- **network** - Connection issues
- **api_key** - Authentication failures
- **rate_limit** - API quota exceeded
- **permission** - Access denied
- **not_found** - Resource missing
- **invalid_data** - Malformed data
- **timeout** - Operation timeout
- **server_error** - Service unavailable
- **unknown** - Other errors

**Example categorization logic:**
```javascript
if (message.includes('network') || message.includes('fetch')) {
  return 'network';
}
if (message.includes('api key') || message.includes('unauthorized')) {
  return 'api_key';
}
```

### 3. User-Friendly Error Messages

Each error type has a user-friendly message:

```javascript
{
  network: "Network issue while ${operation}. Please check your internet connection.",
  api_key: "API key issue while ${operation}. Please verify your API key in settings.",
  rate_limit: "Rate limit reached while ${operation}. Please wait a moment and try again.",
  // ... more messages
}
```

**Example output:**
```
User-friendly error: Network issue while moving bookmark. Please check your internet connection.
```

### 4. Actionable Recovery Steps

Each error type provides specific recovery steps:

```javascript
{
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
  // ... more recovery steps
}
```

### 5. Error Aggregation

Prevents duplicate error notifications within a time window:

```javascript
// ErrorAggregator prevents showing the same error multiple times
const errorKey = `moveBookmark_${bookmarkId}_${error.message}`;
if (this.errorAggregator.add(errorKey, contextError, context)) {
  // First occurrence - show to user
  console.error('User-friendly error:', contextError.userMessage);
  console.error('Recovery steps:', contextError.recoverySteps);
}
```

**Features:**
- 60-second deduplication window
- Tracks error frequency
- Provides error summaries
- Automatic cleanup of old errors

### 6. Graceful Degradation

API failures don't break the entire operation:

```javascript
// In findOrCreateFolderByPath
try {
  // Try to create folder level
} catch (error) {
  // Log warning but continue with next level
  console.warn(`Failed to process folder level "${part}":`, error);
  errors.push({ level: part, error: error.message });
  
  // Only throw if we can't continue
  if (i === 0 || !currentParentId) {
    throw error;
  }
}
```

**Benefits:**
- Partial success is better than total failure
- Users can retry specific operations
- System remains functional during degraded state

## Implementation Details

### BookmarkService Enhancements

All BookmarkService methods now use context-aware error handling:

```javascript
async getAllBookmarks() {
  const context = {
    operation: 'retrieving bookmarks',
    method: 'getAllBookmarks',
    timestamp: Date.now()
  };

  try {
    // ... operation
  } catch (error) {
    const contextError = new ContextError(
      'Failed to retrieve bookmarks',
      { ...context, error: error.message },
      error
    );

    const errorKey = `getAllBookmarks_${error.message}`;
    if (this.errorAggregator.add(errorKey, contextError, context)) {
      console.error('User-friendly error:', contextError.userMessage);
      console.error('Recovery steps:', contextError.recoverySteps);
    }

    throw contextError;
  }
}
```

**Enhanced methods:**
- `getAllBookmarks()` - Bookmark retrieval
- `createFolder()` - Folder creation
- `moveBookmark()` - Bookmark movement
- `findOrCreateFolderByPath()` - Hierarchical folder creation

### Categorizer Enhancements

Categorizer tracks and summarizes errors during batch operations:

```javascript
async categorizeAllBookmarks(progressCallback, forceReorganize = false) {
  try {
    // Clear error aggregator at start
    if (this.errorAggregator) {
      this.errorAggregator.clear();
    }

    // ... categorization logic
    
  } catch (error) {
    // Wrap with context
    const contextError = new ContextError(
      'Categorization failed',
      {
        operation: 'categorizing all bookmarks',
        method: 'categorizeAllBookmarks',
        forceReorganize,
        timestamp: Date.now()
      },
      error
    );

    // Show error summary
    if (this.errorAggregator && this.errorAggregator.getCount() > 0) {
      const summary = this.errorAggregator.getSummary();
      console.error(`Encountered ${summary.length} unique errors:`, summary);
    }

    throw contextError;
  }
}
```

### AIProcessor Enhancements

API errors now provide better context and recovery information:

```javascript
if (response.status === 401) {
  const contextError = new ContextError(
    "Invalid API key for category generation",
    {
      operation: 'generating categories with Gemini',
      model: currentModel,
      status: response.status,
      attempt: attempt + 1
    },
    new Error(errorText)
  );

  if (contextError.userMessage) {
    console.error('User-friendly error:', contextError.userMessage);
    console.error('Recovery steps:', contextError.recoverySteps);
  }

  throw contextError;
}
```

## Usage Examples

### Example 1: Handling Network Errors

```javascript
try {
  await bookmarkService.moveBookmark(bookmarkId, folderId);
} catch (error) {
  if (error instanceof ContextError) {
    // Error is already wrapped with context
    console.log(error.userMessage);  // "Network issue while moving bookmark..."
    console.log(error.recoverySteps);  // ['Check your internet connection', ...]
    
    // Show to user
    showNotification(error.userMessage, error.recoverySteps[0]);
  }
}
```

### Example 2: Error Summary After Batch Operation

```javascript
const categorizer = new Categorizer();
try {
  await categorizer.categorizeAllBookmarks(progressCallback);
} catch (error) {
  if (categorizer.errorAggregator) {
    const summary = categorizer.errorAggregator.getSummary();
    console.log(`${summary.length} unique errors occurred`);
    summary.forEach(e => {
      console.log(`${e.message} (${e.count} times)`);
      console.log(`First: ${new Date(e.firstOccurrence)}`);
      console.log(`Last: ${new Date(e.lastOccurrence)}`);
    });
  }
}
```

### Example 3: API Request with Retry

```javascript
const handler = new APIRequestHandler(errorAggregator);
try {
  const response = await handler.fetchWithContext(
    url,
    { method: 'POST', body: data },
    { operation: 'calling Gemini API', model: 'gemini-2.5-flash' }
  );
} catch (error) {
  // Automatically retried with exponential backoff
  // Error includes full context and recovery steps
  console.error(error.userMessage);
}
```

## Error Flow Diagram

```
┌─────────────────┐
│  User Action    │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Try Operation  │
└────────┬────────┘
         │
         ▼
      Error?
         │
         ├─ No ──────────────────────┐
         │                           │
         └─ Yes ───────────┐         │
                           ▼         │
              ┌───────────────────┐  │
              │ Wrap with Context │  │
              │  (ContextError)   │  │
              └─────────┬─────────┘  │
                        │            │
                        ▼            │
              ┌───────────────────┐  │
              │   Categorize      │  │
              │  (network, api,   │  │
              │   rate_limit...)  │  │
              └─────────┬─────────┘  │
                        │            │
                        ▼            │
              ┌───────────────────┐  │
              │ Generate Message  │  │
              │  & Recovery Steps │  │
              └─────────┬─────────┘  │
                        │            │
                        ▼            │
              ┌───────────────────┐  │
              │ Error Aggregator  │  │
              │  (check duplicate)│  │
              └─────────┬─────────┘  │
                        │            │
            ┌───────────┴────────┐   │
            │                    │   │
         Duplicate?            First │
            │                    │   │
            ▼                    ▼   │
    ┌──────────────┐    ┌───────────────┐
    │ Increment    │    │ Show to User  │
    │ Counter Only │    │ (log, notify) │
    └──────────────┘    └───────┬───────┘
                                │
                                ▼
                    ┌──────────────────────┐
                    │  Return to User      │
                    │  (with context info) │
                    └──────────────────────┘
```

## Testing

The error handling system includes comprehensive test coverage:

### Unit Tests
- Error categorization accuracy
- Message generation
- Recovery steps generation
- Aggregation deduplication
- Context wrapping

### Integration Tests
- End-to-end error flows
- Multi-operation error tracking
- Error recovery scenarios

### Example Test

```javascript
test('should provide user-friendly error for API key issues', () => {
  const error = new ContextError(
    'API authentication failed',
    { operation: 'calling Gemini API' },
    new Error('401 Unauthorized')
  );

  expect(error.errorType).toBe('api_key');
  expect(error.userMessage).toContain('API key issue');
  expect(error.recoverySteps).toContain('Verify your Gemini API key is correct');
});
```

## Best Practices

### For Developers

1. **Always use context-aware wrapping for errors:**
   ```javascript
   try {
     // operation
   } catch (error) {
     throw new ContextError('Operation failed', context, error);
   }
   ```

2. **Provide rich context:**
   ```javascript
   const context = {
     operation: 'descriptive operation name',
     method: 'methodName',
     ...relevantData,
     timestamp: Date.now()
   };
   ```

3. **Use error aggregation for batch operations:**
   ```javascript
   if (this.errorAggregator.add(errorKey, error, context)) {
     // First time - show to user
   }
   ```

4. **Implement graceful degradation:**
   ```javascript
   try {
     // Try operation
   } catch (error) {
     // Log and continue if possible
     if (canContinue) {
       console.warn('Continuing despite error:', error);
       // Continue
     } else {
       throw error;
     }
   }
   ```

### For Users

When an error occurs:
1. Read the user-friendly message
2. Follow the recovery steps in order
3. Check browser console for detailed logs
4. Contact support if issue persists

## Performance Considerations

- Error aggregation cleanup runs every 30 seconds
- 60-second deduplication window balances memory and UX
- Context wrapping has negligible performance impact
- Error logging is asynchronous where possible

## Future Enhancements

Potential improvements:
- [ ] Error reporting to remote service
- [ ] Automatic error recovery for common issues
- [ ] ML-based error prediction
- [ ] User-customizable error messages
- [ ] Error analytics dashboard

## Troubleshooting

### Common Issues

**Error aggregator not preventing duplicates:**
- Check errorKey uniqueness
- Verify aggregator is initialized
- Check time window configuration

**Recovery steps not showing:**
- Verify error categorization is working
- Check console for detailed logs
- Ensure ContextError is being used

**Too many error notifications:**
- Increase deduplication window
- Adjust errorKey generation
- Review error handling flow

## References

- `scripts/errorHandler.js` - Core error handling classes
- `scripts/bookmarkService.js` - BookmarkService error handling
- `scripts/categorizer.js` - Categorizer error handling
- `scripts/aiProcessor.js` - AIProcessor error handling
- `tests/` - Comprehensive test suite

## Support

For questions or issues with error handling:
1. Check browser console logs
2. Review this documentation
3. Check existing GitHub issues
4. Create new issue with error details
