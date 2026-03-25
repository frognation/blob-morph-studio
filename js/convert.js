// convert.js — Text and image to BlobChain conversion
// Rasterizes text/image, extracts contours, creates spring-mass blob chains

/**
 * Convert text into one or more BlobChain objects.
 * 1. Render text on offscreen canvas
 * 2. Find connected components (each letter = component)
 * 3. For each component, trace its outer boundary
 * 4. Downsample to targetParticles points
 * 5. Return array of {points[], label} records
 */
function textToBlobs(text, fontFamily, fontSize, particlesPerBlob = 80) {
    const pad = 20;
    const offW = Math.max(800, text.length * fontSize * 0.8 + pad * 2);
    const offH = fontSize * 2 + pad * 2;

    const off = document.createElement('canvas');
    off.width = offW; off.height = offH;
    const ctx = off.getContext('2d');

    ctx.fillStyle = 'black';
    ctx.fillRect(0, 0, offW, offH);

    ctx.font = `bold ${fontSize}px "${fontFamily}"`;
    ctx.fillStyle = 'white';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, pad, offH / 2);

    const imgData = ctx.getImageData(0, 0, offW, offH);
    const data = imgData.data;

    // Build binary mask (filled = 1)
    const mask = new Uint8Array(offW * offH);
    for (let i = 0; i < offW * offH; i++) {
        mask[i] = data[i * 4] > 128 ? 1 : 0;
    }

    // Connected components labeling (4-connectivity)
    const labels = new Int32Array(offW * offH);
    let nextLabel = 1;
    const componentSizes = {};

    for (let y = 0; y < offH; y++) {
        for (let x = 0; x < offW; x++) {
            if (!mask[y * offW + x]) continue;
            const topLabel  = y > 0 ? labels[(y - 1) * offW + x] : 0;
            const leftLabel = x > 0 ? labels[y * offW + (x - 1)] : 0;
            let lbl = 0;
            if (topLabel && leftLabel) {
                lbl = Math.min(topLabel, leftLabel);
                // merge — simple: overwrite larger label (good enough for text)
                if (topLabel !== leftLabel) {
                    const old = Math.max(topLabel, leftLabel);
                    for (let j = 0; j < labels.length; j++) {
                        if (labels[j] === old) labels[j] = lbl;
                    }
                    delete componentSizes[old];
                }
            } else if (topLabel) {
                lbl = topLabel;
            } else if (leftLabel) {
                lbl = leftLabel;
            } else {
                lbl = nextLabel++;
            }
            labels[y * offW + x] = lbl;
            componentSizes[lbl] = (componentSizes[lbl] || 0) + 1;
        }
    }

    // Collect boundary pixels per component
    const boundaries = {};
    for (let y = 1; y < offH - 1; y++) {
        for (let x = 1; x < offW - 1; x++) {
            if (!mask[y * offW + x]) continue;
            const lbl = labels[y * offW + x];
            if (!lbl) continue;
            // Boundary = filled pixel with at least one empty 4-neighbor
            if (!mask[(y - 1) * offW + x] || !mask[(y + 1) * offW + x] ||
                !mask[y * offW + (x - 1)] || !mask[y * offW + (x + 1)]) {
                if (!boundaries[lbl]) boundaries[lbl] = [];
                boundaries[lbl].push({ x, y });
            }
        }
    }

    const results = [];
    const minSize = fontSize * 0.5; // ignore tiny noise components

    for (const [lbl, bndPts] of Object.entries(boundaries)) {
        if ((componentSizes[lbl] || 0) < minSize * minSize * 0.05) continue;
        if (bndPts.length < 6) continue;

        // Sort boundary pixels into a continuous chain using nearest-neighbor walk
        const ordered = traceContour(bndPts);

        // Downsample
        const target = Math.min(particlesPerBlob, Math.max(20, Math.floor(ordered.length / 3)));
        const sampled = downsamplePath(ordered, target);

        results.push({ points: sampled });
    }

    return results;
}

/**
 * Trace a contour from a set of boundary pixels using nearest-neighbor walk.
 * Starts from the topmost-leftmost pixel and walks to the closest unvisited neighbor.
 */
function traceContour(pixels) {
    if (pixels.length === 0) return [];

    // Build fast lookup grid
    const minX = Math.min(...pixels.map(p => p.x));
    const minY = Math.min(...pixels.map(p => p.y));
    const maxX = Math.max(...pixels.map(p => p.x));
    const maxY = Math.max(...pixels.map(p => p.y));
    const W = maxX - minX + 1;

    const lookup = new Set(pixels.map(p => (p.y - minY) * W + (p.x - minX)));
    const visited = new Set();

    // Find topmost-leftmost pixel as start
    let start = pixels[0];
    for (const p of pixels) {
        if (p.y < start.y || (p.y === start.y && p.x < start.x)) start = p;
    }

    const path = [start];
    visited.add((start.y - minY) * W + (start.x - minX));

    // 8-directional offsets ordered for clockwise traversal
    const dirs8 = [
        { dx: 1, dy: 0 }, { dx: 1, dy: 1 }, { dx: 0, dy: 1 }, { dx: -1, dy: 1 },
        { dx: -1, dy: 0 }, { dx: -1, dy: -1 }, { dx: 0, dy: -1 }, { dx: 1, dy: -1 }
    ];

    let current = start;
    for (let iter = 0; iter < pixels.length * 3; iter++) {
        let found = false;
        // Try 8-neighbors first, then expand search radius for sparse boundaries
        for (const { dx, dy } of dirs8) {
            const nx = current.x + dx, ny = current.y + dy;
            if (nx < minX || ny < minY || nx > maxX || ny > maxY) continue;
            const key = (ny - minY) * W + (nx - minX);
            if (lookup.has(key) && !visited.has(key)) {
                const next = { x: nx, y: ny };
                path.push(next);
                visited.add(key);
                current = next;
                found = true;
                break;
            }
        }
        if (!found) break;
    }

    return path;
}

/**
 * Convert an image to BlobChains via Sobel edge detection.
 * Returns an array of {points[]} for significant contours.
 */
function imageToBlobs(imageEl, maxParticles = 120, edgeThreshold = 0.18) {
    const SIZE = 512;
    const off = document.createElement('canvas');
    off.width = SIZE; off.height = SIZE;
    const ctx = off.getContext('2d');

    // Scale to fit, maintain aspect ratio
    const iw = imageEl.naturalWidth || imageEl.width;
    const ih = imageEl.naturalHeight || imageEl.height;
    const scale = Math.min(SIZE / iw, SIZE / ih);
    const dw = iw * scale, dh = ih * scale;
    const dx = (SIZE - dw) / 2, dy = (SIZE - dh) / 2;

    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, SIZE, SIZE);
    ctx.drawImage(imageEl, dx, dy, dw, dh);

    const imgData = ctx.getImageData(0, 0, SIZE, SIZE);
    const d = imgData.data;

    // Grayscale
    const gray = new Float32Array(SIZE * SIZE);
    for (let i = 0; i < SIZE * SIZE; i++) {
        gray[i] = (d[i * 4] * 0.299 + d[i * 4 + 1] * 0.587 + d[i * 4 + 2] * 0.114) / 255;
    }

    // Sobel operator
    const edges = new Float32Array(SIZE * SIZE);
    let maxEdge = 0;
    for (let y = 1; y < SIZE - 1; y++) {
        for (let x = 1; x < SIZE - 1; x++) {
            const idx = y * SIZE + x;
            const gx = -gray[idx - SIZE - 1] + gray[idx - SIZE + 1]
                       - 2 * gray[idx - 1] + 2 * gray[idx + 1]
                       - gray[idx + SIZE - 1] + gray[idx + SIZE + 1];
            const gy = -gray[idx - SIZE - 1] - 2 * gray[idx - SIZE] - gray[idx - SIZE + 1]
                       + gray[idx + SIZE - 1] + 2 * gray[idx + SIZE] + gray[idx + SIZE + 1];
            edges[idx] = Math.sqrt(gx * gx + gy * gy);
            if (edges[idx] > maxEdge) maxEdge = edges[idx];
        }
    }

    // Threshold
    const thresh = maxEdge * edgeThreshold;
    const edgePts = [];
    for (let y = 2; y < SIZE - 2; y++) {
        for (let x = 2; x < SIZE - 2; x++) {
            if (edges[y * SIZE + x] > thresh) edgePts.push({ x, y });
        }
    }

    if (edgePts.length < 10) return [];

    // Cluster edge pixels into up to 3 largest connected components
    // For simplicity, subsample to ≤2000 pts for clustering
    const subEdge = edgePts.length > 2000
        ? edgePts.filter((_, i) => i % Math.ceil(edgePts.length / 2000) === 0)
        : edgePts;

    // Single cluster: trace the subsampled edge points
    const ordered = traceContour(subEdge);

    const target = Math.min(maxParticles, Math.max(30, Math.floor(ordered.length / 4)));
    const sampled = downsamplePath(ordered, target);

    // Offset by canvas position (dx, dy) to account for image centering
    return [{ points: sampled }];
}

/**
 * Create a BlobChain from an array of {x,y} points at offset (ox, oy).
 */
function pointsToChain(points, ox = 0, oy = 0, color = '#60a5fa') {
    const chain = new BlobChain();
    chain.color = color;
    for (const pt of points) chain.addParticle(pt.x + ox, pt.y + oy);
    chain.closed = true;
    return chain;
}
