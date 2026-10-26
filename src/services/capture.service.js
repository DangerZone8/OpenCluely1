const { desktopCapturer, screen } = require('electron');
const logger = require('../core/logger').createServiceLogger('CAPTURE');

class CaptureService {
  constructor() {
    this.isProcessing = false;
  }

  listDisplays() {
    try {
      const displays = screen.getAllDisplays().map(d => ({
        id: d.id,
        bounds: d.bounds,
        size: d.size,
        scaleFactor: d.scaleFactor,
        rotation: d.rotation,
        touchSupport: d.touchSupport || 'unknown'
      }));
      return { success: true, displays };
    } catch (error) {
      logger.error('Failed to list displays', { error: error.message });
      return { success: false, error: error.message };
    }
  }

  /**
   * Capture screenshot and return an image buffer.
   * options: { displayId?: number, area?: { x, y, width, height } }
   */
  async captureAndProcess(options = {}) {
    if (this.isProcessing) throw new Error('Capture already in progress');
    this.isProcessing = true;
    const startTime = Date.now();
    try {
      const { image, metadata } = await this.captureScreenshot(options);

      // Crop if area specified
      let finalImage = image;
      if (options.area && this._isValidArea(options.area)) {
        try {
          finalImage = image.crop(options.area);
        } catch (e) {
          logger.warn('Crop failed, returning full image', { error: e.message, area: options.area });
        }
      }

      // Screen-aware AI needs readable UI text, not lossless full-resolution PNGs.
      // Downscale very large displays and encode as JPEG to reduce request bytes.
      const originalSize = finalImage.getSize();
      const maxWidth = 1600;
      const maxHeight = 1000;
      const scale = Math.min(1, maxWidth / originalSize.width, maxHeight / originalSize.height);
      if (scale < 1) {
        finalImage = finalImage.resize({
          width: Math.max(1, Math.round(originalSize.width * scale)),
          height: Math.max(1, Math.round(originalSize.height * scale)),
          quality: 'good'
        });
      }
      const jpegQuality = 72;
      const buffer = finalImage.toJPEG(jpegQuality);
      logger.logPerformance('Compressed screenshot capture', startTime, {
        bytes: buffer.length,
        originalDimensions: originalSize,
        dimensions: finalImage.getSize(),
        mimeType: 'image/jpeg',
        jpegQuality
      });

      return {
        imageBuffer: buffer,
        mimeType: 'image/jpeg',
        metadata: {
          timestamp: new Date().toISOString(),
          source: metadata,
          originalDimensions: originalSize,
          dimensions: finalImage.getSize(),
          compression: { format: 'jpeg', quality: jpegQuality, maxWidth, maxHeight },
          processingTime: Date.now() - startTime
        }
      };
    } finally {
      this.isProcessing = false;
    }
  }

  async captureScreenshot(options = {}) {
    const targetDisplay = this._getTargetDisplay(options.displayId);
    const { width, height } = targetDisplay.size || { width: 1920, height: 1080 };

    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width, height }
    });

    if (sources.length === 0) {
      throw new Error('No screen sources available for capture');
    }

    // Prefer Electron's explicit display mapping. Equal-sized monitors are common,
    // so dimensions alone must not select a different display when display_id exists.
    const usableSources = sources.filter(source =>
      source && source.thumbnail && typeof source.thumbnail.getSize === 'function'
    );
    if (usableSources.length === 0) {
      throw new Error('No usable screen thumbnails available for capture');
    }

    const displayMatch = usableSources.find(source =>
      source.display_id != null && String(source.display_id) !== '' &&
      String(source.display_id) === String(targetDisplay.id)
    );
    const sizeMatch = usableSources.find(source => {
      const size = source.thumbnail.getSize();
      return size && size.width === width && size.height === height;
    });
    const source = displayMatch || sizeMatch || usableSources[0];
    const image = source.thumbnail;

    logger.debug('Screenshot captured successfully', {
      sourceName: source.name,
      imageSize: image.getSize()
    });

    return {
      image,
      metadata: {
        displayId: targetDisplay.id,
        sourceName: source.name,
        dimensions: image.getSize(),
        captureTime: new Date().toISOString()
      }
    };
  }

  _getTargetDisplay(displayId) {
    const all = screen.getAllDisplays();
    if (!all || all.length === 0) return screen.getPrimaryDisplay();
    if (displayId == null) return screen.getPrimaryDisplay();
    const found = all.find(d => d.id === displayId);
    return found || screen.getPrimaryDisplay();
  }

  _isValidArea(area) {
    return area && Number.isFinite(area.x) && Number.isFinite(area.y) &&
      Number.isFinite(area.width) && Number.isFinite(area.height) &&
      area.width > 0 && area.height > 0;
  }
}

module.exports = new CaptureService();
