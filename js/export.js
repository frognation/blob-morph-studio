// export.js — PNG and SVG export utilities

/**
 * Export the main canvas as a PNG file.
 * @param {HTMLCanvasElement} canvas
 * @param {string} filename
 */
function exportPNG(canvas, filename = 'blobmorph.png') {
    const link = document.createElement('a');
    link.download = filename;
    link.href = canvas.toDataURL('image/png');
    link.click();
}

/**
 * Export all visible chains as an SVG file.
 * @param {BlobChain[]} chains
 * @param {number} width
 * @param {number} height
 * @param {string} bgColor
 * @param {string} filename
 */
function exportSVG(chains, width, height, bgColor = '#1a1a2e', filename = 'blobmorph.svg') {
    const paths = [];

    for (const chain of chains) {
        if (!chain.visible || !chain.isValid()) continue;

        const d = splineToSVGPath(chain.particles, chain.closed);
        if (!d) continue;

        const fillColor  = chain.showFilled  ? hexToRgba(chain.color, 0.35) : 'none';
        const strokeColor = chain.showOutline ? chain.color : 'none';
        const strokeW    = chain.showOutline  ? chain.lineWidth : 0;

        paths.push(`  <path d="${d}" fill="${fillColor}" stroke="${strokeColor}" stroke-width="${strokeW}" stroke-linejoin="round" stroke-linecap="round"/>`);
    }

    const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="${width}" height="${height}" fill="${bgColor}"/>
${paths.join('\n')}
</svg>`;

    const blob = new Blob([svg], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.download = filename;
    link.href = url;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Export current animation as a WebM video using MediaRecorder.
 * Records for `durationMs` milliseconds.
 */
function exportVideo(canvas, durationMs = 3000, filename = 'blobmorph.webm') {
    return new Promise((resolve, reject) => {
        if (!canvas.captureStream) {
            reject(new Error('captureStream not supported'));
            return;
        }
        const stream = canvas.captureStream(30);
        const recorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp9' });
        const chunks = [];

        recorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };
        recorder.onstop = () => {
            const blob = new Blob(chunks, { type: 'video/webm' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.download = filename;
            link.href = url;
            link.click();
            setTimeout(() => URL.revokeObjectURL(url), 2000);
            resolve();
        };

        recorder.start();
        setTimeout(() => recorder.stop(), durationMs);
    });
}

/**
 * Export scene state as JSON (for save/reload).
 */
function exportJSON(chains, physics) {
    const state = {
        version: '1.0',
        timestamp: new Date().toISOString(),
        physics: {
            stiffness: physics.stiffness,
            damping: physics.damping,
            chaos: physics.chaos,
            inflation: physics.inflation,
            timeStep: physics.timeStep,
            gravity: physics.gravity
        },
        chains: chains.map(c => ({
            id: c.id, label: c.label, color: c.color,
            lineWidth: c.lineWidth, showFilled: c.showFilled,
            showOutline: c.showOutline, closed: c.closed,
            particles: c.particles.map(p => ({
                x: p.x, y: p.y, vx: p.vx, vy: p.vy,
                pinned: p.pinned, frozen: p.frozen
            }))
        }))
    };

    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.download = 'blobmorph-scene.json';
    link.href = url;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return state;
}

/**
 * Load a JSON scene state and return { chains, physics }.
 */
function loadJSON(jsonText) {
    const state = JSON.parse(jsonText);
    const chains = state.chains.map(c => {
        const chain = new BlobChain();
        chain.id = c.id; chain.label = c.label; chain.color = c.color;
        chain.lineWidth = c.lineWidth; chain.showFilled = c.showFilled;
        chain.showOutline = c.showOutline; chain.closed = c.closed;
        c.particles.forEach(p => {
            const part = new Particle(p.x, p.y);
            part.vx = p.vx; part.vy = p.vy;
            part.pinned = p.pinned; part.frozen = p.frozen;
            chain.particles.push(part);
        });
        chain.initRestLengths();
        return chain;
    });
    return { chains, physics: state.physics };
}
