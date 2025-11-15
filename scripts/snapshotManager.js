/**
 * BookmarkMind - Snapshot Manager
 * Handles versioned snapshots of bookmark state for undo/rollback functionality
 */

const snapshotmanagerLogger = typeof Logger !== 'undefined' ? Logger.create('SnapshotManager') : null;
class SnapshotManager {
  constructor() {
    this.maxSnapshots = 10;
    this.storageKey = 'bookmarkMindSnapshots';
    this.QUOTA_BYTES_LIMIT = 10485760; // 10MB chrome.storage.local limit
    this.SAFE_THRESHOLD = 0.8; // Use only 80% of quota for safety
  }

  /**
   * Validate snapshot data structure
   * @private
   */
  _validateSnapshotStructure(snapshot) {
    const errors = [];

    if (!snapshot || typeof snapshot !== 'object') {
      errors.push('Snapshot is not an object');
      return { valid: false, errors };
    }

    if (!snapshot.id || typeof snapshot.id !== 'string') {
      errors.push('Invalid or missing snapshot ID');
    }

    if (!snapshot.timestamp || typeof snapshot.timestamp !== 'number') {
      errors.push('Invalid or missing timestamp');
    }

    if (!snapshot.description || typeof snapshot.description !== 'string') {
      errors.push('Invalid or missing description');
    }

    if (!snapshot.bookmarkTree || typeof snapshot.bookmarkTree !== 'object') {
      errors.push('Invalid or missing bookmark tree');
    } else {
      if (!this._validateBookmarkNode(snapshot.bookmarkTree)) {
        errors.push('Invalid bookmark tree structure');
      }
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * Validate bookmark node structure recursively
   * @private
   */
  _validateBookmarkNode(node) {
    if (!node || typeof node !== 'object') return false;

    if (!node.id || typeof node.id !== 'string') return false;

    if (node.url !== undefined && typeof node.url !== 'string') return false;

    if (node.children && Array.isArray(node.children)) {
      for (const child of node.children) {
        if (!this._validateBookmarkNode(child)) return false;
      }
    }

    return true;
  }

  /**
   * Get detailed storage state for diagnostics
   * @private
   */
  async _getStorageState() {
    try {
      const allData = await chrome.storage.local.get(null);
      const allKeys = Object.keys(allData);

      let totalSize = 0;
      const keyDetails = {};

      for (const key of allKeys) {
        const serialized = JSON.stringify(allData[key]);
        const size = new Blob([serialized]).size;
        totalSize += size;
        keyDetails[key] = {
          size,
          sizeMB: (size / (1024 * 1024)).toFixed(4),
          type: Array.isArray(allData[key]) ? 'array' : typeof allData[key],
          itemCount: Array.isArray(allData[key]) ? allData[key].length : 'N/A'
        };
      }

      return {
        totalSize,
        totalSizeMB: (totalSize / (1024 * 1024)).toFixed(4),
        usagePercent: ((totalSize / this.QUOTA_BYTES_LIMIT) * 100).toFixed(2),
        quotaRemaining: this.QUOTA_BYTES_LIMIT - totalSize,
        quotaRemainingMB: ((this.QUOTA_BYTES_LIMIT - totalSize) / (1024 * 1024)).toFixed(4),
        keys: allKeys,
        keyDetails
      };
    } catch (error) {
      if (snapshotmanagerLogger) snapshotmanagerLogger.error('Failed to get storage state:', error);
      return null;
    }
  }

  /**
   * Log detailed error with stack trace and storage state
   * @private
   */
  async _logDetailedError(context, error, additionalData = {}) {
    const errorDetails = {
      context,
      timestamp: new Date().toISOString(),
      error: {
        message: error.message,
        name: error.name,
        stack: error.stack
      },
      ...additionalData
    };

    const storageState = await this._getStorageState();
    if (storageState) {
      errorDetails.storageState = storageState;
    }

    if (snapshotmanagerLogger) snapshotmanagerLogger.error('🔴 SNAPSHOT ERROR DETAILS:', JSON.stringify(errorDetails, null, 2));

    return errorDetails;
  }

  /**
   * Detect and repair corrupted snapshots
   * @private
   */
  async _detectAndRepairCorruption() {
    try {
      if (snapshotmanagerLogger) snapshotmanagerLogger.info('🔍 Checking for corrupted snapshots...');

      const result = await chrome.storage.local.get([this.storageKey]);
      const snapshots = result[this.storageKey];

      if (!snapshots) {
        if (snapshotmanagerLogger) snapshotmanagerLogger.info('✅ No snapshots to check');
        return { repaired: false, removed: 0 };
      }

      if (!Array.isArray(snapshots)) {
        if (snapshotmanagerLogger) snapshotmanagerLogger.error('🔴 Snapshots data is not an array, resetting...');
        await chrome.storage.local.set({ [this.storageKey]: [] });
        return { repaired: true, removed: 'all', reason: 'not_array' };
      }

      const validSnapshots = [];
      const corruptedSnapshots = [];

      for (let i = 0; i < snapshots.length; i++) {
        const snapshot = snapshots[i];
        const validation = this._validateSnapshotStructure(snapshot);

        if (validation.valid) {
          validSnapshots.push(snapshot);
        } else {
          if (snapshotmanagerLogger) snapshotmanagerLogger.warn(`🔴 Corrupted snapshot at index ${i}:`, {
            id: snapshot?.id || 'unknown',
            errors: validation.errors
          });
          corruptedSnapshots.push({
            index: i,
            id: snapshot?.id || 'unknown',
            errors: validation.errors
          });
        }
      }

      if (corruptedSnapshots.length > 0) {
        if (snapshotmanagerLogger) snapshotmanagerLogger.info(`🔧 Removing ${corruptedSnapshots.length} corrupted snapshots...`);
        await chrome.storage.local.set({ [this.storageKey]: validSnapshots });

        return {
          repaired: true,
          removed: corruptedSnapshots.length,
          validRemaining: validSnapshots.length,
          corruptedSnapshots
        };
      }

      if (snapshotmanagerLogger) snapshotmanagerLogger.info(`✅ All ${snapshots.length} snapshots are valid`);
      return { repaired: false, removed: 0 };

    } catch (error) {
      if (snapshotmanagerLogger) snapshotmanagerLogger.error('Failed to detect/repair corruption:', error);
      await this._logDetailedError('detectAndRepairCorruption', error);

      try {
        if (snapshotmanagerLogger) snapshotmanagerLogger.warn('⚠️ Attempting emergency reset of snapshots storage...');
        await chrome.storage.local.set({ [this.storageKey]: [] });
        return { repaired: true, removed: 'all', reason: 'emergency_reset' };
      } catch (resetError) {
        if (snapshotmanagerLogger) snapshotmanagerLogger.error('Emergency reset failed:', resetError);
        throw resetError;
      }
    }
  }

  /**
   * Create a snapshot of current bookmark state
   * @param {string} description - Description of what operation this snapshot is for
   * @param {Object} metadata - Additional metadata (e.g., operation type, bookmark count)
   * @returns {Promise<Object>} Created snapshot object
   */
  async createSnapshot(description, metadata = {}) {
    try {
      if (snapshotmanagerLogger) snapshotmanagerLogger.info(`📸 Creating snapshot: ${description}`);

      await this._detectAndRepairCorruption();

      const storageState = await this._getStorageState();
      if (snapshotmanagerLogger) snapshotmanagerLogger.info(`📊 Current storage usage: ${storageState.usagePercent}% (${storageState.totalSizeMB}MB / ${(this.QUOTA_BYTES_LIMIT / (1024 * 1024)).toFixed(2)}MB)`);

      const tree = await chrome.bookmarks.getTree();

      const snapshot = {
        id: this._generateSnapshotId(),
        timestamp: Date.now(),
        description: description,
        metadata: {
          ...metadata,
          version: '1.0',
          createdBy: 'BookmarkMind'
        },
        bookmarkTree: tree[0]
      };

      const validation = this._validateSnapshotStructure(snapshot);
      if (!validation.valid) {
        throw new Error(`Invalid snapshot structure: ${validation.errors.join(', ')}`);
      }

      const snapshotSize = new Blob([JSON.stringify(snapshot)]).size;
      const snapshotSizeMB = (snapshotSize / (1024 * 1024)).toFixed(4);
      if (snapshotmanagerLogger) snapshotmanagerLogger.info(`📦 Snapshot size: ${snapshotSizeMB}MB`);

      if (snapshotSize > this.QUOTA_BYTES_LIMIT * this.SAFE_THRESHOLD) {
        if (snapshotmanagerLogger) snapshotmanagerLogger.warn(`⚠️ Snapshot size (${snapshotSizeMB}MB) exceeds safe threshold, may cause storage issues`);
      }

      await this._saveSnapshot(snapshot);

      if (snapshotmanagerLogger) snapshotmanagerLogger.info(`✅ Snapshot created: ${snapshot.id}`);
      return snapshot;
    } catch (error) {
      await this._logDetailedError('createSnapshot', error, { description, metadata });
      throw new Error(`Failed to create snapshot: ${error.message}`);
    }
  }

  /**
   * Get all available snapshots with corruption checking
   * @returns {Promise<Array>} Array of snapshot metadata (without full tree data)
   */
  async getSnapshots() {
    try {
      await this._detectAndRepairCorruption();

      const result = await chrome.storage.local.get([this.storageKey]);
      const snapshots = result[this.storageKey];

      if (!snapshots) {
        if (snapshotmanagerLogger) snapshotmanagerLogger.info('📭 No snapshots found');
        return [];
      }

      if (!Array.isArray(snapshots)) {
        if (snapshotmanagerLogger) snapshotmanagerLogger.error('🔴 Snapshots data is corrupted (not an array)');
        await this._logDetailedError('getSnapshots', new Error('Snapshots data is not an array'), {
          snapshotsType: typeof snapshots,
          snapshotsValue: JSON.stringify(snapshots).substring(0, 500)
        });
        await chrome.storage.local.set({ [this.storageKey]: [] });
        return [];
      }

      const validSnapshots = snapshots
        .filter(snapshot => {
          const validation = this._validateSnapshotStructure(snapshot);
          if (!validation.valid) {
            if (snapshotmanagerLogger) snapshotmanagerLogger.warn('⚠️ Filtering out invalid snapshot:', snapshot?.id, validation.errors);
            return false;
          }
          return true;
        })
        .map(snapshot => ({
          id: snapshot.id,
          timestamp: snapshot.timestamp,
          description: snapshot.description,
          metadata: snapshot.metadata
        }));

      if (validSnapshots.length !== snapshots.length) {
        if (snapshotmanagerLogger) snapshotmanagerLogger.warn(`⚠️ Filtered ${snapshots.length - validSnapshots.length} invalid snapshots`);
      }

      if (snapshotmanagerLogger) snapshotmanagerLogger.info(`📦 Loaded ${validSnapshots.length} valid snapshots`);
      return validSnapshots;

    } catch (error) {
      await this._logDetailedError('getSnapshots', error);
      if (snapshotmanagerLogger) snapshotmanagerLogger.error('🔴 Critical error getting snapshots, returning empty array for graceful degradation');
      return [];
    }
  }

  /**
   * Get a specific snapshot by ID with validation
   * @param {string} snapshotId - Snapshot ID
   * @returns {Promise<Object|null>} Snapshot object or null if not found
   */
  async getSnapshot(snapshotId) {
    try {
      if (!snapshotId || typeof snapshotId !== 'string') {
        throw new Error('Invalid snapshot ID');
      }

      await this._detectAndRepairCorruption();

      const result = await chrome.storage.local.get([this.storageKey]);
      const snapshots = result[this.storageKey];

      if (!snapshots || !Array.isArray(snapshots)) {
        if (snapshotmanagerLogger) snapshotmanagerLogger.warn('🔴 No valid snapshots array found');
        return null;
      }

      const snapshot = snapshots.find(s => s.id === snapshotId);

      if (!snapshot) {
        if (snapshotmanagerLogger) snapshotmanagerLogger.warn(`⚠️ Snapshot ${snapshotId} not found`);
        return null;
      }

      const validation = this._validateSnapshotStructure(snapshot);
      if (!validation.valid) {
        if (snapshotmanagerLogger) snapshotmanagerLogger.error(`🔴 Snapshot ${snapshotId} is corrupted:`, validation.errors);
        await this._logDetailedError('getSnapshot', new Error('Snapshot validation failed'), {
          snapshotId,
          validationErrors: validation.errors
        });
        return null;
      }

      if (snapshotmanagerLogger) snapshotmanagerLogger.info(`✅ Loaded snapshot: ${snapshotId}`);
      return snapshot;

    } catch (error) {
      await this._logDetailedError('getSnapshot', error, { snapshotId });
      return null;
    }
  }

  /**
   * Restore bookmarks from a snapshot
   * @param {string} snapshotId - Snapshot ID to restore
   * @param {Function} progressCallback - Progress update callback
   * @returns {Promise<Object>} Restoration results
   */
  async restoreSnapshot(snapshotId, progressCallback) {
    // Initialize counting variables at the start of the function
    const results = {
      foldersCreated: 0,
      foldersDeleted: 0,
      bookmarksRestored: 0,
      bookmarksRemoved: 0,
      errors: []
    };

    try {
      if (snapshotmanagerLogger) snapshotmanagerLogger.info(`🔄 Restoring snapshot: ${snapshotId}`);

      // Notify background script to disable bookmark move listener
      try {
        await chrome.runtime.sendMessage({ action: 'startSnapshotRestore' });
      } catch (error) {
        if (snapshotmanagerLogger) snapshotmanagerLogger.warn('Could not notify background script about snapshot restore start:', error);
      }

      progressCallback?.({ stage: 'loading', progress: 0, message: 'Loading snapshot...' });

      const snapshot = await this.getSnapshot(snapshotId);
      if (!snapshot) {
        throw new Error('Snapshot not found or corrupted');
      }

      progressCallback?.({ stage: 'preparing', progress: 10, message: 'Preparing restoration...' });

      const currentTree = await chrome.bookmarks.getTree();

      progressCallback?.({ stage: 'clearing', progress: 20, message: 'Clearing current bookmarks...' });
      await this._clearCurrentBookmarks(currentTree[0], results, progressCallback);

      progressCallback?.({ stage: 'restoring', progress: 50, message: 'Restoring bookmarks...' });
      await this._restoreBookmarkTree(snapshot.bookmarkTree, results, progressCallback);

      progressCallback?.({ stage: 'complete', progress: 100, message: 'Restoration complete' });

      if (snapshotmanagerLogger) snapshotmanagerLogger.info('✅ Snapshot restored successfully:', results);

      // Notify background script to re-enable bookmark move listener
      try {
        await chrome.runtime.sendMessage({ action: 'endSnapshotRestore' });
      } catch (error) {
        if (snapshotmanagerLogger) snapshotmanagerLogger.warn('Could not notify background script about snapshot restore end:', error);
      }

      return results;
    } catch (error) {
      // Ensure listener is re-enabled even on error
      try {
        await chrome.runtime.sendMessage({ action: 'endSnapshotRestore' });
      } catch (msgError) {
        if (snapshotmanagerLogger) snapshotmanagerLogger.warn('Could not notify background script about snapshot restore end (error case):', msgError);
      }

      await this._logDetailedError('restoreSnapshot', error, { snapshotId });
      throw new Error(`Failed to restore snapshot: ${error.message}`);
    }
  }

  /**
   * Delete a snapshot
   * @param {string} snapshotId - Snapshot ID to delete
   * @returns {Promise<boolean>} Success status
   */
  async deleteSnapshot(snapshotId) {
    try {
      if (!snapshotId || typeof snapshotId !== 'string') {
        throw new Error('Invalid snapshot ID');
      }

      const result = await chrome.storage.local.get([this.storageKey]);
      const snapshots = result[this.storageKey] || [];

      if (!Array.isArray(snapshots)) {
        if (snapshotmanagerLogger) snapshotmanagerLogger.error('🔴 Snapshots data is corrupted');
        await chrome.storage.local.set({ [this.storageKey]: [] });
        return false;
      }

      const filteredSnapshots = snapshots.filter(s => s.id !== snapshotId);

      if (filteredSnapshots.length === snapshots.length) {
        if (snapshotmanagerLogger) snapshotmanagerLogger.warn(`⚠️ Snapshot ${snapshotId} not found`);
        return false;
      }

      await chrome.storage.local.set({
        [this.storageKey]: filteredSnapshots
      });

      if (snapshotmanagerLogger) snapshotmanagerLogger.info(`🗑️ Snapshot deleted: ${snapshotId}`);
      return true;
    } catch (error) {
      await this._logDetailedError('deleteSnapshot', error, { snapshotId });
      return false;
    }
  }

  /**
   * Clear all snapshots
   * @returns {Promise<boolean>} Success status
   */
  async clearAllSnapshots() {
    try {
      await chrome.storage.local.set({
        [this.storageKey]: []
      });

      if (snapshotmanagerLogger) snapshotmanagerLogger.info('🗑️ All snapshots cleared');
      return true;
    } catch (error) {
      await this._logDetailedError('clearAllSnapshots', error);
      return false;
    }
  }

  /**
   * Save snapshot to storage with robust error handling
   * @private
   */
  async _saveSnapshot(snapshot) {
    try {
      const result = await chrome.storage.local.get([this.storageKey]);
      let snapshots = result[this.storageKey] || [];

      if (!Array.isArray(snapshots)) {
        if (snapshotmanagerLogger) snapshotmanagerLogger.warn('🔴 Snapshots data corrupted, resetting...');
        snapshots = [];
      }

      snapshots.push(snapshot);
      snapshots.sort((a, b) => b.timestamp - a.timestamp);

      if (snapshots.length > this.maxSnapshots) {
        if (snapshotmanagerLogger) snapshotmanagerLogger.info(`📦 Removing old snapshots (keeping ${this.maxSnapshots} most recent)`);
        snapshots = snapshots.slice(0, this.maxSnapshots);
      }

      const dataSize = new Blob([JSON.stringify(snapshots)]).size;
      const dataSizeMB = (dataSize / (1024 * 1024)).toFixed(4);

      if (dataSize > this.QUOTA_BYTES_LIMIT) {
        if (snapshotmanagerLogger) snapshotmanagerLogger.warn(`⚠️ Data size (${dataSizeMB}MB) exceeds quota, reducing snapshots...`);
        throw new Error('QUOTA_BYTES quota exceeded');
      }

      await chrome.storage.local.set({
        [this.storageKey]: snapshots
      });

      if (snapshotmanagerLogger) snapshotmanagerLogger.info(`💾 Saved ${snapshots.length} snapshots (${dataSizeMB}MB)`);

    } catch (error) {
      if (error.message && (error.message.includes('QUOTA_BYTES') || error.message.includes('quota'))) {
        if (snapshotmanagerLogger) snapshotmanagerLogger.warn('⚠️ Storage quota exceeded, initiating cleanup...');
        await this._handleQuotaExceeded(snapshot);
      } else {
        await this._logDetailedError('_saveSnapshot', error);
        throw error;
      }
    }
  }

  /**
   * Handle storage quota exceeded with aggressive cleanup
   * @private
   */
  async _handleQuotaExceeded(newSnapshot) {
    try {
      if (snapshotmanagerLogger) snapshotmanagerLogger.info('🧹 Starting quota exceeded recovery...');

      const storageState = await this._getStorageState();
      if (snapshotmanagerLogger) snapshotmanagerLogger.info('Current storage state:', storageState);

      const result = await chrome.storage.local.get([this.storageKey]);
      let snapshots = result[this.storageKey] || [];

      if (!Array.isArray(snapshots)) {
        snapshots = [];
      }

      snapshots.push(newSnapshot);
      snapshots.sort((a, b) => b.timestamp - a.timestamp);

      let savedSuccessfully = false;
      let keepCount = Math.min(snapshots.length - 1, 5);

      while (!savedSuccessfully && keepCount > 0) {
        const trimmedSnapshots = snapshots.slice(0, keepCount);
        const testSize = new Blob([JSON.stringify(trimmedSnapshots)]).size;
        const testSizeMB = (testSize / (1024 * 1024)).toFixed(4);

        if (snapshotmanagerLogger) snapshotmanagerLogger.info(`🔄 Attempting save with ${keepCount} snapshots (${testSizeMB}MB)...`);

        if (testSize > this.QUOTA_BYTES_LIMIT * this.SAFE_THRESHOLD) {
          if (snapshotmanagerLogger) snapshotmanagerLogger.info(`⚠️ ${keepCount} snapshots still too large, reducing further...`);
          keepCount--;
          continue;
        }

        try {
          await chrome.storage.local.set({
            [this.storageKey]: trimmedSnapshots
          });
          savedSuccessfully = true;
          if (snapshotmanagerLogger) snapshotmanagerLogger.info(`✅ Saved snapshot with ${keepCount} total snapshots (${testSizeMB}MB)`);
        } catch (error) {
          if (snapshotmanagerLogger) snapshotmanagerLogger.warn(`❌ Failed to save with ${keepCount} snapshots, reducing...`);
          keepCount--;
        }
      }

      if (!savedSuccessfully) {
        if (snapshotmanagerLogger) snapshotmanagerLogger.error('🔴 Unable to save snapshot even after aggressive cleanup');
        await chrome.storage.local.set({ [this.storageKey]: [newSnapshot] });
        if (snapshotmanagerLogger) snapshotmanagerLogger.info('⚠️ Saved only the new snapshot, all old snapshots removed');
      }
    } catch (error) {
      await this._logDetailedError('_handleQuotaExceeded', error);
      throw new Error(`Quota recovery failed: ${error.message}`);
    }
  }

  /**
   * Clear current bookmarks (except root folders)
   * @private
   */
  async _clearCurrentBookmarks(rootNode, results, progressCallback) {
    const queue = [];

    if (rootNode.children) {
      for (const child of rootNode.children) {
        if (['1', '2', '3'].includes(child.id)) {
          if (child.children) {
            queue.push(...child.children);
          }
        }
      }
    }

    const total = queue.length;
    let processed = 0;

    for (const node of queue) {
      try {
        await chrome.bookmarks.removeTree(node.id);

        if (node.url) {
          results.bookmarksRemoved++;
        } else {
          results.foldersDeleted++;
        }

        processed++;
        const progress = 20 + Math.floor((processed / total) * 30);
        progressCallback?.({ stage: 'clearing', progress, message: `Clearing... (${processed}/${total})` });
      } catch (error) {
        if (snapshotmanagerLogger) snapshotmanagerLogger.warn(`Failed to remove node ${node.id}:`, error);
        results.errors.push(`Failed to remove: ${node.title || node.url}`);
      }
    }
  }

  /**
   * Restore bookmark tree from snapshot
   * @private
   */
  async _restoreBookmarkTree(snapshotTree, results, progressCallback) {
    const folderMap = new Map();
    folderMap.set('0', '0');
    folderMap.set('1', '1');
    folderMap.set('2', '2');
    folderMap.set('3', '3');

    const allNodes = [];
    const collectNodes = (node, depth = 0) => {
      if (node.id !== '0' && !['1', '2', '3'].includes(node.id)) {
        allNodes.push({ node, depth });
      }
      if (node.children) {
        node.children.forEach(child => collectNodes(child, depth + 1));
      }
    };

    collectNodes(snapshotTree);

    allNodes.sort((a, b) => a.depth - b.depth);

    const total = allNodes.length;
    let processed = 0;

    for (const { node } of allNodes) {
      try {
        const parentId = folderMap.get(node.parentId);

        if (!parentId) {
          if (snapshotmanagerLogger) snapshotmanagerLogger.warn(`Parent not found for node ${node.id}, skipping...`);
          continue;
        }

        if (node.url) {
          const bookmark = await chrome.bookmarks.create({
            parentId: parentId,
            title: node.title,
            url: node.url,
            index: node.index
          });

          results.bookmarksRestored++;
          folderMap.set(node.id, bookmark.id);
        } else {
          const folder = await chrome.bookmarks.create({
            parentId: parentId,
            title: node.title,
            index: node.index
          });

          results.foldersCreated++;
          folderMap.set(node.id, folder.id);
        }

        processed++;
        const progress = 50 + Math.floor((processed / total) * 45);
        progressCallback?.({ stage: 'restoring', progress, message: `Restoring... (${processed}/${total})` });
      } catch (error) {
        if (snapshotmanagerLogger) snapshotmanagerLogger.error(`Failed to restore node ${node.id}:`, error);
        results.errors.push(`Failed to restore: ${node.title || node.url}`);
      }
    }
  }

  /**
   * Generate unique snapshot ID
   * @private
   */
  _generateSnapshotId() {
    return `snapshot_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Get storage usage information
   * @returns {Promise<Object>} Storage usage stats
   */
  async getStorageInfo() {
    try {
      const result = await chrome.storage.local.get([this.storageKey]);
      const snapshots = result[this.storageKey] || [];

      if (!Array.isArray(snapshots)) {
        if (snapshotmanagerLogger) snapshotmanagerLogger.warn('🔴 Snapshots data corrupted in getStorageInfo');
        return {
          snapshotCount: 0,
          totalSizeBytes: 0,
          totalSizeMB: '0.00',
          maxSnapshots: this.maxSnapshots,
          warning: 'Snapshots data corrupted'
        };
      }

      const totalSize = new Blob([JSON.stringify(snapshots)]).size;
      const storageState = await this._getStorageState();

      return {
        snapshotCount: snapshots.length,
        totalSizeBytes: totalSize,
        totalSizeMB: (totalSize / (1024 * 1024)).toFixed(2),
        maxSnapshots: this.maxSnapshots,
        quotaUsagePercent: storageState?.usagePercent || 'N/A',
        quotaRemainingMB: storageState?.quotaRemainingMB || 'N/A'
      };
    } catch (error) {
      await this._logDetailedError('getStorageInfo', error);
      return {
        snapshotCount: 0,
        totalSizeBytes: 0,
        totalSizeMB: '0.00',
        maxSnapshots: this.maxSnapshots,
        error: error.message
      };
    }
  }

  /**
   * Run diagnostics on snapshot storage
   * @returns {Promise<Object>} Diagnostic report
   */
  async runDiagnostics() {
    try {
      if (snapshotmanagerLogger) snapshotmanagerLogger.info('🔍 Running snapshot storage diagnostics...');

      const storageState = await this._getStorageState();
      const repairResult = await this._detectAndRepairCorruption();
      const storageInfo = await this.getStorageInfo();

      const diagnostics = {
        timestamp: new Date().toISOString(),
        storageState,
        repairResult,
        storageInfo,
        health: 'unknown'
      };

      if (repairResult.removed > 0) {
        diagnostics.health = 'repaired';
      } else if (storageInfo.error) {
        diagnostics.health = 'critical';
      } else if (parseFloat(storageState?.usagePercent || 0) > 90) {
        diagnostics.health = 'warning';
      } else {
        diagnostics.health = 'good';
      }

      if (snapshotmanagerLogger) snapshotmanagerLogger.info('📊 Diagnostics complete:', diagnostics);
      return diagnostics;

    } catch (error) {
      await this._logDetailedError('runDiagnostics', error);
      return {
        timestamp: new Date().toISOString(),
        health: 'critical',
        error: error.message
      };
    }
  }
}

if (typeof window !== 'undefined') {
  window.SnapshotManager = SnapshotManager;
}

if (typeof self !== 'undefined' && typeof window === 'undefined') {
  self.SnapshotManager = SnapshotManager;
}
