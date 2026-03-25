// app.js — BlobMorph Studio main application
// Ties together physics, rendering, tools, and UI

// ─── State ─────────────────────────────────────────────────────────────────

const state = {
    tool: 'blob',           // active tool
    isDrawing: false,       // mouse held down
    activeChain: null,      // chain being drawn
    lastDrawX: -999, lastDrawY: -999,
    minDrawDist: 8,         // min pixels between new particles
    selectedChain: null,    // chain selected by select tool
    dragParticle: null,     // particle being dragged
    undoStack: [],
    color: '#60a5fa',
    lineWidth: 2,
    particleSpacing: 10,
    showFilled: true,
    showOutline: true,
    showDots: false,
    strokeStyle: 'normal',   // 'normal' | 'chain' | 'dashed'
    chainWidth: 14,
    fillOpacity: 0.28,
    bgColor: '#0f0f1a',
    showGrid: true,
    animPlaying: true,
    textPending: null,      // text waiting to be placed
};

// ─── Canvas + Engine setup ──────────────────────────────────────────────────

const canvas = document.getElementById('mainCanvas');
const ctx = canvas.getContext('2d');
let physics;

function resizeCanvas() {
    const area = document.querySelector('.canvas-area');
    canvas.width  = area.clientWidth;
    canvas.height = area.clientHeight;
    if (physics) physics.resize(canvas.width, canvas.height);
}

window.addEventListener('resize', () => { resizeCanvas(); });

// ─── Rendering ─────────────────────────────────────────────────────────────

function render() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Background
    ctx.fillStyle = state.bgColor;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Grid
    if (state.showGrid) drawGrid();

    // All committed chains
    for (const chain of physics.chains) {
        if (!chain.visible) continue;
        renderChain(chain, false);
    }

    // Active (in-progress) chain
    if (state.activeChain && state.activeChain.particles.length >= 2) {
        renderInProgressChain(state.activeChain);
    }

    // Crosshair cursor indicator when drawing
    if (state.tool === 'blob' && !state.isDrawing) {
        const last = canvas._cursorPos;
        if (last) {
            ctx.strokeStyle = 'rgba(255,255,255,0.3)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(last.x - 10, last.y); ctx.lineTo(last.x + 10, last.y);
            ctx.moveTo(last.x, last.y - 10); ctx.lineTo(last.x, last.y + 10);
            ctx.stroke();
        }
    }
}

function drawGrid() {
    const step = 24;
    ctx.strokeStyle = 'rgba(255,255,255,0.04)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = step; x < canvas.width; x += step) { ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height); }
    for (let y = step; y < canvas.height; y += step) { ctx.moveTo(0, y); ctx.lineTo(canvas.width, y); }
    ctx.stroke();
    // Major gridlines
    ctx.strokeStyle = 'rgba(255,255,255,0.075)';
    ctx.beginPath();
    for (let x = step * 5; x < canvas.width; x += step * 5) { ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height); }
    for (let y = step * 5; y < canvas.height; y += step * 5) { ctx.moveTo(0, y); ctx.lineTo(canvas.width, y); }
    ctx.stroke();
}

function renderChain(chain, isActive) {
    const pts = chain.particles;
    if (pts.length < 3) return;

    const fillAlpha = chain.fillOpacity !== undefined ? chain.fillOpacity : 0.28;
    const fillRgba  = chain.showFilled ? hexToRgba(chain.color, fillAlpha) : null;

    // Always draw fill first (behind stroke)
    if (chain.showFilled) {
        const path = buildSplinePath(pts, chain.closed, 14);
        ctx.beginPath();
        ctx.moveTo(path[0].x, path[0].y);
        for (let i = 1; i < path.length; i++) ctx.lineTo(path[i].x, path[i].y);
        if (chain.closed) ctx.closePath();
        ctx.fillStyle = fillRgba;
        ctx.fill();
    }

    // Draw stroke depending on style
    if (chain.showOutline) {
        if (chain.strokeStyle === 'chain') {
            drawChainStroke(ctx, pts, chain.closed, chain.color, chain.chainWidth, chain.lineWidth);
        } else if (chain.strokeStyle === 'dashed') {
            const path = buildSplinePath(pts, chain.closed, 14);
            ctx.beginPath();
            ctx.moveTo(path[0].x, path[0].y);
            for (let i = 1; i < path.length; i++) ctx.lineTo(path[i].x, path[i].y);
            if (chain.closed) ctx.closePath();
            ctx.strokeStyle = chain.color;
            ctx.lineWidth = chain.lineWidth;
            ctx.setLineDash([8, 6]);
            ctx.lineJoin = 'round'; ctx.lineCap = 'round';
            ctx.stroke();
            ctx.setLineDash([]);
        } else {
            // Normal stroke
            drawSpline(ctx, pts, chain.closed, chain.color, chain.lineWidth,
                       null, false, true);
        }
    }

    // Draw particles if selected or in dots mode
    if (chain.selected || state.showDots) {
        for (const p of pts) {
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.pinned ? 5 : p.frozen ? 4 : 3, 0, Math.PI * 2);
            ctx.fillStyle = p.pinned  ? '#f59e0b'
                          : p.frozen  ? '#a78bfa'
                          : 'rgba(255,255,255,0.6)';
            ctx.fill();
        }
    }

    // Selection highlight ring
    if (chain.selected) {
        const b = chain.getBounds();
        if (b) {
            const pad = 8;
            ctx.strokeStyle = 'rgba(96,165,250,0.5)';
            ctx.lineWidth = 1;
            ctx.setLineDash([4, 4]);
            ctx.strokeRect(b.minX - pad, b.minY - pad,
                           b.maxX - b.minX + pad * 2, b.maxY - b.minY + pad * 2);
            ctx.setLineDash([]);
        }
    }
}

function renderInProgressChain(chain) {
    const pts = chain.particles;
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.strokeStyle = hexToRgba(chain.color, 0.6);
    ctx.lineWidth = chain.lineWidth;
    ctx.setLineDash([5, 5]);
    ctx.stroke();
    ctx.setLineDash([]);

    // Particle dots
    for (const p of pts) {
        ctx.beginPath(); ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255,255,255,0.7)'; ctx.fill();
    }

    // Closing line if near start
    if (pts.length > 5) {
        const dx = pts[pts.length - 1].x - pts[0].x;
        const dy = pts[pts.length - 1].y - pts[0].y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 40) {
            ctx.beginPath();
            ctx.arc(pts[0].x, pts[0].y, 14, 0, Math.PI * 2);
            ctx.strokeStyle = 'rgba(96,165,250,0.8)'; ctx.lineWidth = 1.5;
            ctx.stroke();
        }
    }
}

// ─── Animation Loop ─────────────────────────────────────────────────────────

function loop() {
    physics.update();
    render();
    requestAnimationFrame(loop);
}

// ─── Input helpers ──────────────────────────────────────────────────────────

function getCanvasPos(e) {
    const r = canvas.getBoundingClientRect();
    const t = e.touches ? e.touches[0] : e;
    return { x: t.clientX - r.left, y: t.clientY - r.top };
}

function commitActiveChain() {
    const chain = state.activeChain;
    if (!chain || !chain.isValid()) { state.activeChain = null; return; }
    chain.closed = true;
    pushUndo();
    physics.addChain(chain);
    state.activeChain = null;
}

// ─── Mouse / Touch events ───────────────────────────────────────────────────

canvas.addEventListener('mousemove', e => {
    const pos = getCanvasPos(e);
    canvas._cursorPos = pos;

    if (state.tool === 'blob' && state.isDrawing && state.activeChain) {
        const dx = pos.x - state.lastDrawX, dy = pos.y - state.lastDrawY;
        if (dx * dx + dy * dy >= state.minDrawDist * state.minDrawDist) {
            state.activeChain.addParticle(pos.x, pos.y);
            state.lastDrawX = pos.x; state.lastDrawY = pos.y;
        }
    }

    if (state.tool === 'select' && state.dragParticle) {
        state.dragParticle.x = pos.x;
        state.dragParticle.y = pos.y;
        state.dragParticle.vx = 0; state.dragParticle.vy = 0;
    }
});

canvas.addEventListener('mousedown', e => {
    const pos = getCanvasPos(e);
    state.isDrawing = true;

    if (state.tool === 'blob') {
        state.activeChain = new BlobChain();
        state.activeChain.color       = state.color;
        state.activeChain.lineWidth   = state.lineWidth;
        state.activeChain.showFilled  = state.showFilled;
        state.activeChain.showOutline = state.showOutline;
        state.activeChain.strokeStyle = state.strokeStyle;
        state.activeChain.chainWidth  = state.chainWidth;
        state.activeChain.fillOpacity = state.fillOpacity;
        state.activeChain.addParticle(pos.x, pos.y);
        state.lastDrawX = pos.x; state.lastDrawY = pos.y;

    } else if (state.tool === 'text' && state.textPending) {
        // Place pending text blobs
        placePendingText(pos.x, pos.y);

    } else if (state.tool === 'select') {
        // Find closest chain/particle
        let bestDist = 20, bestChain = null, bestPart = null;
        for (const chain of physics.chains) {
            const hit = chain.closestParticle(pos.x, pos.y, bestDist);
            if (hit) { bestDist = Math.sqrt(hit.distSq); bestChain = chain; bestPart = hit.particle; }
        }
        // Deselect previous
        if (state.selectedChain) state.selectedChain.selected = false;
        if (bestChain) {
            state.selectedChain = bestChain;
            bestChain.selected = true;
            state.dragParticle = bestPart;
        } else {
            // Click on interior to select whole chain
            for (const chain of physics.chains) {
                if (chain.containsPoint(pos.x, pos.y)) {
                    state.selectedChain = chain;
                    chain.selected = true;
                    break;
                }
            }
        }
        refreshLayerPanel();

    } else if (state.tool === 'pin') {
        toggleParticleProperty(pos.x, pos.y, 'pinned');

    } else if (state.tool === 'freeze') {
        toggleParticleProperty(pos.x, pos.y, 'frozen');

    } else if (state.tool === 'delete') {
        deleteAtPoint(pos.x, pos.y);
    }
});

canvas.addEventListener('mouseup', e => {
    state.isDrawing = false;
    state.dragParticle = null;

    if (state.tool === 'blob' && state.activeChain) {
        if (state.activeChain.particles.length >= 4) {
            commitActiveChain();
        } else {
            state.activeChain = null;
        }
    }
});

canvas.addEventListener('mouseleave', () => {
    canvas._cursorPos = null;
    if (state.isDrawing && state.tool === 'blob') {
        if (state.activeChain && state.activeChain.particles.length >= 4) commitActiveChain();
        else state.activeChain = null;
        state.isDrawing = false;
    }
});

// Touch support
canvas.addEventListener('touchstart', e => { e.preventDefault(); canvas.dispatchEvent(new MouseEvent('mousedown', { clientX: e.touches[0].clientX, clientY: e.touches[0].clientY })); }, { passive: false });
canvas.addEventListener('touchmove', e => { e.preventDefault(); canvas.dispatchEvent(new MouseEvent('mousemove', { clientX: e.touches[0].clientX, clientY: e.touches[0].clientY })); }, { passive: false });
canvas.addEventListener('touchend', e => { e.preventDefault(); canvas.dispatchEvent(new MouseEvent('mouseup')); }, { passive: false });

// ─── Tool helpers ───────────────────────────────────────────────────────────

function toggleParticleProperty(x, y, prop) {
    for (const chain of physics.chains) {
        const hit = chain.closestParticle(x, y, 18);
        if (hit) { hit.particle[prop] = !hit.particle[prop]; return; }
    }
}

function deleteAtPoint(x, y) {
    // Delete whole chain if click inside or near
    for (let i = physics.chains.length - 1; i >= 0; i--) {
        const chain = physics.chains[i];
        if (chain.containsPoint(x, y)) {
            pushUndo();
            physics.removeChain(chain.id);
            if (state.selectedChain === chain) state.selectedChain = null;
            refreshLayerPanel();
            return;
        }
        const hit = chain.closestParticle(x, y, 14);
        if (hit) {
            pushUndo();
            physics.removeChain(chain.id);
            if (state.selectedChain === chain) state.selectedChain = null;
            refreshLayerPanel();
            return;
        }
    }
}

// ─── Text Tool ──────────────────────────────────────────────────────────────

function openTextModal() {
    document.getElementById('textModal').style.display = 'flex';
    document.getElementById('modalTextInput').focus();
    updateTextPreview();
}

function updateTextPreview() {
    const text = document.getElementById('modalTextInput').value || 'BLOB';
    const fontSize = parseInt(document.getElementById('modalFontSize').value);
    const fontFamily = document.getElementById('modalFontFamily').value;

    const previewCanvas = document.getElementById('textPreviewCanvas');
    const pCtx = previewCanvas.getContext('2d');
    pCtx.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
    pCtx.fillStyle = '#0f0f1a';
    pCtx.fillRect(0, 0, previewCanvas.width, previewCanvas.height);

    // Preview the blob outlines
    const blobs = textToBlobs(text, fontFamily, fontSize, 60);
    pCtx.strokeStyle = state.color;
    pCtx.lineWidth = 1.5;
    for (const blob of blobs) {
        if (blob.points.length < 3) continue;
        pCtx.beginPath();
        pCtx.moveTo(blob.points[0].x, blob.points[0].y);
        for (const pt of blob.points) pCtx.lineTo(pt.x, pt.y);
        pCtx.closePath();
        pCtx.stroke();
    }
}

function applyTextBlobs() {
    const text = document.getElementById('modalTextInput').value.trim();
    if (!text) return;
    const fontSize = parseInt(document.getElementById('modalFontSize').value);
    const fontFamily = document.getElementById('modalFontFamily').value;
    const particleCount = parseInt(document.getElementById('modalParticleCount').value);

    const blobs = textToBlobs(text, fontFamily, fontSize, particleCount);
    if (!blobs.length) return;

    // Center the blobs
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    blobs.forEach(b => b.points.forEach(p => {
        if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
    }));
    const blobW = maxX - minX, blobH = maxY - minY;
    const ox = (canvas.width - blobW) / 2 - minX;
    const oy = (canvas.height - blobH) / 2 - minY;

    pushUndo();
    blobs.forEach((blob, i) => {
        const chain = pointsToChain(blob.points, ox, oy, state.color);
        chain.lineWidth   = state.lineWidth;
        chain.showFilled  = state.showFilled;
        chain.showOutline = state.showOutline;
        chain.strokeStyle = state.strokeStyle;
        chain.chainWidth  = state.chainWidth;
        chain.fillOpacity = state.fillOpacity;
        chain.label = `${text}[${i}]`;
        physics.addChain(chain);
    });

    document.getElementById('textModal').style.display = 'none';
    refreshLayerPanel();
}

// ─── Image Import ───────────────────────────────────────────────────────────

function handleImageImport(file) {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
        const blobs = imageToBlobs(img);
        if (!blobs.length) { alert('No edges detected. Try a higher-contrast image.'); return; }

        // Center on canvas
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        blobs.forEach(b => b.points.forEach(p => {
            if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
            if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
        }));
        const blobW = maxX - minX, blobH = maxY - minY;
        const ox = (canvas.width - blobW) / 2 - minX;
        const oy = (canvas.height - blobH) / 2 - minY;

        pushUndo();
        blobs.forEach(blob => {
            const chain = pointsToChain(blob.points, ox, oy, state.color);
            chain.lineWidth   = state.lineWidth;
            chain.showFilled  = state.showFilled;
            chain.showOutline = state.showOutline;
            chain.strokeStyle = state.strokeStyle;
            chain.chainWidth  = state.chainWidth;
            chain.fillOpacity = state.fillOpacity;
            chain.label = file.name.split('.')[0];
            physics.addChain(chain);
        });
        URL.revokeObjectURL(url);
        refreshLayerPanel();
    };
    img.src = url;
}

// ─── Undo ───────────────────────────────────────────────────────────────────

function pushUndo() {
    const snap = physics.chains.map(c => ({
        ...c,
        particles: c.particles.map(p => ({ ...p })),
        restLengths: [...c.restLengths]
    }));
    state.undoStack.push(snap);
    if (state.undoStack.length > 20) state.undoStack.shift();
}

function undo() {
    if (!state.undoStack.length) return;
    const snap = state.undoStack.pop();
    physics.chains = snap.map(s => {
        const chain = new BlobChain();
        Object.assign(chain, s);
        chain.particles = s.particles.map(p => Object.assign(new Particle(p.x, p.y), p));
        return chain;
    });
    state.selectedChain = null;
    refreshLayerPanel();
}

// ─── Layers panel ───────────────────────────────────────────────────────────

function refreshLayerPanel() {
    const list = document.getElementById('layerList');
    list.innerHTML = '';
    [...physics.chains].reverse().forEach(chain => {
        const item = document.createElement('div');
        item.className = 'layer-item' + (chain.selected ? ' selected' : '');
        item.innerHTML = `
            <span class="layer-dot" style="background:${chain.color}"></span>
            <span class="layer-name">${chain.label || 'Blob'}</span>
            <button class="layer-vis" data-id="${chain.id}" title="${chain.visible ? 'Hide' : 'Show'}">${chain.visible ? '◉' : '○'}</button>
            <button class="layer-del" data-id="${chain.id}" title="Delete">✕</button>
        `;
        item.querySelector('.layer-vis').addEventListener('click', e => {
            e.stopPropagation();
            const c = physics.getChain(+e.target.dataset.id);
            if (c) { c.visible = !c.visible; refreshLayerPanel(); }
        });
        item.querySelector('.layer-del').addEventListener('click', e => {
            e.stopPropagation();
            pushUndo();
            physics.removeChain(+e.target.dataset.id);
            if (state.selectedChain?.id === +e.target.dataset.id) state.selectedChain = null;
            refreshLayerPanel();
        });
        item.addEventListener('click', () => {
            if (state.selectedChain) state.selectedChain.selected = false;
            state.selectedChain = chain;
            chain.selected = true;
            refreshLayerPanel();
        });
        list.appendChild(item);
    });
}

// ─── UI Wiring ───────────────────────────────────────────────────────────────

function initUI() {
    // Tool buttons
    document.querySelectorAll('.tool-btn[data-tool]').forEach(btn => {
        btn.addEventListener('click', () => {
            setTool(btn.dataset.tool);
        });
    });

    function setTool(tool) {
        state.tool = tool;
        document.querySelectorAll('.tool-btn[data-tool]').forEach(b => {
            b.classList.toggle('active', b.dataset.tool === tool);
        });
        const modeLabel = document.getElementById('modeLabel');
        const modeMap = {
            blob: 'BLOB DRAW', text: 'TEXT', image: 'IMAGE IMPORT',
            select: 'SELECT', pin: 'PIN', freeze: 'FREEZE', delete: 'DELETE'
        };
        modeLabel.textContent = modeMap[tool] || tool.toUpperCase();

        // Show/hide text section
        document.getElementById('textSection').style.display = tool === 'text' ? '' : 'none';

        if (tool === 'text') openTextModal();
        if (tool === 'image') document.getElementById('imageFileInput').click();
    }

    // Play/pause
    const playBtn = document.getElementById('playBtn');
    playBtn.addEventListener('click', () => {
        const paused = physics.togglePause();
        state.animPlaying = !paused;
        playBtn.innerHTML = paused
            ? `<svg viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg>`
            : `<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>`;
    });

    // Undo
    document.getElementById('undoBtn').addEventListener('click', undo);

    // Clear
    document.getElementById('clearBtn').addEventListener('click', () => {
        if (confirm('Clear all blobs?')) { pushUndo(); physics.clear(); state.selectedChain = null; refreshLayerPanel(); }
    });

    // Color picker
    document.getElementById('colorPicker').addEventListener('input', e => {
        state.color = e.target.value;
        if (state.selectedChain) { state.selectedChain.color = state.color; }
    });

    // Line width
    document.getElementById('lineWidthSlider').addEventListener('input', e => {
        state.lineWidth = +e.target.value;
        document.getElementById('lineWidthVal').textContent = state.lineWidth + 'px';
        if (state.selectedChain) state.selectedChain.lineWidth = state.lineWidth;
    });

    // Particle spacing / size
    document.getElementById('particleSizeSlider').addEventListener('input', e => {
        state.minDrawDist = +e.target.value;
        document.getElementById('particleSizeVal').textContent = e.target.value + 'px';
    });

    // Fill / Outline toggles
    document.getElementById('fillToggle').addEventListener('click', function() {
        state.showFilled = !state.showFilled;
        this.classList.toggle('active', state.showFilled);
        if (state.selectedChain) state.selectedChain.showFilled = state.showFilled;
    });
    document.getElementById('outlineToggle').addEventListener('click', function() {
        state.showOutline = !state.showOutline;
        this.classList.toggle('active', state.showOutline);
        if (state.selectedChain) state.selectedChain.showOutline = state.showOutline;
    });
    document.getElementById('particlesToggle').addEventListener('click', function() {
        state.showDots = !state.showDots;
        this.classList.toggle('active', state.showDots);
    });

    // Stroke style toggle buttons
    document.querySelectorAll('.stroke-style-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            state.strokeStyle = btn.dataset.style;
            document.querySelectorAll('.stroke-style-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            // Show/hide chain width control
            const cwRow = document.getElementById('chainWidthRow');
            if (cwRow) cwRow.style.display = state.strokeStyle === 'chain' ? '' : 'none';
            if (state.selectedChain) state.selectedChain.strokeStyle = state.strokeStyle;
        });
    });

    // Chain width slider
    document.getElementById('chainWidthSlider')?.addEventListener('input', e => {
        state.chainWidth = +e.target.value;
        document.getElementById('chainWidthVal').textContent = e.target.value + 'px';
        if (state.selectedChain) state.selectedChain.chainWidth = state.chainWidth;
    });

    // Fill opacity slider
    document.getElementById('fillOpacitySlider')?.addEventListener('input', e => {
        state.fillOpacity = +e.target.value / 100;
        document.getElementById('fillOpacityVal').textContent = e.target.value + '%';
        if (state.selectedChain) state.selectedChain.fillOpacity = state.fillOpacity;
    });

    // Physics sliders
    const sliders = {
        stiffness:    v => physics.setStiffness(v),
        excitability: v => physics.setExcitability(v),
        inflation:    v => physics.setInflation(v),
        chaos:        v => physics.setChaos(v),
        speed:        v => physics.setSpeed(v),
    };
    Object.entries(sliders).forEach(([name, fn]) => {
        const slider = document.getElementById(name + 'Slider');
        const val    = document.getElementById(name + 'Val');
        slider.addEventListener('input', e => {
            fn(+e.target.value / 100);
            val.textContent = e.target.value + '%';
        });
        // Init
        fn(+slider.value / 100);
    });

    // Gravity
    document.getElementById('gravityToggle').addEventListener('click', function() {
        physics.gravity = !physics.gravity;
        this.classList.toggle('active', physics.gravity);
    });

    // Grid toggle
    document.getElementById('gridToggle').addEventListener('click', function() {
        state.showGrid = !state.showGrid;
        this.classList.toggle('active', state.showGrid);
    });

    // BG color
    document.getElementById('bgColorPicker').addEventListener('input', e => {
        state.bgColor = e.target.value;
    });

    // Export PNG
    document.getElementById('exportPngBtn').addEventListener('click', () => {
        // Render one clean frame
        physics._paused = true;
        render();
        exportPNG(canvas, `blobmorph-${Date.now()}.png`);
        physics._paused = !state.animPlaying;
    });

    // Export SVG
    document.getElementById('exportSvgBtn').addEventListener('click', () => {
        exportSVG(physics.chains, canvas.width, canvas.height, state.bgColor, `blobmorph-${Date.now()}.svg`);
    });

    // Export Video
    document.getElementById('exportVideoBtn')?.addEventListener('click', async () => {
        const btn = document.getElementById('exportVideoBtn');
        btn.textContent = 'RECORDING…';
        btn.disabled = true;
        try {
            await exportVideo(canvas, 4000, `blobmorph-${Date.now()}.webm`);
        } catch(e) { alert('Video export not supported in this browser.'); }
        btn.textContent = 'EXPORT VIDEO';
        btn.disabled = false;
    });

    // Save / Load JSON
    document.getElementById('saveSceneBtn')?.addEventListener('click', () => {
        exportJSON(physics.chains, physics);
    });
    document.getElementById('loadSceneBtn')?.addEventListener('click', () => {
        document.getElementById('jsonFileInput').click();
    });
    document.getElementById('jsonFileInput')?.addEventListener('change', e => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = ev => {
            try {
                const { chains, physics: phys } = loadJSON(ev.target.result);
                physics.clear();
                physics.chains = chains;
                physics._nextId = Math.max(...chains.map(c => c.id)) + 1;
                if (phys) Object.assign(physics, phys);
                refreshLayerPanel();
            } catch(err) { alert('Invalid scene file: ' + err.message); }
        };
        reader.readAsText(file);
        e.target.value = '';
    });

    // Image import
    document.getElementById('imageFileInput').addEventListener('change', e => {
        const file = e.target.files[0];
        if (file) handleImageImport(file);
        e.target.value = '';
        setTool('select');
    });

    // Text modal
    document.getElementById('confirmTextBtn').addEventListener('click', applyTextBlobs);
    document.getElementById('cancelTextBtn').addEventListener('click', () => {
        document.getElementById('textModal').style.display = 'none';
        setTool('blob');
    });
    document.getElementById('closeTextModal').addEventListener('click', () => {
        document.getElementById('textModal').style.display = 'none';
        setTool('blob');
    });
    document.getElementById('modalTextInput').addEventListener('input', debounce(updateTextPreview, 300));
    document.getElementById('modalFontSize').addEventListener('input', e => {
        document.getElementById('modalFontSizeVal').textContent = e.target.value + 'px';
        debounce(updateTextPreview, 300)();
    });
    document.getElementById('modalParticleCount').addEventListener('input', e => {
        document.getElementById('modalParticleVal').textContent = e.target.value;
    });
    document.getElementById('modalFontFamily').addEventListener('change', debounce(updateTextPreview, 200));

    // Collapsible sections
    document.querySelectorAll('.section-header').forEach(header => {
        header.addEventListener('click', () => {
            const body = header.nextElementSibling;
            const chevron = header.querySelector('.chevron');
            body.style.display = body.style.display === 'none' ? '' : 'none';
            if (chevron) chevron.textContent = body.style.display === 'none' ? '▸' : '▾';
        });
    });

    // Keyboard shortcuts
    window.addEventListener('keydown', e => {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
        switch (e.key.toLowerCase()) {
            case 'b': setTool('blob'); break;
            case 't': setTool('text'); break;
            case 'i': setTool('image'); break;
            case 'v': setTool('select'); break;
            case 'p': setTool('pin'); break;
            case 'f': setTool('freeze'); break;
            case 'd': setTool('delete'); break;
            case ' ': e.preventDefault(); document.getElementById('playBtn').click(); break;
            case 'z': if (e.metaKey || e.ctrlKey) { e.preventDefault(); undo(); } break;
            case 'escape':
                state.activeChain = null;
                if (state.selectedChain) { state.selectedChain.selected = false; state.selectedChain = null; }
                break;
        }
    });
}

function debounce(fn, ms) {
    let timer;
    return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), ms); };
}

function placePendingText(x, y) {
    if (!state.textPending) return;
    // already applied in applyTextBlobs
    state.textPending = null;
}

// ─── Init ────────────────────────────────────────────────────────────────────

function init() {
    resizeCanvas();
    physics = new PhysicsEngine(canvas.width, canvas.height);

    // Set initial physics values from slider defaults
    physics.setStiffness(0.30);
    physics.setExcitability(0.50);
    physics.setInflation(0.0);
    physics.setChaos(0.08);
    physics.setSpeed(0.50);

    initUI();
    refreshLayerPanel();
    loop();
}

window.addEventListener('load', init);
