/**
 * BookmarkMind - Memory Manager
 * Monitors memory usage and implements automatic cleanup
 */

class MemoryManager {
  constructor() {
    this.MEMORY_THRESHOLD_MB = 100;
    this.CHECK_INTERVAL_MS = 60000; // Check every minute
    this.monitoringTimer = null;
    this.services = new Map();
    this.lastCleanup = Date.now();
    this.MIN_CLEANUP_INTERVAL = 300000; // 5 minutes
  }

  /**
   * Start monitoring memory usage
   */
  startMonitoring() {
    if (this.monitoringTimer) {
      return;
    }

    console.log('📊 Memory monitoring started');

    this.monitoringTimer = setInterval(() => {
      this.checkMemoryUsage();
    }, this.CHECK_INTERVAL_MS);

    this.checkMemoryUsage();
  }

  /**
   * Stop monitoring
   */
  stopMonitoring() {
    if (this.monitoringTimer) {
      clearInterval(this.monitoringTimer);
      this.monitoringTimer = null;
      console.log('📊 Memory monitoring stopped');
    }
  }

  /**
   * Check current memory usage
   */
  async checkMemoryUsage() {
    try {
      if (typeof performance !== 'undefined' && performance.memory) {
        const memoryMB = performance.memory.usedJSHeapSize / (1024 * 1024);
        const limitMB = performance.memory.jsHeapSizeLimit / (1024 * 1024);
        const usagePercent = (memoryMB / limitMB) * 100;

        console.log(`💾 Memory usage: ${memoryMB.toFixed(2)}MB / ${limitMB.toFixed(2)}MB (${usagePercent.toFixed(1)}%)`);

        if (memoryMB > this.MEMORY_THRESHOLD_MB || usagePercent > 75) {
          console.warn(`⚠️ High memory usage detected: ${memoryMB.toFixed(2)}MB`);
          await this.triggerCleanup();
        }
      }
    } catch (error) {
      console.error('Error checking memory usage:', error);
    }
  }

  /**
   * Trigger cleanup operations
   */
  async triggerCleanup() {
    const now = Date.now();

    if (now - this.lastCleanup < this.MIN_CLEANUP_INTERVAL) {
      console.log('⏭️ Skipping cleanup - too soon since last cleanup');
      return;
    }

    console.log('🧹 Triggering memory cleanup...');
    this.lastCleanup = now;

    try {
      await this.cleanupCaches();

      await this.cleanupOldData();

      /* istanbul ignore next */ if (typeof gc !== 'undefined' && typeof gc === 'function') {
        gc();
        console.log('🗑️ Garbage collection triggered');
      }

      console.log('✅ Memory cleanup completed');
    } catch (error) {
      console.error('Error during cleanup:', error);
    }
  }

  /**
   * Clean up caches
   */
  async cleanupCaches() {
    console.log('🗑️ Cleaning up caches...');

    if (typeof FolderManager !== 'undefined') {
      const folderManager = this.getService('folderManager', () => new FolderManager());
      folderManager.invalidateCache();
      console.log('  ✓ FolderManager cache cleared');
    }

    if (typeof SnapshotManager !== 'undefined') {
      const snapshotManager = this.getService('snapshotManager', () => new SnapshotManager());
      const snapshots = await snapshotManager.getSnapshots();

      if (snapshots.length > snapshotManager.maxSnapshots) {
        const toRemove = snapshots.length - snapshotManager.maxSnapshots;
        const oldestSnapshots = snapshots
          .sort((a, b) => a.timestamp - b.timestamp)
          .slice(0, toRemove);

        for (const snapshot of oldestSnapshots) {
          await snapshotManager.deleteSnapshot(snapshot.id);
          console.log(`  ✓ Deleted old snapshot: ${snapshot.id}`);
        }
      }
    }
  }

  /**
   * Clean up old data from storage
   */
  async cleanupOldData() {
    console.log('🗑️ Cleaning up old data...');

    try {
      const allData = await chrome.storage.local.get(null);
      const now = Date.now();
      const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;
      const keysToRemove = [];

      for (const key of Object.keys(allData)) {
        if (key.startsWith('ai_moved_')) {
          const timestamp = allData[key];
          if (now - timestamp > THIRTY_DAYS) {
            keysToRemove.push(key);
          }
        }
      }

      if (keysToRemove.length > 0) {
        await chrome.storage.local.remove(keysToRemove);
        console.log(`  ✓ Removed ${keysToRemove.length} old metadata entries`);
      }
    } catch (error) {
      console.error('Error cleaning up old data:', error);
    }
  }

  /**
   * Get or create service instance with lazy loading
   * @param {string} name - Service name
   * @param {Function} factory - Factory function to create service
   * @returns {Object} Service instance
   */
  getService(name, factory) {
    if (!this.services.has(name)) {
      console.log(`⚡ Lazy loading service: ${name}`);
      this.services.set(name, factory());
    }
    return this.services.get(name);
  }

  /**
   * Unload unused service
   * @param {string} name - Service name
   */
  unloadService(name) {
    if (this.services.has(name)) {
      this.services.delete(name);
      console.log(`🗑️ Unloaded service: ${name}`);
    }
  }

  /**
   * Get memory statistics
   * @returns {Object} Memory stats
   */
  getStats() {
    const stats = {
      monitoring: !!this.monitoringTimer,
      lastCleanup: this.lastCleanup,
      loadedServices: Array.from(this.services.keys())
    };

    if (typeof performance !== 'undefined' && performance.memory) {
      stats.usedMB = (performance.memory.usedJSHeapSize / (1024 * 1024)).toFixed(2);
      stats.limitMB = (performance.memory.jsHeapSizeLimit / (1024 * 1024)).toFixed(2);
      stats.usagePercent = ((performance.memory.usedJSHeapSize / performance.memory.jsHeapSizeLimit) * 100).toFixed(1);
    }

    return stats;
  }
}

if (typeof window !== 'undefined') {
  window.MemoryManager = MemoryManager;
}

if (typeof self !== 'undefined' && typeof window === 'undefined') {
  self.MemoryManager = MemoryManager;
}

