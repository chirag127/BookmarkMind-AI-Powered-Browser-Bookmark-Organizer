/**
 * BookmarkMind - Folder Manager
 * Handles folder operations and bookmark organization with intelligent caching
 */

class FolderManager {
  constructor() {
    this.folderCache = new Map();
    this.treeCache = null;
    this.treeCacheTimestamp = null;
    this.TREE_CACHE_TTL = 30000; // 30 seconds
    this.childrenCache = new Map();
    this.CHILDREN_CACHE_TTL = 10000; // 10 seconds
    this.preloadTimer = null;
  }

  /**
   * Preload folder structure into cache
   * @param {string} rootId - Root folder ID to preload
   * @returns {Promise<void>}
   */
  async preloadFolderStructure(rootId = '1') {
    try {
      console.log('📦 Preloading folder structure...');
      const startTime = Date.now();

      const tree = await chrome.bookmarks.getSubTree(rootId);
      this.treeCache = tree[0];
      this.treeCacheTimestamp = Date.now();

      await this._preloadChildrenRecursive(tree[0]);

      console.log(`✅ Folder structure preloaded in ${Date.now() - startTime}ms`);
    } catch (error) {
      console.error('Error preloading folder structure:', error);
    }
  }

  /**
   * Recursively preload children into cache
   * @private
   */
  async _preloadChildrenRecursive(node) {
    if (!node || !node.id) return;

    if (node.children) {
      const folders = node.children.filter(child => !child.url);
      const bookmarks = node.children.filter(child => child.url);

      this.childrenCache.set(node.id, {
        children: node.children,
        folders,
        bookmarks,
        timestamp: Date.now()
      });

      for (const child of folders) {
        await this._preloadChildrenRecursive(child);
      }
    }
  }

  /**
   * Schedule automatic cache preloading
   * @param {number} interval - Preload interval in milliseconds (default: 60s)
   */
  schedulePreloading(interval = 60000) {
    if (this.preloadTimer) {
      clearInterval(this.preloadTimer);
    }

    this.preloadTimer = setInterval(() => {
      this.preloadFolderStructure();
    }, interval);

    this.preloadFolderStructure();
  }

  /**
   * Stop automatic preloading
   */
  stopPreloading() {
    if (this.preloadTimer) {
      clearInterval(this.preloadTimer);
      this.preloadTimer = null;
    }
  }

  /**
   * Get cached children or fetch from Chrome API
   * @private
   */
  async _getCachedChildren(parentId) {
    const cached = this.childrenCache.get(parentId);

    if (cached && (Date.now() - cached.timestamp) < this.CHILDREN_CACHE_TTL) {
      return cached.children;
    }

    const children = await chrome.bookmarks.getChildren(parentId);
    this.childrenCache.set(parentId, {
      children,
      folders: children.filter(c => !c.url),
      bookmarks: children.filter(c => c.url),
      timestamp: Date.now()
    });

    return children;
  }

  /**
   * Batch get multiple folder children with single cache lookup
   * @param {Array<string>} parentIds - Array of parent IDs
   * @returns {Promise<Map>} Map of parentId to children
   */
  async batchGetChildren(parentIds) {
    const results = new Map();
    const uncachedIds = [];

    for (const parentId of parentIds) {
      const cached = this.childrenCache.get(parentId);
      if (cached && (Date.now() - cached.timestamp) < this.CHILDREN_CACHE_TTL) {
        results.set(parentId, cached.children);
      } else {
        uncachedIds.push(parentId);
      }
    }

    await Promise.all(uncachedIds.map(async (parentId) => {
      try {
        const children = await chrome.bookmarks.getChildren(parentId);
        this.childrenCache.set(parentId, {
          children,
          folders: children.filter(c => !c.url),
          bookmarks: children.filter(c => c.url),
          timestamp: Date.now()
        });
        results.set(parentId, children);
      } catch (error) {
        console.error(`Error fetching children for ${parentId}:`, error);
        results.set(parentId, []);
      }
    }));

    return results;
  }

  /**
   * Create folder structure for categories
   * @param {Array} categories - List of categories
   * @returns {Promise<Object>} Mapping of category to folder ID
   */
  async createCategoryFolders(categories) {
    const folderMap = {};

    for (const category of categories) {
      try {
        const folderId = await this._createCategoryFolder(category);
        folderMap[category] = folderId;
      } catch (error) {
        console.error(`Error creating folder for category ${category}:`, error);
      }
    }

    return folderMap;
  }

  /**
   * Create or find folder for a category (supports nested paths)
   * @param {string} categoryPath - Category path (e.g., "Work/Projects/Current")
   * @param {string} parentId - Parent folder ID
   * @returns {Promise<string>} Folder ID
   */
  async _createCategoryFolder(categoryPath, parentId = '1') {
    const cacheKey = `${parentId}:${categoryPath}`;
    if (this.folderCache.has(cacheKey)) {
      return this.folderCache.get(cacheKey);
    }

    const parts = categoryPath.split('/').map(part => part.trim()).filter(part => part);
    let currentParentId = parentId;

    for (const part of parts) {
      const existingFolder = await this._findFolderByName(part, currentParentId);

      if (existingFolder) {
        currentParentId = existingFolder.id;
      } else {
        const newFolder = await this._createFolder(part, currentParentId);
        currentParentId = newFolder.id;
      }
    }

    this.folderCache.set(cacheKey, currentParentId);
    return currentParentId;
  }

  /**
   * Find folder by name in parent (cache-optimized)
   * @param {string} name - Folder name
   * @param {string} parentId - Parent folder ID
   * @returns {Promise<Object|null>} Folder object or null
   */
  async _findFolderByName(name, parentId) {
    try {
      const children = await this._getCachedChildren(parentId);
      return children.find(child => !child.url && child.title === name) || null;
    } catch (error) {
      console.error('Error finding folder:', error);
      return null;
    }
  }

  /**
   * Create a new folder
   * @param {string} title - Folder title
   * @param {string} parentId - Parent folder ID
   * @returns {Promise<Object>} Created folder
   */
  async _createFolder(title, parentId) {
    try {
      const folder = await chrome.bookmarks.create({
        parentId: parentId,
        title: title
      });

      this.childrenCache.delete(parentId);

      console.log(`Created folder: ${title} in ${parentId}`);
      return folder;
    } catch (error) {
      console.error(`Error creating folder ${title}:`, error);
      throw error;
    }
  }

  /**
   * Move multiple bookmarks to folders efficiently (batch optimized)
   * @param {Array} moves - Array of {bookmarkId, folderId} objects
   * @returns {Promise<Object>} Results summary
   */
  async moveBookmarksToFolders(moves) {
    const results = {
      success: 0,
      errors: 0,
      errorDetails: []
    };

    const BATCH_SIZE = 10;
    const metadataEntries = {};

    for (let i = 0; i < moves.length; i += BATCH_SIZE) {
      const batch = moves.slice(i, i + BATCH_SIZE);

      await Promise.all(batch.map(async (move) => {
        try {
          metadataEntries[`ai_moved_${move.bookmarkId}`] = Date.now();

          await chrome.bookmarks.move(move.bookmarkId, {
            parentId: move.folderId
          });
          results.success++;
        } catch (error) {
          console.error(`Error moving bookmark ${move.bookmarkId}:`, error);
          results.errors++;
          results.errorDetails.push({
            bookmarkId: move.bookmarkId,
            error: error.message
          });
        }
      }));
    }

    try {
      if (Object.keys(metadataEntries).length > 0) {
        await chrome.storage.local.set(metadataEntries);
      }
    } catch (metadataError) {
      console.warn('Failed to set AI metadata in batch:', metadataError);
    }

    return results;
  }

  /**
   * Get folder structure for display (cache-optimized)
   * @param {string} rootId - Root folder ID (default: bookmarks bar)
   * @returns {Promise<Object>} Folder tree structure
   */
  async getFolderStructure(rootId = '1') {
    try {
      if (this.treeCache &&
          this.treeCacheTimestamp &&
          (Date.now() - this.treeCacheTimestamp) < this.TREE_CACHE_TTL &&
          this.treeCache.id === rootId) {
        return this._buildFolderTree(this.treeCache);
      }

      const tree = await chrome.bookmarks.getSubTree(rootId);
      this.treeCache = tree[0];
      this.treeCacheTimestamp = Date.now();

      return this._buildFolderTree(tree[0]);
    } catch (error) {
      console.error('Error getting folder structure:', error);
      return null;
    }
  }

  /**
   * Build folder tree structure
   * @param {Object} node - Bookmark tree node
   * @returns {Object} Folder tree
   */
  _buildFolderTree(node) {
    const tree = {
      id: node.id,
      title: node.title,
      children: [],
      bookmarkCount: 0
    };

    if (node.children) {
      for (const child of node.children) {
        if (child.url) {
          tree.bookmarkCount++;
        } else {
          const childTree = this._buildFolderTree(child);
          tree.children.push(childTree);
          tree.bookmarkCount += childTree.bookmarkCount;
        }
      }
    }

    return tree;
  }

  /**
   * Clean up empty folders
   * @param {string} rootId - Root folder to start cleanup
   * @returns {Promise<number>} Number of folders removed
   */
  async cleanupEmptyFolders(rootId = '1') {
    let removedCount = 0;

    try {
      const tree = await this.getFolderStructure(rootId);
      removedCount = await this._removeEmptyFolders(tree);

      this.invalidateCache();
    } catch (error) {
      console.error('Error cleaning up empty folders:', error);
    }

    return removedCount;
  }

  /**
   * Recursively remove empty folders
   * @param {Object} folderTree - Folder tree node
   * @returns {Promise<number>} Number of folders removed
   */
  async _removeEmptyFolders(folderTree) {
    let removedCount = 0;

    for (const child of folderTree.children) {
      removedCount += await this._removeEmptyFolders(child);
    }

    if (folderTree.children.length === 0 && folderTree.bookmarkCount === 0 && folderTree.id !== '1') {
      try {
        await chrome.bookmarks.remove(folderTree.id);
        console.log(`Removed empty folder: ${folderTree.title}`);
        removedCount++;
      } catch (error) {
        console.error(`Error removing empty folder ${folderTree.title}:`, error);
      }
    }

    return removedCount;
  }

  /**
   * Export bookmark organization to JSON
   * @returns {Promise<Object>} Exported data
   */
  async exportOrganization() {
    try {
      const tree = await chrome.bookmarks.getTree();
      const exportData = {
        exportDate: new Date().toISOString(),
        version: '1.0.0',
        bookmarks: this._flattenBookmarkTree(tree[0])
      };

      return exportData;
    } catch (error) {
      console.error('Error exporting organization:', error);
      throw error;
    }
  }

  /**
   * Flatten bookmark tree for export
   * @param {Object} node - Tree node
   * @param {string} path - Current path
   * @returns {Array} Flattened bookmarks
   */
  _flattenBookmarkTree(node, path = '') {
    const bookmarks = [];
    const currentPath = path ? `${path}/${node.title}` : node.title;

    if (node.url) {
      bookmarks.push({
        title: node.title,
        url: node.url,
        path: path,
        dateAdded: node.dateAdded
      });
    }

    if (node.children) {
      for (const child of node.children) {
        bookmarks.push(...this._flattenBookmarkTree(child, currentPath));
      }
    }

    return bookmarks;
  }

  /**
   * Invalidate all caches
   */
  invalidateCache() {
    this.folderCache.clear();
    this.treeCache = null;
    this.treeCacheTimestamp = null;
    this.childrenCache.clear();
  }

  /**
   * Clear folder cache (legacy method, now calls invalidateCache)
   */
  clearCache() {
    this.invalidateCache();
  }

  /**
   * Get cache statistics
   * @returns {Object} Cache stats
   */
  getCacheStats() {
    return {
      folderCacheSize: this.folderCache.size,
      childrenCacheSize: this.childrenCache.size,
      treeCached: !!this.treeCache,
      treeCacheAge: this.treeCacheTimestamp ? Date.now() - this.treeCacheTimestamp : null
    };
  }
}

if (typeof window !== 'undefined') {
  window.FolderManager = FolderManager;
}

if (typeof self !== 'undefined' && typeof window === 'undefined') {
  self.FolderManager = FolderManager;
}
