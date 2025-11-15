/**
 * BookmarkMind - Bookmark Service
 * Handles all Chrome Bookmarks API interactions
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
      return false; // Don't notify
    }

    this.errors.set(errorKey, {
      error,
      context,
      count: 1,
      firstOccurrence: now,
      lastOccurrence: now,
      contexts: [context]
    });
    return true; // Notify
  }

  getSummary() {
    return Array.from(this.errors.values()).map(e => ({
      message: e.error.message,
      count: e.count,
      contexts: e.contexts
    }));
  }

  clear() {
    this.errors.clear();
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
    this.userMessage = this._generateUserMessage();
    this.recoverySteps = this._generateRecoverySteps();
  }

  _generateUserMessage() {
    const { operation } = this.context;
    const errorType = this._categorizeError();

    const messages = {
      network: `Network issue while ${operation}. Please check your internet connection.`,
      api_key: `API key issue while ${operation}. Please verify your API key in settings.`,
      rate_limit: `Rate limit reached while ${operation}. Please wait a moment and try again.`,
      permission: `Permission denied while ${operation}. Please check extension permissions.`,
      not_found: `Resource not found while ${operation}. The item may have been deleted.`,
      invalid_data: `Invalid data encountered while ${operation}. Please try again.`,
      timeout: `Operation timed out while ${operation}. Please try again with smaller batches.`,
      unknown: `An error occurred while ${operation}. Please try again.`
    };

    return messages[errorType] || messages.unknown;
  }

  _generateRecoverySteps() {
    const errorType = this._categorizeError();

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
      unknown: [
        'Try the operation again',
        'Reload the extension',
        'Check browser console for details',
        'Contact support if issue continues'
      ]
    };

    return steps[errorType] || steps.unknown;
  }

  _categorizeError() {
    const message = (this.message || '').toLowerCase();
    const originalMessage = (this.originalError?.message || '').toLowerCase();
    const combinedMessage = `${message} ${originalMessage}`;

    if (combinedMessage.includes('network') || combinedMessage.includes('fetch') || 
        combinedMessage.includes('connection') || combinedMessage.includes('econnreset')) {
      return 'network';
    }
    if (combinedMessage.includes('api key') || combinedMessage.includes('unauthorized') || 
        combinedMessage.includes('authentication') || combinedMessage.includes('invalid_api_key')) {
      return 'api_key';
    }
    if (combinedMessage.includes('rate limit') || combinedMessage.includes('429') || 
        combinedMessage.includes('quota') || combinedMessage.includes('resource_exhausted')) {
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
        combinedMessage.includes('parse') || combinedMessage.includes('400')) {
      return 'invalid_data';
    }
    if (combinedMessage.includes('timeout') || combinedMessage.includes('timed out') || 
        combinedMessage.includes('etimedout')) {
      return 'timeout';
    }

    return 'unknown';
  }

  toJSON() {
    return {
      message: this.message,
      userMessage: this.userMessage,
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
}

class BookmarkService {
  constructor() {
    this.bookmarkTree = null;
    this.errorAggregator = new ErrorAggregator();
  }

  /**
   * Get all bookmarks from Chrome
   * @returns {Promise<Array>} Array of bookmark objects
   */
  async getAllBookmarks() {
    const context = {
      operation: 'retrieving bookmarks',
      method: 'getAllBookmarks',
      timestamp: Date.now()
    };

    try {
      // Check if Chrome APIs are available
      if (typeof chrome === 'undefined' || !chrome.bookmarks) {
        throw new ContextError(
          'Chrome bookmarks API not available',
          { ...context, issue: 'API unavailable' },
          new Error('Extension context not available')
        );
      }

      console.log('Accessing Chrome bookmarks API...');
      const tree = await chrome.bookmarks.getTree();

      if (!tree || !tree[0]) {
        throw new ContextError(
          'Invalid bookmark tree structure received',
          { ...context, issue: 'Invalid tree structure' },
          new Error('Empty or malformed tree')
        );
      }

      this.bookmarkTree = tree;

      const bookmarks = [];
      this._extractBookmarks(tree[0], bookmarks, '');

      console.log(`Found ${bookmarks.length} bookmarks`);
      console.log('Bookmark distribution by folder:', {
        bookmarksBar: bookmarks.filter(b => b.parentId === '1').length,
        otherBookmarks: bookmarks.filter(b => b.parentId === '2').length,
        mobileBookmarks: bookmarks.filter(b => b.parentId === '3').length,
        other: bookmarks.filter(b => !['1', '2', '3'].includes(b.parentId)).length
      });

      return bookmarks;
    } catch (error) {
      if (error instanceof ContextError) {
        throw error;
      }

      const contextError = new ContextError(
        'Failed to retrieve bookmarks',
        { ...context, error: error.message },
        error
      );

      console.error('Error getting bookmarks:', contextError.toJSON());

      const errorKey = `getAllBookmarks_${error.message}`;
      if (this.errorAggregator.add(errorKey, contextError, context)) {
        console.error('User-friendly error:', contextError.userMessage);
        console.error('Recovery steps:', contextError.recoverySteps);
      }

      throw contextError;
    }
  }

  /**
   * Recursively extract bookmarks from tree structure
   * @param {Object} node - Bookmark tree node
   * @param {Array} bookmarks - Array to collect bookmarks
   * @param {string} currentPath - Current folder path
   */
  _extractBookmarks(node, bookmarks, currentPath = '') {
    if (node.url) {
      // This is a bookmark (has URL)
      bookmarks.push({
        id: node.id,
        title: node.title || 'Untitled',
        url: node.url,
        parentId: node.parentId,
        index: node.index,
        dateAdded: node.dateAdded,
        currentFolder: currentPath || 'Root',
        currentFolderName: this._getFolderName(node.parentId)
      });
    }

    // Recursively process children
    if (node.children) {
      const nodePath = currentPath ? `${currentPath}/${node.title}` : node.title;
      node.children.forEach(child => {
        this._extractBookmarks(child, bookmarks, nodePath);
      });
    }
  }

  /**
   * Get folder name by ID
   * @param {string} folderId - Folder ID
   * @returns {string} Folder name
   */
  _getFolderName(folderId) {
    const folderNames = {
      '0': 'Root',
      '1': 'Bookmarks Bar',
      '2': 'Other Bookmarks',
      '3': 'Mobile Bookmarks'
    };
    return folderNames[folderId] || 'Custom Folder';
  }

  /**
   * Create a new folder
   * @param {string} title - Folder name
   * @param {string} parentId - Parent folder ID (optional)
   * @returns {Promise<Object>} Created folder object
   */
  async createFolder(title, parentId = '1') {
    const context = {
      operation: 'creating folder',
      method: 'createFolder',
      folderName: title,
      parentId,
      timestamp: Date.now()
    };

    try {
      const folder = await chrome.bookmarks.create({
        parentId: parentId,
        title: title
      });
      console.log(`Created folder: ${title}`);
      return folder;
    } catch (error) {
      const contextError = new ContextError(
        `Failed to create folder: ${title}`,
        { ...context, error: error.message },
        error
      );

      console.error('Error creating folder:', contextError.toJSON());

      const errorKey = `createFolder_${title}_${error.message}`;
      if (this.errorAggregator.add(errorKey, contextError, context)) {
        console.error('User-friendly error:', contextError.userMessage);
        console.error('Recovery steps:', contextError.recoverySteps);
      }

      throw contextError;
    }
  }

  /**
   * Move bookmark to a folder
   * @param {string} bookmarkId - Bookmark ID
   * @param {string} parentId - Target folder ID
   * @param {number} index - Position in folder (optional)
   * @returns {Promise<Object>} Moved bookmark object
   */
  async moveBookmark(bookmarkId, parentId, index) {
    const context = {
      operation: 'moving bookmark',
      method: 'moveBookmark',
      bookmarkId,
      targetParentId: parentId,
      index,
      timestamp: Date.now()
    };

    try {
      // Get bookmark details before moving
      const bookmarkBefore = await chrome.bookmarks.get(bookmarkId);
      
      if (!bookmarkBefore || !bookmarkBefore[0]) {
        throw new ContextError(
          `Bookmark not found: ${bookmarkId}`,
          { ...context, issue: 'Bookmark does not exist' },
          new Error('Bookmark not found')
        );
      }

      const originalParentId = bookmarkBefore[0].parentId;
      context.bookmarkTitle = bookmarkBefore[0].title;
      context.originalParentId = originalParentId;

      // Get folder names for detailed logging
      let originalFolderName = 'Unknown';
      let targetFolderName = 'Unknown';

      try {
        if (originalParentId) {
          const originalParent = await chrome.bookmarks.get(originalParentId);
          originalFolderName = originalParent[0].title;
        }
      } catch (e) {
        originalFolderName = `ID:${originalParentId}`;
      }

      try {
        const targetParent = await chrome.bookmarks.get(parentId);
        targetFolderName = targetParent[0].title;
      } catch (e) {
        targetFolderName = `ID:${parentId}`;
      }

      context.originalFolderName = originalFolderName;
      context.targetFolderName = targetFolderName;

      const moveDetails = { parentId };
      if (index !== undefined) {
        moveDetails.index = index;
      }

      console.log(`🔄 Moving "${bookmarkBefore[0].title}" from "${originalFolderName}" to "${targetFolderName}"`);

      // Mark bookmark with AI metadata if this is called during AI categorization
      try {
        const metadataKey = `ai_moved_${bookmarkId}`;
        await chrome.storage.local.set({ [metadataKey]: Date.now() });
      } catch (metadataError) {
        console.warn('Failed to set AI metadata:', metadataError);
      }

      const bookmark = await chrome.bookmarks.move(bookmarkId, moveDetails);

      console.log(`✅ Move completed: "${bookmark.title}" is now in "${targetFolderName}"`);

      return bookmark;
    } catch (error) {
      if (error instanceof ContextError) {
        throw error;
      }

      const contextError = new ContextError(
        `Failed to move bookmark ${bookmarkId}`,
        { ...context, error: error.message },
        error
      );

      console.error('Error moving bookmark:', contextError.toJSON());

      const errorKey = `moveBookmark_${bookmarkId}_${error.message}`;
      if (this.errorAggregator.add(errorKey, contextError, context)) {
        console.error('User-friendly error:', contextError.userMessage);
        console.error('Recovery steps:', contextError.recoverySteps);
      }

      throw contextError;
    }
  }

  /**
   * Find or create a folder by hierarchical path (e.g., "Work > Development > Frontend")
   * @param {string} path - Folder path separated by " > " or "/"
   * @param {string} rootParentId - Root parent ID (default: bookmarks bar)
   * @returns {Promise<string>} Folder ID
   */
  async findOrCreateFolderByPath(path, rootParentId = '1') {
    const context = {
      operation: 'finding or creating folder path',
      method: 'findOrCreateFolderByPath',
      path,
      rootParentId,
      timestamp: Date.now()
    };

    try {
      // Support both " > " (new format) and "/" (legacy format) separators
      const separator = path.includes(' > ') ? ' > ' : '/';
      const parts = path.split(separator).filter(part => part.trim());
      
      if (parts.length === 0) {
        throw new ContextError(
          'Invalid folder path: empty path provided',
          { ...context, issue: 'Empty path' },
          new Error('Empty folder path')
        );
      }

      let currentParentId = rootParentId;

      console.log(`Creating hierarchical folder path: ${path} (${parts.length} levels)`);
      console.log(`Folder hierarchy: ${parts.join(' → ')}`);

      let currentPath = '';
      const createdFolders = [];
      const errors = [];

      for (let i = 0; i < parts.length; i++) {
        const part = parts[i].trim();
        currentPath += (i === 0 ? '' : ' > ') + part;

        try {
          const existingFolder = await this._findFolderByName(part, currentParentId);

          if (existingFolder) {
            console.log(`✓ Found existing folder: ${part} (${existingFolder.id})`);
            currentParentId = existingFolder.id;
          } else {
            console.log(`+ Creating new folder: ${part} in parent ${currentParentId}`);
            const newFolder = await this.createFolder(part, currentParentId);
            currentParentId = newFolder.id;
            createdFolders.push(part);
            console.log(`✓ Created folder: ${part} (${newFolder.id})`);
          }
        } catch (error) {
          // Graceful degradation: try to continue with remaining folders
          console.warn(`Failed to process folder level "${part}":`, error);
          errors.push({ level: part, error: error.message });
          
          // If we can't continue, throw
          if (i === 0 || !currentParentId) {
            throw error;
          }
        }
      }

      console.log(`✅ Hierarchical path complete: ${path} → ${currentParentId}`);
      
      if (errors.length > 0) {
        console.warn(`Created path with ${errors.length} errors:`, errors);
      }

      return currentParentId;
    } catch (error) {
      if (error instanceof ContextError) {
        throw error;
      }

      const contextError = new ContextError(
        `Failed to create folder path: ${path}`,
        { ...context, error: error.message },
        error
      );

      console.error('Error creating folder path:', contextError.toJSON());

      const errorKey = `findOrCreateFolderByPath_${path}_${error.message}`;
      if (this.errorAggregator.add(errorKey, contextError, context)) {
        console.error('User-friendly error:', contextError.userMessage);
        console.error('Recovery steps:', contextError.recoverySteps);
      }

      throw contextError;
    }
  }

  /**
   * Find folder by name within a parent
   * @param {string} name - Folder name
   * @param {string} parentId - Parent folder ID
   * @returns {Promise<Object|null>} Folder object or null
   */
  async _findFolderByName(name, parentId) {
    try {
      const children = await chrome.bookmarks.getChildren(parentId);
      return children.find(child => !child.url && child.title === name) || null;
    } catch (error) {
      console.error('Error finding folder:', error);
      return null;
    }
  }

  /**
   * Get bookmark statistics
   * @returns {Promise<Object>} Statistics object
   */
  async getBookmarkStats() {
    try {
      const bookmarks = await this.getAllBookmarks();
      const folders = await this._getAllFolders();

      // Count uncategorized bookmarks (those in main folders, not subfolders)
      const uncategorized = bookmarks.filter(b => {
        // Include bookmarks directly in main folders (Bookmarks Bar, Other Bookmarks, Mobile Bookmarks)
        return ['1', '2', '3'].includes(b.parentId);
      }).length;

      console.log('Stats calculation:', {
        totalBookmarks: bookmarks.length,
        totalFolders: folders.length,
        uncategorized: uncategorized,
        bookmarksByParent: {
          '1': bookmarks.filter(b => b.parentId === '1').length,
          '2': bookmarks.filter(b => b.parentId === '2').length,
          '3': bookmarks.filter(b => b.parentId === '3').length,
          'other': bookmarks.filter(b => !['1', '2', '3'].includes(b.parentId)).length
        }
      });

      return {
        totalBookmarks: bookmarks.length,
        totalFolders: folders.length,
        uncategorized: uncategorized
      };
    } catch (error) {
      console.error('Error getting stats:', error);
      return { totalBookmarks: 0, totalFolders: 0, uncategorized: 0 };
    }
  }

  /**
   * Get all folders
   * @returns {Promise<Array>} Array of folder objects
   */
  async _getAllFolders() {
    try {
      const tree = await chrome.bookmarks.getTree();
      const folders = [];
      this._extractFolders(tree[0], folders);
      return folders;
    } catch (error) {
      console.error('Error getting folders:', error);
      return [];
    }
  }

  /**
   * Recursively extract folders from tree
   * @param {Object} node - Tree node
   * @param {Array} folders - Array to collect folders
   */
  _extractFolders(node, folders) {
    if (!node.url && node.id !== '0') {
      // This is a folder (no URL and not root)
      folders.push({
        id: node.id,
        title: node.title,
        parentId: node.parentId
      });
    }

    if (node.children) {
      node.children.forEach(child => {
        this._extractFolders(child, folders);
      });
    }
  }
}

// Export for use in other modules
if (typeof window !== 'undefined') {
  window.BookmarkService = BookmarkService;
}

// For service worker context (global scope)
if (typeof self !== 'undefined' && typeof window === 'undefined') {
  self.BookmarkService = BookmarkService;
}
