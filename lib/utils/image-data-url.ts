'use client';

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
      } else {
        reject(new Error('Unable to read image file.'));
      }
    };
    reader.onerror = () => reject(new Error('Failed to read image file.'));
    reader.readAsDataURL(file);
  });
}

export async function fileToOptimizedDataUrl(file: File, maxDimension = 600): Promise<string> {
  const rawDataUrl = await readFileAsDataUrl(file);
  if (!rawDataUrl.startsWith('data:image/')) {
    throw new Error('Selected file is not a valid image.');
  }

  // Skip canvas re-encoding for SVGs or already small images under 150KB
  if (file.type === 'image/svg+xml' || file.size <= 150 * 1024) {
    return rawDataUrl;
  }

  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      try {
        let { width, height } = img;
        if (width > maxDimension || height > maxDimension) {
          const ratio = Math.min(maxDimension / width, maxDimension / height);
          width = Math.max(1, Math.round(width * ratio));
          height = Math.max(1, Math.round(height * ratio));
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(rawDataUrl);
          return;
        }

        ctx.drawImage(img, 0, 0, width, height);
        // Quality kam karke 200KB target tak le jao
        let quality = 0.82;
        let compressed = canvas.toDataURL('image/jpeg', quality);
        for (let i = 0; i < 3; i++) {
          // DataURL ka size approx check karo (base64 ~ 1.37x hota hai)
          const approxBytes = Math.round((compressed.length * 3) / 4);
          if (approxBytes <= 200 * 1024 || quality <= 0.45) break;
          quality -= 0.15;
          compressed = canvas.toDataURL('image/jpeg', quality);
        }
        resolve(compressed.startsWith('data:image/') ? compressed : rawDataUrl);
      } catch {
        resolve(rawDataUrl);
      }
    };
    img.onerror = () => resolve(rawDataUrl);
    img.src = rawDataUrl;
  });
}